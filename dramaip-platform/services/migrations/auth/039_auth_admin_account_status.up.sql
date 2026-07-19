-- The auth domain remains the authoritative account-freeze boundary. This
-- operation ledger makes operator retries idempotent without giving Admin any
-- direct database access to auth.users or authentication sessions.
CREATE TABLE IF NOT EXISTS auth.admin_status_operations (
  idempotency_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_status TEXT NOT NULL,
  after_status TEXT NOT NULL CHECK (after_status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_admin_status_operations_user
  ON auth.admin_status_operations (user_id, created_at DESC);
