import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestGet as listFiles } from '../functions/api/user/files/index.js';
import { onRequestPatch as swapAlbumItems } from '../functions/api/user/albums/[[id]]/items.js';
import { TestD1 } from './helpers/d1.js';

function createEnv(d1, identities = { owner: 'owner-id' }) {
    return {
        img_d1: d1,
        img_url: {
            get: async (key) => {
                const token = key.replace('manage@session@', '');
                const id = identities[token];
                return id ? JSON.stringify({ authType: 'user', expiresAt: Date.now() + 60_000, identity: { id } }) : null;
            },
        },
    };
}

function request(url, token = 'owner', method = 'GET', body) {
    return new Request(url, {
        method,
        headers: { Cookie: `user_session=${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
}

function database() {
    const d1 = new TestD1();
    d1.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    d1.exec(`
        INSERT INTO users (discord_id, username, role, status, used_bytes, created_at, updated_at)
            VALUES ('owner-id', 'Owner', 'member', 'active', 123456, 1, 1), ('other-id', 'Other', 'member', 'active', 0, 1, 1);
        INSERT INTO albums (id, owner_id, slug, name, visibility, created_at, updated_at)
            VALUES ('album-id', 'owner-id', 'album', 'Album', 'public', 1, 1);
        INSERT INTO files (id, metadata, file_name, file_type, file_size_bytes, timestamp, owner_id, visibility, moderation_status)
            VALUES ('same-b.png', '{}', 'Same B', 'image/png', 10, 30, 'owner-id', 'private', 'active'),
                   ('same-a.png', '{}', 'Same A', 'image/png', 20, 30, 'owner-id', 'private', 'active'),
                   ('clip.webm', '{}', 'Clip', 'video/webm', 30, 20, 'owner-id', 'private', 'active'),
                   ('older.png', '{}', 'Older', 'image/png', 40, 10, 'owner-id', 'private', 'active'),
                   ('other.png', '{}', 'Other', 'image/png', 50, 40, 'other-id', 'private', 'active');
        INSERT INTO album_items (album_id, file_id, position, created_at)
            VALUES ('album-id', 'same-a.png', 0, 1), ('album-id', 'clip.webm', 1, 2), ('album-id', 'older.png', 2, 3);
    `);
    return d1;
}

describe('phase 1 file management', () => {
    it('keeps legacy null timestamps and non-ASCII names across one-item pages', async () => {
        const d1 = database();
        try {
            d1.exec(`UPDATE files SET timestamp = NULL WHERE id = 'older.png';
                UPDATE files SET file_name = 'Éclair' WHERE id = 'same-a.png';`);
            const env = createEnv(d1);
            for (const sort of ['newest', 'oldest', 'name']) {
                const ids = [];
                let cursor = '';
                do {
                    const page = await (await listFiles({ env, request: request(`https://example.test/api/user/files?limit=1&sort=${sort}&cursor=${encodeURIComponent(cursor)}`) })).json();
                    ids.push(...page.files.map(file => file.id));
                    cursor = page.nextCursor;
                    assert.ok(ids.length <= 4, 'pagination must advance');
                } while (cursor);
                assert.equal(new Set(ids).size, 4);
                assert.ok(ids.includes('older.png'));
            }
        } finally {
            d1.db.close();
        }
    });

    it('paginates a stable owner-only file list and reports D1 quota usage', async () => {
        const d1 = database();
        try {
            const env = createEnv(d1);
            const first = await listFiles({ env, request: request('https://example.test/api/user/files?limit=2&sort=newest') });
            assert.strictEqual(first.status, 200);
            const firstPage = await first.json();
            assert.deepStrictEqual(firstPage.files.map(file => file.id), ['same-b.png', 'same-a.png']);
            assert.strictEqual(firstPage.usedBytes, 123456);
            assert.ok(firstPage.nextCursor);

            const second = await listFiles({ env, request: request(`https://example.test/api/user/files?limit=2&sort=newest&cursor=${encodeURIComponent(firstPage.nextCursor)}`) });
            const secondPage = await second.json();
            assert.deepStrictEqual(secondPage.files.map(file => file.id), ['clip.webm', 'older.png']);
            assert.strictEqual(secondPage.nextCursor, null);
            assert.ok(![...firstPage.files, ...secondPage.files].some(file => file.id === 'other.png'));
        } finally {
            d1.db.close();
        }
    });

    it('searches and filters in D1 before applying the page limit', async () => {
        const d1 = database();
        try {
            const env = createEnv(d1);
            const response = await listFiles({ env, request: request('https://example.test/api/user/files?limit=1&filter=video&query=clip') });
            const body = await response.json();
            assert.deepStrictEqual(body.files.map(file => file.id), ['clip.webm']);
            assert.strictEqual(body.nextCursor, null);
        } finally {
            d1.db.close();
        }
    });

    it('uses a name cursor that remains ordered across pages', async () => {
        const d1 = database();
        try {
            const env = createEnv(d1);
            const first = await (await listFiles({ env, request: request('https://example.test/api/user/files?limit=2&sort=name') })).json();
            const second = await (await listFiles({ env, request: request(`https://example.test/api/user/files?limit=2&sort=name&cursor=${encodeURIComponent(first.nextCursor)}`) })).json();
            assert.deepStrictEqual([...first.files, ...second.files].map(file => file.file_name), ['Clip', 'Older', 'Same A', 'Same B']);
        } finally {
            d1.db.close();
        }
    });

    it('rejects cursors whose sort or required fields do not match the request', async () => {
        const d1 = database();
        try {
            const env = createEnv(d1);
            const malformed = encodeURIComponent(JSON.stringify({ sort: 'name', id: 'same-a.png' }));
            const response = await listFiles({ env, request: request(`https://example.test/api/user/files?sort=newest&cursor=${malformed}`) });
            assert.strictEqual(response.status, 400);
            assert.deepStrictEqual(await response.json(), { error: 'Invalid page cursor' });
        } finally {
            d1.db.close();
        }
    });

    it('atomically swaps two owned album items and rejects missing membership', async () => {
        const d1 = database();
        try {
            const env = createEnv(d1);
            const response = await swapAlbumItems({
                env,
                request: request('https://example.test/api/user/albums/album-id/items', 'owner', 'PATCH', { fileId: 'same-a.png', swapWithFileId: 'clip.webm' }),
                params: { id: 'album-id' },
            });
            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual(d1.db.prepare('SELECT file_id FROM album_items WHERE album_id = ? ORDER BY position, created_at').all('album-id').map(item => item.file_id), ['clip.webm', 'same-a.png', 'older.png']);

            const rejected = await swapAlbumItems({
                env,
                request: request('https://example.test/api/user/albums/album-id/items', 'owner', 'PATCH', { fileId: 'same-a.png', swapWithFileId: 'other.png' }),
                params: { id: 'album-id' },
            });
            assert.strictEqual(rejected.status, 404);
            assert.deepStrictEqual(d1.db.prepare('SELECT file_id FROM album_items WHERE album_id = ? ORDER BY position, created_at').all('album-id').map(item => item.file_id), ['clip.webm', 'same-a.png', 'older.png']);

            const forbidden = await swapAlbumItems({
                env: createEnv(d1, { other: 'other-id' }),
                request: request('https://example.test/api/user/albums/album-id/items', 'other', 'PATCH', { fileId: 'clip.webm', swapWithFileId: 'same-a.png' }),
                params: { id: 'album-id' },
            });
            assert.strictEqual(forbidden.status, 404);
        } finally {
            d1.db.close();
        }
    });

    it('keeps unique positions when overlapping swaps run concurrently', async () => {
        const d1 = database();
        try {
            const env = createEnv(d1);
            const responses = await Promise.all([
                ['same-a.png', 'clip.webm'],
                ['clip.webm', 'older.png'],
            ].map(([fileId, swapWithFileId]) => swapAlbumItems({
                env,
                request: request('https://example.test/api/user/albums/album-id/items', 'owner', 'PATCH', { fileId, swapWithFileId }),
                params: { id: 'album-id' },
            })));
            assert.ok(responses.every(response => response.status === 200));
            const positions = d1.db.prepare('SELECT position FROM album_items WHERE album_id = ? ORDER BY position').all('album-id');
            assert.deepStrictEqual(positions.map(item => item.position), [0, 1, 2]);
        } finally {
            d1.db.close();
        }
    });

    it('rolls back the whole swap when SQLite rejects an update', async () => {
        const d1 = database();
        try {
            d1.exec(`CREATE TRIGGER reject_swap AFTER UPDATE OF position ON album_items
                WHEN NEW.file_id = 'same-a.png' BEGIN SELECT RAISE(ABORT, 'forced swap failure'); END;`);
            await assert.rejects(() => swapAlbumItems({
                env: createEnv(d1),
                request: request('https://example.test/api/user/albums/album-id/items', 'owner', 'PATCH', { fileId: 'same-a.png', swapWithFileId: 'clip.webm' }),
                params: { id: 'album-id' },
            }), /forced swap failure/);
            assert.deepStrictEqual(d1.db.prepare('SELECT file_id FROM album_items WHERE album_id = ? ORDER BY position, created_at').all('album-id').map(item => item.file_id), ['same-a.png', 'clip.webm', 'older.png']);
        } finally {
            d1.db.close();
        }
    });
});
