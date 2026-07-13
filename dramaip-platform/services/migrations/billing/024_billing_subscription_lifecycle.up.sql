ALTER TABLE billing.subscriptions
  ADD COLUMN IF NOT EXISTS scheduled_plan_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS lifecycle_error TEXT;

CREATE TABLE IF NOT EXISTS billing.subscription_periods (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL,
  order_id UUID,
  status TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  plan_id UUID NOT NULL,
  plan_code TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  billing_period TEXT NOT NULL,
  plan_price NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  monthly_token_quota BIGINT NOT NULL,
  max_rpm INT NOT NULL,
  max_context_tokens BIGINT NOT NULL,
  model_level TEXT NOT NULL,
  plan_snapshot_source TEXT NOT NULL,
  plan_snapshot_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  activated_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_billing_subscription_periods_due
  ON billing.subscription_periods (subscription_id, period_end DESC);

INSERT INTO billing.subscription_periods (
  id, subscription_id, user_id, status, period_start, period_end,
  plan_id, plan_code, plan_name, billing_period, plan_price, currency,
  monthly_token_quota, max_rpm, max_context_tokens, model_level,
  plan_snapshot_source, plan_snapshot_at, source, activated_at, created_at, updated_at
)
SELECT
  gen_random_uuid(), sub.id, sub.user_id, sub.status,
  sub.current_period_start, sub.current_period_end,
  sub.plan_id, sub.plan_code, sub.plan_name, sub.billing_period, sub.plan_price, sub.currency,
  sub.monthly_token_quota, sub.max_rpm, sub.max_context_tokens, sub.model_level,
  sub.plan_snapshot_source, sub.plan_snapshot_at, 'migration_backfill',
  CASE WHEN sub.status = 'active' THEN sub.quota_provisioned_at ELSE NULL END,
  sub.created_at, sub.updated_at
FROM billing.subscriptions sub
WHERE sub.plan_code <> ''
ON CONFLICT (subscription_id, period_start) DO NOTHING;

CREATE TABLE IF NOT EXISTS billing.subscription_changes (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_subscription_changes_due
  ON billing.subscription_changes (status, effective_at, created_at)
  WHERE status IN ('quota_pending', 'scheduled', 'manual_review');

CREATE TABLE IF NOT EXISTS billing.refunds (
  id UUID PRIMARY KEY,
  subscription_id UUID NOT NULL,
  subscription_period_id UUID,
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  used_tokens BIGINT,
  quota_hold_status TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_refunds_retry
  ON billing.refunds (status, updated_at)
  WHERE status IN ('quota_pending', 'manual_review');
