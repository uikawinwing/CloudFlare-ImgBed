import assert from 'assert';
import { TestD1 } from './helpers/d1.js';
import { deletePermanentThumbnail, ensurePermanentThumbnail, hasPermanentThumbnail, persistThumbnailResult } from '../functions/utils/thumbnail.js';

function fixture() {
    const objects = new Map();
    const transforms = [];
    const deletions = [];
    const env = {
        THUMBNAILS: {
            async put(key, blob, options) { objects.set(key, { blob, options }); },
            async delete(keys) { deletions.push(keys); for (const key of keys) objects.delete(key); },
        },
        IMAGE_PROCESSOR: { async transform(stream, options) {
            transforms.push({ input: await new Response(stream).text(), options });
            return new Response(`webp-${options.width}`, { headers: { 'Content-Type': 'image/webp' } });
        } },
    };
    const metadata = { FileType: 'image/png', Width: 1000, Height: 500, TimeStamp: 123, Visibility: 'public', ModerationStatus: 'active' };
    const context = { env, request: new Request('https://example.test/upload') };
    const source = new Blob(['source-bytes'], { type: 'image/png' });
    return { env, context, metadata, source, objects, transforms, deletions };
}

function databaseFor(metadata) {
    const database = new TestD1();
    database.exec(`CREATE TABLE files (id TEXT PRIMARY KEY, metadata TEXT, moderation_status TEXT DEFAULT 'active', updated_at TEXT)`);
    database.db.prepare('INSERT INTO files (id, metadata) VALUES (?, ?)').run('image.png', JSON.stringify(metadata));
    return database;
}

describe('permanent R2 thumbnails', () => {
    let previousFetch;
    beforeEach(() => { previousFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = previousFetch; });

    it('reuses upload bytes without a Discord or original GET and stores every WebP size', async () => {
        const f = fixture();
        globalThis.fetch = async () => { throw new Error('unexpected network request'); };
        const result = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        assert.strictEqual(result.ready, true);
        assert.strictEqual(result.created, true);
        assert.strictEqual(hasPermanentThumbnail(result.metadata), true);
        assert.strictEqual(f.objects.size, 3);
        assert.deepStrictEqual(f.transforms.map(item => item.options.width), [160, 256, 720]);
        assert(f.transforms.every(item => item.input === 'source-bytes' && item.options.outputFormat === 'image/webp'));
        for (const [name, variant] of Object.entries(result.thumbnail.Variants)) {
            assert(variant.Key.endsWith(`/${name}.webp`));
            assert.strictEqual(await f.objects.get(variant.Key).blob.text(), `webp-${variant.Width}`);
            assert.strictEqual(f.objects.get(variant.Key).options.httpMetadata.contentType, 'image/webp');
            assert.strictEqual(variant.Height, variant.Width / 2);
        }
    });

    it('downloads an old original once for all three transforms and uses independent stable keys', async () => {
        const f = fixture();
        const calls = [];
        globalThis.fetch = async url => { calls.push(url); return new Response('old-original', { headers: { 'Content-Type': 'image/png' } }); };
        const result = await ensurePermanentThumbnail(f.context, 'folder/old image.png', f.metadata);
        assert.strictEqual(result.ready, true);
        assert.deepStrictEqual(calls, ['https://example.test/file/folder/old%20image.png']);
        assert(f.transforms.every(item => item.input === 'old-original'));
        assert(Object.values(result.thumbnail.Variants).every(item => !item.Key.includes('folder')));
    });

    it('removes partially written objects when generation or R2 storage fails', async () => {
        const f = fixture();
        const put = f.env.THUMBNAILS.put;
        let writes = 0;
        f.env.THUMBNAILS.put = async (...args) => { await put(...args); if (++writes === 2) throw new Error('R2 unavailable'); };
        const result = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        assert.strictEqual(result.ready, false);
        assert.strictEqual(result.reason, 'thumbnail-generation-failed');
        assert.strictEqual(f.objects.size, 0);
        assert.strictEqual(f.deletions[0].length, 2);
    });

    it('keeps unsupported or oversized sources from creating any objects', async () => {
        const f = fixture();
        const missing = await ensurePermanentThumbnail({ ...f.context, env: {} }, 'image.png', f.metadata, f.source);
        assert.strictEqual(missing.reason, 'thumbnail-storage-missing');
        const oversized = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/png' });
        assert.strictEqual((await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, oversized)).reason, 'source-too-large');
        assert.strictEqual(f.objects.size, 0);
    });

    it('cleans earlier sizes when a later conversion fails and records the status code', async () => {
        const f = fixture();
        const transform = f.env.IMAGE_PROCESSOR.transform;
        f.env.IMAGE_PROCESSOR.transform = async (stream, options) => options.width === 256
            ? new Response('converter unavailable', { status: 503 }) : transform(stream, options);
        const result = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        assert.strictEqual(result.reason, 'transform-503');
        assert.strictEqual(f.objects.size, 0);
        assert.strictEqual(f.deletions[0].length, 1);
    });

    it('only updates thumbnail fields while preserving a concurrent visibility change', async () => {
        const f = fixture();
        f.env.img_d1 = databaseFor(f.metadata);
        const generated = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        f.env.img_d1.db.prepare("UPDATE files SET metadata = json_set(metadata, '$.Visibility', 'private', '$.Tags', json('[\"new\"]'))").run();
        const result = await persistThumbnailResult(f.context, 'image.png', f.metadata, generated);
        assert.strictEqual(result.ready, true);
        assert.strictEqual(result.created, true);
        assert.strictEqual(result.metadata.Visibility, 'private');
        assert.deepStrictEqual(result.metadata.Tags, ['new']);
        assert.strictEqual(result.metadata.ThumbnailStatus, 'ready');
        assert.strictEqual(result.metadata.ThumbnailReason, null);
    });

    it('allows only one concurrent generated set and cleans the CAS loser', async () => {
        const f = fixture();
        f.env.img_d1 = databaseFor(f.metadata);
        const first = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        const second = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        assert.strictEqual(f.objects.size, 6);
        const winner = await persistThumbnailResult(f.context, 'image.png', f.metadata, first);
        const loser = await persistThumbnailResult(f.context, 'image.png', f.metadata, second);
        assert.strictEqual(winner.created, true);
        assert.strictEqual(loser.created, false);
        assert.strictEqual(loser.ready, true);
        assert.strictEqual(loser.reason, 'thumbnail-state-changed');
        assert.deepStrictEqual(loser.metadata.Thumbnail, first.thumbnail);
        assert.strictEqual(f.objects.size, 3);
        assert(Object.values(first.thumbnail.Variants).every(item => f.objects.has(item.Key)));
    });

    it('never revives a deleted record or attaches objects after quarantine or replacement', async () => {
        for (const mutation of [
            "DELETE FROM files",
            "UPDATE files SET moderation_status = 'quarantined'",
            "UPDATE files SET metadata = json_set(metadata, '$.TimeStamp', 456)",
        ]) {
            const f = fixture();
            f.env.img_d1 = databaseFor(f.metadata);
            const generated = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
            f.env.img_d1.db.exec(mutation);
            const result = await persistThumbnailResult(f.context, 'image.png', f.metadata, generated);
            assert.strictEqual(result.created, false);
            assert.strictEqual(result.ready, false);
            assert.strictEqual(f.objects.size, 0);
            if (mutation.startsWith('DELETE')) assert.strictEqual(result.metadata, null);
        }
    });

    it('records generation failure without overwriting other fields and reports deletion failure', async () => {
        const f = fixture();
        f.env.img_d1 = databaseFor(f.metadata);
        const result = await persistThumbnailResult(f.context, 'image.png', f.metadata, { metadata: f.metadata, ready: false, created: false, reason: 'transform-501' });
        assert.strictEqual(result.metadata.Visibility, 'public');
        assert.strictEqual(result.metadata.ThumbnailStatus, 'failed');
        assert.strictEqual(result.metadata.ThumbnailReason, 'transform-501');
        const generated = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        assert.strictEqual(await deletePermanentThumbnail(f.env, generated.metadata), true);
        assert.strictEqual(f.objects.size, 0);
        f.env.THUMBNAILS.delete = async () => { throw new Error('R2 unavailable'); };
        assert.strictEqual(await deletePermanentThumbnail(f.env, generated.metadata), false);
    });

    it('cleans without D1 but preserves objects after an uncertain failed write', async () => {
        for (const database of [undefined, databaseFor(fixture().metadata)]) {
            const f = fixture();
            f.env.img_d1 = database;
            if (database) {
                const prepare = database.prepare.bind(database);
                database.prepare = sql => { if (sql.startsWith('UPDATE')) throw new Error('D1 write unavailable'); return prepare(sql); };
            }
            const generated = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
            const result = await persistThumbnailResult(f.context, 'image.png', f.metadata, generated);
            assert.strictEqual(result.created, false);
            assert.strictEqual(result.ready, false);
            assert.strictEqual(f.objects.size, database ? 3 : 0);
        }
    });

    it('preserves objects when D1 committed successfully but its response was lost', async () => {
        const f = fixture();
        f.env.img_d1 = databaseFor(f.metadata);
        const prepare = f.env.img_d1.prepare.bind(f.env.img_d1);
        f.env.img_d1.prepare = sql => {
            const statement = prepare(sql);
            if (sql.startsWith('UPDATE')) {
                const first = statement.first.bind(statement);
                statement.first = async () => { await first(); throw new Error('lost D1 response'); };
            }
            return statement;
        };
        const generated = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        const result = await persistThumbnailResult(f.context, 'image.png', f.metadata, generated);
        assert.strictEqual(result.ready, true);
        assert.strictEqual(result.created, true);
        assert.deepStrictEqual(result.metadata.Thumbnail, generated.thumbnail);
        assert.strictEqual(f.objects.size, 3);
    });

    it('preserves uncertain writes when verification is also unavailable', async () => {
        const f = fixture();
        f.env.img_d1 = { prepare() { throw new Error('D1 unavailable'); } };
        const generated = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        const result = await persistThumbnailResult(f.context, 'image.png', f.metadata, generated);
        assert.strictEqual(result.reason, 'thumbnail-persistence-failed');
        assert.strictEqual(f.objects.size, 3);
    });

    it('preserves committed objects if the file was renamed before response verification', async () => {
        const f = fixture();
        f.env.img_d1 = databaseFor(f.metadata);
        const prepare = f.env.img_d1.prepare.bind(f.env.img_d1);
        f.env.img_d1.prepare = sql => {
            const statement = prepare(sql);
            if (sql.startsWith('UPDATE')) {
                const first = statement.first.bind(statement);
                statement.first = async () => {
                    await first();
                    f.env.img_d1.db.exec("UPDATE files SET id = 'renamed.png'");
                    throw new Error('lost D1 response');
                };
            }
            return statement;
        };
        const generated = await ensurePermanentThumbnail(f.context, 'image.png', f.metadata, f.source);
        const result = await persistThumbnailResult(f.context, 'image.png', f.metadata, generated);
        assert.strictEqual(result.reason, 'thumbnail-persistence-failed');
        assert.strictEqual(f.env.img_d1.db.prepare('SELECT id FROM files').get().id, 'renamed.png');
        assert.strictEqual(f.objects.size, 3);
    });

    it('avoids conversion for files already marked as quarantined or deleting', async () => {
        const f = fixture();
        for (const ModerationStatus of ['quarantined', 'deleting']) {
            const result = await ensurePermanentThumbnail(f.context, 'image.png', { ...f.metadata, ModerationStatus }, f.source);
            assert.strictEqual(result.reason, 'file-not-active');
        }
        assert.strictEqual(f.transforms.length, 0);
        assert.strictEqual(f.objects.size, 0);
    });

    it('recognizes complete R2 variants and preserves existing Discord thumbnails', async () => {
        const f = fixture();
        const legacy = { ...f.metadata, Thumbnail: { Channel: 'Discord', DiscordMessageId: 'legacy-message' } };
        assert.deepStrictEqual(await ensurePermanentThumbnail(f.context, 'image.png', legacy, f.source), { metadata: legacy, ready: true, created: false });
        assert.strictEqual(hasPermanentThumbnail({ Thumbnail: { Version: 2, Channel: 'CloudflareR2', Variants: { avatar: { Key: 'only-one' } } } }), false);
    });
});
