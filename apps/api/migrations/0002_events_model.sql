-- Events-model schema additions for D1.
-- Keep the legacy time_entries table in place for compatibility.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lockout_until_utc TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at_utc TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

CREATE TABLE IF NOT EXISTS punch_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
  ts_utc TEXT NOT NULL,
  note TEXT,
  source_ip TEXT,
  user_agent TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_punch_events_user_ts ON punch_events(user_id, ts_utc);
CREATE INDEX IF NOT EXISTS idx_punch_events_ts ON punch_events(ts_utc);

CREATE TABLE IF NOT EXISTS sent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_period_start_utc TEXT NOT NULL,
  pay_period_end_utc TEXT NOT NULL,
  sent_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pay_period_start_utc, pay_period_end_utc)
);
