-- Media lifecycle metadata for R2. Only objects uploaded after this migration
-- are registered, so existing history is never eligible for automatic deletion.
CREATE TABLE IF NOT EXISTS media_objects (
  object_key TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_references (
  object_key TEXT NOT NULL,
  room_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (object_key, room_id, record_type, record_id)
);

CREATE INDEX IF NOT EXISTS idx_media_objects_created_at
  ON media_objects(created_at);

CREATE INDEX IF NOT EXISTS idx_media_references_object_active
  ON media_references(object_key, active);
