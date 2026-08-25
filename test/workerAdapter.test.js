import assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

describe('Worker route adapter', () => {
    let worker;
    let bundleDirectory;
    let originalCaches;

    before(async function () {
        this.timeout(30000);
        const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
        bundleDirectory = mkdtempSync(join(tmpdir(), 'imgbed-worker-test-'));
        execFileSync(process.execPath, [
            join(repositoryRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
            'deploy',
            '--dry-run',
            '--config',
            'deploy/worker/wrangler.toml',
            '--outdir',
            bundleDirectory,
        ], { cwd: repositoryRoot, stdio: 'pipe' });
        writeFileSync(join(bundleDirectory, 'package.json'), '{"type":"module"}\n');
        ({ default: worker } = await import(pathToFileURL(join(bundleDirectory, 'index.js')).href));
    });

    after(() => {
        if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true });
    });

    beforeEach(() => {
        originalCaches = globalThis.caches;
    });

    afterEach(() => {
        if (originalCaches === undefined) delete globalThis.caches;
        else globalThis.caches = originalCaches;
    });

    it('serves frontend assets when no function route matches', async () => {
        const response = await worker.fetch(new Request('https://staging.example.test/'), {
            ASSETS: { fetch: async () => new Response('<main>ImgBed staging</main>', { headers: { 'Content-Type': 'text/html' } }) },
        }, executionContext());
        assert.strictEqual(response.status, 200);
        assert.match(await response.text(), /ImgBed staging/);
    });

    it('matches required dynamic Gallery Pack segments on Workers', async () => {
        globalThis.caches = emptyCache();
        const album = {
            id: 'album-id',
            public_handle: 'uika',
            discord_id: 'owner-id',
            username: 'Master',
            char_info_character_name: '克瑞西达',
            updated_at: 10,
        };
        const files = [{
            id: 'users/master/portrait.png',
            file_name: 'Portrait.png',
            file_type: 'image/png',
            timestamp: 11,
            visibility: 'private',
        }];
        const env = {
            img_d1: {
                prepare(sql) {
                    if (sql.includes('FROM albums a JOIN users u')) return { bind: () => ({ first: async () => album }) };
                    if (sql.includes('FROM album_items ai')) return { bind: () => ({ all: async () => ({ results: files }) }) };
                    throw new Error(`Unexpected SQL: ${sql}`);
                },
            },
        };

        const response = await worker.fetch(
            new Request('https://staging.example.test/api/public/gallery/uika/elfa1'),
            env,
            executionContext(),
        );
        const pack = await response.json();
        assert.strictEqual(response.status, 200);
        assert.strictEqual(pack.format, 'char-info-gallery-pack');
        assert.strictEqual(pack.avatarThumbnail, 'https://staging.example.test/thumb/users/master/portrait.png?variant=avatar&v=11');
        assert.strictEqual(pack.gallery[0].thumbnail, 'https://staging.example.test/thumb/users/master/portrait.png?v=11');
    });

    it('preserves Gallery Pack ETag revalidation through the Worker adapter', async () => {
        let genericCacheMatches = 0;
        globalThis.caches = {
            default: {
                async match() {
                    genericCacheMatches += 1;
                    return null;
                },
                async put() {},
            },
        };
        const album = {
            id: 'album-id',
            public_handle: 'uika',
            discord_id: 'owner-id',
            username: 'Master',
            char_info_character_name: '克瑞西达',
            updated_at: 10,
        };
        const files = [{
            id: 'users/master/portrait.png',
            file_name: 'Portrait.png',
            file_type: 'image/png',
            timestamp: 11,
            visibility: 'private',
        }];
        const env = {
            img_d1: {
                prepare(sql) {
                    if (sql.includes('FROM albums a JOIN users u')) return { bind: () => ({ first: async () => album }) };
                    if (sql.includes('FROM album_items ai')) return { bind: () => ({ all: async () => ({ results: files }) }) };
                    throw new Error(`Unexpected SQL: ${sql}`);
                },
            },
        };

        const first = await worker.fetch(
            new Request('https://staging.example.test/api/public/gallery/uika/elfa1'),
            env,
            executionContext(),
        );
        const etag = first.headers.get('etag');
        const revalidated = await worker.fetch(
            new Request('https://staging.example.test/api/public/gallery/uika/elfa1', {
                headers: { 'If-None-Match': etag },
            }),
            env,
            executionContext(),
        );

        assert.ok(etag);
        assert.strictEqual(revalidated.status, 304);
        assert.strictEqual(revalidated.headers.get('cache-control'), 'public, max-age=60');
        assert.strictEqual(genericCacheMatches, 0, 'Gallery Pack must reach its own ETag handler');
    });

    it('lets the thumbnail route perform its moderation check before its own edge-cache lookup', async () => {
        let cacheMatches = 0;
        globalThis.caches = {
            default: {
                async match() {
                    cacheMatches += 1;
                    return null;
                },
                async put() {},
            },
        };
        const metadata = {
            Visibility: 'private',
            ModerationStatus: 'active',
            FileType: 'image/png',
            TimeStamp: 12,
            Thumbnail: {
                Channel: 'Discord',
                DiscordMessageId: 'message-id',
                FileType: 'image/webp',
                FileSizeBytes: 20,
                Width: 720,
            },
        };
        const response = await worker.fetch(
            new Request('https://staging.example.test/thumb/users/master/private.png?v=12', { method: 'HEAD' }),
            { img_url: { get: async () => null, getWithMetadata: async () => ({ value: '', metadata }) } },
            executionContext(),
        );

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        assert.strictEqual(cacheMatches, 1, 'the generic Worker cache must not run ahead of the thumbnail route');
    });

    it('does not let the generic Worker cache bypass original-file moderation checks', async () => {
        let genericCacheMatches = 0;
        globalThis.caches = {
            default: {
                async match() {
                    genericCacheMatches += 1;
                    return new Response('stale file');
                },
                async put() {},
            },
        };

        const response = await worker.fetch(
            new Request('https://staging.example.test/file/users/master/quarantined.png'),
            { img_url: { get: async () => null, getWithMetadata: async () => null } },
            executionContext(),
        );

        assert.strictEqual(response.status, 404);
        assert.strictEqual(genericCacheMatches, 0, 'the file handler must validate metadata before any cache hit');
    });
});

function executionContext() {
    return { waitUntil() {} };
}

function emptyCache() {
    return {
        default: {
            async match() { return null; },
            async put() {},
        },
    };
}
