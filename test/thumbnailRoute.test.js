import assert from 'assert';
import { onRequest as serveThumbnail } from '../functions/thumb/[[path]].js';
import { returnWithCheck } from '../functions/file/fileTools.js';

describe('thumbnail route visibility and cache contract', () => {
    it('does not treat private visibility as thumbnail authorization', async () => {
        const metadata = {
            Visibility: 'private',
            ModerationStatus: 'active',
            FileType: 'image/png',
            TimeStamp: 123,
            Thumbnail: {
                Version: 1,
                Channel: 'Discord',
                DiscordMessageId: 'message-id',
                FileName: 'private.thumb.webp',
                FileType: 'image/webp',
                FileSizeBytes: 123,
                Width: 720,
            },
        };
        const env = {
            img_url: {
                get: async () => null,
                getWithMetadata: async key => key === 'users/master/private.png' ? { value: '', metadata } : null,
            },
        };
        const response = await serveThumbnail({
            request: new Request('https://example.test/thumb/users/master/private.png?v=123', { method: 'HEAD' }),
            env,
            params: { path: 'users,master,private.png' },
        });

        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.headers.get('content-type'), 'image/webp');
        assert.strictEqual(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
        assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
    });

    it('serves and edge-caches all three private WebP variants separately', async () => {
        const originalFetch = globalThis.fetch;
        const originalCaches = globalThis.caches;
        const stored = new Map();
        const transformWidths = [];
        let metadataLookups = 0;
        let sourceReads = 0;

        globalThis.caches = {
            default: {
                async match(key) {
                    const response = stored.get(key.url);
                    return response?.clone();
                },
                async put(key, response) {
                    stored.set(key.url, response.clone());
                },
            },
        };
        globalThis.fetch = async url => {
            sourceReads += 1;
            assert.match(String(url), /\/file\/users\/master\/private\.png$/);
            return new Response(new Uint8Array([1, 2, 3]), {
                headers: { 'Content-Type': 'image/png', 'Content-Length': '3' },
            });
        };

        const metadata = {
            Visibility: 'private',
            ModerationStatus: 'active',
            FileType: 'image/png',
            Width: 1200,
            TimeStamp: 123,
        };
        const env = {
            img_url: {
                get: async () => null,
                getWithMetadata: async () => {
                    metadataLookups += 1;
                    return { value: '', metadata };
                },
            },
            IMAGE_PROCESSOR: {
                async transform(stream, options) {
                    transformWidths.push(options.width);
                    await new Response(stream).arrayBuffer();
                    return new Response(new Uint8Array([4, 5]), {
                        headers: { 'Content-Type': options.outputFormat, 'Content-Length': '2' },
                    });
                },
            },
        };

        try {
            for (const [variant, width] of [['avatar', 160], ['library', 256], ['gallery', 720]]) {
                const suffix = variant === 'gallery' ? '?v=123' : `?variant=${variant}&v=123`;
                const response = await serveThumbnail({
                    request: new Request(`https://example.test/thumb/users/master/private.png${suffix}`),
                    env,
                    params: { path: 'users,master,private.png' },
                });
                assert.strictEqual(response.status, 200);
                assert.strictEqual(response.headers.get('content-type'), 'image/webp');
                assert.strictEqual(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
                assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
                assert.strictEqual(transformWidths.at(-1), width);
            }

            const cached = await serveThumbnail({
                request: new Request('https://example.test/thumb/users/master/private.png?variant=library&v=123'),
                env,
                params: { path: 'users,master,private.png' },
            });
            assert.strictEqual(cached.status, 200);
            assert.strictEqual(metadataLookups, 4, 'moderation state is checked before every edge-cache read');
            assert.strictEqual(sourceReads, 3);
            assert.strictEqual(transformWidths.length, 3);
        } finally {
            globalThis.fetch = originalFetch;
            if (originalCaches === undefined) delete globalThis.caches;
            else globalThis.caches = originalCaches;
        }
    });

    it('redirects a legacy URL to the current version and rejects stale versions', async () => {
        const metadata = {
            ModerationStatus: 'active',
            FileType: 'image/png',
            TimeStamp: 456,
        };
        const env = {
            img_url: {
                get: async () => null,
                getWithMetadata: async () => ({ value: '', metadata }),
            },
        };
        const legacy = await serveThumbnail({
            request: new Request('https://example.test/thumb/users/master/private.png?variant=library'),
            env,
            params: { path: 'users,master,private.png' },
        });
        assert.strictEqual(legacy.status, 302);
        assert.strictEqual(legacy.headers.get('location'), 'https://example.test/thumb/users/master/private.png?variant=library&v=456');
        assert.strictEqual(legacy.headers.get('cache-control'), 'public, max-age=60, must-revalidate');
        assert.strictEqual(legacy.headers.get('access-control-allow-origin'), '*');

        const stale = await serveThumbnail({
            request: new Request('https://example.test/thumb/users/master/private.png?variant=library&v=455'),
            env,
            params: { path: 'users,master,private.png' },
        });
        assert.strictEqual(stale.status, 404);
        assert.match(await stale.text(), /version not found/);
    });

    it('derives compact variants from an existing permanent 720px WebP', async () => {
        const originalFetch = globalThis.fetch;
        const fetchedUrls = [];
        const transformWidths = [];
        globalThis.fetch = async url => {
            fetchedUrls.push(String(url));
            if (String(url).startsWith('https://discord.com/api/v10/channels/channel-id/messages/message-id')) {
                return Response.json({ attachments: [{ url: 'https://cdn.discordapp.com/attachments/channel-id/attachment-id/private.webp' }] });
            }
            if (String(url).startsWith('https://cdn.discordapp.com/attachments/')) {
                return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } });
            }
            throw new Error(`Unexpected source fetch: ${url}`);
        };

        const metadata = {
            Visibility: 'private',
            ModerationStatus: 'active',
            FileType: 'image/png',
            Width: 1200,
            TimeStamp: 789,
            Thumbnail: {
                Version: 1,
                Channel: 'Discord',
                ChannelName: 'Discord_env',
                DiscordMessageId: 'message-id',
                FileType: 'image/webp',
                Width: 720,
            },
        };
        const env = {
            DISCORD_BOT_TOKEN: 'token',
            DISCORD_CHANNEL_ID: 'channel-id',
            img_url: {
                get: async () => null,
                getWithMetadata: async () => ({ value: '', metadata }),
            },
            IMAGE_PROCESSOR: {
                async transform(stream, options) {
                    transformWidths.push(options.width);
                    await new Response(stream).arrayBuffer();
                    return new Response(new Uint8Array([4, 5]), { headers: { 'Content-Type': options.outputFormat } });
                },
            },
        };

        try {
            const response = await serveThumbnail({
                request: new Request('https://example.test/thumb/users/master/private.png?variant=avatar&v=789'),
                env,
                params: { path: 'users,master,private.png' },
            });
            assert.strictEqual(response.status, 200);
            assert.deepStrictEqual(transformWidths, [160]);
            assert.ok(fetchedUrls.some(url => url.startsWith('https://discord.com/api/v10/')));
            assert.ok(fetchedUrls.some(url => url.startsWith('https://cdn.discordapp.com/attachments/')));
            assert.ok(fetchedUrls.every(url => !url.includes('/file/users/master/private.png')));
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('does not change immutable bytes by falling back when a permanent source is unavailable', async () => {
        const originalFetch = globalThis.fetch;
        const fetchedUrls = [];
        globalThis.fetch = async url => {
            fetchedUrls.push(String(url));
            return new Response('Discord unavailable', { status: 503 });
        };
        const metadata = {
            ModerationStatus: 'active',
            FileType: 'image/png',
            TimeStamp: 100,
            Thumbnail: {
                Channel: 'Discord',
                ChannelName: 'Discord_env',
                DiscordMessageId: 'message-id',
                FileType: 'image/webp',
                Width: 720,
                CreatedAt: 200,
            },
        };
        const env = {
            DISCORD_BOT_TOKEN: 'token',
            DISCORD_CHANNEL_ID: 'channel-id',
            img_url: {
                get: async () => null,
                getWithMetadata: async () => ({ value: '', metadata }),
            },
        };

        try {
            const response = await serveThumbnail({
                request: new Request('https://example.test/thumb/private.png?variant=avatar&v=200'),
                env,
                params: { path: 'private.png' },
            });
            assert.strictEqual(response.status, 502);
            assert.strictEqual(response.headers.get('cache-control'), 'private, no-store, max-age=0');
            assert.ok(fetchedUrls.some(url => url.startsWith('https://discord.com/api/v10/')));
            assert.ok(fetchedUrls.every(url => !url.includes('/file/private.png')));
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('rejects unknown variants without touching storage', async () => {
        const response = await serveThumbnail({
            request: new Request('https://example.test/thumb/image.png?variant=huge'),
            env: {},
            params: { path: 'image.png' },
        });
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
    });

    it('keeps a private owned file directly accessible while preserving normal safety checks', async () => {
        const context = {
            url: new URL('https://example.test/file/private.png'),
            securityConfig: { access: { whiteListMode: false } },
            fileAccess: { isAdminPreview: false },
        };
        const response = await returnWithCheck(context, {
            metadata: { OwnerId: 'master', Visibility: 'private', ModerationStatus: 'active' },
        });
        assert.strictEqual(response.status, 200);
    });
});
