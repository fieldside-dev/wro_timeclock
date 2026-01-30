CREATE TABLE IF NOT EXISTS sent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_period_start TEXT NOT NULL,
  pay_period_end TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  UNIQUE(pay_period_start, pay_period_end)
);

-- Example schema for payroll sources (adjust to match existing tables).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
