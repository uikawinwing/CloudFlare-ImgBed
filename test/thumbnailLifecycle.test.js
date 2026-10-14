import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { TestD1 } from './helpers/d1.js';
import { deleteFile } from '../functions/api/manage/delete/[[path]].js';
import { onRequestPost as quarantine } from '../functions/api/moderation/quarantine/[[path]].js';
import { onRequestPost as restore } from '../functions/api/moderation/restore/[[path]].js';

let rename;
let move;

function thumbnail() {
    return { Version: 2, Channel: 'CloudflareR2', CreatedAt: 456, Variants: Object.fromEntries(['avatar', 'library', 'gallery'].map(name => [name, { Key: `thumbnails/stable/${name}.webp` }])) };
}

function fixture(status = 'active') {
    const d1 = new TestD1();
    d1.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    d1.exec("INSERT INTO users (discord_id, username, role, status, used_bytes, created_at, updated_at) VALUES ('admin-id', 'Admin', 'admin', 'active', 100, 1, 1)");
    const metadata = { Channel: 'CloudflareR2', OwnerId: 'admin-id', FileType: 'image/png', FileSizeBytes: 100, TimeStamp: 123, ModerationStatus: status };
    d1.db.prepare('INSERT INTO files (id, value, metadata, owner_id, file_size_bytes, moderation_status) VALUES (?, ?, ?, ?, ?, ?)').run('image.png', '', JSON.stringify(metadata), 'admin-id', 100, status);
    const originals = new Set(['image.png']);
    const thumbnails = new Set(Object.values(thumbnail().Variants).map(item => item.Key));
    const values = new Map([['manage@session@admin', JSON.stringify({ authType: 'user', expiresAt: Date.now() + 60_000, identity: { id: 'admin-id' } })]]);
    const env = {
        img_d1: d1,
        img_url: { get: async key => values.get(key) || null, getWithMetadata: async () => null, delete: async key => values.delete(key) },
        img_r2: {
            get: async key => originals.has(key) ? { body: new Blob(['source']).stream(), httpMetadata: { contentType: 'image/png' } } : null,
            put: async key => { if (originals.has(key)) return null; originals.add(key); return {}; },
            delete: async key => originals.delete(key),
        },
        THUMBNAILS: { delete: async keys => { for (const key of keys) thumbnails.delete(key); } },
    };
    const setThumbnail = () => d1.db.prepare("UPDATE files SET metadata = json_set(metadata, '$.Thumbnail', json(?), '$.Tags', json('[\"concurrent\"]'))").run(JSON.stringify(thumbnail()));
    return { d1, env, originals, thumbnails, setThumbnail };
}

function request(handler, env) {
    return handler({ env, params: { path: 'image.png' }, request: new Request('https://example.test/api/moderation/change/image.png', {
        method: 'POST', headers: { Cookie: 'user_session=admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'reviewed content' }),
    }) });
}

describe('thumbnail lifecycle', () => {
    let previousCaches;
    let previousError;
    before(async () => {
        const modules = await Promise.all(['functions/api/manage/rename/[[path]].js', 'functions/api/manage/move/[[path]].js'].map(async entry => {
            const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser' });
            return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
        }));
        rename = modules[0].onRequest;
        move = modules[1].onRequest;
    });
    beforeEach(() => {
        previousError = console.error;
        console.error = (...args) => previousError(...args.map(value => value instanceof Error ? value.message : value));
        previousCaches = globalThis.caches;
        globalThis.caches = { default: { delete: async () => true, put: async () => {} } };
    });
    afterEach(() => { globalThis.caches = previousCaches; console.error = previousError; });

    it('deletes the latest thumbnail committed after the initial file read', async () => {
        const f = fixture();
        const prepare = f.d1.prepare.bind(f.d1);
        let injected = false;
        f.d1.prepare = sql => {
            const statement = prepare(sql);
            if (sql === 'SELECT * FROM files WHERE id = ?') {
                const first = statement.first.bind(statement);
                statement.first = async (...args) => {
                    const snapshot = await first(...args);
                    if (!injected) { injected = true; f.setThumbnail(); }
                    return snapshot;
                };
            }
            return statement;
        };
        assert.equal(await deleteFile(f.env, 'image.png', 'https://example.test/file/image.png', new URL('https://example.test')), true);
        assert.equal(f.thumbnails.size, 0);
        assert.equal(f.originals.size, 0);
        assert.equal(f.d1.db.prepare('SELECT COUNT(*) AS n FROM files').get().n, 0);
        assert.equal(f.d1.db.prepare("SELECT used_bytes FROM users WHERE discord_id = 'admin-id'").get().used_bytes, 0);
    });

    it('preserves keys, quota and original while thumbnail cleanup fails, then permits retry', async () => {
        const f = fixture();
        f.setThumbnail();
        const remove = f.env.THUMBNAILS.delete;
        f.env.THUMBNAILS.delete = async () => { throw new Error('R2 unavailable'); };
        assert.equal(await deleteFile(f.env, 'image.png', 'https://example.test/file/image.png', new URL('https://example.test')), false);
        const row = f.d1.db.prepare('SELECT metadata, moderation_status FROM files').get();
        assert.equal(row.moderation_status, 'deleting');
        assert.deepEqual(JSON.parse(row.metadata).Thumbnail, thumbnail());
        assert.equal(f.originals.size, 1);
        assert.equal(f.d1.db.prepare("SELECT used_bytes FROM users WHERE discord_id = 'admin-id'").get().used_bytes, 100);
        f.env.THUMBNAILS.delete = remove;
        assert.equal(await deleteFile(f.env, 'image.png', 'https://example.test/file/image.png', new URL('https://example.test')), true);
        assert.equal(f.thumbnails.size, 0);
        assert.equal(f.originals.size, 0);
    });

    it('quarantine and restore preserve a thumbnail committed after their initial read', async () => {
        for (const [handler, beforeStatus, afterStatus] of [[quarantine, 'active', 'quarantined'], [restore, 'quarantined', 'active']]) {
            const f = fixture(beforeStatus);
            const batch = f.d1.batch.bind(f.d1);
            f.d1.batch = async statements => { f.setThumbnail(); return batch(statements); };
            const response = await request(handler, f.env);
            assert.equal(response.status, 200, await response.text());
            const row = f.d1.db.prepare('SELECT metadata, moderation_status FROM files').get();
            assert.equal(row.moderation_status, afterStatus);
            const metadata = JSON.parse(row.metadata);
            assert.equal(metadata.ModerationStatus, afterStatus);
            assert.deepEqual(metadata.Thumbnail, thumbnail());
            assert.deepEqual(metadata.Tags, ['concurrent']);
        }
    });

    it('cannot restore or quarantine a record once deletion has started', async () => {
        for (const handler of [quarantine, restore]) {
            const f = fixture('deleting');
            assert.equal((await request(handler, f.env)).status, 409);
            const row = f.d1.db.prepare('SELECT metadata, moderation_status FROM files').get();
            assert.equal(row.moderation_status, 'deleting');
            assert.equal(JSON.parse(row.metadata).ModerationStatus, 'deleting');
            assert.equal(f.d1.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, 0);
        }
    });

    async function relocate(handler, env) {
        const pending = [];
        const response = await handler({ env, params: { path: 'image.png' }, request: new Request('https://example.test/api/manage/relocate/image.png?dist=folder', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newFileId: 'folder/image.png' }),
        }), waitUntil: promise => pending.push(promise) });
        await Promise.all(pending);
        return response;
    }

    it('keeps existing stable thumbnail objects when renaming or moving the original', async () => {
        for (const handler of [rename, move]) {
            const f = fixture();
            f.setThumbnail();
            const response = await relocate(handler, f.env);
            assert.equal(response.status, 200, await response.text());
            const row = f.d1.db.prepare('SELECT id, metadata FROM files').get();
            assert.equal(row.id, 'folder/image.png');
            assert.deepEqual(JSON.parse(row.metadata).Thumbnail, thumbnail());
            assert.equal(JSON.parse(row.metadata).Directory, 'folder/');
            assert.deepEqual([...f.originals], ['folder/image.png']);
            assert.equal(f.thumbnails.size, 3);
        }
    });

    it('rejects relocation when a thumbnail commits during copying and preserves the original', async () => {
        for (const handler of [rename, move]) {
            const f = fixture();
            const put = f.env.img_r2.put;
            f.env.img_r2.put = async (...args) => { const result = await put(...args); f.setThumbnail(); return result; };
            const response = await relocate(handler, f.env);
            assert.equal(response.status, 409);
            const row = f.d1.db.prepare('SELECT id, metadata FROM files').get();
            assert.equal(row.id, 'image.png');
            assert.deepEqual(JSON.parse(row.metadata).Thumbnail, thumbnail());
            assert.deepEqual([...f.originals], ['image.png']);
            assert.equal(f.thumbnails.size, 3);
        }
    });

    it('rejects relocation with album references without losing either the file or its thumbnail', async () => {
        for (const handler of [rename, move]) {
            const f = fixture();
            f.setThumbnail();
            f.d1.db.exec("INSERT INTO albums (id, owner_id, slug, name, created_at, updated_at) VALUES ('album', 'admin-id', 'album', 'Album', 1, 1); INSERT INTO album_items VALUES ('album', 'image.png', 0, 1)");
            const response = await relocate(handler, f.env);
            assert.equal(response.status, 409);
            assert.match(await response.text(), /File belongs to an album/);
            assert.equal(f.d1.db.prepare('SELECT id FROM files').get().id, 'image.png');
            assert.equal(f.d1.db.prepare('SELECT file_id FROM album_items').get().file_id, 'image.png');
            assert.deepEqual([...f.originals], ['image.png']);
            assert.equal(f.thumbnails.size, 3);
        }
    });

    it('preserves the committed new original and thumbnail if relocation response is lost', async () => {
        for (const handler of [rename, move]) {
            const f = fixture();
            f.setThumbnail();
            const prepare = f.d1.prepare.bind(f.d1);
            f.d1.prepare = sql => {
                const statement = prepare(sql);
                if (sql.startsWith('UPDATE files SET id')) {
                    const first = statement.first.bind(statement);
                    statement.first = async (...args) => { await first(...args); throw new Error('lost D1 response'); };
                }
                return statement;
            };
            const response = await relocate(handler, f.env);
            assert.notEqual(response.status, 200);
            const row = f.d1.db.prepare('SELECT id, metadata FROM files').get();
            assert.equal(row.id, 'folder/image.png');
            assert.deepEqual(JSON.parse(row.metadata).Thumbnail, thumbnail());
            assert(f.originals.has('folder/image.png'));
            assert.equal(f.thumbnails.size, 3);
        }
    });
});
