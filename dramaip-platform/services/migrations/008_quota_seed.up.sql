INSERT INTO quota.token_accounts (
  id,
  user_id,
  subscription_id,
  period_start,
  period_end,
  quota_tokens,
  used_tokens,
  status
)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '2026-07-01T00:00:00Z',
  '2026-08-01T00:00:00Z',
  2000000,
  380000,
  'active'
)
ON CONFLICT (subscription_id, period_start) DO UPDATE SET
  quota_tokens = EXCLUDED.quota_tokens,
  used_tokens = EXCLUDED.used_tokens,
  status = EXCLUDED.status,
  updated_at = now();
