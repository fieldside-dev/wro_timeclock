from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable


@dataclass(frozen=True)
class SchemaStatement:
    name: str
    sql: str


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def utc_iso(dt: datetime | None = None) -> str:
    value = dt if dt is not None else utc_now()
    return value.astimezone(timezone.utc).isoformat()


def get_schema() -> Iterable[SchemaStatement]:
    return (
        SchemaStatement(
            name="users",
            sql="""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
                is_active INTEGER NOT NULL DEFAULT 1,
                pin_hash TEXT NOT NULL,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                lockout_until_utc TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """,
        ),
        SchemaStatement(
            name="punch_events",
            sql="""
            CREATE TABLE IF NOT EXISTS punch_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
                ts_utc TEXT NOT NULL,
                note TEXT,
                source_ip TEXT,
                user_agent TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            """,
        ),
        SchemaStatement(
            name="idx_punch_events_user_ts",
            sql="""
            CREATE INDEX IF NOT EXISTS idx_punch_events_user_ts
            ON punch_events (user_id, ts_utc);
            """,
        ),
        SchemaStatement(
            name="idx_users_active",
            sql="""
            CREATE INDEX IF NOT EXISTS idx_users_active
            ON users (is_active);
            """,
        ),
    )


def init_db(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON;")
    for stmt in get_schema():
        conn.execute(stmt.sql)
    conn.commit()


def create_user(
    conn: sqlite3.Connection,
    *,
    name: str,
    role: str,
    pin_hash: str,
    is_active: bool = True,
    now: datetime | None = None,
) -> int:
    timestamp = utc_iso(now)
    cur = conn.execute(
        """
        INSERT INTO users (name, role, is_active, pin_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (name, role, 1 if is_active else 0, pin_hash, timestamp, timestamp),
    )
    conn.commit()
    return int(cur.lastrowid)


def update_user_security(
    conn: sqlite3.Connection,
    *,
    user_id: int,
    failed_attempts: int,
    lockout_until_utc: str | None,
    now: datetime | None = None,
) -> None:
    timestamp = utc_iso(now)
    conn.execute(
        """
        UPDATE users
        SET failed_attempts = ?, lockout_until_utc = ?, updated_at = ?
        WHERE id = ?
        """,
        (failed_attempts, lockout_until_utc, timestamp, user_id),
    )
    conn.commit()


def fetch_user(conn: sqlite3.Connection, user_id: int) -> sqlite3.Row | None:
    conn.row_factory = sqlite3.Row
    cur = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    return cur.fetchone()
