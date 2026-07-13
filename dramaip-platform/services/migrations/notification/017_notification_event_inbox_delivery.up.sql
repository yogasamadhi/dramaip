-- Notification event consumption is at-least-once. These fields make an
-- inbox row leaseable and auditable without deleting the durable event body.
ALTER TABLE notification.event_inbox
  ADD COLUMN IF NOT EXISTS processing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_notification_event_inbox_pending
  ON notification.event_inbox (created_at ASC)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS notification.delivery_attempts (
  id UUID PRIMARY KEY,
  event_id TEXT NOT NULL,
  notification_id UUID NOT NULL REFERENCES notification.notifications(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('delivered', 'failed')),
  failure TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_attempts_event
  ON notification.delivery_attempts (event_id, attempted_at DESC);
