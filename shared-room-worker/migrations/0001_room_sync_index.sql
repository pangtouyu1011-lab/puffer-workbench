-- D1 is initially a safe, queryable index of KV-backed rooms.
-- Do not store room passwords or full room payloads here during the compatibility phase.
CREATE TABLE IF NOT EXISTS room_sync_index (
  room_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  storage_backend TEXT NOT NULL DEFAULT 'kv'
);

CREATE INDEX IF NOT EXISTS idx_room_sync_index_updated_at
  ON room_sync_index(updated_at DESC);
