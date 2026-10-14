import assert from 'node:assert/strict';
import { onRequest as backfill } from '../functions/api/manage/thumbnails/backfill.js';
import { TestD1 } from './helpers/d1.js';

function fixture() {
    const database = new TestD1();
    database.exec(`CREATE TABLE files (id TEXT PRIMARY KEY, metadata TEXT, moderation_status TEXT DEFAULT 'active', updated_at TEXT);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
    const values = new Map([
        ['manage@session@test-admin', JSON.stringify({ authType: 'admin', expiresAt: Date.now() + 60000 })],
        ['manage@session@test-user', JSON.stringify({ authType: 'user', expiresAt: Date.now() + 60000 })],
    ]);
    const objects = new Map();
    const env = {
        img_d1: database,
        img_url: { get: async key => values.get(key) || null, delete: async key => values.delete(key) },
        THUMBNAILS: {
            put: async (key, blob) => objects.set(key, blob),
            delete: async keys => keys.forEach(key => objects.delete(key)),
        },
        IMAGE_PROCESSOR: { transform: async (stream, options) => {
            await new Response(stream).text();
            return new Response(`webp-${options.width}`, { headers: { 'Content-Type': 'image/webp' } });
        } },
    };
    function add(id, overrides = {}, status = 'active') {
        const metadata = { FileType: 'image/png', TimeStamp: 123, ModerationStatus: status, Visibility: 'private', ...overrides };
        database.db.prepare('INSERT INTO files (id, metadata, moderation_status) VALUES (?, ?, ?)').run(id, JSON.stringify(metadata), status);
        return metadata;
    }
    function request(body, headers = {}, method = 'POST') {
        return new Request('https://example.test/api/manage/thumbnails/backfill', {
            method, headers: { 'Content-Type': 'application/json', Cookie: 'admin_session=test-admin', ...headers },
            ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
        });
    }
    return { env, database, values, objects, add, request };
}

describe('explicit thumbnail backfill', () => {
    let previousFetch;
    beforeEach(() => { previousFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = previousFetch; });

    it('requires real administrator credentials even when authentication has not been configured', async () => {
        const f = fixture();
        for (const Cookie of ['', 'admin_session=unknown', 'user_session=test-user']) {
            const response = await backfill({ env: f.env, request: f.request({ fileIds: ['image.png'] }, { Cookie }) });
            assert.equal(response.status, 401);
        }
        f.values.set('manage@session@test-admin', JSON.stringify({ authType: 'admin', expiresAt: Date.now() - 1 }));
        const expired = await backfill({ env: f.env, request: f.request({ fileIds: ['image.png'] }) });
        assert.equal(expired.status, 401);
        assert.equal(f.objects.size, 0);
    });

    it('rejects cross-site writes and other methods before reading or generating files', async () => {
        const f = fixture();
        const origin = await backfill({ env: f.env, request: f.request({ fileIds: ['image.png'] }, { Origin: 'https://elsewhere.test' }) });
        const site = await backfill({ env: f.env, request: f.request({ fileIds: ['image.png'] }, { 'Sec-Fetch-Site': 'cross-site' }) });
        const get = await backfill({ env: f.env, request: f.request(null, {}, 'GET') });
        assert.equal(origin.status, 403);
        assert.equal(site.status, 403);
        assert.equal(get.status, 405);
        assert.equal(f.objects.size, 0);
    });

    it('accepts a management token but rejects an upload-only token without a session', async () => {
        const f = fixture();
        f.values.set('manage@sysConfig@security', JSON.stringify({ apiTokens: { tokens: {
            management: { token: 'manage-test', permissions: ['manage'] },
            uploader: { token: 'upload-test', permissions: ['upload'] },
        } } }));
        for (const [token, expected] of [['manage-test', 200], ['upload-test', 401]]) {
            const response = await backfill({ env: f.env, request: f.request({ fileIds: ['missing.png'] }, { Cookie: '', Authorization: `Bearer ${token}` }) });
            assert.equal(response.status, expected);
        }
        assert.equal(f.objects.size, 0);
    });

    it('accepts only explicit small unique batches and valid JSON', async () => {
        const f = fixture();
        for (const body of ['{', {}, { fileIds: [] }, { fileIds: ['a', 'b', 'c', 'd'] }, { fileIds: ['a', 'a'] }, { fileIds: [' '] }, { fileIds: [1] }, { fileIds: ['manage\nkey'] }]) {
            const response = await backfill({ env: f.env, request: f.request(body) });
            assert.equal(response.status, 400);
        }
        assert.equal(f.objects.size, 0);
    });

    it('generates sequentially, preserves private visibility, and skips completed images on repeat', async () => {
        const f = fixture();
        f.add('first.png');
        f.add('second.png', { Visibility: 'public' });
        const reads = [];
        globalThis.fetch = async url => {
            if (reads.length) assert.equal(f.objects.size, 3, 'previous image must be completely stored before reading the next');
            reads.push(url);
            return new Response('original', { headers: { 'Content-Type': 'image/png' } });
        };
        const response = await backfill({ env: f.env, request: f.request({ fileIds: ['first.png', 'second.png'] }) });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
        assert.deepEqual((await response.json()).results.map(item => [item.ready, item.created]), [[true, true], [true, true]]);
        assert.equal(reads.length, 2);
        assert.equal(f.objects.size, 6);
        const first = JSON.parse(f.database.db.prepare('SELECT metadata FROM files WHERE id = ?').get('first.png').metadata);
        assert.equal(first.Visibility, 'private');
        assert.equal(first.Thumbnail.Channel, 'CloudflareR2');
        globalThis.fetch = async () => { throw new Error('completed thumbnails must not reread originals'); };
        const repeated = await backfill({ env: f.env, request: f.request({ fileIds: ['first.png', 'second.png'] }) });
        assert.deepEqual((await repeated.json()).results.map(item => [item.ready, item.created]), [[true, false], [true, false]]);
        assert.equal(f.objects.size, 6);
    });

    it('reports failures per image without losing originals or stopping the remaining batch', async () => {
        const f = fixture();
        f.add('failed.png');
        f.add('good.png');
        globalThis.fetch = async url => url.endsWith('/failed.png')
            ? new Response('unavailable', { status: 503 })
            : new Response('original', { headers: { 'Content-Type': 'image/png' } });
        const response = await backfill({ env: f.env, request: f.request({ fileIds: ['failed.png', 'good.png'] }) });
        const results = (await response.json()).results;
        assert.equal(results[0].ready, false);
        assert.equal(results[0].reason, 'source-503');
        assert.equal(results[1].ready, true);
        const failed = JSON.parse(f.database.db.prepare('SELECT metadata FROM files WHERE id = ?').get('failed.png').metadata);
        assert.equal(failed.Visibility, 'private');
        assert.equal(failed.ModerationStatus, 'active');
        assert.equal(failed.ThumbnailStatus, 'failed');
        assert.equal(f.objects.size, 3);
    });

    it('never generates for missing, quarantined, or non-image records', async () => {
        const f = fixture();
        f.add('quarantine.png', {}, 'quarantined');
        f.add('video.mp4', { FileType: 'video/mp4' });
        globalThis.fetch = async () => { throw new Error('unexpected original read'); };
        const response = await backfill({ env: f.env, request: f.request({ fileIds: ['missing.png', 'quarantine.png', 'video.mp4'] }) });
        assert.deepEqual((await response.json()).results.map(item => item.reason), ['file-not-found', 'file-not-active', 'not-image']);
        assert.equal(f.objects.size, 0);
    });
});
