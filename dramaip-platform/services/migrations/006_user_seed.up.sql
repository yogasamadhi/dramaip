INSERT INTO user_profile.profiles (user_id, display_name, locale, timezone)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Demo Creator',
  'zh-CN',
  'Asia/Shanghai'
)
ON CONFLICT (user_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  locale = EXCLUDED.locale,
  timezone = EXCLUDED.timezone,
  updated_at = now();
