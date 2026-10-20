"""Business and security checks for editable courses and teacher roster accounts."""

from pathlib import Path
import tempfile
import unittest

from backend import PhysicsPlusApp, BRAND_CODES_MIGRATION, migrate_academic_schema, migrate_brand_codes


class StaffCourseTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.owner = PhysicsPlusApp(Path(directory.name) / "school.sqlite3", "https://school.example")
        self.owner.bootstrap_admin(None, "Administrator", "PreviousPassword123!", "oldadmin")
        self.base = {"host": "school.example", "origin": "https://school.example"}
        login = self.owner.handle("POST", "/api/auth/login",
                                  {"login": "oldadmin", "password": "PreviousPassword123!"},
                                  self.base, "127.0.0.1")
        self.assertEqual(login.status, 200)
        self.auth = {**self.base, "cookie": login.headers["Set-Cookie"].split(";", 1)[0],
                     "x-csrf-token": login.body["csrf_token"]}

    def request(self, method, path, data=None):
        return self.owner.handle(method, path, data, self.auth, "127.0.0.1")

    def test_pending_roster_is_assignable_but_cannot_log_in_until_activation(self):
        users = self.request("GET", "/api/admin/users").body["users"]
        seeded = [row for row in users if row["role"] == "teacher"]
        self.assertEqual({row["name"] for row in seeded}, {"ครูตุ้ม", "ครูโรจน์", "ครูโจ้"})
        self.assertTrue(all(row["email"] is None and row["roster_pending"] for row in seeded))
        self.owner._init_db()
        self.assertEqual(len([row for row in self.request("GET", "/api/admin/users").body["users"] if row["role"] == "teacher"]), 3)

        teacher = seeded[0]
        create = self.request("POST", "/api/admin/courses", {"level": "high", "subject": "physics",
                             "price_satang": 525_000, "teacher_id": teacher["id"], "capacity": 13})
        self.assertEqual(create.status, 201, create.body)
        self.assertEqual(create.body["price_satang"], 525_000)
        course = self.request("PUT", f"/api/admin/courses/{create.body['course_id']}", {"price_satang": 575_000})
        self.assertEqual(course.status, 200, course.body)
        self.assertEqual(course.body["price_satang"], 575_000)
        with self.owner.connect() as conn:
            migrate_academic_schema(conn)
            self.assertEqual(conn.execute("SELECT active,price_satang FROM courses WHERE id=?", (create.body["course_id"],)).fetchone()[:], (1, 575_000))

        for action in ("enable", "reset-password"):
            result = self.request("POST", f"/api/admin/users/{teacher['id']}/{action}", {})
            self.assertEqual(result.status, 409)
        invalid = self.request("POST", f"/api/admin/staff/{teacher['id']}/activate",
                               {"email": "staff@physics-plus.invalid"})
        self.assertEqual(invalid.status, 400)
        active = self.request("POST", f"/api/admin/staff/{teacher['id']}/activate",
                              {"email": "teacher@example.com"})
        self.assertEqual(active.status, 200, active.body)
        self.assertTrue(active.body["temporary_password"])
        self.assertTrue(active.body["user"]["login_enabled"])
        again = self.request("POST", f"/api/admin/staff/{teacher['id']}/activate",
                             {"email": "another@example.com"})
        self.assertEqual(again.status, 409)

    def test_admin_controls_staff_and_subject_catalog(self):
        new = self.request("POST", "/api/admin/staff", {"name": "ครูใหม่"})
        self.assertEqual(new.status, 201, new.body)
        self.assertNotIn("temporary_password", new.body)
        self.assertEqual(new.body["user"]["email"], None)
        duplicate = self.request("POST", "/api/admin/staff", {"name": "ครูใหม่"})
        self.assertEqual(duplicate.status, 409)
        teacher_id = new.body["user"]["id"]
        edited = self.request("PUT", f"/api/admin/users/{teacher_id}", {"name": "ครูใหม่ A"})
        self.assertEqual(edited.status, 200)
        self.assertEqual(edited.body["email"], None)
        self.assertEqual(self.request("PUT", f"/api/admin/users/{teacher_id}",
                                      {"email": "teacher@example.com"}).status, 409)
        self.assertEqual(self.request("POST", "/api/admin/courses", {"level": "middle", "subject": "physics",
                         "price_satang": 350_000, "teacher_id": teacher_id, "capacity": 10}).status, 400)
        report = self.request("GET", "/api/admin/reports/teachers").body["rows"]
        self.assertTrue(all(not str(row["email"] or "").endswith(".invalid") for row in report))

    def test_admin_username_password_rotation_revokes_old_login(self):
        changed = self.request("POST", "/api/admin/account", {
            "current_password": "PreviousPassword123!", "new_username": "physicsplus",
            "new_password": "NewSyntheticPassword456!",
        })
        self.assertEqual(changed.status, 200, changed.body)
        self.assertTrue(changed.body["sessions_revoked"])
        old = self.owner.handle("POST", "/api/auth/login",
                                {"login": "oldadmin", "password": "PreviousPassword123!"},
                                self.base, "127.0.0.1")
        self.assertEqual(old.status, 401)
        new = self.owner.handle("POST", "/api/auth/login",
                                {"login": "physicsplus", "password": "NewSyntheticPassword456!"},
                                self.base, "127.0.0.1")
        self.assertEqual(new.status, 200)

    def test_brand_migration_changes_display_codes_without_changing_record_ids(self):
        teacher = next(row for row in self.request("GET", "/api/admin/users").body["users"]
                       if row["role"] == "teacher")
        created = self.request("POST", "/api/admin/courses", {"level": "middle", "subject": "math",
                               "price_satang": 378_000, "teacher_id": teacher["id"], "capacity": 10})
        self.assertEqual(created.status, 201)
        with self.owner.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM app_migrations WHERE key=?", (BRAND_CODES_MIGRATION,))
            conn.execute("UPDATE users SET public_code='PH-'||substr(public_code,4) WHERE id=?", (teacher["id"],))
            conn.execute("UPDATE courses SET course_code='PH-'||substr(course_code,4) WHERE id=?", (created.body["course_id"],))
            conn.execute(
                "INSERT INTO invoices(id,invoice_number,student_id,description,amount_satang,due_date,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                ("legacy-invoice", "PH-20261001-ABC123", teacher["id"], "Earlier invoice", 350_000,
                 "2026-10-31", 1),
            )
            conn.commit()
            migrate_brand_codes(conn)
            row = conn.execute("SELECT id,teacher_id,course_code,price_satang FROM courses WHERE id=?",
                               (created.body["course_id"],)).fetchone()
            self.assertEqual(row["id"], created.body["course_id"])
            self.assertEqual(row["teacher_id"], teacher["id"])
            self.assertEqual(row["price_satang"], 378_000)
            self.assertTrue(row["course_code"].startswith("PP-"))
            self.assertTrue(conn.execute("SELECT public_code FROM users WHERE id=?", (teacher["id"],)).fetchone()[0].startswith("PP-"))
            self.assertEqual(conn.execute("SELECT invoice_number FROM invoices WHERE id='legacy-invoice'").fetchone()[0],
                             "PH-20261001-ABC123")


if __name__ == "__main__":
    unittest.main()
