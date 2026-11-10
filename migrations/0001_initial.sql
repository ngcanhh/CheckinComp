PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS event_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  signup_open INTEGER NOT NULL DEFAULT 1 CHECK (signup_open IN (0, 1))
);
INSERT OR IGNORE INTO event_settings (id, signup_open) VALUES (1, 1);
CREATE TABLE IF NOT EXISTS attendees (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, student_id TEXT NOT NULL UNIQUE,
  telegram TEXT NOT NULL DEFAULT '', source TEXT NOT NULL CHECK (source IN ('registration', 'walkin')),
  created_at TEXT NOT NULL, checked_in_at TEXT,
  telegram_token_hash TEXT UNIQUE, telegram_token_expires INTEGER, telegram_chat_id TEXT
);
CREATE TABLE IF NOT EXISTS cups (
  number INTEGER PRIMARY KEY CHECK (number BETWEEN 1 AND 150),
  attendee_id TEXT UNIQUE REFERENCES attendees(id), collected_at TEXT,
  CHECK (collected_at IS NULL OR attendee_id IS NOT NULL)
);
WITH RECURSIVE slots(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM slots WHERE n < 150)
INSERT OR IGNORE INTO cups (number) SELECT n FROM slots;
-- Insertion + cup reservation are one atomic database statement.
CREATE TRIGGER IF NOT EXISTS require_open_signup
BEFORE INSERT ON attendees WHEN NEW.source = 'registration'
BEGIN
  SELECT CASE WHEN (SELECT signup_open FROM event_settings WHERE id = 1) = 0
    THEN RAISE(ABORT, 'signup_closed') END;
END;
CREATE TRIGGER IF NOT EXISTS reserve_registration_cup
AFTER INSERT ON attendees WHEN NEW.source = 'registration'
BEGIN
  UPDATE cups SET attendee_id = NEW.id
    WHERE number = (SELECT MIN(number) FROM cups WHERE attendee_id IS NULL);
END;
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits (client_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, resets_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_outbox (
  attendee_id TEXT PRIMARY KEY REFERENCES attendees(id), chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  lease_until INTEGER NOT NULL DEFAULT 0, sent_at TEXT
);
