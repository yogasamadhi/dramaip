INSERT INTO billing.plans (
  id,
  code,
  name,
  billing_period,
  price,
  currency,
  monthly_token_quota,
  max_rpm,
  max_context_tokens,
  model_level,
  is_active
)
VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'free',
    'Free',
    'monthly',
    0,
    'CNY',
    10000,
    5,
    32000,
    'starter',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'basic',
    'Basic',
    'monthly',
    39,
    'CNY',
    500000,
    20,
    64000,
    'standard',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'pro',
    'Pro',
    'monthly',
    99,
    'CNY',
    2000000,
    60,
    128000,
    'standard',
    true
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'premium',
    'Premium',
    'monthly',
    299,
    'CNY',
    10000000,
    120,
    256000,
    'advanced',
    true
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  billing_period = EXCLUDED.billing_period,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  monthly_token_quota = EXCLUDED.monthly_token_quota,
  max_rpm = EXCLUDED.max_rpm,
  max_context_tokens = EXCLUDED.max_context_tokens,
  model_level = EXCLUDED.model_level,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO billing.subscriptions (
  id,
  user_id,
  plan_id,
  provider,
  provider_subscription_id,
  status,
  current_period_start,
  current_period_end
)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'platform_seed',
  'platform_seed_subscription_001',
  'active',
  '2026-07-01T00:00:00Z',
  '2026-08-01T00:00:00Z'
)
ON CONFLICT (id) DO UPDATE SET
  plan_id = EXCLUDED.plan_id,
  provider = EXCLUDED.provider,
  provider_subscription_id = EXCLUDED.provider_subscription_id,
  status = EXCLUDED.status,
  current_period_start = EXCLUDED.current_period_start,
  current_period_end = EXCLUDED.current_period_end,
  updated_at = now();
