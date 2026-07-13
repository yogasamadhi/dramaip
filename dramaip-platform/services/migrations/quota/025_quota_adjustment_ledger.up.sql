CREATE TABLE IF NOT EXISTS quota.quota_adjustments (
  id UUID PRIMARY KEY,
  adjustment_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  token_account_id UUID,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  delta_tokens BIGINT NOT NULL,
  quota_before BIGINT,
  quota_after BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quota_adjustments_subscription_created
  ON quota.quota_adjustments (subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quota.refund_holds (
  refund_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  token_account_id UUID,
  status TEXT NOT NULL,
  used_tokens BIGINT NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
