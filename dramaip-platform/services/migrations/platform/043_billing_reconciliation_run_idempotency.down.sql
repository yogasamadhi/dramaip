DROP INDEX IF EXISTS billing.idx_billing_reconciliation_runs_idempotency;
ALTER TABLE billing.reconciliation_runs
  DROP COLUMN IF EXISTS idempotency_key;
