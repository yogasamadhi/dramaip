-- Expand-only support for provider refund retries and exactly-once entitlement effects.
-- Provider adapters remain disabled until their signed webhook/refund implementations exist.

ALTER TABLE billing.refunds
  ADD COLUMN IF NOT EXISTS provider_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_event_key TEXT,
  ADD COLUMN IF NOT EXISTS request_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_query_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compensation_state TEXT NOT NULL DEFAULT 'not_started';

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_refunds_provider_event
  ON billing.refunds (provider, provider_event_key)
  WHERE provider_event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_refunds_provider_retry
  ON billing.refunds (next_query_at, updated_at)
  WHERE status IN ('provider_pending', 'quota_pending', 'compensation_pending');

CREATE TABLE IF NOT EXISTS quota.billing_entitlement_inbox (
  event_id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id UUID NOT NULL,
  workspace_id UUID,
  subscription_id UUID,
  payload_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  attempts INT NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_quota_billing_entitlement_inbox_pending
  ON quota.billing_entitlement_inbox (received_at)
  WHERE status IN ('received', 'retry');

GRANT SELECT, INSERT, UPDATE, DELETE ON billing.refunds TO dramaip_billing_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON quota.billing_entitlement_inbox TO dramaip_quota_svc;
