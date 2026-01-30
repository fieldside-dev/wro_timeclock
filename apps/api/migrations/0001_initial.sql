-- Initial schema for WRO Timeclock

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_email ON time_entries(user_email);
CREATE INDEX IF NOT EXISTS idx_time_entries_started_at ON time_entries(started_at);
