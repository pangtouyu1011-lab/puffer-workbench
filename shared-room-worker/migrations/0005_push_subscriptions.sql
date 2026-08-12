-- Web Push subscriptions are device-specific and never part of room content.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  room_id TEXT NOT NULL,
  person TEXT NOT NULL CHECK (person IN ('a', 'b')),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_room_person
  ON push_subscriptions(room_id, person);
