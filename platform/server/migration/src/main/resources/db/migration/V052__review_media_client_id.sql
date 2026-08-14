-- The desktop's manifest media IDs are stable logical IDs, not PostgreSQL UUIDs.
-- Persist them separately so pre-signed upload targets can be retried after a restart.
ALTER TABLE review.media_objects ADD COLUMN IF NOT EXISTS client_media_id TEXT;
UPDATE review.media_objects SET client_media_id = id::text WHERE client_media_id IS NULL;
ALTER TABLE review.media_objects ALTER COLUMN client_media_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_media_objects_package_client_id
  ON review.media_objects (package_id, client_media_id);
