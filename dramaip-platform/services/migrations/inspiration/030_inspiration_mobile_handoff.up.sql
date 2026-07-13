CREATE SCHEMA IF NOT EXISTS inspiration;

CREATE TABLE IF NOT EXISTS inspiration.mobile_drafts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inspiration', 'character', 'project')),
  capture_mode TEXT NOT NULL CHECK (capture_mode IN ('text', 'voice')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  ai_expansion TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_inspiration_mobile_drafts_user_updated
  ON inspiration.mobile_drafts (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS inspiration.mobile_draft_adoptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  draft_id UUID NOT NULL REFERENCES inspiration.mobile_drafts(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  adopted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, draft_id, idempotency_key)
);

-- 018 predates this domain. Keep its grants immutable for installed
-- environments and extend the same deny-by-default matrix here.
REVOKE ALL ON SCHEMA inspiration FROM PUBLIC;
REVOKE ALL ON SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM dramaip_inspiration;
REVOKE ALL ON SCHEMA inspiration FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration;
REVOKE ALL ON ALL TABLES IN SCHEMA inspiration FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM dramaip_inspiration;
REVOKE ALL ON ALL TABLES IN SCHEMA inspiration FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA inspiration FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification FROM dramaip_inspiration;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA inspiration FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration;

GRANT USAGE ON SCHEMA inspiration TO dramaip_inspiration;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inspiration TO dramaip_inspiration;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA inspiration TO dramaip_inspiration;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspiration GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_inspiration;
ALTER DEFAULT PRIVILEGES IN SCHEMA inspiration GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_inspiration;
