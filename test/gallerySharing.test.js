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

    it('shares private album items with the same thumbnail access as public items', async () => {
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
        assert.strictEqual(privatePack.gallery[0].thumbnail, 'https://example.test/thumb/old-private.png?v=2');
        assert.strictEqual(privatePack.avatarThumbnail, 'https://example.test/thumb/old-private.png?variant=avatar&v=2');
        assert.strictEqual(privatePack.libraryThumbnail, 'https://example.test/thumb/old-private.png?variant=library&v=2');

        files = [{ ...files[0], visibility: 'public' }];
        const publicResponse = await publicGalleryGet({ request, env });
        assert.strictEqual(publicResponse.headers.get('etag'), privateEtag, 'Discover visibility does not change the shared pack representation');
        const publicPack = await publicResponse.json();
        assert.strictEqual(publicPack.gallery[0].thumbnail, 'https://example.test/thumb/old-private.png?v=2');
    });

    it('selects the first image in album order for CharInfo compact previews', async () => {
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
        const files = [
            { id: 'intro.webm', file_name: 'Intro.webm', file_type: 'video/webm', timestamp: 1, visibility: 'private' },
            { id: 'folder/portrait one.png', file_name: 'Portrait.png', file_type: 'image/png', timestamp: 2, thumbnail_created_at: 20, visibility: 'private' },
            { id: 'second.png', file_name: 'Second.png', file_type: 'image/png', timestamp: 3, visibility: 'public' },
        ];
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
        const response = await publicGalleryGet({ request, env });
        const pack = await response.json();

        assert.strictEqual(pack.format, 'char-info-gallery-pack');
        assert.strictEqual(pack.version, 1);
        assert.strictEqual(pack.avatarThumbnail, 'https://example.test/thumb/folder/portrait%20one.png?variant=avatar&v=20');
        assert.strictEqual(pack.libraryThumbnail, 'https://example.test/thumb/folder/portrait%20one.png?variant=library&v=20');
        assert.deepStrictEqual(pack.gallery.map(item => item.title), ['Intro.webm', 'Portrait.png', 'Second.png']);
        assert.deepStrictEqual(pack.gallery.map(item => item.sources[0]), [
            'https://example.test/file/intro.webm',
            'https://example.test/file/folder/portrait%20one.png',
            'https://example.test/file/second.png',
        ]);
        assert.strictEqual(pack.gallery[0].thumbnail, null);
        assert.strictEqual(pack.gallery[1].thumbnail, 'https://example.test/thumb/folder/portrait%20one.png?v=20');
        assert.strictEqual(response.headers.get('cache-control'), 'public, max-age=60');
        assert.ok(response.headers.get('etag'));

        const notModified = await publicGalleryGet({
            request: new Request(request.url, { headers: { 'If-None-Match': response.headers.get('etag') } }),
            env,
        });
        assert.strictEqual(notModified.status, 304);
    });

    it('returns null compact previews for an all-video CharInfo gallery', async () => {
        const album = {
            id: 'album-id',
            char_info_character_name: '角色名',
            updated_at: 1,
            public_handle: 'master',
        };
        const files = [
            { id: 'first.webm', file_name: 'First.webm', file_type: 'video/webm', timestamp: 1, visibility: 'public' },
            { id: 'second.mp4', file_name: 'Second.mp4', file_type: 'video/mp4', timestamp: 2, visibility: 'private' },
        ];
        const env = {
            img_d1: {
                prepare(sql) {
                    if (sql.includes('FROM albums a JOIN users u')) return { bind: () => ({ first: async () => album }) };
                    if (sql.includes('FROM album_items ai')) return { bind: () => ({ all: async () => ({ results: files }) }) };
                    throw new Error(`Unexpected SQL: ${sql}`);
                },
            },
        };
        const response = await publicGalleryGet({ request: new Request('https://example.test/api/public/gallery/master/shared'), env });
        const pack = await response.json();
        assert.strictEqual(pack.avatarThumbnail, null);
        assert.strictEqual(pack.libraryThumbnail, null);
        assert.deepStrictEqual(pack.gallery.map(item => item.title), ['First.webm', 'Second.mp4']);
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
