-- Manual delivery replay is a privileged asynchronous operation. Persisting
-- the confirmation-derived key makes an uncertain Admin response safe to
-- retry without delivering the same failed event twice.
CREATE TABLE IF NOT EXISTS notification.delivery_retry_operations (
  id UUID PRIMARY KEY,
  delivery_attempt_id UUID NOT NULL REFERENCES notification.delivery_attempts(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  event_id TEXT NOT NULL,
  notification_id UUID NOT NULL REFERENCES notification.notifications(id),
  failure TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
