-- Workspace membership/invitation security model. Invitation credentials are
-- represented only by SHA-256 digests; plaintext tokens never enter the database.

ALTER TABLE user_profile.workspaces
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE user_profile.workspaces
  DROP CONSTRAINT IF EXISTS user_profile_workspaces_status_check;
ALTER TABLE user_profile.workspaces
  ADD CONSTRAINT user_profile_workspaces_status_check
  CHECK (status IN ('active', 'suspended', 'closed'));

ALTER TABLE user_profile.workspace_invitations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_expiry
  ON user_profile.workspace_invitations (expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_profile.workspace_audit_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES user_profile.workspaces(id),
  actor_user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_audit_events_workspace
  ON user_profile.workspace_audit_events (workspace_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION user_profile.reject_workspace_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workspace audit events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_audit_append_only ON user_profile.workspace_audit_events;
CREATE TRIGGER trg_workspace_audit_append_only
BEFORE UPDATE OR DELETE ON user_profile.workspace_audit_events
FOR EACH ROW EXECUTE FUNCTION user_profile.reject_workspace_audit_mutation();

CREATE TABLE IF NOT EXISTS user_profile.identity_outbox_events (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_identity_outbox_pending
  ON user_profile.identity_outbox_events (available_at, created_at)
  WHERE status IN ('pending', 'retry');

CREATE TABLE IF NOT EXISTS auth.security_audit_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  event_type TEXT NOT NULL,
  subject_hash TEXT,
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_security_audit_user
  ON auth.security_audit_events (user_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION auth.reject_security_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security audit events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_security_audit_append_only
  ON auth.security_audit_events;
CREATE TRIGGER trg_auth_security_audit_append_only
BEFORE UPDATE OR DELETE ON auth.security_audit_events
FOR EACH ROW EXECUTE FUNCTION auth.reject_security_audit_mutation();

GRANT SELECT, INSERT, UPDATE, DELETE ON user_profile.workspaces,
  user_profile.workspace_members, user_profile.workspace_invitations,
  user_profile.identity_outbox_events TO dramaip_identity_svc;
GRANT SELECT, INSERT ON user_profile.workspace_audit_events TO dramaip_identity_svc;
GRANT SELECT, INSERT, UPDATE ON auth.email_actions TO dramaip_identity_svc;
GRANT SELECT, INSERT ON auth.security_audit_events TO dramaip_identity_svc;
