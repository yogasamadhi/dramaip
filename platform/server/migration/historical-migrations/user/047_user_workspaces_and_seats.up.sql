CREATE TABLE IF NOT EXISTS user_profile.workspaces (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  plan_code TEXT NOT NULL DEFAULT 'free',
  included_seats INT NOT NULL DEFAULT 1 CHECK (included_seats >= 1),
  review_storage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (review_storage_bytes >= 0),
  review_retention_days INT NOT NULL DEFAULT 0 CHECK (review_retention_days BETWEEN 0 AND 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profile.workspace_members (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES user_profile.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_single_active_owner
  ON user_profile.workspace_members (workspace_id)
  WHERE role = 'owner' AND status = 'active';

CREATE TABLE IF NOT EXISTS user_profile.workspace_invitations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES user_profile.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash BYTEA NOT NULL UNIQUE,
  invited_by UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by UUID,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_pending_invite_email
  ON user_profile.workspace_invitations (workspace_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Existing users receive one personal workspace. The owner counts toward the
-- seat limit; external reviewers are intentionally not represented here.
INSERT INTO user_profile.workspaces (id, owner_user_id, name, plan_code, included_seats)
SELECT gen_random_uuid(), profile.user_id, COALESCE(NULLIF(profile.display_name, ''), '个人') || '的工作区', 'free', 1
FROM user_profile.profiles AS profile
WHERE NOT EXISTS (
  SELECT 1 FROM user_profile.workspaces AS workspace WHERE workspace.owner_user_id = profile.user_id
);

INSERT INTO user_profile.workspace_members (id, workspace_id, user_id, role, status)
SELECT gen_random_uuid(), workspace.id, workspace.owner_user_id, 'owner', 'active'
FROM user_profile.workspaces AS workspace
WHERE NOT EXISTS (
  SELECT 1 FROM user_profile.workspace_members AS member
  WHERE member.workspace_id = workspace.id AND member.user_id = workspace.owner_user_id
);

CREATE OR REPLACE FUNCTION user_profile.ensure_personal_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_profile.workspaces WHERE owner_user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;
  workspace_id := gen_random_uuid();
  INSERT INTO user_profile.workspaces (
    id, owner_user_id, name, plan_code, included_seats, review_storage_bytes, review_retention_days
  )
  VALUES (
    workspace_id, NEW.user_id, COALESCE(NULLIF(NEW.display_name, ''), '个人') || '的工作区',
    'free', 1, 0, 0
  );
  INSERT INTO user_profile.workspace_members (id, workspace_id, user_id, role, status)
  VALUES (gen_random_uuid(), workspace_id, NEW.user_id, 'owner', 'active');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profile_ensure_personal_workspace ON user_profile.profiles;
CREATE TRIGGER trg_user_profile_ensure_personal_workspace
AFTER INSERT ON user_profile.profiles
FOR EACH ROW EXECUTE FUNCTION user_profile.ensure_personal_workspace();

GRANT SELECT, INSERT, UPDATE, DELETE ON user_profile.workspaces, user_profile.workspace_members, user_profile.workspace_invitations TO dramaip_user;
