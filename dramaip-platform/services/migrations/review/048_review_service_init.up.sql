CREATE SCHEMA IF NOT EXISTS review;

CREATE TABLE IF NOT EXISTS review.packages (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  desktop_package_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  token_hash BYTEA NOT NULL UNIQUE,
  pin_hash BYTEA,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'published', 'revoked', 'expired', 'deleting', 'deleted', 'failed')),
  manifest JSONB NOT NULL,
  storage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0 AND storage_bytes <= 536870912),
  sync_cursor BIGINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, desktop_package_id),
  CHECK (expires_at <= created_at + INTERVAL '30 days')
);

CREATE TABLE IF NOT EXISTS review.media_objects (
  id UUID PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES review.packages(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  upload_id TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'uploading', 'complete', 'failed', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review.comments (
  id UUID PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES review.packages(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  shot_id TEXT,
  timecode_seconds NUMERIC(12, 3),
  author_alias TEXT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  resolved BOOLEAN NOT NULL DEFAULT false,
  cursor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, client_id)
);

CREATE TABLE IF NOT EXISTS review.decisions (
  id UUID PRIMARY KEY,
  package_id UUID NOT NULL REFERENCES review.packages(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  shot_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'return', 'request_changes', 'note')),
  author_alias TEXT,
  note TEXT,
  cursor BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, client_id)
);

CREATE TABLE IF NOT EXISTS review.access_audit (
  id UUID PRIMARY KEY,
  package_id UUID NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_packages_expiry ON review.packages (expires_at) WHERE status IN ('uploading', 'published', 'revoked', 'failed');
CREATE INDEX IF NOT EXISTS idx_review_comments_sync ON review.comments (package_id, cursor);
CREATE INDEX IF NOT EXISTS idx_review_decisions_sync ON review.decisions (package_id, cursor);

REVOKE ALL ON SCHEMA review FROM PUBLIC, dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting, dramaip_snapshot, dramaip_review;
REVOKE ALL ON ALL TABLES IN SCHEMA review FROM PUBLIC, dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting, dramaip_snapshot, dramaip_review;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA review FROM PUBLIC, dramaip_auth, dramaip_user, dramaip_billing, dramaip_quota, dramaip_ai_gateway, dramaip_notification, dramaip_inspiration, dramaip_admin, dramaip_reporting, dramaip_snapshot, dramaip_review;
GRANT USAGE ON SCHEMA review TO dramaip_review;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA review TO dramaip_review;
REVOKE UPDATE, DELETE ON review.access_audit FROM dramaip_review;
ALTER DEFAULT PRIVILEGES IN SCHEMA review GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dramaip_review;
