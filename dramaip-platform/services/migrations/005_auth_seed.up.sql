INSERT INTO auth.users (id, email, password_hash, status)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'creator@example.com',
  '$2a$10$ZevXAHm6n65cxgEcdw.l3.gesNW2jpVfuveMDsIXF/l6vz3X54UHW',
  'active'
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  status = EXCLUDED.status,
  updated_at = now();
