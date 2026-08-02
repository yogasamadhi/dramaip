ALTER TABLE quota.token_accounts
  ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT '';

UPDATE quota.token_accounts
SET plan_code = 'pro'
WHERE subscription_id = '20000000-0000-4000-8000-000000000001'::uuid
  AND plan_code = '';
