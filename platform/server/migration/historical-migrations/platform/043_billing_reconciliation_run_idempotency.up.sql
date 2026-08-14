-- A second-confirmation retry must resolve to the original reconciliation run
-- instead of starting another full ledger scan after an uncertain network
-- response. Scheduled runs intentionally leave this nullable.
ALTER TABLE billing.reconciliation_runs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_reconciliation_runs_idempotency
  ON billing.reconciliation_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
