-- Keep a collected cup accounted for when its attendee is removed from the desk.
-- Uncollected entries can be deleted completely, releasing the student ID.
CREATE TABLE IF NOT EXISTS removed_attendees (
  attendee_id TEXT PRIMARY KEY REFERENCES attendees(id),
  removed_at TEXT NOT NULL
);
