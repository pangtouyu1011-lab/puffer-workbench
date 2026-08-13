-- One browser origin owns one live PushSubscription endpoint. Keep only the
-- newest legacy binding, then enforce that changing rooms cannot leave a
-- device subscribed to more than one room.
DELETE FROM push_subscriptions
WHERE rowid IN (
  SELECT rowid FROM (
    SELECT rowid, ROW_NUMBER() OVER (
      PARTITION BY endpoint ORDER BY updated_at DESC, rowid DESC
    ) AS duplicate_rank
    FROM push_subscriptions
  )
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
  ON push_subscriptions(endpoint);
