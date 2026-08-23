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
    sanitizeReturnTo,
} from '../functions/utils/auth/discordIdentity.js';
import { normalizeSlug } from '../functions/api/user/albums/index.js';
import { normalizeAlbumIdParam } from '../functions/api/user/albums/[[id]]/items.js';
import { absoluteFileUrl, createGalleryPack, onRequestGet as publicGalleryGet } from '../functions/api/public/gallery/[ownerSlug]/[albumSlug].js';
import { onRequestGet as legacyPublicGalleryGet } from '../functions/api/public/gallery/[[ownerSlug]]/[[albumSlug]].js';
import { normalizeCharInfoCharacterName, validateCharInfoCharacterName } from '../functions/utils/charInfoGallery.js';
import { rejectCrossSiteMutation } from '../functions/utils/auth/mutationSecurity.js';
import { matchesAllowedFileSignature } from '../functions/utils/fileSignature.js';
import { D1Database } from '../functions/utils/d1Database.js';
import { resolveUploadTarget } from '../functions/upload/memberUploadPolicy.js';
import { onRequest as legacyDavRoute } from '../functions/dav/[[path]].js';
import { onRequestGet as publicGalleryPageGet } from '../functions/gallery/[ownerSlug]/[albumSlug].js';
import { onRequestGet as legacyPublicGalleryPageGet } from '../functions/gallery/[[ownerSlug]]/[[albumSlug]].js';


describe('Discord identity policy', () => {
    it('uses the production callback by default and allows an isolated staging callback', () => {
        assert.strictEqual(DISCORD_CALLBACK_URL, 'https://cloudflare-imgbed-dxx.pages.dev/api/auth/discord/callback');
        assert.strictEqual(getDiscordCallbackUrl({}), DISCORD_CALLBACK_URL);
        assert.strictEqual(getDiscordCallbackUrl({ DISCORD_CALLBACK_URL: 'https://staging.cloudflare-imgbed-dxx.pages.dev/api/auth/discord/callback' }), 'https://staging.cloudflare-imgbed-dxx.pages.dev/api/auth/discord/callback');
    });

    it('only returns from Discord sign-in to a local page', () => {
        assert.strictEqual(sanitizeReturnTo('/discover/?type=video'), '/discover/?type=video');
        assert.strictEqual(sanitizeReturnTo('https://evil.test'), '/studio');
        assert.strictEqual(sanitizeReturnTo('//evil.test'), '/studio');
        assert.strictEqual(sanitizeReturnTo('/\\evil.test'), '/studio');
    });

    it('makes the fixed Discord account the owner', () => {
        assert.strictEqual(resolveAppRole(DISCORD_OWNER_ID, [], {}), 'owner');
        assert.strictEqual(resolveAppRole('another-user', [], {}), 'member');
    });

    it('limits Discord uploads to the agreed formats and sizes', () => {
        assert.deepStrictEqual([...ALLOWED_UPLOAD_TYPES].sort(), ['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
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

    it('normalizes the catch-all album id before binding it to D1', () => {
        assert.strictEqual(normalizeAlbumIdParam('album-id'), 'album-id');
        assert.strictEqual(normalizeAlbumIdParam(['album-id']), 'album-id');
        assert.strictEqual(normalizeAlbumIdParam(['album-id', 'extra']), null);
        assert.strictEqual(normalizeAlbumIdParam('album-id/extra'), null);
    });

    it('routes public galleries by URL even when catch-all params are malformed', async () => {
        assert.strictEqual(existsSync(new URL('../functions/api/public/gallery/[ownerSlug]/[albumSlug].js', import.meta.url)), true);
        assert.strictEqual(existsSync(new URL('../functions/gallery/[ownerSlug]/[albumSlug].js', import.meta.url)), true);
        assert.strictEqual(legacyPublicGalleryGet, publicGalleryGet);
        assert.strictEqual(legacyPublicGalleryPageGet, publicGalleryPageGet);

        const bindings = [];
        const env = {
            img_d1: {
                prepare() {
                    return {
                        bind(...values) {
                            bindings.push(values);
                            return { first: async () => null };
                        },
                    };
                },
            },
        };
        const malformedParams = { ownerSlug: ['uika', 'siren'], albumSlug: [] };
        const apiResponse = await publicGalleryGet({ request: new Request('https://example.test/api/public/gallery/uika/siren'), env, params: malformedParams });
        const pageResponse = await publicGalleryPageGet({ request: new Request('https://example.test/gallery/uika/siren'), env, params: malformedParams });
        assert.strictEqual(apiResponse.status, 404);
        assert.strictEqual(pageResponse.status, 200);
        assert.deepStrictEqual(bindings, [['uika', 'siren'], ['uika', 'siren']]);

        const invalidResponse = await publicGalleryGet({ request: new Request('https://example.test/api/public/gallery/uika/siren/extra'), env, params: malformedParams });
        assert.strictEqual(invalidResponse.status, 404);
        assert.strictEqual(bindings.length, 2);
    });

    it('builds a CharInfo gallery pack from album identity instead of Discord identity', () => {
        const pack = createGalleryPack({ id: 'album-id', public_handle: 'master', discord_id: 'discord-id', username: 'Master', char_info_character_name: '维奥莱塔·马克西姆·奥古斯塔' }, 'summer', [
            { id: 'folder/a b.png', file_name: 'First image.png', file_type: 'image/png', timestamp: 1 },
            { id: 'second.mp4', file_name: 'Second video.mp4', file_type: 'video/mp4', timestamp: 2 },
            { id: 'third.webm', file_name: 'Third video.webm', file_type: 'video/webm', timestamp: 3 },
        ], 'http://example.test/api/public/gallery/master/summer');
        assert.strictEqual(pack.format, 'char-info-gallery-pack');
        assert.strictEqual(pack.packId, 'master');
        assert.strictEqual(pack.profileId, 'album-id');
        assert.strictEqual(pack.characterName, '维奥莱塔·马克西姆·奥古斯塔');
        assert.deepStrictEqual(pack.gallery, [
            { title: 'First image.png', sources: ['https://example.test/file/folder/a%20b.png'], thumbnail: 'https://example.test/thumb/folder/a%20b.png' },
            { title: 'Second video.mp4', sources: ['https://example.test/file/second.mp4'], thumbnail: null },
            { title: 'Third video.webm', sources: ['https://example.test/file/third.webm'], thumbnail: null },
        ]);
        assert.strictEqual(absoluteFileUrl('http://example.test/x', 'a.png'), 'https://example.test/file/a.png');
    });

    it('requires an explicit valid character name before exposing a CharInfo pack', () => {
        assert.strictEqual(normalizeCharInfoCharacterName('  维奥莱塔·马克西姆·奥古斯塔  '), '维奥莱塔·马克西姆·奥古斯塔');
        assert.strictEqual(validateCharInfoCharacterName('维奥莱塔·马克西姆·奥古斯塔'), null);
        assert.match(validateCharInfoCharacterName('bad\nname'), /control characters/);
        assert.throws(
            () => createGalleryPack({ id: 'album-id', public_handle: 'master', username: 'Master' }, 'summer', [], 'https://example.test/x'),
            /character name is not configured/,
        );
    });

    it('rejects cross-site mutations but allows same-origin requests', () => {
        assert.strictEqual(rejectCrossSiteMutation(new Request('https://example.test/api/user/files/a', { method: 'DELETE', headers: { Origin: 'https://example.test' } })), null);
        assert.strictEqual(rejectCrossSiteMutation(new Request('https://example.test/api/user/files/a', { method: 'DELETE', headers: { Origin: 'https://evil.test' } })).status, 403);
    });

    it('checks file bytes instead of trusting the browser MIME label', async () => {
        const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])]);
        const webm = new Blob([new Uint8Array([
            0x1a, 0x45, 0xdf, 0xa3, 0x9f,
            0x42, 0x86, 0x81, 0x01,
            0x42, 0xf7, 0x81, 0x01,
            0x42, 0xf2, 0x81, 0x04,
            0x42, 0xf3, 0x81, 0x08,
            0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
        ])]);
        const fakeWebm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04])]);
        const fake = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])]);
        assert.strictEqual(await matchesAllowedFileSignature(png, 'image/png'), true);
        assert.strictEqual(await matchesAllowedFileSignature(fake, 'image/png'), false);
        assert.strictEqual(await matchesAllowedFileSignature(webm, 'video/webm'), true);
        assert.strictEqual(await matchesAllowedFileSignature(fakeWebm, 'video/webm'), false);
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

    it('removes ownerless and External upload target behavior', () => {
        // Legacy anonymous / automation callers no longer choose a storage target.
        assert.strictEqual(resolveUploadTarget({ config: [] }).channel, 'telegram');

        assert.strictEqual(resolveUploadTarget({ config: [{ id: 'defaultUploadChannel', value: 'external' }] }).channel, 'telegram');
    });

    it('retires the public WebDAV service without removing WebDAV as a storage backend', () => {
        const response = legacyDavRoute();
        assert.strictEqual(response.status, 410);
        assert.deepStrictEqual(resolveUploadTarget({ config: [{ id: 'defaultUploadChannel', value: 'webdav' }] }).channel, 'webdav');
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
            channel: 'discord',
            channelName: 'CardServer',
        });
    });
});
