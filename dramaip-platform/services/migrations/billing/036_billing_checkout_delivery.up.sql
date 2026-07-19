-- Persist the provider-issued payment entry and its local validity window so
-- the authenticated order view can recover a checkout after navigation or a
-- browser restart. These fields contain no credential material.
ALTER TABLE billing.orders
  ADD COLUMN IF NOT EXISTS payment_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_billing_orders_pending_expiry
  ON billing.orders (payment_expires_at)
  WHERE status = 'pending' AND payment_expires_at IS NOT NULL;
