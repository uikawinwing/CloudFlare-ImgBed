import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TestD1 } from './helpers/d1.js';
import { onRequest as userMiddleware } from '../functions/api/user/_middleware.js';
import { onRequest as albumIndex } from '../functions/api/user/albums/index.js';
import { onRequest as albumDetail } from '../functions/api/user/albums/[id].js';
import { onRequestPost as addItem, onRequestDelete as removeItem, onRequestPatch as reorderItems } from '../functions/api/user/albums/[[id]]/items.js';
import { onRequestPut as putVisual, onRequestDelete as deleteVisual } from '../functions/api/user/albums/[[id]]/charinfo.js';

function fixture() {
    const d1 = new TestD1();
    d1.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    d1.exec(`
        INSERT INTO users (discord_id, username, public_handle, role, status, used_bytes, created_at, updated_at)
        VALUES ('a', 'A', 'player-a', 'member', 'active', 0, 1, 1), ('b', 'B', 'player-b', 'member', 'active', 0, 1, 1);
        INSERT INTO albums (id, owner_id, slug, name, char_info_character_name, created_at, updated_at)
        VALUES ('album-a', 'a', 'album-a', '图册', '爱丽丝', 1, 1);
        INSERT INTO files (id, metadata, file_name, file_type, file_size_bytes, timestamp, owner_id, visibility, moderation_status)
        VALUES ('image1.png', '{}', 'Image 1', 'image/png', 1, 1, 'a', 'private', 'active'),
               ('image2.png', '{}', 'Image 2', 'image/png', 1, 2, 'a', 'public', 'active'),
               ('other.png', '{}', 'Other', 'image/png', 1, 3, 'b', 'public', 'active');
        INSERT INTO album_items (album_id, file_id, position, created_at) VALUES ('album-a', 'image1.png', 0, 1);
    `);
    const env = {
        img_d1: d1,
        img_url: { get: async key => {
            const user = { 'manage@session@a-token': 'a', 'manage@session@b-token': 'b' }[key];
            return user ? JSON.stringify({ authType: 'user', expiresAt: Date.now() + 60_000, identity: { id: user } }) : null;
        } },
    };
    return { env, db: d1.db };
}

async function call(env, handler, { method = 'GET', path = '/api/user/albums/album-a', body, user = 'a', headers = {} } = {}) {
    const request = new Request(`https://example.test${path}`, {
        method,
        headers: { ...(user ? { Cookie: `user_session=${user}-token` } : {}), Origin: 'https://example.test', 'Content-Type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return userMiddleware({ request, env, next: () => handler({ request, env, params: { id: 'album-a' } }) });
}

const mutations = [
    { title: 'create', handler: albumIndex, method: 'POST', body: { name: 'New' }, path: '/api/user/albums', otherStatus: 201 },
    { title: 'rename', handler: albumDetail, method: 'PATCH', body: { name: 'Renamed' }, otherStatus: 403 },
    { title: 'cover', handler: albumDetail, method: 'PATCH', body: { coverFileId: 'image1.png' }, otherStatus: 403 },
    { title: 'delete', handler: albumDetail, method: 'DELETE', otherStatus: 403 },
    { title: 'add item', handler: addItem, method: 'POST', body: { fileId: 'image2.png', position: 1 }, otherStatus: 404 },
    { title: 'remove item', handler: removeItem, method: 'DELETE', path: '/api/user/albums/album-a/items?fileId=image1.png', otherStatus: 404 },
    { title: 'reorder', handler: reorderItems, method: 'PATCH', body: { fileId: 'image1.png', swapWithFileId: 'image2.png' }, otherStatus: 404 },
    { title: 'visual save', handler: putVisual, method: 'PUT', body: {}, otherStatus: 404 },
    { title: 'visual delete', handler: deleteVisual, method: 'DELETE', otherStatus: 404 },
];

describe('album integration creation and mutation boundaries', () => {
    let env;
    let db;
    beforeEach(() => { ({ env, db } = fixture()); });
    afterEach(() => db.close());

    it('creates Chinese and Japanese names with UUID IDs and unique safe automatic slugs', async () => {
        const slugs = [];
        for (const name of ['爱丽丝', '爱丽丝', 'アリス']) {
            const response = await call(env, albumIndex, { method: 'POST', body: { name, charInfoCharacterName: name } });
            assert.equal(response.status, 201);
            const album = await response.json();
            assert.match(album.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
            assert.match(album.slug, /^npc-[a-f0-9-]+$/);
            assert.equal(album.name, name);
            assert.equal(album.charInfoCharacterName, name);
            slugs.push(album.slug);
        }
        assert.equal(new Set(slugs).size, 3);
    });

    it('preserves English automatic slugs and rejects invalid explicit slugs on create and update', async () => {
        const created = await call(env, albumIndex, { method: 'POST', body: { name: 'Iris Gallery' } });
        assert.equal((await created.json()).slug, 'iris-gallery');
        for (const slug of ['', null, '中文', '../album', 'two words', 'a'.repeat(81)]) {
            for (const [handler, method] of [[albumIndex, 'POST'], [albumDetail, 'PATCH']]) {
                const response = await call(env, handler, { method, body: { name: 'Valid name', slug } });
                assert.equal(response.status, 400, `${method}: ${String(slug)}`);
            }
        }
    });

    it('reports real slug conflicts without replacing the existing album', async () => {
        const response = await call(env, albumIndex, { method: 'POST', body: { name: 'Duplicate', slug: 'album-a' } });
        assert.equal(response.status, 409);
        assert.equal(db.prepare('SELECT name FROM albums WHERE id = ?').get('album-a').name, '图册');
    });

    it('assigns newly created albums to the authenticated user despite forged ownership fields', async () => {
        const response = await call(env, albumIndex, { method: 'POST', user: 'b', body: { name: '我的图册', ownerId: 'a', isOwner: true } });
        assert.equal(response.status, 201);
        const album = await response.json();
        assert.equal(db.prepare('SELECT owner_id FROM albums WHERE id = ?').get(album.id).owner_id, 'b');
    });

    it('keeps unexpected database errors distinct from slug conflicts', async () => {
        const original = env.img_d1.prepare.bind(env.img_d1);
        env.img_d1.prepare = sql => {
            if (sql.startsWith('INSERT INTO albums')) return { bind: () => ({ run: async () => { throw new Error('unavailable'); } }) };
            return original(sql);
        };
        const response = await call(env, albumIndex, { method: 'POST', body: { name: '爱丽丝' } });
        assert.equal(response.status, 500);
        assert.equal((await response.json()).error, 'Unable to create album');
    });

    for (const mutation of mutations) {
        it(`requires login for ${mutation.title}`, async () => {
            const response = await call(env, mutation.handler, { ...mutation, user: null });
            assert.equal(response.status, 401);
        });
        it(`rejects cross-site ${mutation.title} before changing data`, async () => {
            for (const headers of [{ Origin: 'https://st.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
                const response = await call(env, mutation.handler, { ...mutation, headers });
                assert.equal(response.status, 403);
                assert.equal((await response.json()).error, 'Cross-site request rejected');
            }
            assert.equal(db.prepare('SELECT name FROM albums WHERE id = ?').get('album-a').name, '图册');
            assert.equal(db.prepare('SELECT count(*) AS count FROM album_items').get().count, 1);
        });
        if (mutation.title !== 'create') {
            it(`denies another user ${mutation.title} even with forged owner fields`, async () => {
                const response = await call(env, mutation.handler, { ...mutation, user: 'b', ...(mutation.body ? { body: { ...mutation.body, ownerId: 'a', isOwner: true } } : {}) });
                assert.equal(response.status, mutation.otherStatus);
            });
        }
    }

    it('lets the owner add, reorder, select a cover and remove membership while preserving files', async () => {
        assert.equal((await call(env, addItem, { method: 'POST', body: { fileId: 'other.png' } })).status, 404);
        assert.equal((await call(env, addItem, { method: 'POST', body: { fileId: 'image2.png', position: 1 } })).status, 200);
        assert.equal((await call(env, reorderItems, { method: 'PATCH', body: { fileId: 'image1.png', swapWithFileId: 'image2.png' } })).status, 200);
        assert.deepEqual(db.prepare('SELECT file_id FROM album_items ORDER BY position').all().map(row => row.file_id), ['image2.png', 'image1.png']);
        assert.equal((await call(env, albumDetail, { method: 'PATCH', body: { coverFileId: 'image1.png' } })).status, 200);
        assert.equal((await call(env, removeItem, { method: 'DELETE', path: '/api/user/albums/album-a/items?fileId=image1.png' })).status, 200);
        assert.equal(db.prepare('SELECT count(*) AS count FROM album_covers').get().count, 0);
        assert.equal(db.prepare('SELECT count(*) AS count FROM files').get().count, 3);
        assert.equal((await call(env, putVisual, { method: 'PUT', body: {} })).status, 200);
        assert.equal((await call(env, deleteVisual, { method: 'DELETE' })).status, 200);
        assert.equal((await call(env, albumDetail, { method: 'DELETE' })).status, 200);
        assert.equal(db.prepare('SELECT count(*) AS count FROM files').get().count, 3);
    });

    it('distinguishes unauthenticated, non-owner and missing private album GET responses', async () => {
        assert.equal((await call(env, albumDetail, { user: null })).status, 401);
        assert.equal((await call(env, albumDetail, { user: 'b' })).status, 403);
        assert.equal((await call(env, albumDetail)).status, 200);
        db.prepare('DELETE FROM album_items').run();
        db.prepare('DELETE FROM albums').run();
        assert.equal((await call(env, albumDetail)).status, 404);
    });
});
