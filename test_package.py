"""Offline integration checks using SQLite as a Turso transport stand-in.

These checks exercise application boundaries, not the real Turso network or a
Vercel deployment. Run with `python3 -m unittest test_package.py`.
"""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as site
import remote
from backend import ApiError


class DeploymentPackageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        database = Path(self.temp.name) / "remote-stand-in.sqlite3"

        def sqlite_transport(_url, *, auth_token=None, isolation_level=None):
            return sqlite3.connect(database, isolation_level=isolation_level)

        connection_patch = patch.object(remote.turso_serverless, "connect", sqlite_transport)
        connection_patch.start()
        self.addCleanup(connection_patch.stop)

        self.owner = remote.RemotePhysicsHouseApp(
            "turso://test.example", "synthetic-test-token", "https://school.example"
        )
        self.owner.initialize_remote()
        backend_patch = patch.object(site, "_backend", lambda: self.owner)
        backend_patch.start()
        self.addCleanup(backend_patch.stop)
        self.base_url = "https://school.example"

    def test_schema_seed_and_single_administrator(self) -> None:
        self.owner.initialize_remote()
        status = self.owner.check_remote()
        self.assertTrue(status["schema_initialized"])
        self.assertEqual(status["confirmed_default_rate_count"], 8)
        self.owner.bootstrap_admin(None, "Admin", "SafeTestPassword123!", "physicshouse")
        with self.assertRaises(ApiError):
            self.owner.bootstrap_admin(None, "Admin 2", "SafeTestPassword123!", "other-admin")
        self.assertEqual(self.owner.check_remote()["admin_count"], 1)

    def test_private_dashboard_login_and_student_registration(self) -> None:
        self.owner.bootstrap_admin(None, "Admin", "SafeTestPassword123!", "physicshouse")
        client = site.app.test_client()
        self.assertEqual(client.get("/dashboard.html", base_url=self.base_url).status_code, 303)
        self.assertEqual(client.get("/private/dashboard.html", base_url=self.base_url).status_code, 404)

        bad_origin = client.post(
            "/api/auth/login",
            base_url=self.base_url,
            headers={"Origin": "https://attacker.example"},
            json={"login": "physicshouse", "password": "SafeTestPassword123!"},
        )
        self.assertEqual(bad_origin.status_code, 403)

        login = client.post(
            "/api/auth/login",
            base_url=self.base_url,
            headers={"Origin": self.base_url},
            json={"login": "physicshouse", "password": "SafeTestPassword123!"},
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json["user"]["role"], "admin")
        cookie = login.headers["Set-Cookie"]
        for attribute in ("Secure", "HttpOnly", "SameSite=Lax"):
            self.assertIn(attribute, cookie)
        dashboard = client.get("/dashboard.html", base_url=self.base_url)
        self.assertEqual(dashboard.status_code, 200)
        dashboard.close()
        self.assertEqual(client.get("/api/admin/reports/students", base_url=self.base_url).status_code, 200)

        student = site.app.test_client()
        registration = student.post(
            "/api/auth/register",
            base_url=self.base_url,
            headers={"Origin": self.base_url},
            json={
                "name": "Example Student", "email": "student@example.com",
                "password": "SafeTestPassword123!", "grade": "M3", "school": "Example School",
                "guardian_name": "Example Guardian", "guardian_phone": "0812345678",
                "guardian_relationship": "mother",
            },
        )
        self.assertEqual(registration.status_code, 201)
        self.assertEqual(registration.json["user"]["role"], "student")
        self.assertEqual(student.get("/api/me", base_url=self.base_url).json["user"]["role"], "student")
        self.assertEqual(student.get("/admin", base_url=self.base_url).status_code, 403)

    def test_throttle_persists_across_app_instances(self) -> None:
        second_instance = remote.RemotePhysicsHouseApp(
            "turso://test.example", "synthetic-test-token", "https://school.example"
        )
        for _ in range(5):
            self.owner.limiter.check("login:shared@example.com", 10, 900)
        for _ in range(5):
            second_instance.limiter.check("login:shared@example.com", 10, 900)
        with self.assertRaises(ApiError) as caught:
            second_instance.limiter.check("login:shared@example.com", 10, 900)
        self.assertEqual(caught.exception.status, 429)

    def test_connection_rolls_back_and_closes(self) -> None:
        with self.assertRaises(RuntimeError):
            with self.owner.connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute(
                    "INSERT INTO login_throttle(key_hash,window_started,attempts) VALUES('test',1,1)"
                )
                raise RuntimeError("trigger rollback")
        with self.owner.connect() as conn:
            self.assertIsNone(
                conn.execute("SELECT 1 FROM login_throttle WHERE key_hash='test'").fetchone()
            )

    def test_administrator_controls_student_invoice_amount(self) -> None:
        self.owner.bootstrap_admin(None, "Admin", "SafeTestPassword123!", "physicshouse")
        admin = site.app.test_client()
        login = admin.post("/api/auth/login", base_url=self.base_url,
                           headers={"Origin": self.base_url},
                           json={"login": "physicshouse", "password": "SafeTestPassword123!"})
        admin_headers = {"Origin": self.base_url, "X-CSRF-Token": login.json["csrf_token"]}
        teacher = admin.post("/api/admin/staff", base_url=self.base_url, headers=admin_headers,
                             json={"name": "Example Teacher", "email": "teacher@example.com", "role": "teacher"})
        self.assertEqual(teacher.status_code, 201, teacher.json)
        course = admin.post("/api/admin/courses", base_url=self.base_url, headers=admin_headers,
                            json={"subject": "physics", "level": "high",
                                  "teacher_id": teacher.json["user"]["id"], "capacity": 10})
        self.assertEqual(course.status_code, 201, course.json)
        student = site.app.test_client()
        registration = student.post("/api/auth/register", base_url=self.base_url,
                                    headers={"Origin": self.base_url},
                                    json={"name": "Example Student", "email": "student@example.com",
                                          "password": "SafeTestPassword123!", "grade": "M4", "school": "Example School",
                                          "guardian_name": "Example Guardian", "guardian_phone": "0812345678",
                                          "guardian_relationship": "mother"})
        self.assertEqual(registration.status_code, 201, registration.json)
        student_headers = {"Origin": self.base_url, "X-CSRF-Token": registration.json["csrf_token"]}
        enrollment = student.post("/api/student/enrollments", base_url=self.base_url, headers=student_headers,
                                  json={"course_id": course.json["course_id"], "grade": "M4",
                                        "school": "Example School", "guardian_name": "Example Guardian",
                                        "guardian_phone": "0812345678", "guardian_relationship": "mother"})
        self.assertEqual(enrollment.status_code, 201, enrollment.json)
        self.assertNotIn("invoice", enrollment.json)
        self.assertEqual(student.get("/api/student/dashboard", base_url=self.base_url).json["invoices"], [])
        self.assertEqual(student.get("/api/admin/invoices", base_url=self.base_url).status_code, 403)
        invoice = admin.post("/api/admin/invoices", base_url=self.base_url, headers=admin_headers,
                             json={"enrollment_id": enrollment.json["enrollment_id"],
                                   "amount_satang": 175000, "due_date": "2030-01-15"})
        self.assertEqual(invoice.status_code, 201, invoice.json)
        self.assertEqual(student.get("/api/student/dashboard", base_url=self.base_url).json["invoices"][0]["amount_satang"], 175000)
        altered = student.post("/api/student/payment-claims", base_url=self.base_url, headers=student_headers,
                               json={"invoice_id": invoice.json["invoice_id"], "amount_satang": 1,
                                     "reference": "TEST-REF"})
        self.assertEqual(altered.status_code, 400, altered.json)
        claim = student.post("/api/student/payment-claims", base_url=self.base_url, headers=student_headers,
                             json={"invoice_id": invoice.json["invoice_id"], "reference": "TEST-REF"})
        self.assertEqual(claim.status_code, 201, claim.json)
        self.assertEqual(claim.json["amount_satang"], 175000)


if __name__ == "__main__":
    unittest.main()
