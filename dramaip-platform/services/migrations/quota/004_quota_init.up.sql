CREATE SCHEMA IF NOT EXISTS quota;

CREATE TABLE IF NOT EXISTS quota.token_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  plan_code TEXT NOT NULL DEFAULT '',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  quota_tokens BIGINT NOT NULL,
  used_tokens BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, period_start)
);

CREATE TABLE IF NOT EXISTS quota.token_reservations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  token_account_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  reserved_tokens BIGINT NOT NULL,
  actual_tokens BIGINT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id)
);

CREATE TABLE IF NOT EXISTS quota.token_usage_logs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  token_account_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens BIGINT NOT NULL,
  cost_amount NUMERIC(12, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id)
);
