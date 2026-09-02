import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequest } from '../functions/api/user/albums/[id].js';
import { onRequestDelete as removeAlbumItem } from '../functions/api/user/albums/[[id]]/items.js';
import { listDiscoverAlbums } from '../functions/utils/publicCatalog.js';

class TestD1 {
    constructor() {
        this.db = new DatabaseSync(':memory:');
        this.db.exec('PRAGMA foreign_keys = ON');
    }

    exec(sql) { this.db.exec(sql); }

    prepare(sql) { return new TestD1Statement(this.db, sql); }

    async batch(statements) {
        this.db.exec('BEGIN');
        try {
            const results = statements.map(statement => statement.runSync());
            this.db.exec('COMMIT');
            return results;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}

class TestD1Statement {
    constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
    bind(...params) { this.params = params; return this; }
    async first() { return this.db.prepare(this.sql).get(...this.params) || null; }
    async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
    async run() { return this.runSync(); }
    runSync() {
        const result = this.db.prepare(this.sql).run(...this.params);
        return { success: true, meta: { changes: Number(result.changes || 0) } };
    }
}

const album = {
    id: 'album-id', owner_id: 'owner-id', slug: 'album', name: 'Album', description: null,
    visibility: 'public', char_info_character_name: null, cover_file_id: null,
    cover_position_x: null, cover_position_y: null,
};

function sessionEnv({ coverFile = { id: 'art.png' }, storedAlbum = album } = {}) {
    const queries = [];
    const statements = [];
    const env = {
        img_url: {
            get: async key => key === 'manage@session@token' ? JSON.stringify({
                authType: 'user', expiresAt: Date.now() + 60_000, identity: { id: 'owner-id' },
            }) : null,
        },
        img_d1: {
            prepare(sql) {
                queries.push(sql);
                return {
                    bind(...values) {
                        const statement = { sql, values };
                        statements.push(statement);
                        return {
                            first: async () => {
                                if (sql.includes('SELECT username, avatar')) return { username: 'Owner', avatar: null, public_handle: 'owner', role: 'member', status: 'active' };
                                if (sql.includes('FROM albums a LEFT JOIN album_covers')) return storedAlbum;
                                if (sql.includes('SELECT f.id FROM album_items ai')) return coverFile;
                                return null;
                            },
                            run: async () => ({ success: true }),
                            all: async () => ({ results: [] }),
                        };
                    },
                };
            },
            batch: async batch => { statements.push(...batch); },
        },
    };
    return { env, queries, statements };
}

function patchRequest(body) {
    return new Request('https://example.test/api/user/albums/album-id', {
        method: 'PATCH', headers: { Cookie: 'user_session=token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
}

describe('album covers', () => {
    it('persists an active image from the same album with a bounded focal point', async () => {
        const { env, queries, statements } = sessionEnv();
        const response = await onRequest({ env, request: patchRequest({ coverFileId: 'art.png', coverPositionX: 20, coverPositionY: 80 }), params: { id: 'album-id' } });
        assert.strictEqual(response.status, 200);
        assert.deepStrictEqual(await response.json(), {
            id: 'album-id', slug: 'album', name: 'Album', description: null, charInfoCharacterName: null, visibility: 'public',
            coverFileId: 'art.png', coverPositionX: 20, coverPositionY: 80,
        });
        assert.ok(queries.some(sql => sql.includes("f.file_type LIKE 'image/%' AND f.moderation_status = 'active'")));
        assert.ok(statements.some(statement => statement.sql?.includes('INSERT INTO album_covers')));
    });

    it('rejects videos, files outside the album, and invalid focal points', async () => {
        const unavailable = sessionEnv({ coverFile: null });
        const unavailableResponse = await onRequest({ env: unavailable.env, request: patchRequest({ coverFileId: 'clip.mp4', coverPositionX: 50, coverPositionY: 50 }), params: { id: 'album-id' } });
        assert.strictEqual(unavailableResponse.status, 400);
        assert.strictEqual((await unavailableResponse.json()).error, 'Album cover must be an active image in this album');

        const invalid = sessionEnv();
        const invalidResponse = await onRequest({ env: invalid.env, request: patchRequest({ coverFileId: 'art.png', coverPositionX: 101, coverPositionY: 50 }), params: { id: 'album-id' } });
        assert.strictEqual(invalidResponse.status, 400);
        assert.strictEqual((await invalidResponse.json()).error, 'Invalid album cover data');
        assert.ok(!invalid.statements.some(statement => statement.sql?.includes('INSERT INTO album_covers')));
    });

    it('resets the returned focal point when the owner restores automatic cover selection', async () => {
        const storedAlbum = { ...album, cover_file_id: 'art.png', cover_position_x: 20, cover_position_y: 80 };
        const { env, statements } = sessionEnv({ storedAlbum });
        const response = await onRequest({ env, request: patchRequest({ coverFileId: null }), params: { id: 'album-id' } });
        assert.strictEqual(response.status, 200);
        const body = await response.json();
        assert.deepStrictEqual({ coverFileId: body.coverFileId, coverPositionX: body.coverPositionX, coverPositionY: body.coverPositionY }, {
            coverFileId: null, coverPositionX: 50, coverPositionY: 50,
        });
        assert.ok(statements.some(statement => statement.sql?.includes('DELETE FROM album_covers')));
    });

    it('defines the cover table with one record per album and cascading cleanup', () => {
        const init = readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8');
        const migration = readFileSync(new URL('../database/migrations/v2.10.0_album_covers.sql', import.meta.url), 'utf8');
        for (const sql of [init, migration]) {
            assert.match(sql, /CREATE TABLE IF NOT EXISTS album_covers/);
            assert.match(sql, /album_id TEXT PRIMARY KEY/);
            assert.match(sql, /position_x INTEGER NOT NULL DEFAULT 50 CHECK\(position_x BETWEEN 0 AND 100\)/);
            assert.match(sql, /FOREIGN KEY \(file_id\) REFERENCES files\(id\) ON DELETE CASCADE/);
            assert.match(sql, /FOREIGN KEY \(album_id, file_id\) REFERENCES album_items\(album_id, file_id\) ON DELETE CASCADE/);
        }
    });

    it('keeps the routine staging Worker deployment independent from one-time D1 migrations', () => {
        const stagingWorkflow = readFileSync(new URL('../.github/workflows/deploy-staging-worker.yml', import.meta.url), 'utf8');
        assert.match(stagingWorkflow, /name: Validate staging Worker bundle[\s\S]*deploy --dry-run --config deploy\/worker\/wrangler\.staging\.toml/);
        assert.match(stagingWorkflow, /name: Deploy staging Worker[\s\S]*deploy --config deploy\/worker\/wrangler\.staging\.toml/);
        assert.doesNotMatch(stagingWorkflow, /wrangler d1 execute/);
        assert.ok(stagingWorkflow.indexOf('name: Validate staging Worker bundle') < stagingWorkflow.indexOf('name: Deploy staging Worker'));
    });
});

describe('album cover D1 integration', () => {
    it('keeps order stable, hides a selected private cover from Discover, and cascades membership cleanup', async () => {
        const db = new TestD1();
        try {
            db.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
            db.exec(`
                INSERT INTO users (discord_id, username, public_handle, role, status, used_bytes, created_at, updated_at)
                    VALUES ('owner-id', 'Owner', 'owner', 'member', 'active', 0, 1, 1),
                           ('other-id', 'Other', 'other', 'member', 'active', 0, 1, 1);
                INSERT INTO albums (id, owner_id, slug, name, visibility, created_at, updated_at)
                    VALUES ('album-id', 'owner-id', 'album', 'Album', 'public', 1, 1);
                INSERT INTO files (id, metadata, file_name, file_type, file_size_bytes, timestamp, owner_id, visibility, moderation_status)
                    VALUES ('clip.webm', '{}', 'Clip', 'video/webm', 1, 1, 'owner-id', 'public', 'active'),
                           ('public.png', '{}', 'Public', 'image/png', 1, 2, 'owner-id', 'public', 'active'),
                           ('private.png', '{}', 'Private', 'image/png', 1, 3, 'owner-id', 'private', 'active'),
                           ('outside.png', '{}', 'Outside', 'image/png', 1, 4, 'owner-id', 'public', 'active');
                INSERT INTO album_items (album_id, file_id, position, created_at)
                    VALUES ('album-id', 'clip.webm', 0, 1), ('album-id', 'public.png', 1, 2), ('album-id', 'private.png', 2, 3);
            `);
            const sessions = {
                'manage@session@owner-token': { authType: 'user', expiresAt: Date.now() + 60_000, identity: { id: 'owner-id' } },
                'manage@session@other-token': { authType: 'user', expiresAt: Date.now() + 60_000, identity: { id: 'other-id' } },
            };
            const env = {
                img_d1: db,
                img_url: { get: async key => sessions[key] ? JSON.stringify(sessions[key]) : null, delete: async () => {} },
            };
            const orderBefore = db.db.prepare('SELECT file_id FROM album_items WHERE album_id = ? ORDER BY position, created_at').all('album-id').map(row => row.file_id);
            const response = await onRequest({ env, request: new Request('https://example.test/api/user/albums/album-id', {
                method: 'PATCH', headers: { Cookie: 'user_session=owner-token', 'Content-Type': 'application/json' },
                body: JSON.stringify({ coverFileId: 'private.png', coverPositionX: 20, coverPositionY: 80 }),
            }), params: { id: 'album-id' } });
            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual({ ...db.db.prepare('SELECT file_id, position_x, position_y FROM album_covers').get() }, { file_id: 'private.png', position_x: 20, position_y: 80 });
            const orderAfter = db.db.prepare('SELECT file_id FROM album_items WHERE album_id = ? ORDER BY position, created_at').all('album-id').map(row => row.file_id);
            assert.deepStrictEqual(orderAfter, orderBefore, 'choosing a cover must not reorder Gallery Pack items');

            const discover = await listDiscoverAlbums(env, 'https://example.test/api/public/discover');
            assert.strictEqual(discover[0].coverUrl, 'https://example.test/file/clip.webm?v=1');
            assert.strictEqual(discover[0].coverType, 'video/webm');

            const otherResponse = await onRequest({ env, request: new Request('https://example.test/api/user/albums/album-id', {
                method: 'PATCH', headers: { Cookie: 'user_session=other-token', 'Content-Type': 'application/json' },
                body: JSON.stringify({ coverFileId: 'public.png', coverPositionX: 50, coverPositionY: 50 }),
            }), params: { id: 'album-id' } });
            assert.strictEqual(otherResponse.status, 403);

            const removeResponse = await removeAlbumItem({ env, request: new Request('https://example.test/api/user/albums/album-id/items?fileId=private.png', {
                method: 'DELETE', headers: { Cookie: 'user_session=owner-token' },
            }), params: { id: 'album-id' } });
            assert.strictEqual(removeResponse.status, 200);
            assert.strictEqual(db.db.prepare('SELECT COUNT(*) AS count FROM album_covers').get().count, 0);
            assert.throws(() => db.db.prepare('INSERT INTO album_covers (album_id, file_id, position_x, position_y, updated_at) VALUES (?, ?, 50, 50, 1)').run('album-id', 'outside.png'), /FOREIGN KEY constraint failed/);
        } finally {
            db.db.close();
        }
    });
});
