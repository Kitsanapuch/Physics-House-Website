"""Remote, transactional Turso storage for the Physics Plus API.

Both remote drivers keep one connection open for each API request, preserving
the explicit BEGIN IMMEDIATE / COMMIT boundaries in backend.PhysicsPlusApp.
"""

from __future__ import annotations

import hashlib
import hmac
import sqlite3
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

import libsql
import turso_serverless

from backend import (
    COURSE_CATALOG,
    BRAND_CODES_MIGRATION,
    TEACHER_ROSTER_MIGRATION,
    PhysicsPlusApp,
    RATE_GRID,
    RATE_GRID_EFFECTIVE_FROM,
    RATE_GRID_MIGRATION,
    Response,
    SCHEMA,
    fail,
    migrate_outbox_schema,
    migrate_academic_schema,
    migrate_brand_codes,
    seed_initial_teachers,
    now,
    uid,
)


THROTTLE_SCHEMA = """
CREATE TABLE IF NOT EXISTS login_throttle (
  key_hash TEXT PRIMARY KEY,
  window_started INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts >= 0)
);
"""


class LibsqlRow(tuple):
    """Give libsql's tuple results the index and column-name API of sqlite3.Row."""

    def __new__(cls, values: tuple, columns: tuple[str, ...]) -> LibsqlRow:
        row = super().__new__(cls, values)
        row._columns = columns
        return row

    def __getitem__(self, key: int | slice | str):
        if isinstance(key, str):
            for index, name in enumerate(self._columns):
                if name.casefold() == key.casefold():
                    return super().__getitem__(index)
            raise IndexError(f"No item with that key: {key}")
        return super().__getitem__(key)

    def keys(self) -> list[str]:
        return list(self._columns)


class LibsqlCursor:
    def __init__(self, cursor: libsql.Cursor) -> None:
        self._cursor = cursor
        self._columns = tuple(column[0] for column in cursor.description or ())

    def __getattr__(self, name: str):
        return getattr(self._cursor, name)

    def _row(self, values: tuple | None) -> LibsqlRow | None:
        return None if values is None else LibsqlRow(values, self._columns)

    def fetchone(self) -> LibsqlRow | None:
        return self._row(self._cursor.fetchone())

    def fetchall(self) -> list[LibsqlRow]:
        return [LibsqlRow(values, self._columns) for values in self._cursor.fetchall() or ()]

    def __iter__(self):
        while (row := self.fetchone()) is not None:
            yield row


class LibsqlConnection:
    """Adapt the native libsql driver's missing sqlite3 conveniences."""

    def __init__(self, connection: libsql.Connection) -> None:
        self._connection = connection

    def __getattr__(self, name: str):
        return getattr(self._connection, name)

    @staticmethod
    def _call(operation, *args):
        try:
            return operation(*args)
        except ValueError as exc:
            # The native libsql driver reports SQLite constraint violations as
            # ValueError, while the domain API uses sqlite3.IntegrityError.
            if str(exc).lower().startswith((
                "unique constraint failed", "foreign key constraint failed",
                "check constraint failed", "not null constraint failed",
            )):
                raise sqlite3.IntegrityError("Remote database constraint failed") from exc
            raise

    def execute(self, sql: str, parameters: tuple | list = ()) -> LibsqlCursor:
        return LibsqlCursor(self._call(self._connection.execute, sql, parameters))

    def executemany(self, sql: str, parameters: list[tuple]) -> LibsqlCursor:
        return LibsqlCursor(self._call(self._connection.executemany, sql, parameters))

    def executescript(self, script: str) -> None:
        # libsql 0.1.11's executescript silently discards execute_batch errors.
        # Run complete statements individually so schema setup fails closed.
        start = 0
        for index, character in enumerate(script):
            if character == ";" and sqlite3.complete_statement(script[start:index + 1]):
                self.execute(script[start:index + 1])
                start = index + 1
        if script[start:].strip():
            self.execute(script[start:])


class ClosingRemoteConnection:
    """Context manager with sqlite3-style commit/rollback and actual close."""

    def __init__(self, connection: turso_serverless.Connection | LibsqlConnection) -> None:
        self._connection = connection

    def __getattr__(self, name: str):
        return getattr(self._connection, name)

    def __enter__(self) -> ClosingRemoteConnection:
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        try:
            if exc_type is None:
                self._connection.commit()
            else:
                self._connection.rollback()
        finally:
            self._connection.close()
        return False


class PersistentRateLimiter:
    """Share authentication attempt limits across Vercel function instances."""

    def __init__(self, owner: RemotePhysicsPlusApp) -> None:
        self.owner = owner

    def check(self, key: str, limit: int, period: int) -> None:
        if limit < 1 or period < 1:
            raise ValueError("invalid rate limit")
        digest = hmac.new(
            self.owner.auth_token.encode("utf-8"), key.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        current = now()
        with self.owner.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            # Periodic bounded cleanup keeps this table from growing forever.
            # Authentication still works if no cleanup is due in this request.
            if current % 97 == 0:
                conn.execute("DELETE FROM login_throttle WHERE window_started < ?", (current - 24 * 3600,))
            row = conn.execute(
                "SELECT window_started,attempts FROM login_throttle WHERE key_hash=?",
                (digest,),
            ).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO login_throttle(key_hash,window_started,attempts) VALUES(?,?,1)",
                    (digest, current),
                )
            elif row["window_started"] <= current - period:
                conn.execute(
                    "UPDATE login_throttle SET window_started=?, attempts=1 WHERE key_hash=?",
                    (current, digest),
                )
            elif row["attempts"] >= limit:
                fail(429, "rate_limited", "Too many attempts; try again later")
            else:
                conn.execute(
                    "UPDATE login_throttle SET attempts=attempts+1 WHERE key_hash=?",
                    (digest,),
                )
            conn.commit()


class RemotePhysicsPlusApp(PhysicsPlusApp):
    def __init__(
        self,
        database_url: str,
        auth_token: str,
        origin: str,
        extra_origins: set[str] | None = None,
    ) -> None:
        parsed = urlsplit(database_url)
        if parsed.scheme not in {"turso", "libsql"} or not parsed.hostname:
            raise ValueError("TURSO_DATABASE_URL must be a turso:// or libsql:// database URL")
        if parsed.username is not None or parsed.password is not None or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("TURSO_DATABASE_URL must not contain credentials or query text")
        if not auth_token.strip():
            raise ValueError("TURSO_AUTH_TOKEN is required")
        self.database_url = database_url.rstrip("/")
        self.database_scheme = parsed.scheme
        self.auth_token = auth_token
        # The inherited constructor's migration hook is deliberately a no-op.
        # Remote migrations are an explicit management step, never a side
        # effect of a Vercel cold start.
        super().__init__(Path("/__remote_turso__"), origin, None)
        for extra in extra_origins or set():
            parsed_origin = urlsplit(extra)
            if parsed_origin.scheme != "https" or not parsed_origin.netloc or parsed_origin.path or parsed_origin.query or parsed_origin.fragment:
                raise ValueError("Additional public origins must be exact HTTPS origins")
            self.allowed_origins.add(extra.rstrip("/"))
        self.limiter = PersistentRateLimiter(self)

    def _init_db(self) -> None:
        pass

    def connect(self) -> ClosingRemoteConnection:
        if self.database_scheme == "libsql":
            connection = LibsqlConnection(libsql.connect(
                database=self.database_url,
                auth_token=self.auth_token,
                isolation_level=None,
                timeout=30.0,
            ))
        else:
            connection = turso_serverless.connect(
                self.database_url,
                auth_token=self.auth_token,
                isolation_level=None,
            )
        try:
            if self.database_scheme == "turso":
                connection.row_factory = turso_serverless.Row
            connection.execute("PRAGMA foreign_keys=ON")
            # Turso's remote libSQL protocol rejects PRAGMA busy_timeout;
            # libsql.connect(timeout=30.0) configures the client instead.
            if self.database_scheme == "turso":
                connection.execute("PRAGMA busy_timeout=30000")
            enabled = connection.execute("PRAGMA foreign_keys").fetchone()
            if enabled is None or enabled[0] != 1:
                raise RuntimeError("Remote database must enforce foreign keys")
            return ClosingRemoteConnection(connection)
        except BaseException:
            connection.close()
            raise

    def initialize_remote(self) -> None:
        """Run idempotent schema/rate initialization from a trusted CLI."""
        with self.connect() as conn:
            conn.executescript(SCHEMA + THROTTLE_SCHEMA)
            migrate_outbox_schema(conn)
            migrate_academic_schema(conn)
            migrate_brand_codes(conn)
            seed_initial_teachers(conn)
            conn.execute("BEGIN IMMEDIATE")
            if not conn.execute(
                "SELECT 1 FROM app_migrations WHERE key=?", (RATE_GRID_MIGRATION,)
            ).fetchone():
                conn.execute(
                    "DELETE FROM rate_rules WHERE state='pending_confirmation' "
                    "AND teacher_id IS NULL AND source_note LIKE 'Inferred hourly rate%'"
                )
                conn.executemany(
                    "INSERT INTO rate_rules(id,teacher_label,subject,level,min_students,max_students,"
                    "rate_satang_per_hour,effective_from,state,source_note,confirmed_at) "
                    "VALUES(?,'อัตรากลาง','all',?,?,?,?,?,'confirmed',?,?)",
                    [
                        (uid(), level, low, high, amount, RATE_GRID_EFFECTIVE_FROM, note, now())
                        for level, low, high, amount, note in RATE_GRID
                    ],
                )
                conn.execute(
                    "INSERT INTO app_migrations(key,applied_at) VALUES(?,?)",
                    (RATE_GRID_MIGRATION, now()),
                )
                self.audit(
                    conn,
                    None,
                    "rate_schedule",
                    RATE_GRID_MIGRATION,
                    "activate_owner_grid",
                    {"effective_from": RATE_GRID_EFFECTIVE_FROM, "tiers": len(RATE_GRID)},
                )
            conn.commit()

    def check_remote(self) -> dict:
        """Read-only deployment readiness check for the management CLI."""
        with self.connect() as conn:
            marker = conn.execute(
                "SELECT 1 FROM app_migrations WHERE key=?", (RATE_GRID_MIGRATION,)
            ).fetchone()
            admin_count, active_admin_count = conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(status='active'),0) FROM users WHERE role='admin'"
            ).fetchone()
            rate_rows = conn.execute(
                "SELECT level,min_students,max_students,rate_satang_per_hour,subject,effective_to "
                "FROM rate_rules WHERE teacher_id IS NULL AND state='confirmed' AND effective_from=?",
                (RATE_GRID_EFFECTIVE_FROM,),
            ).fetchall()
            expected_rates = Counter((level, low, high, amount, "all", None)
                                     for level, low, high, amount, _ in RATE_GRID)
            actual_rates = Counter(tuple(row) for row in rate_rows)
            throttle_table = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='login_throttle'"
            ).fetchone()
            outbox_columns = {row[1] for row in conn.execute("PRAGMA table_info(notification_outbox)").fetchall()}
            user_columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
            course_columns = {row[1] for row in conn.execute("PRAGMA table_info(courses)").fetchall()}
            class_columns = {row[1] for row in conn.execute("PRAGMA table_info(class_sessions)").fetchall()}
            clauses = " OR ".join("(level=? AND subject=?)" for _ in COURSE_CATALOG)
            catalog_args = tuple(value for level, subject in COURSE_CATALOG for value in (level, subject))
            invalid_active = conn.execute(
                "SELECT COUNT(*) FROM courses WHERE active=1 AND NOT (" + clauses + ")", catalog_args
            ).fetchone()[0]
            missing_codes = conn.execute(
                "SELECT (SELECT COUNT(*) FROM users WHERE role IN ('student','teacher') AND public_code IS NULL)"
                "+(SELECT COUNT(*) FROM courses WHERE course_code IS NULL OR subject_code IS NULL)"
                "+(SELECT COUNT(*) FROM class_sessions WHERE teacher_id IS NULL OR room_name IS NULL)"
            ).fetchone()[0]
            new_migrations = conn.execute(
                "SELECT COUNT(*) FROM app_migrations WHERE key IN (?,?)",
                (BRAND_CODES_MIGRATION, TEACHER_ROSTER_MIGRATION),
            ).fetchone()[0]
            return {
                "schema_initialized": bool(marker) and bool(throttle_table) and
                                      {"id", "first_attempt_at", "lease_token"}.issubset(outbox_columns) and
                                      {"public_code"}.issubset(user_columns) and
                                      {"course_code", "subject_code"}.issubset(course_columns) and
                                      {"room_name", "teacher_id"}.issubset(class_columns) and
                                      len(COURSE_CATALOG) == 8 and invalid_active == 0 and missing_codes == 0 and new_migrations == 2,
                "admin_count": admin_count,
                "active_admin_count": active_admin_count,
                "confirmed_default_rate_count": len(rate_rows),
                "default_rate_grid_matches": actual_rates == expected_rates,
                "catalog_offering_count": len(COURSE_CATALOG),
                "invalid_active_course_count": invalid_active,
                "missing_public_code_count": missing_codes,
            }

    def handle(self, method: str, target: str, data: dict | None, headers: dict[str, str], client_ip: str) -> Response:
        try:
            result = super().handle(method, target, data, headers, client_ip)
            if method == "GET" and target.split("?", 1)[0] == "/api/health" and result.status == 200:
                with self.connect() as conn:
                    conn.execute("SELECT 1").fetchone()
                return Response(200, {"ok": True, "database": "turso"})
            return result
        except turso_serverless.IntegrityError:
            return Response(409, {"error": {"code": "conflict", "message": "The requested change conflicts with existing data"}})

