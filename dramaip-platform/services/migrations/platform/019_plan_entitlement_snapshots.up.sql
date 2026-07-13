-- Preserve the entitlement that was purchased, rather than reconstructing it
-- from mutable billing.plans rows. Existing rows are the best available
-- historical reconstruction and are explicitly marked legacy_backfill.
ALTER TABLE billing.orders
  ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_token_quota BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_rpm INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_context_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_level TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_snapshot_source TEXT NOT NULL DEFAULT 'legacy_backfill',
  ADD COLUMN IF NOT EXISTS plan_snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE billing.subscriptions
  ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CNY',
  ADD COLUMN IF NOT EXISTS monthly_token_quota BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_rpm INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_context_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_level TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_snapshot_source TEXT NOT NULL DEFAULT 'legacy_backfill',
  ADD COLUMN IF NOT EXISTS plan_snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE billing.orders AS orders
SET plan_code = plan.code,
    plan_name = plan.name,
    billing_period = plan.billing_period,
    plan_price = plan.price,
    currency = plan.currency,
    monthly_token_quota = plan.monthly_token_quota,
    max_rpm = plan.max_rpm,
    max_context_tokens = plan.max_context_tokens,
    model_level = plan.model_level,
    plan_snapshot_source = 'legacy_backfill',
    plan_snapshot_at = orders.created_at
FROM billing.plans AS plan
WHERE plan.id = orders.plan_id
  AND orders.plan_code = '';

UPDATE billing.subscriptions AS subscriptions
SET plan_code = plan.code,
    plan_name = plan.name,
    billing_period = plan.billing_period,
    plan_price = plan.price,
    currency = plan.currency,
    monthly_token_quota = plan.monthly_token_quota,
    max_rpm = plan.max_rpm,
    max_context_tokens = plan.max_context_tokens,
    model_level = plan.model_level,
    plan_snapshot_source = 'legacy_backfill',
    plan_snapshot_at = subscriptions.created_at
FROM billing.plans AS plan
WHERE plan.id = subscriptions.plan_id
  AND subscriptions.plan_code = '';

UPDATE billing.orders
SET plan_code = 'legacy_unknown',
    plan_name = 'Legacy plan',
    plan_snapshot_at = created_at
WHERE plan_code = '';

UPDATE billing.subscriptions
SET plan_code = 'legacy_unknown',
    plan_name = 'Legacy plan',
    plan_snapshot_at = created_at
WHERE plan_code = '';

-- Keep the migration-first / application-rollout compatibility window safe:
-- an older billing image can still insert an order or subscription without the
-- new columns, and this trigger immediately captures the then-current plan as
-- a clearly labelled legacy_compat snapshot. New code always writes its own
-- checkout snapshot and therefore does not take this path.
CREATE OR REPLACE FUNCTION billing.capture_legacy_plan_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_plan billing.plans%ROWTYPE;
BEGIN
  IF NEW.plan_code <> '' AND NEW.plan_name <> '' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO source_plan FROM billing.plans WHERE id = NEW.plan_id;
  IF NOT FOUND THEN
    NEW.plan_code := 'legacy_unknown';
    NEW.plan_name := 'Legacy plan';
    NEW.plan_snapshot_source := 'legacy_compat';
    NEW.plan_snapshot_at := now();
    RETURN NEW;
  END IF;

  NEW.plan_code := source_plan.code;
  NEW.plan_name := source_plan.name;
  NEW.billing_period := source_plan.billing_period;
  NEW.plan_price := source_plan.price;
  NEW.currency := source_plan.currency;
  NEW.monthly_token_quota := source_plan.monthly_token_quota;
  NEW.max_rpm := source_plan.max_rpm;
  NEW.max_context_tokens := source_plan.max_context_tokens;
  NEW.model_level := source_plan.model_level;
  NEW.plan_snapshot_source := 'legacy_compat';
  NEW.plan_snapshot_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_orders_capture_legacy_plan_snapshot ON billing.orders;
CREATE TRIGGER trg_billing_orders_capture_legacy_plan_snapshot
BEFORE INSERT OR UPDATE OF plan_id ON billing.orders
FOR EACH ROW EXECUTE FUNCTION billing.capture_legacy_plan_snapshot();

DROP TRIGGER IF EXISTS trg_billing_subscriptions_capture_legacy_plan_snapshot ON billing.subscriptions;
CREATE TRIGGER trg_billing_subscriptions_capture_legacy_plan_snapshot
BEFORE INSERT OR UPDATE OF plan_id ON billing.subscriptions
FOR EACH ROW EXECUTE FUNCTION billing.capture_legacy_plan_snapshot();

ALTER TABLE quota.token_accounts
  ADD COLUMN IF NOT EXISTS plan_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CNY',
  ADD COLUMN IF NOT EXISTS max_rpm INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_context_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_level TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plan_snapshot_source TEXT NOT NULL DEFAULT 'legacy_backfill',
  ADD COLUMN IF NOT EXISTS plan_snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE quota.token_accounts AS accounts
SET plan_code = subscriptions.plan_code,
    plan_name = subscriptions.plan_name,
    billing_period = subscriptions.billing_period,
    plan_price = subscriptions.plan_price,
    currency = subscriptions.currency,
    max_rpm = subscriptions.max_rpm,
    max_context_tokens = subscriptions.max_context_tokens,
    model_level = subscriptions.model_level,
    plan_snapshot_source = 'legacy_backfill',
    plan_snapshot_at = accounts.created_at
FROM billing.subscriptions AS subscriptions
WHERE subscriptions.id = accounts.subscription_id
  AND accounts.plan_name = '';

UPDATE quota.token_accounts
SET plan_code = COALESCE(NULLIF(plan_code, ''), 'legacy_unknown'),
    plan_name = 'Legacy plan',
    plan_snapshot_at = created_at
WHERE plan_name = '';

-- Quota deliberately cannot query billing.plans. During a mixed-version
-- rollout, an older billing/quota pair sends only code and quota_tokens; keep
-- that account usable and explicitly label the missing entitlement details.
CREATE OR REPLACE FUNCTION quota.capture_legacy_entitlement_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.plan_name <> '' THEN
    RETURN NEW;
  END IF;

  NEW.plan_code := COALESCE(NULLIF(NEW.plan_code, ''), 'legacy_unknown');
  NEW.plan_name := 'Legacy plan';
  NEW.billing_period := 'monthly';
  NEW.plan_price := 0;
  NEW.currency := 'CNY';
  NEW.max_rpm := 1;
  NEW.max_context_tokens := 1;
  NEW.model_level := 'legacy';
  NEW.plan_snapshot_source := 'legacy_compat';
  NEW.plan_snapshot_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quota_accounts_capture_legacy_snapshot ON quota.token_accounts;
CREATE TRIGGER trg_quota_accounts_capture_legacy_snapshot
BEFORE INSERT OR UPDATE OF plan_code ON quota.token_accounts
FOR EACH ROW EXECUTE FUNCTION quota.capture_legacy_entitlement_snapshot();
