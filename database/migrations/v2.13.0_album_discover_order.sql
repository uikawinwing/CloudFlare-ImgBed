CREATE INDEX IF NOT EXISTS idx_albums_discover_order ON albums(updated_at DESC, id DESC);
