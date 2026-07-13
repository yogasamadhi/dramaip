-- Keep unknown provider usage charged until it is either reconciled with a
-- precise settlement or conservatively finalized by quota maintenance.
ALTER TABLE quota.token_reservations
  ADD COLUMN IF NOT EXISTS settlement_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_error TEXT;

CREATE INDEX IF NOT EXISTS idx_quota_reservations_settlement_pending
  ON quota.token_reservations (settlement_deadline)
  WHERE status = 'settlement_pending';
