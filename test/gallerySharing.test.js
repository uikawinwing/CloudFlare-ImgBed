import assert from 'assert';
import { readFileSync } from 'fs';
import { onRequestGet as publicGalleryGet } from '../functions/api/public/gallery/[ownerSlug]/[albumSlug].js';

describe('direct album sharing', () => {
    it('does not overlay a play button on autoplaying gallery videos', () => {
        const source = readFileSync(new URL('../frontend-dist/gallery-app/gallery.js', import.meta.url), 'utf8');
        const styles = readFileSync(new URL('../frontend-dist/gallery-app/gallery.css', import.meta.url), 'utf8');
        assert.doesNotMatch(source, /<span class="play"/);
        assert.doesNotMatch(styles, /^\.play/m);
    });

    it('shares private album items without using public-only thumbnails', async () => {
        const album = {
            id: 'album-id',
            name: 'Shared album',
            description: '',
            char_info_character_name: '角色名',
            updated_at: 1,
            discord_id: 'owner-id',
            username: 'Master',
            public_handle: 'master',
        };
        let files = [{
            id: 'old-private.png',
            file_name: 'Old private.png',
            file_type: 'image/png',
            timestamp: 2,
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
        const request = new Request('https://example.test/api/public/gallery/master/shared');
        const privateResponse = await publicGalleryGet({ request, env });
        const privateEtag = privateResponse.headers.get('etag');
        const privatePack = await privateResponse.json();
        assert.strictEqual(privatePack.gallery.length, 1);
        assert.strictEqual(privatePack.gallery[0].sources[0], 'https://example.test/file/old-private.png');
        assert.strictEqual(privatePack.gallery[0].thumbnail, null);

        files = [{ ...files[0], visibility: 'public' }];
        const publicResponse = await publicGalleryGet({ request, env });
        assert.notStrictEqual(publicResponse.headers.get('etag'), privateEtag);
        const publicPack = await publicResponse.json();
        assert.strictEqual(publicPack.gallery[0].thumbnail, 'https://example.test/thumb/old-private.png');
    });

    it('opens a normal shared album without requiring CharInfo identity', async () => {
        const album = {
            id: 'plain-album',
            name: 'Plain album',
            description: '',
            char_info_character_name: null,
            updated_at: 1,
            discord_id: 'owner-id',
            username: 'Master',
            public_handle: 'master',
        };
        const env = {
            img_d1: {
                prepare(sql) {
                    if (sql.includes('FROM albums a JOIN users u')) return { bind: () => ({ first: async () => album }) };
                    if (sql.includes('FROM album_items ai')) return { bind: () => ({ all: async () => ({ results: [] }) }) };
                    throw new Error(`Unexpected SQL: ${sql}`);
                },
            },
        };
        const response = await publicGalleryGet({ request: new Request('https://example.test/api/public/gallery/master/plain'), env });
        assert.strictEqual(response.status, 200);
        const pack = await response.json();
        assert.strictEqual(pack.format, 'imgbed-gallery');
        assert.deepStrictEqual(pack.gallery, []);
    });
});
