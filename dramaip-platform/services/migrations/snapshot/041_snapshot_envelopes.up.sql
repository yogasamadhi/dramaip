-- Snapshot storage is deliberately opaque: the domain receives an already
-- authenticated encrypted envelope and has no recovery-key or plaintext
-- column. Deletion clears the only ciphertext copy while retaining minimal
-- timing/audit metadata for idempotent client behaviour.
CREATE SCHEMA IF NOT EXISTS snapshot;

CREATE TABLE IF NOT EXISTS snapshot.project_snapshots (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  encrypted_envelope BYTEA,
  encrypted_bytes BIGINT NOT NULL CHECK (encrypted_bytes > 0 AND encrypted_bytes <= 8388608),
  encrypted_sha256 TEXT NOT NULL CHECK (encrypted_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ,
  CHECK ((deleted_at IS NULL AND purged_at IS NULL AND encrypted_envelope IS NOT NULL)
    OR (deleted_at IS NOT NULL AND encrypted_envelope IS NULL)
    OR (purged_at IS NOT NULL AND encrypted_envelope IS NULL)),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_project_snapshots_active
  ON snapshot.project_snapshots (user_id, created_at DESC)
  WHERE deleted_at IS NULL AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_snapshot_project_snapshots_expiry
  ON snapshot.project_snapshots (expires_at)
  WHERE encrypted_envelope IS NOT NULL;

-- The migration identity bootstraps dramaip_snapshot. Runtime access stays
-- constrained to this one schema, matching every other domain service.
REVOKE ALL ON SCHEMA snapshot FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA snapshot FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA snapshot FROM PUBLIC;
REVOKE ALL ON SCHEMA snapshot FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting, dramaip_snapshot;
REVOKE ALL ON ALL TABLES IN SCHEMA snapshot FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting, dramaip_snapshot;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA snapshot FROM dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting, dramaip_snapshot;

GRANT USAGE ON SCHEMA snapshot TO dramaip_snapshot;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA snapshot TO dramaip_snapshot;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA snapshot TO dramaip_snapshot;
ALTER DEFAULT PRIVILEGES IN SCHEMA snapshot GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_snapshot;
ALTER DEFAULT PRIVILEGES IN SCHEMA snapshot GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO dramaip_snapshot;
