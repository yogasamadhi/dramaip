-- Initial local administrator. Change this password after the first successful login.
INSERT INTO admin.principals (id, email, password_hash, status)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'admin@163.com',
  '$2a$10$Gx7qKwpbSeYKslzsJchphuJtOAYiBqPEQRlk0bjv4kO1OAOqoM6yy',
  'active'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO admin.principal_roles (principal_id, role)
SELECT id, 'security_admin'
FROM admin.principals
WHERE email = 'admin@163.com'
ON CONFLICT (principal_id, role) DO NOTHING;
