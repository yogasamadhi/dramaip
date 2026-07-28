-- v2 plans separate text quota from BYOK media generation and snapshot every
-- non-token entitlement at purchase time. Historical plans remain queryable
-- but cannot be purchased after this migration.
ALTER TABLE billing.plans
  ADD COLUMN IF NOT EXISTS purchase_mode TEXT NOT NULL DEFAULT 'self_service'
    CHECK (purchase_mode IN ('self_service', 'sales_contact', 'legacy_closed')),
  ADD COLUMN IF NOT EXISTS entitlements JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE billing.orders
  ADD COLUMN IF NOT EXISTS purchase_mode TEXT NOT NULL DEFAULT 'legacy_closed',
  ADD COLUMN IF NOT EXISTS entitlements_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE billing.subscriptions
  ADD COLUMN IF NOT EXISTS purchase_mode TEXT NOT NULL DEFAULT 'legacy_closed',
  ADD COLUMN IF NOT EXISTS entitlements_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS legacy_plan_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS renewal_plan_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS migration_effective_at TIMESTAMPTZ;

UPDATE billing.plans
SET name = 'Free',
    price = 0,
    monthly_token_quota = 10000,
    purchase_mode = 'self_service',
    entitlements = '{
      "included_seats": 1,
      "byok_enabled": true,
      "offline_review_enabled": true,
      "advanced_export_enabled": false,
      "cloud_review_enabled": false,
      "review_storage_bytes": 0,
      "review_retention_days": 0,
      "private_gateway_enabled": false
    }'::jsonb,
    is_active = true,
    updated_at = now()
WHERE code = 'free';

INSERT INTO billing.plans (
  id, code, name, billing_period, price, currency, monthly_token_quota,
  max_rpm, max_context_tokens, model_level, purchase_mode, entitlements, is_active
)
VALUES
  (
    '10000000-0000-4000-8000-000000000005', 'creator', 'Creator', 'monthly', 49, 'CNY', 500000,
    30, 128000, 'standard', 'self_service',
    '{"included_seats":1,"byok_enabled":true,"offline_review_enabled":true,"advanced_export_enabled":true,"cloud_review_enabled":false,"review_storage_bytes":0,"review_retention_days":0,"private_gateway_enabled":false}'::jsonb,
    true
  ),
  (
    '10000000-0000-4000-8000-000000000006', 'studio', 'Studio', 'monthly', 199, 'CNY', 2000000,
    90, 256000, 'advanced', 'self_service',
    '{"included_seats":5,"byok_enabled":true,"offline_review_enabled":true,"advanced_export_enabled":true,"cloud_review_enabled":true,"review_storage_bytes":5368709120,"review_retention_days":30,"private_gateway_enabled":false}'::jsonb,
    true
  ),
  (
    '10000000-0000-4000-8000-000000000007', 'enterprise', 'Enterprise', 'monthly', 0, 'CNY', 0,
    300, 512000, 'enterprise', 'sales_contact',
    '{"included_seats":0,"byok_enabled":true,"offline_review_enabled":true,"advanced_export_enabled":true,"cloud_review_enabled":true,"review_storage_bytes":0,"review_retention_days":30,"private_gateway_enabled":true}'::jsonb,
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
  purchase_mode = EXCLUDED.purchase_mode,
  entitlements = EXCLUDED.entitlements,
  is_active = EXCLUDED.is_active,
  updated_at = now();

UPDATE billing.plans
SET is_active = false, purchase_mode = 'legacy_closed', updated_at = now()
WHERE code IN ('basic', 'pro', 'premium');

UPDATE billing.orders AS orders
SET purchase_mode = plan.purchase_mode,
    entitlements_snapshot = plan.entitlements
FROM billing.plans AS plan
WHERE plan.id = orders.plan_id
  AND orders.entitlements_snapshot = '{}'::jsonb;

UPDATE billing.subscriptions AS subscriptions
SET purchase_mode = plan.purchase_mode,
    entitlements_snapshot = plan.entitlements
FROM billing.plans AS plan
WHERE plan.id = subscriptions.plan_id
  AND subscriptions.entitlements_snapshot = '{}'::jsonb;

-- Current-period benefits remain untouched. Only renewal is scheduled.
UPDATE billing.subscriptions
SET legacy_plan_code = plan_code,
    renewal_plan_code = CASE plan_code
      WHEN 'basic' THEN 'creator'
      WHEN 'pro' THEN 'studio'
      WHEN 'premium' THEN 'studio'
      ELSE renewal_plan_code
    END,
    migration_effective_at = current_period_end,
    updated_at = now()
WHERE plan_code IN ('basic', 'pro', 'premium');

CREATE OR REPLACE FUNCTION billing.capture_v2_entitlement_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_plan billing.plans%ROWTYPE;
BEGIN
  SELECT * INTO source_plan FROM billing.plans WHERE id = NEW.plan_id;
  IF FOUND THEN
    IF NEW.purchase_mode = '' OR NEW.purchase_mode = 'legacy_closed' THEN
      NEW.purchase_mode := source_plan.purchase_mode;
    END IF;
    IF NEW.entitlements_snapshot = '{}'::jsonb THEN
      NEW.entitlements_snapshot := source_plan.entitlements;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_orders_capture_v2_entitlements ON billing.orders;
CREATE TRIGGER trg_billing_orders_capture_v2_entitlements
BEFORE INSERT OR UPDATE OF plan_id ON billing.orders
FOR EACH ROW EXECUTE FUNCTION billing.capture_v2_entitlement_snapshot();

DROP TRIGGER IF EXISTS trg_billing_subscriptions_capture_v2_entitlements ON billing.subscriptions;
CREATE TRIGGER trg_billing_subscriptions_capture_v2_entitlements
BEFORE INSERT OR UPDATE OF plan_id ON billing.subscriptions
FOR EACH ROW EXECUTE FUNCTION billing.capture_v2_entitlement_snapshot();

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_renewal_migration
  ON billing.subscriptions (migration_effective_at)
  WHERE renewal_plan_code <> '';
