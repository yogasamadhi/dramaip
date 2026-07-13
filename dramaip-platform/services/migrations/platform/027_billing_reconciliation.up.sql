-- Reconciliation remains domain-owned: billing stores its findings and
-- operator audit trail, while quota continues to own token-account state.
CREATE TABLE IF NOT EXISTS billing.reconciliation_runs (
  id UUID PRIMARY KEY,
  trigger TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  scanned_orders INT NOT NULL DEFAULT 0,
  detected_items INT NOT NULL DEFAULT 0,
  failure_reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one worker may create a report at a time. A second scheduler tick
-- intentionally skips rather than racing a provider/quota read.
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_reconciliation_one_running
  ON billing.reconciliation_runs ((1))
  WHERE status = 'running';

-- The cursor walks the paid-order ledger in bounded batches rather than
-- repeatedly inspecting only the newest or oldest orders.
CREATE TABLE IF NOT EXISTS billing.reconciliation_cursors (
  name TEXT PRIMARY KEY,
  last_paid_at TIMESTAMPTZ,
  last_order_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing.reconciliation_items (
  id UUID PRIMARY KEY,
  case_key TEXT NOT NULL UNIQUE,
  first_run_id UUID NOT NULL,
  last_run_id UUID NOT NULL,
  order_id UUID,
  subscription_id UUID,
  provider TEXT NOT NULL DEFAULT '',
  mismatch_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  recommended_action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurrences INT NOT NULL DEFAULT 1,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_items_open
  ON billing.reconciliation_items (status, last_detected_at DESC);

-- A case row is the current operator work item. Every observation is kept
-- separately so a later retry cannot overwrite historical discrepancy facts.
CREATE TABLE IF NOT EXISTS billing.reconciliation_observations (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  item_id UUID NOT NULL,
  case_key TEXT NOT NULL,
  mismatch_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_observations_item
  ON billing.reconciliation_observations (item_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS billing.reconciliation_actions (
  id UUID PRIMARY KEY,
  item_id UUID NOT NULL,
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_actions_item
  ON billing.reconciliation_actions (item_id, created_at DESC);
