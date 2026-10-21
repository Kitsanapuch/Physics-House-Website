"""Teacher class cancellation, student visibility, and notification security.

All identities and email delivery are synthetic.  No production records or
external mail provider are touched by these checks.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend import PhysicsPlusApp, hash_password, now, uid
from mailer import MailResult


PASSWORD = "SyntheticTestPassword123!"
REASON = "ติดธุระส่วนตัว ต้องยกคลาสครั้งนี้"


class TeacherCancellationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.owner = PhysicsPlusApp(Path(directory.name) / "school.sqlite3", "https://school.example")
        self.base_headers = {"host": "school.example", "origin": "https://school.example"}
        self.owner.bootstrap_admin(None, "Test Admin", PASSWORD, "testadmin")
        self.teacher_id = uid()
        self.other_teacher_id = uid()
        self.student_ids = [uid(), uid()]
        self.other_student_id = uid()
        with self.owner.connect() as conn:
            for user_id, email, name, role in (
                (self.teacher_id, "teacher-one@example.com", "Teacher One", "teacher"),
                (self.other_teacher_id, "teacher-two@example.com", "Teacher Two", "teacher"),
                (self.student_ids[0], "student-one@example.com", "Student One", "student"),
                (self.student_ids[1], "student-two@example.com", "Student Two", "student"),
                (self.other_student_id, "outsider@example.com", "Other Student", "student"),
            ):
                conn.execute(
                    "INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)",
                    (user_id, email, name, hash_password(PASSWORD), role, now()),
                )
            self.course_id = conn.execute(
                "SELECT id FROM courses WHERE level='high' AND subject='physics'"
            ).fetchone()[0]
        self.auth = {
            "admin": self._login("testadmin"),
            "teacher": self._login("teacher-one@example.com"),
            "other_teacher": self._login("teacher-two@example.com"),
            "student_one": self._login("student-one@example.com"),
            "student_two": self._login("student-two@example.com"),
            "outsider": self._login("outsider@example.com"),
        }
        self.class_id = self._class(self.teacher_id, now() + 86_400, self.student_ids)

    def _login(self, login_name: str) -> dict[str, str]:
        result = self.owner.handle(
            "POST", "/api/auth/login", {"login": login_name, "password": PASSWORD},
            self.base_headers, "127.0.0.1",
        )
        self.assertEqual(result.status, 200, result.body)
        return {
            **self.base_headers,
            "cookie": result.headers["Set-Cookie"].split(";", 1)[0],
            "x-csrf-token": result.body["csrf_token"],
        }

    def _class(self, teacher_id: str, start: int, students: list[str] | None = None) -> str:
        class_id = uid()
        with self.owner.connect() as conn:
            conn.execute(
                "INSERT INTO class_sessions(id,course_id,room_name,teacher_id,starts_at,ends_at,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (class_id, self.course_id, "Test Room", teacher_id, start, start + 3600, now()),
            )
            conn.executemany(
                "INSERT INTO session_students(session_id,student_id) VALUES(?,?)",
                [(class_id, student_id) for student_id in students or []],
            )
        return class_id

    def _request(self, actor: str | None, method: str, path: str, data: dict | None = None):
        return self.owner.handle(
            method, path, data,
            self.auth[actor] if actor is not None else self.base_headers,
            "127.0.0.1",
        )

    def _cancel(self, actor: str | None = "teacher", *, class_id: str | None = None,
                reason: str = REASON):
        return self._request(
            actor, "POST", f"/api/teacher/classes/{class_id or self.class_id}/cancel",
            {"reason": reason},
        )

    def test_own_future_class_cancellation_reaches_roster_and_admin_once(self) -> None:
        result = self._cancel()
        self.assertEqual(result.status, 200, result.body)
        self.assertEqual(result.body["status"], "cancelled")
        self.assertEqual(result.body["class_id"], self.class_id)
        self.assertEqual(result.body["cancellation_reason"], REASON)
        self.assertIsInstance(result.body["cancelled_at"], int)

        with self.owner.connect() as conn:
            recorded = conn.execute(
                "SELECT status FROM class_sessions WHERE id=?",
                (self.class_id,),
            ).fetchone()
            cancellation = conn.execute(
                "SELECT details,created_at FROM audit_events WHERE entity='class_session' "
                "AND entity_id=? AND action='cancel'", (self.class_id,),
            ).fetchone()
            notices = conn.execute(
                "SELECT n.event_type,n.recipient_kind,n.recipient_user_id,n.status,"
                "a.actor_id,a.entity_id FROM notification_outbox n "
                "JOIN audit_events a ON a.id=n.audit_event_id "
                "WHERE n.event_type='class_cancelled' ORDER BY n.recipient_user_id",
            ).fetchall()
        self.assertEqual(recorded["status"], "cancelled")
        self.assertEqual(json.loads(cancellation["details"])["reason"], REASON)
        self.assertLessEqual(abs(cancellation["created_at"] - result.body["cancelled_at"]), 1)
        self.assertEqual(len(notices), 3)
        self.assertEqual({n["recipient_user_id"] for n in notices if n["recipient_kind"] == "user"},
                         set(self.student_ids))
        self.assertEqual(sum(n["recipient_kind"] == "admin" for n in notices), 1)
        self.assertTrue(all(n["actor_id"] == self.teacher_id and n["entity_id"] == self.class_id
                            and n["status"] == "pending" for n in notices))

        deliveries: list[tuple[str, str | None]] = []
        dispatched = self.owner.dispatch_outbox(
            lambda address, *, event_id, event_type=None: (
                deliveries.append((address, event_type))
                or MailResult(True, "accepted", provider_id="synthetic")
            ),
            limit=5,
            admin_email="admin@example.com",
        )
        self.assertEqual(dispatched["sent"], 3)
        self.assertCountEqual(deliveries, [
            ("student-one@example.com", "class_cancelled"),
            ("student-two@example.com", "class_cancelled"),
            ("admin@example.com", "class_cancelled"),
        ])

    def test_students_see_cancelled_class_and_reason_in_their_own_view(self) -> None:
        before = self._request("teacher", "GET", "/api/teacher/dashboard")
        self.assertEqual(before.status, 200)
        self.assertTrue(next(row for row in before.body["sessions"] if row["id"] == self.class_id)["can_cancel"])
        self.assertEqual(self._cancel().status, 200)
        for actor in ("student_one", "student_two"):
            with self.subTest(actor=actor):
                response = self._request(actor, "GET", "/api/student/classes")
                self.assertEqual(response.status, 200)
                item = next(row for row in response.body["classes"] if row["id"] == self.class_id)
                self.assertEqual(item["status"], "cancelled")
                self.assertEqual(item["cancellation_reason"], REASON)
                self.assertIsInstance(item["cancelled_at"], int)
        outsider = self._request("outsider", "GET", "/api/student/classes")
        self.assertEqual(outsider.status, 200)
        self.assertNotIn(self.class_id, {row["id"] for row in outsider.body["classes"]})
        teacher = self._request("teacher", "GET", "/api/teacher/classes")
        self.assertEqual(teacher.status, 200)
        self.assertEqual(teacher.body["classes"][0]["status"], "cancelled")
        self.assertEqual(teacher.body["classes"][0]["cancellation_reason"], REASON)
        dashboard = self._request("teacher", "GET", "/api/teacher/dashboard")
        self.assertFalse(next(row for row in dashboard.body["sessions"] if row["id"] == self.class_id)["can_cancel"])

    def test_other_teacher_cannot_cancel_and_admin_can_audit_result(self) -> None:
        wrong_teacher = self._cancel("other_teacher")
        self.assertEqual(wrong_teacher.status, 404)
        self.assertEqual(self._cancel("student_one").status, 403)
        self.assertEqual(self._cancel("admin").status, 403)
        self.assertEqual(self._cancel(None).status, 401)
        self.assertEqual(self._cancel().status, 200)
        academic = self._request("admin", "GET", "/api/admin/academic")
        self.assertEqual(academic.status, 200)
        record = next(row for row in academic.body["classes"] if row["id"] == self.class_id)
        self.assertEqual(record["status"], "cancelled")
        self.assertEqual(record["cancellation_reason"], REASON)
        self.assertIsInstance(record["cancelled_at"], int)
        report = self._request("admin", "GET", "/api/admin/reports/classes")
        self.assertEqual(report.status, 200)
        exported = next(row for row in report.body["rows"] if row["id"] == self.class_id)
        self.assertEqual(exported["cancellation_reason"], REASON)

    def test_repeat_cancellation_does_not_create_duplicate_notifications(self) -> None:
        self.assertEqual(self._cancel().status, 200)
        with self.owner.connect() as conn:
            notices_before = conn.execute(
                "SELECT COUNT(*) FROM notification_outbox WHERE event_type='class_cancelled'"
            ).fetchone()[0]
            audits_before = conn.execute(
                "SELECT COUNT(*) FROM audit_events WHERE entity='class_session' "
                "AND entity_id=? AND action='cancel'", (self.class_id,),
            ).fetchone()[0]
        duplicate = self._cancel()
        self.assertEqual(duplicate.status, 409, duplicate.body)
        with self.owner.connect() as conn:
            notices_after = conn.execute(
                "SELECT COUNT(*) FROM notification_outbox WHERE event_type='class_cancelled'"
            ).fetchone()[0]
            audits_after = conn.execute(
                "SELECT COUNT(*) FROM audit_events WHERE entity='class_session' "
                "AND entity_id=? AND action='cancel'", (self.class_id,),
            ).fetchone()[0]
        self.assertEqual((notices_after, audits_after), (notices_before, audits_before))

    def test_past_attended_or_paid_class_cannot_be_cancelled(self) -> None:
        with self.owner.connect() as conn:
            conn.execute(
                "UPDATE class_sessions SET starts_at=?,ends_at=? WHERE id=?",
                (now() - 7200, now() - 3600, self.class_id),
            )
        past = self._cancel()
        self.assertEqual(past.status, 409, past.body)
        attended_class = self._class(self.teacher_id, now() + 129_600, self.student_ids)
        with self.owner.connect() as conn:
            conn.execute(
                "INSERT INTO attendance(session_id,student_id,status,recorded_by,recorded_at) "
                "VALUES(?,?,?,?,?)",
                (attended_class, self.student_ids[0], "present", self.teacher_id, now()),
            )
        attended = self._cancel(class_id=attended_class)
        self.assertEqual(attended.status, 409, attended.body)
        paid_class = self._class(self.teacher_id, now() + 172_800)
        entry_id = uid()
        with self.owner.connect() as conn:
            conn.execute(
                "INSERT INTO time_entries(id,session_id,teacher_id,actual_start,actual_end,"
                "break_minutes,status,payable_minutes,amount_satang,submitted_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (entry_id, paid_class, self.teacher_id, now() - 7200, now() - 3600,
                 0, "paid", 60, 25_000, now() - 3500),
            )
        paid = self._cancel(class_id=paid_class)
        self.assertEqual(paid.status, 409, paid.body)
        with self.owner.connect() as conn:
            self.assertEqual(conn.execute(
                "SELECT status FROM class_sessions WHERE id=?", (paid_class,)
            ).fetchone()[0], "scheduled")
            entry = conn.execute(
                "SELECT status,amount_satang FROM time_entries WHERE id=?", (entry_id,)
            ).fetchone()
            self.assertEqual(tuple(entry), ("paid", 25_000))
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM notification_outbox WHERE event_type='class_cancelled'"
            ).fetchone()[0], 0)
            self.assertEqual(conn.execute(
                "SELECT status FROM class_sessions WHERE id=?", (attended_class,)
            ).fetchone()[0], "scheduled")

    def test_cancellation_preserves_other_approved_wages_and_course_payment(self) -> None:
        other_class = self._class(self.teacher_id, now() - 7200)
        enrollment_id = uid()
        with self.owner.connect() as conn:
            conn.execute(
                "INSERT INTO time_entries(id,session_id,teacher_id,actual_start,actual_end,"
                "break_minutes,status,payable_minutes,amount_satang,submitted_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (uid(), other_class, self.teacher_id, now() - 7200, now() - 3600,
                 0, "approved", 60, 30_000, now() - 3500),
            )
            conn.execute(
                "INSERT INTO enrollments(id,course_id,student_id,created_at) VALUES(?,?,?,?)",
                (enrollment_id, self.course_id, self.student_ids[0], now()),
            )
        invoice = self._request("admin", "POST", "/api/admin/invoices", {
            "enrollment_id": enrollment_id, "amount_satang": 450_000, "due_date": "2030-01-15",
        })
        self.assertEqual(invoice.status, 201, invoice.body)
        payment = self._request("admin", "POST", "/api/admin/payments", {
            "invoice_id": invoice.body["invoice_id"], "amount_satang": 100_000,
            "method": "bank_transfer", "reference": "SYNTHETIC-CANCEL-TEST",
        })
        self.assertEqual(payment.status, 201, payment.body)
        before = self._request("teacher", "GET", "/api/teacher/payroll")
        self.assertEqual(before.status, 200)
        self.assertEqual(before.body["total_wages_due_satang"], 30_000)
        self.assertEqual(self._cancel().status, 200)
        after = self._request("teacher", "GET", "/api/teacher/payroll")
        self.assertEqual(after.status, 200)
        self.assertEqual(after.body["total_wages_due_satang"], 30_000)
        with self.owner.connect() as conn:
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM time_entries WHERE session_id=?", (self.class_id,)
            ).fetchone()[0], 0)
            self.assertEqual(tuple(conn.execute(
                "SELECT status,amount_satang FROM invoices WHERE id=?",
                (invoice.body["invoice_id"],),
            ).fetchone()), ("partial", 450_000))
            self.assertEqual(conn.execute(
                "SELECT amount_satang FROM payments WHERE id=?", (payment.body["payment_id"],)
            ).fetchone()[0], 100_000)
            self.assertEqual(conn.execute(
                "SELECT id FROM receipts WHERE payment_id=?", (payment.body["payment_id"],)
            ).fetchone()[0], payment.body["receipt_id"])

    def test_reason_is_required_and_rejected_values_make_no_change(self) -> None:
        for reason in ("", " ", "x", "!?!", "A" * 301):
            with self.subTest(reason=reason[:20]):
                response = self._cancel(reason=reason)
                self.assertEqual(response.status, 400, response.body)
        missing = self._request(
            "teacher", "POST", f"/api/teacher/classes/{self.class_id}/cancel", {},
        )
        self.assertEqual(missing.status, 400)
        with self.owner.connect() as conn:
            row = conn.execute(
                "SELECT status FROM class_sessions WHERE id=?",
                (self.class_id,),
            ).fetchone()
            self.assertEqual(row["status"], "scheduled")
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM audit_events WHERE entity='class_session' "
                "AND entity_id=? AND action='cancel'", (self.class_id,),
            ).fetchone()[0], 0)
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM notification_outbox WHERE event_type='class_cancelled'"
            ).fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
