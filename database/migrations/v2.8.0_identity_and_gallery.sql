-- Discord identity, ownership, moderation and public galleries.
CREATE TABLE IF NOT EXISTS users (
    discord_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    avatar TEXT,
    public_handle TEXT UNIQUE,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'manager', 'admin', 'owner')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
    used_bytes INTEGER NOT NULL DEFAULT 0,
    last_login_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
    discord_id TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (discord_id, role),
    FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'unlisted' CHECK(visibility IN ('public', 'unlisted')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(owner_id, slug),
    FOREIGN KEY (owner_id) REFERENCES users(discord_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS album_items (
    album_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (album_id, file_id),
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT,
    details TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (actor_id) REFERENCES users(discord_id)
);

ALTER TABLE files ADD COLUMN owner_id TEXT;
ALTER TABLE files ADD COLUMN file_size_bytes INTEGER;
ALTER TABLE files ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE files ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE files ADD COLUMN quarantined_by TEXT;
ALTER TABLE files ADD COLUMN quarantined_at INTEGER;

UPDATE users
SET used_bytes = COALESCE((
    SELECT SUM(COALESCE(file_size_bytes, 0))
    FROM files
    WHERE files.owner_id = users.discord_id
      AND files.moderation_status != 'deleted'
), 0);

CREATE INDEX IF NOT EXISTS idx_users_public_handle ON users(public_handle);
CREATE INDEX IF NOT EXISTS idx_files_owner_id ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_moderation_status ON files(moderation_status);
CREATE INDEX IF NOT EXISTS idx_album_items_album_order ON album_items(album_id, position);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
