import assert from 'assert';
import { existsSync } from 'fs';
import {
    ALLOWED_UPLOAD_TYPES,
    DISCORD_CALLBACK_URL,
    DISCORD_OWNER_ID,
    MAX_UPLOAD_BYTES,
    USER_QUOTA_BYTES,
    getDiscordCallbackUrl,
    resolveAppRole,
} from '../functions/utils/auth/discordIdentity.js';
import { normalizeSlug } from '../functions/api/user/albums/index.js';
import { absoluteFileUrl, createGalleryPack } from '../functions/api/public/gallery/[[ownerSlug]]/[[albumSlug]].js';
import { rejectCrossSiteMutation } from '../functions/utils/auth/mutationSecurity.js';
import { matchesAllowedFileSignature } from '../functions/utils/fileSignature.js';
import { D1Database } from '../functions/utils/d1Database.js';
import { hasExplicitAutomationCredential } from '../functions/utils/automationCredential.js';
import { resolveUploadTarget } from '../functions/upload/memberUploadPolicy.js';

describe('Discord identity policy', () => {
    it('uses the production callback by default and allows an isolated staging callback', () => {
        assert.strictEqual(DISCORD_CALLBACK_URL, 'https://cloudflare-imgbed-dxx.pages.dev/api/auth/discord/callback');
        assert.strictEqual(getDiscordCallbackUrl({}), DISCORD_CALLBACK_URL);
        assert.strictEqual(getDiscordCallbackUrl({ DISCORD_CALLBACK_URL: 'https://staging.cloudflare-imgbed-dxx.pages.dev/api/auth/discord/callback' }), 'https://staging.cloudflare-imgbed-dxx.pages.dev/api/auth/discord/callback');
    });

    it('makes the fixed Discord account the owner', () => {
        assert.strictEqual(resolveAppRole(DISCORD_OWNER_ID, [], {}), 'owner');
        assert.strictEqual(resolveAppRole('another-user', [], {}), 'member');
    });

    it('limits Discord uploads to the agreed formats and sizes', () => {
        assert.deepStrictEqual([...ALLOWED_UPLOAD_TYPES].sort(), ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
        assert.strictEqual(MAX_UPLOAD_BYTES, 95 * 1024 * 1024);
        assert.strictEqual(USER_QUOTA_BYTES, 200 * 1024 * 1024);
    });

    it('builds stable public album slugs', () => {
        assert.strictEqual(normalizeSlug('  My Gallery!  '), 'my-gallery');
        assert.strictEqual(normalizeSlug('___'), '');
    });

    it('uses a single-segment album route so the list endpoint is not swallowed', () => {
        assert.strictEqual(existsSync(new URL('../functions/api/user/albums/[id].js', import.meta.url)), true);
        assert.strictEqual(existsSync(new URL('../functions/api/user/albums/[[id]].js', import.meta.url)), false);
    });

    it('builds a CharInfo gallery pack with one absolute HTTPS source per file', () => {
        const pack = createGalleryPack({ id: 'album-id', public_handle: 'master', discord_id: 'discord-id', username: 'Master' }, 'summer', [
            { id: 'folder/a b.png', file_name: 'First image.png', timestamp: 1 },
            { id: 'second.mp4', file_name: 'Second video.mp4', timestamp: 2 },
        ], 'http://example.test/api/public/gallery/master/summer');
        assert.strictEqual(pack.format, 'char-info-gallery-pack');
        assert.strictEqual(pack.profileId, 'master');
        assert.deepStrictEqual(pack.gallery, [
            { title: 'First image.png', sources: ['https://example.test/file/folder/a%20b.png'] },
            { title: 'Second video.mp4', sources: ['https://example.test/file/second.mp4'] },
        ]);
        assert.strictEqual(absoluteFileUrl('http://example.test/x', 'a.png'), 'https://example.test/file/a.png');
    });

    it('rejects cross-site mutations but allows same-origin requests', () => {
        assert.strictEqual(rejectCrossSiteMutation(new Request('https://example.test/api/user/files/a', { method: 'DELETE', headers: { Origin: 'https://example.test' } })), null);
        assert.strictEqual(rejectCrossSiteMutation(new Request('https://example.test/api/user/files/a', { method: 'DELETE', headers: { Origin: 'https://evil.test' } })).status, 403);
    });

    it('checks file bytes instead of trusting the browser MIME label', async () => {
        const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])]);
        const fake = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]);
        assert.strictEqual(await matchesAllowedFileSignature(png, 'image/png'), true);
        assert.strictEqual(await matchesAllowedFileSignature(fake, 'image/png'), false);
    });

    it('paginates more than 1000 D1 sessions without losing revocation candidates', async () => {
        const rows = Array.from({ length: 1005 }, (_, index) => ({ key: `manage@session@${String(index).padStart(4, '0')}`, value: '{}' }));
        const fakeD1 = {
            prepare() {
                return {
                    bind(...params) {
                        return {
                            async all() {
                                const prefix = String(params[0]).replace(/%$/, '');
                                const limit = Number(params.at(-1));
                                const cursor = params.length === 3 ? params[1] : null;
                                return { results: rows.filter(row => row.key.startsWith(prefix) && (!cursor || row.key > cursor)).slice(0, limit) };
                            },
                        };
                    },
                };
            },
        };
        const db = new D1Database(fakeD1);
        const first = await db.list({ prefix: 'manage@session@', limit: 1000 });
        const second = await db.list({ prefix: 'manage@session@', limit: 1000, cursor: first.cursor });
        assert.strictEqual(first.keys.length, 1000);
        assert.strictEqual(first.list_complete, false);
        assert.strictEqual(second.keys.length, 5);
        assert.strictEqual(second.list_complete, true);
    });

    it('keeps explicitly authenticated automation uploads separate from browser login', () => {
        const tokenRequest = new Request('https://example.test/upload', { headers: { Authorization: 'Bearer token' } });
        assert.strictEqual(hasExplicitAutomationCredential(tokenRequest, new URL(tokenRequest.url)), true);
        const browserRequest = new Request('https://example.test/upload');
        assert.strictEqual(hasExplicitAutomationCredential(browserRequest, new URL(browserRequest.url)), false);
    });

    it('keeps storage selection under administrator control for Discord members', () => {
        const pageConfig = { config: [
            { id: 'defaultUploadChannel', value: 'discord' },
            { id: 'defaultChannelName', value: 'CardServer' },
        ] };
        assert.deepStrictEqual(resolveUploadTarget(pageConfig, 's3', 'member-choice', { id: 'member' }), {
            channel: 'discord',
            channelName: 'CardServer',
        });
        assert.deepStrictEqual(resolveUploadTarget(pageConfig, 's3', 'automation-choice', null), {
            channel: 's3',
            channelName: 'automation-choice',
        });
    });
});
