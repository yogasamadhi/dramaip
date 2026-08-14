-- Migration 005 originally created the bundled local-development account
-- before email verification became a checkout precondition. Existing data
-- volumes have already recorded that migration version, so keep the known
-- seed identity verified through a new, idempotent migration.
UPDATE auth.users
SET email_verified_at = COALESCE(email_verified_at, now()),
    status = 'active',
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000001'::uuid
  AND email = 'creator@example.com';
