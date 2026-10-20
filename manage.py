#!/usr/bin/env python3
"""Trusted one-time Turso setup commands for Physics Plus."""

from __future__ import annotations

import argparse
import getpass
import os
import sys

from turso_serverless import DatabaseError
from turso_serverless.protocol import ProtocolError

from backend import ApiError
from remote import RemotePhysicsPlusApp


def backend() -> RemotePhysicsPlusApp:
    database_url = os.getenv("TURSO_DATABASE_URL", "").strip()
    token = os.getenv("TURSO_AUTH_TOKEN", "").strip()
    # No HTTP requests are served by this process. Origin matters only for
    # cookie attributes and host checks in the deployed app.
    return RemotePhysicsPlusApp(database_url, token, "https://physics-plus.invalid")


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage the Physics Plus remote database")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Create schema and the reviewed default rate grid")
    bootstrap = sub.add_parser("bootstrap-admin", help="Create the only administrator account")
    bootstrap.add_argument("--username", default="physicsplus")
    sub.add_parser("check", help="Read-only deployment readiness check")
    args = parser.parse_args()

    try:
        owner = backend()
        if args.command == "init":
            owner.initialize_remote()
            print("Remote schema and default teacher rate grid are initialized.")
            return 0

        status = owner.check_remote()
        if not status["schema_initialized"]:
            print("Remote schema is not initialized. Run: python3 manage.py init", file=sys.stderr)
            return 1

        if args.command == "bootstrap-admin":
            if status["admin_count"] != 0:
                print("An administrator already exists; bootstrap is disabled.", file=sys.stderr)
                return 1
            if not sys.stdin.isatty():
                print("Bootstrap requires an interactive terminal for the password prompt.", file=sys.stderr)
                return 1
            password = getpass.getpass("Administrator password: ")
            confirm = getpass.getpass("Repeat administrator password: ")
            if password != confirm:
                print("Passwords do not match.", file=sys.stderr)
                return 1
            owner.bootstrap_admin(None, "ผู้ดูแล Physics Plus", password, args.username)
            print("Administrator created. No plaintext password was written to a file.")
            return 0

        print(
            "schema_initialized={schema_initialized} admin_count={admin_count} "
            "active_admin_count={active_admin_count} "
            "confirmed_default_rate_count={confirmed_default_rate_count} "
            "default_rate_grid_matches={default_rate_grid_matches}".format(**status)
        )
        ready = status["active_admin_count"] == 1 and status["default_rate_grid_matches"]
        if not ready:
            print("Database is not ready for production use.", file=sys.stderr)
        return 0 if ready else 1
    except ApiError as exc:
        print(f"Setup rejected: {exc.message}", file=sys.stderr)
        return 1
    except (DatabaseError, ProtocolError, RuntimeError, ValueError) as exc:
        # Driver errors may contain SQL or a URL. Keep setup output free of
        # tokens and connection details even on failed remote requests.
        print(f"Database setup failed ({type(exc).__name__}). Check the URL, token and database status.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
