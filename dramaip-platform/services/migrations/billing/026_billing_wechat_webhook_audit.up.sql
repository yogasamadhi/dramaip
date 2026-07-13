ALTER TABLE billing.webhook_events
  ADD COLUMN IF NOT EXISTS raw_body BYTEA,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS signature_timestamp TEXT,
  ADD COLUMN IF NOT EXISTS signature_nonce TEXT,
  ADD COLUMN IF NOT EXISTS signature_serial TEXT,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS verification_error TEXT,
  ADD COLUMN IF NOT EXISTS provider_order_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS query_payload JSONB,
  ADD COLUMN IF NOT EXISTS query_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_billing_webhook_provider_order
  ON billing.webhook_events (provider, provider_order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_verification_retry
  ON billing.webhook_events (provider, verification_status, received_at)
  WHERE verification_status IN ('received', 'verification_failed', 'query_pending');
