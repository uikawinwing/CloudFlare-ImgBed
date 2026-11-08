-- Run explicitly against the intended environment after a backup.
-- Replace existing indexes to match the actual list predicates and sort order.
DROP INDEX IF EXISTS idx_files_owner_id;
DROP INDEX IF EXISTS idx_files_public_catalog;
DROP INDEX IF EXISTS idx_files_featured_catalog;
CREATE INDEX idx_files_owner_id ON files(owner_id, COALESCE(timestamp, 0), id);
CREATE INDEX IF NOT EXISTS idx_files_owner_name ON files(owner_id, LOWER(COALESCE(NULLIF(file_name, ''), id)), id);
CREATE INDEX idx_files_public_catalog ON files(visibility, moderation_status, timestamp DESC, id DESC);
CREATE INDEX idx_files_featured_catalog ON files(visibility, moderation_status, featured_at DESC, id DESC);
