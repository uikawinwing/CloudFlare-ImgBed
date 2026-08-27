CREATE TABLE IF NOT EXISTS album_covers (
    album_id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    position_x INTEGER NOT NULL DEFAULT 50 CHECK(position_x BETWEEN 0 AND 100),
    position_y INTEGER NOT NULL DEFAULT 50 CHECK(position_y BETWEEN 0 AND 100),
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (album_id, file_id) REFERENCES album_items(album_id, file_id) ON DELETE CASCADE
);
