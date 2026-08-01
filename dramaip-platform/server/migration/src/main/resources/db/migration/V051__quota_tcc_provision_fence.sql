-- The fence records TCC try/confirm/cancel state by subscription-period key.
-- It prevents empty rollback, duplicate confirm and hanging-try races from
-- creating or activating a second token account.
CREATE TABLE IF NOT EXISTS quota.tcc_provision_fences (
  business_key TEXT PRIMARY KEY,
  account_id UUID,
  status TEXT NOT NULL CHECK (status IN ('tried', 'confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON quota.tcc_provision_fences TO dramaip_quota_svc;
