-- OAuth 2.1 / PKCE-style desktop login. Raw authorization codes and PKCE
-- verifiers are never persisted; code_hash is single-use and short-lived.
CREATE TABLE IF NOT EXISTS auth.desktop_authorization_codes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  code_hash TEXT NOT NULL UNIQUE,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  device_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_reason TEXT CHECK (consumed_reason IN ('exchanged', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_desktop_authorization_codes_active
  ON auth.desktop_authorization_codes (user_id, device_id, expires_at DESC)
  WHERE consumed_at IS NULL;
