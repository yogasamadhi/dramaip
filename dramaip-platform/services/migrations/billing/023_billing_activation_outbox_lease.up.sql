-- Activation emits subscription.activated.v1 in the same local transaction
-- that makes the subscription usable. Relay leases make multiple job replicas
-- safe while preserving at-least-once delivery after a crash.
ALTER TABLE billing.outbox_events
  ADD COLUMN IF NOT EXISTS lease_id UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_billing_outbox_claimable
  ON billing.outbox_events (next_attempt_at, created_at)
  WHERE published_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_outbox_subscription_activated
  ON billing.outbox_events (aggregate_type, aggregate_id, event_type)
  WHERE event_type = 'subscription.activated.v1';
