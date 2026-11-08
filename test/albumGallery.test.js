import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestGet, onRequestOptions } from '../functions/api/public/album-gallery/[albumId].js';
import { onRequest as userMiddleware } from '../functions/api/user/_middleware.js';
import * as items from '../functions/api/user/albums/[[id]]/items.js';
import { TestD1 } from './helpers/d1.js';
import { isSupportedRemoteImageUrl, isSupportedRemoteMediaUrl } from '../frontend-src/charinfo/upstream/remoteMediaUrl.ts';

const albumId = '12345678-1234-4234-8234-123456789abc';
const url = `https://example.test/api/public/album-gallery/${albumId}`;

// Protocol requirements from CharInfo Manager's remoteGallery.ts v1 parser.
function assertGalleryV1(pack) {
    assert.equal(pack.format, 'char-info-gallery-pack');
    assert.equal(pack.version, 1);
    for (const key of ['packId', 'profileId']) assert.match(pack[key], /^[a-z0-9][a-z0-9._-]{0,63}$/u);
    assert.ok(pack.characterName.trim() && pack.characterName.length <= 80);
    assert.doesNotMatch(pack.characterName, /[\x00-\x1f\x7f]/u);
    const image = value => {
        assert.equal(new URL(value).protocol, 'https:');
        assert.ok(isSupportedRemoteImageUrl(value));
    };
    for (const key of ['avatarThumbnail', 'libraryThumbnail']) {
        assert.ok(Object.hasOwn(pack, key));
        if (pack[key] !== null) image(pack[key]);
    }
    assert.ok(Array.isArray(pack.gallery));
    for (const item of pack.gallery) {
        assert.equal(typeof item.title, 'string');
        assert.doesNotMatch(item.title, /[\x00-\x1f\x7f]/u);
        assert.ok(item.sources.length);
        for (const source of item.sources) {
            assert.equal(new URL(source).protocol, 'https:');
            assert.ok(isSupportedRemoteMediaUrl(source));
        }
        if (item.thumbnail) image(item.thumbnail);
    }
    assert.deepEqual(Object.keys(pack).sort(), [
        'format', 'version', 'packId', 'profileId', 'characterName', 'avatarThumbnail', 'libraryThumbnail', 'gallery',
    ].sort(), 'no owner identity or character metadata is exposed');
}

function fixture() {
    const db = new TestD1();
    db.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO users (discord_id, username, public_handle, created_at, updated_at)
        VALUES ('a', 'A', 'alice', 1, 1), ('b', 'B', 'bob', 1, 1);
        INSERT INTO albums (id, owner_id, name, slug, visibility, char_info_character_name, created_at, updated_at)
        VALUES ('${albumId}', 'a', '图片集', 'gallery', 'unlisted', '旅行者', 1, 1);`);
    for (const [index, [id, type, moderation, owner]] of [
        ['image1.png', 'image/png', 'active', 'a'], ['clip.webm', 'video/webm', 'active', 'a'],
        ['image5.png', 'image/png', 'active', 'a'], ['pending.png', 'image/png', 'pending', 'a'],
        ['old.svg', 'image/svg+xml', 'active', 'a'], ['foreign.png', 'image/png', 'active', 'b'],
    ].entries()) {
        db.db.prepare('INSERT INTO files (id, file_name, metadata, file_type, owner_id, visibility, moderation_status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, id, '{}', type, owner, 'private', moderation, index + 1);
        db.db.prepare('INSERT INTO album_items (album_id, file_id, position, created_at) VALUES (?, ?, ?, ?)')
            .run(albumId, id, index, index);
    }
    const env = { img_d1: db, img_url: { get: async key => key === 'manage@session@test' ? JSON.stringify({
        authType: 'user', expiresAt: Date.now() + 60_000, identity: { id: 'a' },
    }) : null } };
    const read = (headers, id = albumId) => onRequestGet({ request: new Request(url, { headers }), env, params: { albumId: id } });
    const mutate = (method, body, query = '') => {
        const request = new Request(`https://example.test/api/user/albums/${albumId}/items${query}`, {
            method, headers: { Cookie: 'user_session=test', Origin: 'https://example.test', 'Content-Type': 'application/json' },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const context = { request, env, params: { id: albumId } };
        return userMiddleware({ ...context, next: () => items[`onRequest${method[0]}${method.slice(1).toLowerCase()}`](context) });
    };
    return { db, env, read, mutate };
}

describe('stable Album Gallery Pack', () => {
    let f;
    beforeEach(() => { f = fixture(); });
    afterEach(() => f.db.db.close());

    it('serves strict v1 media in member order without requiring a public handle', async () => {
        f.db.exec("UPDATE users SET public_handle = NULL WHERE discord_id = 'a'");
        f.db.db.prepare('INSERT INTO other_data (key, value) VALUES (?, ?)').run(`charinfo.visual:${albumId}`,
            JSON.stringify({ mainFileId: 'clip.webm', viewerHiddenFileIds: ['image5.png'], metadata: { author: 'never output' } }));
        const response = await f.read();
        assert.equal(response.status, 200);
        const pack = await response.json();
        assertGalleryV1(pack);
        assert.equal(pack.packId, albumId);
        assert.equal(pack.profileId, albumId);
        assert.equal(pack.characterName, '旅行者');
        assert.deepEqual(pack.gallery.map(item => item.title), ['image1.png', 'clip.webm', 'image5.png', 'foreign.png']);
        assert.equal(pack.gallery[2].viewerVisible, false);
        assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'ETag');
        assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
    });

    it('keeps identity and URL stable after names, slugs and handles change', async () => {
        const first = await (await f.read()).json();
        f.db.exec("UPDATE albums SET name = '新图集', slug = 'new-slug'; UPDATE users SET public_handle = 'renamed' WHERE discord_id = 'a'");
        assert.deepEqual(await (await f.read()).json(), first);
    });

    it('uses compact avatar and library thumbnails for selected images and retains version invalidation', async () => {
        f.db.exec(`UPDATE files SET metadata = '{"Thumbnail":{"CreatedAt":30}}' WHERE id = 'image5.png';
            UPDATE files SET metadata = '{"Thumbnail":{"CreatedAt":40}}' WHERE id = 'foreign.png'`);
        f.db.db.prepare('INSERT INTO other_data (key, value) VALUES (?, ?)').run(`charinfo.visual:${albumId}`,
            JSON.stringify({ avatarFileId: 'image5.png', coverFileId: 'foreign.png' }));
        const first = await f.read();
        const pack = await first.json();
        assertGalleryV1(pack);
        assert.equal(pack.avatarThumbnail, 'https://example.test/thumb/image5.png?variant=avatar&v=30');
        assert.equal(pack.libraryThumbnail, 'https://example.test/thumb/foreign.png?variant=library&v=40');
        assert.deepEqual(pack.gallery[0].sources, [
            'https://example.test/thumb/image1.png?variant=portrait&v=1',
            'https://example.test/thumb/image1.png?v=1',
        ]);
        assert.deepEqual(pack.gallery[1].sources, ['https://example.test/file/clip.webm?v=2']);
        assert.equal(pack.gallery[0].thumbnail, 'https://example.test/thumb/image1.png?v=1');
        assert.ok(pack.gallery[0].sources.every(source => !source.includes('/file/')), 'ST must never download PNG originals');
        f.db.exec(`UPDATE files SET metadata = '{"Thumbnail":{"CreatedAt":31}}' WHERE id = 'image5.png'`);
        const changed = await f.read({ 'If-None-Match': first.headers.get('etag') });
        assert.equal(changed.status, 200);
        assert.equal((await changed.json()).avatarThumbnail, 'https://example.test/thumb/image5.png?variant=avatar&v=31');
        f.db.exec('DELETE FROM other_data');
        const fallback = await (await f.read()).json();
        assert.equal(fallback.avatarThumbnail, 'https://example.test/thumb/image1.png?variant=avatar&v=1');
        assert.equal(fallback.libraryThumbnail, 'https://example.test/thumb/image1.png?variant=library&v=1');
    });

    it('normalizes historical control characters only in protocol titles', async () => {
        f.db.db.prepare('UPDATE files SET file_name = ? WHERE id = ?').run('bad\nname\u007f', 'image1.png');
        const pack = await (await f.read()).json();
        assertGalleryV1(pack);
        assert.equal(pack.gallery[0].title, 'bad name');
        assert.equal(f.db.db.prepare("SELECT file_name FROM files WHERE id = 'image1.png'").get().file_name, 'bad\nname\u007f');
    });

    it('invalidates ETags on add, remove, reorder, file rename and thumbnail replacement without album timestamp changes', async () => {
        let response = await f.read();
        let etag = response.headers.get('etag');
        const changed = async expected => {
            response = await f.read({ 'If-None-Match': etag });
            assert.equal(response.status, 200);
            assert.notEqual(response.headers.get('etag'), etag);
            etag = response.headers.get('etag');
            assert.deepEqual((await response.json()).gallery.map(item => item.title), expected);
        };
        f.db.exec("INSERT INTO files (id, file_name, metadata, file_type, owner_id, moderation_status) VALUES ('image6.png', 'image6.png', '{}', 'image/png', 'a', 'active')");
        assert.equal((await f.mutate('POST', { fileId: 'image6.png', position: 9 })).status, 200);
        await changed(['image1.png', 'clip.webm', 'image5.png', 'foreign.png', 'image6.png']);
        assert.equal((await f.mutate('DELETE', null, '?fileId=image5.png')).status, 200);
        await changed(['image1.png', 'clip.webm', 'foreign.png', 'image6.png']);
        assert.equal(f.db.db.prepare("SELECT COUNT(*) AS n FROM files WHERE id = 'image5.png'").get().n, 1);
        assert.equal((await f.mutate('PATCH', { fileId: 'image1.png', swapWithFileId: 'image6.png' })).status, 200);
        await changed(['image6.png', 'clip.webm', 'foreign.png', 'image1.png']);
        f.db.exec("UPDATE files SET file_name = '新名称' WHERE id = 'image6.png'");
        await changed(['新名称', 'clip.webm', 'foreign.png', 'image1.png']);
        f.db.exec(`UPDATE files SET metadata = '{"Thumbnail":{"CreatedAt":999}}' WHERE id = 'image6.png'`);
        await changed(['新名称', 'clip.webm', 'foreign.png', 'image1.png']);
        assert.equal(f.db.db.prepare('SELECT updated_at FROM albums').get().updated_at, 1);
        for (const value of [etag, `W/${etag}`, `"unrelated", ${etag}`, '*']) {
            const unchanged = await f.read({ 'If-None-Match': value });
            assert.equal(unchanged.status, 304);
            assert.equal(await unchanged.text(), '');
            assert.equal(unchanged.headers.get('Cache-Control'), 'public, max-age=60');
            assert.equal(unchanged.headers.get('Access-Control-Allow-Origin'), '*');
        }
    });

    it('returns null thumbnails for empty and video-only albums', async () => {
        f.db.exec("DELETE FROM album_items WHERE file_id != 'clip.webm'");
        let pack = await (await f.read()).json();
        assertGalleryV1(pack);
        assert.equal(pack.avatarThumbnail, null);
        assert.equal(pack.libraryThumbnail, null);
        f.db.exec('DELETE FROM album_items');
        pack = await (await f.read()).json();
        assertGalleryV1(pack);
        assert.deepEqual(pack.gallery, []);
        assert.equal(pack.avatarThumbnail, null);
        assert.equal(pack.libraryThumbnail, null);
    });

    it('does not share media from suspended owners or pending moderation', async () => {
        f.db.exec("UPDATE users SET status = 'suspended' WHERE discord_id = 'b'");
        const pack = await (await f.read()).json();
        assert.deepEqual(pack.gallery.map(item => item.title), ['image1.png', 'clip.webm', 'image5.png']);
        f.db.exec("UPDATE users SET status = 'suspended' WHERE discord_id = 'a'");
        assert.equal((await f.read()).status, 404);
    });

    it('reports missing or invalid identity, UUIDs, albums and unavailable D1 without caching errors', async () => {
        assert.equal((await f.read(undefined, '../invalid')).status, 400);
        assert.equal((await f.read(undefined, '00000000-0000-4000-8000-000000000000')).status, 404);
        for (const name of [null, 'x'.repeat(81), 'bad\u0001name']) {
            f.db.db.prepare('UPDATE albums SET char_info_character_name = ?').run(name);
            const response = await f.read();
            assert.equal(response.status, 409);
            assert.equal(response.headers.get('Cache-Control'), 'no-store');
            assert.ok((await response.json()).error);
        }
        for (const env of [{}, { img_d1: { prepare() { throw new Error('internal credentials must not leak'); } } }]) {
            const response = await onRequestGet({ request: new Request(url), env, params: { albumId } });
            assert.equal(response.status, 503);
            assert.doesNotMatch(await response.text(), /credentials/);
        }
        const options = onRequestOptions();
        assert.equal(options.status, 204);
        assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
    });
});
