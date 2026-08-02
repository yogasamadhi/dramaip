-- The admin schema is an independent privileged identity boundary. It does
-- not contain customer, billing, quota, or reporting records.
CREATE SCHEMA IF NOT EXISTS admin;

CREATE TABLE IF NOT EXISTS admin.principals (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin.principal_roles (
  principal_id UUID NOT NULL REFERENCES admin.principals(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'operator', 'security_admin')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, role)
);

CREATE TABLE IF NOT EXISTS admin.sessions (
  id UUID PRIMARY KEY,
  principal_id UUID NOT NULL REFERENCES admin.principals(id) ON DELETE RESTRICT,
  token_id_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_active
  ON admin.sessions (principal_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS admin.confirmations (
  id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES admin.principals(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('principal.suspend')),
  target_id UUID NOT NULL REFERENCES admin.principals(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_confirmations_actor_expiry
  ON admin.confirmations (actor_id, expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS admin.audit_logs (
  id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES admin.principals(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin.audit_logs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_resource ON admin.audit_logs (resource_type, resource_id, created_at DESC);

-- Application credentials can append an audit row but cannot alter or erase
-- audit evidence, even if a future grant is accidentally widened.
CREATE OR REPLACE FUNCTION admin.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin audit logs are immutable';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_logs_immutable ON admin.audit_logs;
CREATE TRIGGER admin_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON admin.audit_logs
  FOR EACH ROW EXECUTE FUNCTION admin.reject_audit_mutation();

-- Extend the existing deny-by-default role matrix. The migration identity is
-- the only DDL principal; the admin runtime receives exactly one schema.
REVOKE ALL ON SCHEMA admin FROM PUBLIC;
REVOKE ALL ON SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin;
REVOKE ALL ON ALL TABLES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin FROM dramaip_admin;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA admin FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA auth, user_profile, billing, quota, ai_gateway, notification, inspiration, admin FROM dramaip_admin;

GRANT USAGE ON SCHEMA admin TO dramaip_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA admin TO dramaip_admin;
REVOKE UPDATE, DELETE ON admin.audit_logs FROM dramaip_admin;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA admin TO dramaip_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_admin;
