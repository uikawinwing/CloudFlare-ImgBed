-- Public catalog safety and presentation fields.
-- Existing public albums remain public, but nothing is automatically added to Discover.
ALTER TABLE files ADD COLUMN discover_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN width INTEGER;
ALTER TABLE files ADD COLUMN height INTEGER;
ALTER TABLE files ADD COLUMN featured_at INTEGER;

UPDATE files
SET visibility = 'public',
    metadata = json_set(COALESCE(metadata, '{}'), '$.Visibility', 'public'),
    discover_eligible = 0
WHERE owner_id IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM album_items ai
      JOIN albums a ON a.id = ai.album_id
      JOIN users u ON u.discord_id = a.owner_id
      WHERE ai.file_id = files.id
        AND a.visibility = 'public'
        AND a.owner_id = files.owner_id
        AND u.status = 'active'
  );

UPDATE files
SET width = CAST(json_extract(metadata, '$.Width') AS INTEGER),
    height = CAST(json_extract(metadata, '$.Height') AS INTEGER)
WHERE width IS NULL
  AND height IS NULL
  AND metadata IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_files_public_catalog ON files(discover_eligible, visibility, moderation_status, timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_files_featured_catalog ON files(featured_at DESC, visibility, moderation_status, id DESC);
