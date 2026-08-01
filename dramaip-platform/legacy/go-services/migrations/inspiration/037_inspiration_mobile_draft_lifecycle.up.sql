-- Keep adoption evidence immutable while allowing a creator to hide a cloud
-- draft from future mobile/Desktop lists. The row is retained for audit and
-- foreign-key safety; retention cleanup is an explicit future job.
ALTER TABLE inspiration.mobile_drafts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inspiration_mobile_drafts_active_page
  ON inspiration.mobile_drafts (user_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;
