ALTER TABLE user_profile.profiles
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

UPDATE user_profile.profiles
SET email = 'creator@example.com', status = 'active'
WHERE user_id = '00000000-0000-4000-8000-000000000001'::uuid
  AND email = '';
