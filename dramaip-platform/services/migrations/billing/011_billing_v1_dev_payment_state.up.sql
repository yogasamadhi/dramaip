ALTER TABLE billing.subscriptions
  ADD COLUMN IF NOT EXISTS activation_error TEXT,
  ADD COLUMN IF NOT EXISTS quota_provisioned_at TIMESTAMPTZ;

ALTER TABLE billing.orders
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE billing.payments
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE billing.outbox_events
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trace_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS publish_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_orders_user_created ON billing.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_activation_retry
  ON billing.subscriptions (status, updated_at)
  WHERE status IN ('quota_pending', 'activation_failed');
CREATE INDEX IF NOT EXISTS idx_billing_outbox_unpublished
  ON billing.outbox_events (created_at)
  WHERE published_at IS NULL;
