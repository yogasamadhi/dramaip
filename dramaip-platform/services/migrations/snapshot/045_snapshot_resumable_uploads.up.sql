-- Resumable uploads keep only bounded, client-encrypted chunks. They expire
-- automatically and are never visible through the snapshot list/download API.
ALTER TABLE snapshot.project_snapshots
  DROP CONSTRAINT IF EXISTS project_snapshots_encrypted_bytes_check;
ALTER TABLE snapshot.project_snapshots
  ADD CONSTRAINT project_snapshots_encrypted_bytes_check
  CHECK (encrypted_bytes > 0 AND encrypted_bytes <= 67108864);

CREATE TABLE IF NOT EXISTS snapshot.project_snapshot_uploads (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  encrypted_bytes BIGINT NOT NULL CHECK (encrypted_bytes > 8388608 AND encrypted_bytes <= 67108864),
  encrypted_sha256 TEXT NOT NULL CHECK (encrypted_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS snapshot.project_snapshot_upload_chunks (
  upload_id UUID NOT NULL REFERENCES snapshot.project_snapshot_uploads(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0 AND chunk_index < 64),
  encrypted_chunk BYTEA NOT NULL CHECK (octet_length(encrypted_chunk) > 0 AND octet_length(encrypted_chunk) <= 1048576),
  encrypted_chunk_sha256 TEXT NOT NULL CHECK (encrypted_chunk_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (upload_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_project_snapshot_uploads_expiry
  ON snapshot.project_snapshot_uploads (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON snapshot.project_snapshot_uploads TO dramaip_snapshot;
GRANT SELECT, INSERT, UPDATE, DELETE ON snapshot.project_snapshot_upload_chunks TO dramaip_snapshot;
