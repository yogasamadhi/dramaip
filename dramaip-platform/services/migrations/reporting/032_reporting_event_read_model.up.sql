CREATE SCHEMA IF NOT EXISTS reporting;

CREATE TABLE IF NOT EXISTS reporting.source_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  trace_id TEXT NOT NULL DEFAULT '',
  payload BYTEA NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reporting.user_summaries (
  user_id UUID PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  last_plan_code TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reporting.order_summaries (
  order_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  plan_code TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  subscription_id UUID,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reporting_orders_user_updated ON reporting.order_summaries (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reporting.subscription_summaries (
  subscription_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  plan_code TEXT NOT NULL,
  status TEXT NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reporting_subscriptions_user_updated ON reporting.subscription_summaries (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reporting.projection_exceptions (
  id UUID PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  summary TEXT NOT NULL,
  trace_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reporting_projection_exceptions_open ON reporting.projection_exceptions (status, created_at DESC);

REVOKE ALL ON SCHEMA reporting FROM PUBLIC;
REVOKE ALL ON SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, reporting FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting;
REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, reporting FROM dramaip_reporting;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA reporting FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin, reporting FROM dramaip_reporting;
GRANT USAGE ON SCHEMA reporting TO dramaip_reporting;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA reporting TO dramaip_reporting;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA reporting TO dramaip_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_reporting;
