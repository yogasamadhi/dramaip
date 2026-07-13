CREATE TABLE IF NOT EXISTS auth.email_actions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_email_actions_active
  ON auth.email_actions (user_id, purpose, expires_at DESC)
  WHERE consumed_at IS NULL;

-- A password reset invalidates all existing access sessions immediately. The
-- auth service compares JWT iat against this value after its Redis lookup.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS session_invalidated_at TIMESTAMPTZ;
