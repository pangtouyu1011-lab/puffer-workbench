-- Prevent duplicate scheduled reminders for the same room/person/day/slot.
CREATE TABLE IF NOT EXISTS scheduled_pushes (
  room_id TEXT NOT NULL,
  person TEXT NOT NULL CHECK (person IN ('a', 'b')),
  day TEXT NOT NULL,
  slot TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, person, day, slot)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_sent_at
  ON scheduled_pushes(sent_at);
