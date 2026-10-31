import assert from 'assert';
import { onRequestGet as stableCharInfoGet } from '../functions/api/public/charinfo/[albumId].js';
import { createCharInfoVisualPack } from '../functions/utils/charInfoVisualPack.js';

describe('stable CharInfo visual URL', () => {
    it('uses the first album image as the default avatar and preview cover', () => {
        const pack = createCharInfoVisualPack({
            album: {
                id: 'album-id',
                char_info_character_name: '克瑞西达',
                public_handle: 'master',
            },
            files: [
                { id: 'intro.webm', file_name: 'Intro.webm', file_type: 'video/webm', visibility: 'public' },
                { id: 'portrait.png', file_name: 'Portrait.png', file_type: 'image/png', visibility: 'public' },
            ],
            storedVisualConfig: null,
            requestUrl: 'https://example.test/api/public/charinfo/album-id',
        });

        assert.strictEqual(pack.visual.avatarUrl, 'https://example.test/file/portrait.png');
        assert.strictEqual(pack.visual.coverUrl, 'https://example.test/file/portrait.png');
    });

    it('keeps one album UUID URL while visual settings and gallery contents update', async () => {
        const album = {
            id: 'album-id',
            slug: 'summer-gallery',
            name: 'Summer Gallery',
            description: '',
            char_info_character_name: '维奥莱塔·马克西姆·奥古斯塔',
            updated_at: 100,
            discord_id: 'discord-id',
            username: 'Master',
            public_handle: 'master',
        };
        let files = [
            { id: 'first.png', file_name: 'First.png', file_type: 'image/png', timestamp: 1, visibility: 'public' },
            { id: 'second.webm', file_name: 'Second.webm', file_type: 'video/webm', timestamp: 2 },
        ];
        let visualConfig = JSON.stringify({
            entranceQuote: 'Hello',
            raceColor: '#A9DBC3',
            tierColor: '#B7D9E8',
            mainFileId: 'first.png',
            avatarFileId: 'first.png',
            coverFileId: 'private.png',
            viewerHiddenFileIds: ['second.webm'],
            metadata: {
                author: 'Master',
                version: 'v1',
                author_note: 'Visual only',
                sex: '女',
                race: '妖精',
                story_sections: [{ title: 'Intro', content: 'Visual metadata story' }],
            },
            skills: ['must never be exposed'],
            mvu: { hp: 0 },
        });

        const env = {
            img_d1: {
                prepare(sql) {
                    if (sql.includes('FROM albums a JOIN users u')) {
                        assert.match(sql, /a\.id = \?/);
                        assert.doesNotMatch(sql, /a\.visibility = 'public'/);
                        assert.match(sql, /u\.status = 'active'/);
                        return {
                            bind(value) {
                                assert.strictEqual(value, 'album-id');
                                return { first: async () => album };
                            },
                        };
                    }
                    if (sql.includes('FROM album_items ai')) {
                        return {
                            bind(value) {
                                assert.strictEqual(value, 'album-id');
                                return { all: async () => ({ results: files }) };
                            },
                        };
                    }
                    if (sql.includes('FROM other_data')) {
                        return {
                            bind(value) {
                                assert.strictEqual(value, 'charinfo.visual:album-id');
                                return { first: async () => ({ value: visualConfig }) };
                            },
                        };
                    }
                    throw new Error(`Unexpected SQL: ${sql}`);
                },
            },
        };

        const url = 'https://example.test/api/public/charinfo/album-id';
        const firstResponse = await stableCharInfoGet({ request: new Request(url), env, params: { albumId: 'album-id' } });
        assert.strictEqual(firstResponse.status, 200);
        const firstEtag = firstResponse.headers.get('etag');
        const firstPack = await firstResponse.json();
        assert.strictEqual(firstPack.format, 'char-info-visual-pack');
        assert.strictEqual(firstPack.version, 1);
        assert.strictEqual(firstPack.profileId, 'album-id');
        assert.strictEqual(firstPack.galleryUrl, 'https://example.test/api/public/gallery/master/summer-gallery');
        assert.strictEqual(firstPack.visual.entranceQuote, 'Hello');
        assert.strictEqual(firstPack.visual.avatarUrl, 'https://example.test/file/first.png?v=1');
        assert.strictEqual(firstPack.visual.coverUrl, 'https://example.test/file/first.png?v=1', 'an unavailable cover selection falls back to the first album image');
        assert.strictEqual('skills' in firstPack.visual, false);
        assert.strictEqual('mvu' in firstPack.visual, false);
        assert.deepStrictEqual(firstPack.gallery.map((item) => item.title), ['First.png', 'Second.webm']);
        assert.strictEqual(firstPack.gallery[1].viewerVisible, false);

        const galleryUrl = `${url}?view=gallery`;
        const galleryResponse = await stableCharInfoGet({
            request: new Request(galleryUrl, { headers: { 'If-None-Match': firstEtag } }), env, params: { albumId: 'album-id' },
        });
        assert.strictEqual(galleryResponse.status, 200, 'a visual-view ETag must not return a gallery-view 304');
        const galleryEtag = galleryResponse.headers.get('etag');
        const galleryPack = await galleryResponse.json();
        assert.deepStrictEqual(galleryPack, {
            format: 'char-info-gallery-pack', version: 1, packId: 'master', profileId: 'album-id',
            characterName: album.char_info_character_name,
            avatarThumbnail: 'https://example.test/file/first.png?v=1',
            libraryThumbnail: 'https://example.test/file/first.png?v=1',
            gallery: firstPack.gallery,
        });
        assert.strictEqual(galleryResponse.headers.get('Access-Control-Allow-Origin'), '*');
        assert.strictEqual(galleryResponse.headers.get('Cache-Control'), 'public, max-age=60');
        const unchangedGalleryResponse = await stableCharInfoGet({
            request: new Request(galleryUrl, { headers: { 'If-None-Match': galleryEtag } }), env, params: { albumId: 'album-id' },
        });
        assert.strictEqual(unchangedGalleryResponse.status, 304);
        const visualWithGalleryEtag = await stableCharInfoGet({
            request: new Request(url, { headers: { 'If-None-Match': galleryEtag } }), env, params: { albumId: 'album-id' },
        });
        assert.strictEqual(visualWithGalleryEtag.status, 200);

        visualConfig = JSON.stringify({
            entranceQuote: 'Updated',
            mainFileId: 'second.webm',
            avatarFileId: 'first.png',
            viewerHiddenFileIds: [],
            metadata: { author: 'Master', version: 'v2' },
        });

        const secondResponse = await stableCharInfoGet({ request: new Request(url), env, params: { albumId: 'album-id' } });
        assert.strictEqual(secondResponse.status, 200);
        const secondEtag = secondResponse.headers.get('etag');
        const secondPack = await secondResponse.json();
        assert.notStrictEqual(secondEtag, firstEtag, 'visual-only edits must invalidate the ETag');
        assert.strictEqual(secondPack.visual.entranceQuote, 'Updated');
        assert.deepStrictEqual(secondPack.gallery.map((item) => item.title), ['Second.webm', 'First.png'], 'main portrait moves to the front without changing the URL');
        const reorderedGalleryResponse = await stableCharInfoGet({ request: new Request(galleryUrl), env, params: { albumId: 'album-id' } });
        assert.deepStrictEqual((await reorderedGalleryResponse.json()).gallery, secondPack.gallery, 'viewer gallery keeps visual ordering and visibility');

        files = [
            ...files,
            { id: 'third.png', file_name: 'Third.png', file_type: 'image/png', timestamp: 3 },
        ];
        const thirdResponse = await stableCharInfoGet({ request: new Request(url), env, params: { albumId: 'album-id' } });
        const thirdEtag = thirdResponse.headers.get('etag');
        assert.notStrictEqual(thirdEtag, secondEtag);
        const thirdPack = await thirdResponse.json();
        assert.deepStrictEqual(thirdPack.gallery.map((item) => item.title), ['Second.webm', 'First.png', 'Third.png']);

        files[0].visibility = 'private';
        const privateResponse = await stableCharInfoGet({ request: new Request(url), env, params: { albumId: 'album-id' } });
        const privateEtag = privateResponse.headers.get('etag');
        assert.strictEqual(privateEtag, thirdEtag, 'Discover visibility does not change the shared pack representation');
        const privatePack = await privateResponse.json();
        assert.strictEqual(privatePack.gallery.find(item => item.title === 'First.png').thumbnail, 'https://example.test/thumb/first.png?v=1');

        const unchangedResponse = await stableCharInfoGet({
            request: new Request(url, { headers: { 'If-None-Match': privateEtag } }),
            env,
            params: { albumId: 'album-id' },
        });
        assert.strictEqual(unchangedResponse.status, 304);

        album.slug = 'renamed-gallery';
        const renamedResponse = await stableCharInfoGet({
            request: new Request(url, { headers: { 'If-None-Match': privateEtag } }),
            env,
            params: { albumId: 'album-id' },
        });
        assert.strictEqual(renamedResponse.status, 200, 'changing the gallery URL must invalidate the ETag');
        const renamedPack = await renamedResponse.json();
        assert.strictEqual(renamedPack.galleryUrl, 'https://example.test/api/public/gallery/master/renamed-gallery');

        visualConfig = '{broken';
        const brokenResponse = await stableCharInfoGet({ request: new Request(url), env, params: { albumId: 'album-id' } });
        assert.strictEqual(brokenResponse.status, 200);
        const brokenPack = await brokenResponse.json();
        assert.strictEqual(brokenPack.visual, null, 'broken visual config must be ignored instead of clearing local visual state');
        assert.deepStrictEqual(brokenPack.gallery.map((item) => item.title), ['First.png', 'Second.webm', 'Third.png']);
        const brokenGalleryResponse = await stableCharInfoGet({ request: new Request(galleryUrl), env, params: { albumId: 'album-id' } });
        const brokenGalleryPack = await brokenGalleryResponse.json();
        assert.strictEqual(brokenGalleryPack.avatarThumbnail, 'https://example.test/file/first.png?v=1');
        assert.strictEqual(brokenGalleryPack.libraryThumbnail, 'https://example.test/file/first.png?v=1');
    });

    it('rejects unknown views without reading album contents', async () => {
        const response = await stableCharInfoGet({
            request: new Request('https://example.test/api/public/charinfo/album-id?view=unknown'),
            env: { img_d1: { prepare() { throw new Error('Unknown views must fail before data access'); } } },
            params: { albumId: 'album-id' },
        });
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
    });

    it('filters unsupported legacy media only at the viewer protocol boundary', async () => {
        const album = { id: 'album-id', slug: 'gallery', char_info_character_name: '角色', public_handle: 'master' };
        let files = [
            { id: 'old.svg', file_type: 'image/svg+xml' },
            { id: 'old.bmp', file_type: 'image/bmp' },
            { id: 'old-no-extension', file_type: 'image/png' },
            { id: 'clip.webm', file_type: 'video/webm' },
            { id: 'portrait.PNG', file_type: 'image/png' },
        ];
        const visualConfig = JSON.stringify({ avatarFileId: 'old.svg', coverFileId: 'old.bmp' });
        const env = { img_d1: { prepare(sql) {
            if (sql.includes('FROM albums a JOIN users u')) return { bind: () => ({ first: async () => album }) };
            if (sql.includes('FROM album_items ai')) return { bind: () => ({ all: async () => ({ results: files }) }) };
            if (sql.includes('FROM other_data')) return { bind: () => ({ first: async () => ({ value: visualConfig }) }) };
            throw new Error(`Unexpected SQL: ${sql}`);
        } } };
        const url = 'https://example.test/api/public/charinfo/album-id';
        const read = async view => (await stableCharInfoGet({ request: new Request(url + view), env, params: { albumId: 'album-id' } })).json();
        const visualPack = await read('');
        assert.strictEqual(visualPack.gallery.length, 5, 'legacy files remain in the editor view and in their album');
        const galleryPack = await read('?view=gallery');
        assert.deepStrictEqual(galleryPack.gallery.map(item => item.sources[0]), [
            'https://example.test/file/clip.webm', 'https://example.test/file/portrait.PNG',
        ]);
        assert.strictEqual(galleryPack.avatarThumbnail, 'https://example.test/file/portrait.PNG');
        assert.strictEqual(galleryPack.libraryThumbnail, 'https://example.test/file/portrait.PNG');
        files = files.slice(0, 4);
        const allVideoPack = await read('?view=gallery');
        assert.strictEqual(allVideoPack.avatarThumbnail, null);
        assert.strictEqual(allVideoPack.libraryThumbnail, null);
        assert.deepStrictEqual(allVideoPack.gallery.map(item => item.sources[0]), ['https://example.test/file/clip.webm']);
    });
});
