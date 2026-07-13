ALTER TABLE auth.refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id UUID,
  ADD COLUMN IF NOT EXISTS parent_id UUID,
  ADD COLUMN IF NOT EXISTS replaced_by UUID,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Existing refresh tokens become one-token families. New rotations preserve
-- this family id so reuse can revoke every active token for that user.
UPDATE auth.refresh_tokens
SET family_id = id
WHERE family_id IS NULL;

ALTER TABLE auth.refresh_tokens
  ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_hash ON auth.refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_family ON auth.refresh_tokens (user_id, family_id)
  WHERE revoked_at IS NULL;
