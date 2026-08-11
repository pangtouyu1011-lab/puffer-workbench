-- Cached companion greetings. No passwords, messages, photos, or location are stored here.
CREATE TABLE IF NOT EXISTS companion_lines (
  room_id TEXT NOT NULL,
  day TEXT NOT NULL,
  slot TEXT NOT NULL,
  line TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, day, slot)
);

CREATE INDEX IF NOT EXISTS idx_companion_lines_created_at
  ON companion_lines(created_at);
