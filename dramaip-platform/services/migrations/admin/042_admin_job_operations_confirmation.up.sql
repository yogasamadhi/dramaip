-- Job-owned operations are intentionally named in the same explicit allow
-- list as other confirmation actions. Admin still holds no billing or
-- notification domain table permission; it invokes the job's mTLS API.
ALTER TABLE admin.confirmations
  DROP CONSTRAINT IF EXISTS confirmations_action_check;
ALTER TABLE admin.confirmations
  ADD CONSTRAINT confirmations_action_check CHECK (action IN (
    'principal.suspend',
    'reporting.exception.resolve',
    'customer.status.set',
    'billing.refund.request',
    'billing.subscription.resume',
    'quota.adjust',
    'notification.send',
    'billing.reconciliation.start',
    'billing.reconciliation.action',
    'notification.delivery.retry'
  ));
