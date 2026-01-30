from datetime import datetime, timedelta, timezone
import sqlite3
import unittest

from timeclock import auth, db


def setup_conn():
    conn = sqlite3.connect(":memory:")
    db.init_db(conn)
    return conn


def create_user(conn, pin="1234"):
    pin_hash = auth.hash_pin(pin)
    return db.create_user(conn, name="Taylor", role="staff", pin_hash=pin_hash)


class AuthLockoutTests(unittest.TestCase):
    def test_lockout_after_four_failures(self):
        conn = setup_conn()
        user_id = create_user(conn)
        now = datetime(2024, 1, 1, tzinfo=timezone.utc)

        for _ in range(3):
            result = auth.authenticate_user(conn, user_id=user_id, pin="0000", now=now)
            self.assertFalse(result.success)

        with self.assertRaises(auth.LockedOutError):
            auth.authenticate_user(conn, user_id=user_id, pin="0000", now=now)

        user = db.fetch_user(conn, user_id)
        self.assertEqual(user["failed_attempts"], 4)
        self.assertIsNotNone(user["lockout_until_utc"])

    def test_lockout_expiry_allows_attempt(self):
        conn = setup_conn()
        user_id = create_user(conn)
        now = datetime(2024, 1, 1, tzinfo=timezone.utc)

        for _ in range(3):
            auth.authenticate_user(conn, user_id=user_id, pin="0000", now=now)

        with self.assertRaises(auth.LockedOutError):
            auth.authenticate_user(conn, user_id=user_id, pin="0000", now=now)

        later = now + timedelta(minutes=31)
        result = auth.authenticate_user(conn, user_id=user_id, pin="0000", now=later)
        self.assertFalse(result.success)

    def test_reset_on_success(self):
        conn = setup_conn()
        user_id = create_user(conn)
        now = datetime(2024, 1, 1, tzinfo=timezone.utc)

        auth.authenticate_user(conn, user_id=user_id, pin="0000", now=now)
        auth.authenticate_user(conn, user_id=user_id, pin="0000", now=now)

        result = auth.authenticate_user(conn, user_id=user_id, pin="1234", now=now)
        self.assertTrue(result.success)

        user = db.fetch_user(conn, user_id)
        self.assertEqual(user["failed_attempts"], 0)
        self.assertIsNone(user["lockout_until_utc"])


if __name__ == "__main__":
    unittest.main()
