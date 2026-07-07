CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE quota.token_reservations
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes');

ALTER TABLE quota.token_usage_logs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'settled',
  ADD COLUMN IF NOT EXISTS error TEXT;

CREATE INDEX IF NOT EXISTS idx_quota_reservations_expired
  ON quota.token_reservations (expires_at)
  WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_quota_usage_user_created
  ON quota.token_usage_logs (user_id, created_at DESC);
