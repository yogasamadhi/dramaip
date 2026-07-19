-- User profile status is a read-model mirror of Auth's authoritative account
-- status. Its own ledger makes the cross-domain Admin retry idempotent and
-- preserves the operator/reason evidence inside the owning User domain.
CREATE TABLE IF NOT EXISTS user_profile.admin_status_operations (
  idempotency_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES user_profile.profiles(user_id) ON DELETE RESTRICT,
  operator_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_status TEXT NOT NULL,
  after_status TEXT NOT NULL CHECK (after_status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profile_admin_status_operations_user
  ON user_profile.admin_status_operations (user_id, created_at DESC);
