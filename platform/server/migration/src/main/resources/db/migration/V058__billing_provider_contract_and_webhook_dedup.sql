-- Expand the billing schema for the canonical v2 wire contract. Live provider
-- adapters remain disabled until merchant credentials and release evidence are
-- present; this migration contains no credential material.

ALTER TABLE billing.orders
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200);

UPDATE billing.orders
SET idempotency_key = 'legacy-' || id::text
WHERE idempotency_key IS NULL OR btrim(idempotency_key) = '';

ALTER TABLE billing.orders
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_orders_user_idempotency
  ON billing.orders (user_id, idempotency_key);

-- The public enum is camelCase. Normalize any pre-GA shadow value before the
-- constraint is installed.
UPDATE billing.orders SET provider = 'wechatPay' WHERE provider = 'wechat_pay';
UPDATE billing.payments SET provider = 'wechatPay' WHERE provider = 'wechat_pay';
UPDATE billing.webhook_events SET provider = 'wechatPay' WHERE provider = 'wechat_pay';

ALTER TABLE billing.orders
  DROP CONSTRAINT IF EXISTS billing_orders_provider_check;
ALTER TABLE billing.orders
  ADD CONSTRAINT billing_orders_provider_check
  CHECK (provider IN ('wechatPay', 'alipay', 'simulated'));

ALTER TABLE billing.payments
  DROP CONSTRAINT IF EXISTS billing_payments_provider_check;
ALTER TABLE billing.payments
  ADD CONSTRAINT billing_payments_provider_check
  CHECK (provider IN ('wechatPay', 'alipay', 'simulated'));

ALTER TABLE billing.webhook_events
  ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS payload_sha256 CHAR(64),
  ADD COLUMN IF NOT EXISTS amount_minor BIGINT,
  ADD COLUMN IF NOT EXISTS currency CHAR(3),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_webhook_provider_transaction
  ON billing.webhook_events (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_orders_pending_provider_age
  ON billing.orders (provider, created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS billing.provider_statement_imports (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('wechatPay', 'alipay')),
  statement_date DATE NOT NULL,
  artifact_ref TEXT NOT NULL,
  artifact_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (provider, statement_date, artifact_sha256)
);

CREATE TABLE IF NOT EXISTS billing.provider_statement_differences (
  id UUID PRIMARY KEY,
  import_id UUID NOT NULL REFERENCES billing.provider_statement_imports(id),
  order_id UUID REFERENCES billing.orders(id),
  provider_transaction_id TEXT,
  difference_kind TEXT NOT NULL,
  expected_sha256 CHAR(64),
  actual_sha256 CHAR(64),
  status TEXT NOT NULL DEFAULT 'open',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_statement_differences_open
  ON billing.provider_statement_differences (detected_at DESC)
  WHERE status = 'open';
