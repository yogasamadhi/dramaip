-- Customer targets belong to domain services, not admin.principals. The
-- one-time confirmation therefore stores opaque UUID targets and has an
-- explicit allow-list of privileged operations; Admin still cannot query or
-- mutate any customer-domain table directly.
ALTER TABLE admin.confirmations
  DROP CONSTRAINT IF EXISTS confirmations_target_id_fkey;
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
    'notification.send'
  ));

ALTER TABLE admin.principal_roles
  DROP CONSTRAINT IF EXISTS principal_roles_role_check;
ALTER TABLE admin.principal_roles
  ADD CONSTRAINT principal_roles_role_check CHECK (role IN ('viewer', 'operator', 'security_admin', 'finance_admin'));
