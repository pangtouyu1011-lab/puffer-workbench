-- Reversible mirror of KV room data. Each item is stored independently so
-- future history reads can move to D1 without changing the current KV sync path.
-- Room passwords are never written to this table.
CREATE TABLE IF NOT EXISTS room_records (
  room_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  last_revision INTEGER NOT NULL,
  PRIMARY KEY (room_id, record_type, record_id)
);

CREATE INDEX IF NOT EXISTS idx_room_records_room_type_updated
  ON room_records(room_id, record_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_records_room_deleted
  ON room_records(room_id, deleted, updated_at DESC);
