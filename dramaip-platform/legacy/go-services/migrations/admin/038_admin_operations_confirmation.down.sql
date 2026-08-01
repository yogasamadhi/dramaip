ALTER TABLE admin.principal_roles DROP CONSTRAINT IF EXISTS principal_roles_role_check;
ALTER TABLE admin.principal_roles ADD CONSTRAINT principal_roles_role_check CHECK (role IN ('viewer', 'operator', 'security_admin'));
ALTER TABLE admin.confirmations DROP CONSTRAINT IF EXISTS confirmations_action_check;
ALTER TABLE admin.confirmations ADD CONSTRAINT confirmations_action_check CHECK (action IN ('principal.suspend'));
-- The original customer-incompatible foreign key is deliberately not restored.
