import assert from 'assert';
import * as catalog from '../functions/utils/publicCatalog.js';
import {
    decodeCursor,
    encodeCursor,
    isPublicCatalogFile,
    parseDiscoverQuery,
    presentDiscoverFile,
    resolveFilePublication,
    listDiscover,
    listSharedAlbumFiles,
} from '../functions/utils/publicCatalog.js';
import { parseImageTransform, transformImageRequestViaUrl } from '../functions/file/imageTransform.js';

describe('public catalog policy', () => {
    const activeOwner = { status: 'active' };

    it('uses public visibility as the Discover rule', () => {
        assert.strictEqual(isPublicCatalogFile({ visibility: 'private', moderation_status: 'active' }, activeOwner), false);
        assert.strictEqual(isPublicCatalogFile({ visibility: 'public', moderation_status: 'active' }, activeOwner), true);
    });

    it('only accepts private or public visibility', () => {
        assert.deepStrictEqual(resolveFilePublication({ Visibility: 'private' }, { visibility: 'public' }), { visibility: 'public' });
        assert.deepStrictEqual(resolveFilePublication({ Visibility: 'public' }, { visibility: 'private' }), { visibility: 'private' });
        assert.deepStrictEqual(resolveFilePublication({ Visibility: 'public' }, {}), { visibility: 'public' });
        assert.strictEqual(resolveFilePublication({ Visibility: 'private' }, { visibility: 'unlisted' }), null);
    });

    it('uses stable opaque cursors for the recent feed', () => {
        const cursor = encodeCursor({ value: 1234, id: 'folder/a.png' });
        assert.deepStrictEqual(decodeCursor(cursor), { value: 1234, id: 'folder/a.png' });
        assert.throws(() => parseDiscoverQuery(new URL('https://example.test/api/public/discover?cursor=nope')), /Invalid cursor/);
    });

    it('does not invent a video thumbnail', () => {
        const video = presentDiscoverFile({ id: 'clip.mp4', file_name: 'Clip', file_type: 'video/mp4', timestamp: 1 }, 'http://example.test/api/public/discover');
        assert.strictEqual(video.url, 'https://example.test/file/clip.mp4');
        assert.strictEqual(video.thumbnailUrl, null);
    });

    it('emits a stable reusable thumbnail URL for Discover images', () => {
        const image = presentDiscoverFile({ id: 'art.png', file_name: 'Art', file_type: 'image/png', timestamp: 1 }, 'https://example.test/api/public/discover');
        assert.strictEqual(image.thumbnailUrl, 'https://example.test/thumb/art.png?v=1');
    });

    it('keeps original and thumbnail URLs separate for nested file ids', () => {
        const image = presentDiscoverFile({
            id: 'users/589790434960867328/55226fd2-d75d-44d7-be34-f392ce2bd2d8.png',
            file_name: 'venus_divinity.png',
            file_type: 'image/png',
            timestamp: 1,
        }, 'https://staging.cloudflare-imgbed-dxx.pages.dev/api/public/discover');
        assert.match(image.url, /\/file\/users\/589790434960867328\/55226fd2-d75d-44d7-be34-f392ce2bd2d8\.png$/);
        assert.match(image.thumbnailUrl, /\/thumb\/users\/589790434960867328\/55226fd2-d75d-44d7-be34-f392ce2bd2d8\.png\?v=1$/);
        assert.strictEqual(image.name, 'venus_divinity.png');
    });

    it('keeps the dynamic WebP fallback preset available for legacy thumbnails', () => {
        const fallbackUrl = new URL('https://example.test/file/art.png?width=720&format=webp&fallback=original');
        const thumbnail = parseImageTransform(fallbackUrl, { imageTransformEnabled: false });
        assert.strictEqual(thumbnail.requested, true);
        assert.strictEqual(thumbnail.publicThumbnailPreset, true);
        assert.strictEqual(thumbnail.outputFormat, 'image/webp');
        assert.strictEqual(thumbnail.error, undefined);

        const genericFallback = parseImageTransform(new URL('https://example.test/file/art.png?width=640&format=webp&fallback=original'), { imageTransformEnabled: false });
        assert.strictEqual(genericFallback.requested, false);
        assert.strictEqual(genericFallback.fallback, 'original');

        const strict = parseImageTransform(new URL('https://example.test/file/art.png?width=720'), { imageTransformEnabled: false });
        assert.strictEqual(strict.error, 'Image resizing is disabled');
        assert.strictEqual(strict.errorStatus, 403);
    });

    it('skips unavailable Pages image resizing when original fallback is requested', async () => {
        const request = new Request('https://staging.cloudflare-imgbed-dxx.pages.dev/file/users/example/art.png?width=720&fallback=original');
        const imageTransform = parseImageTransform(new URL(request.url), { imageTransformEnabled: true });
        const response = await transformImageRequestViaUrl({ env: {}, imageTransform, request });
        assert.strictEqual(response, null);
    });

    it('uses visibility for Discover but not for direct album sharing', async () => {
        const queries = [];
        const env = {
            img_d1: {
                prepare(sql) {
                    queries.push(sql);
                    return { bind: () => ({ all: async () => ({ results: [] }) }) };
                },
            },
        };
        await listDiscover(env, { limit: 24, type: 'all', sort: 'recent', cursor: null }, 'https://example.test/api/public/discover');
        await listSharedAlbumFiles(env, 'album-id');
        assert.match(queries[0], /f\.visibility = 'public'/);
        assert.doesNotMatch(queries[1], /f\.visibility = 'public'/);
        for (const sql of queries) {
            assert.match(sql, /f\.moderation_status = 'active'/);
            assert.match(sql, /u\.status = 'active'/);
        }
        assert.doesNotMatch(queries[0], /f\.discover_eligible = 1/);
    });

    it('lists only public albums in Discover while keeping their direct share URLs', async () => {
        assert.strictEqual(typeof catalog.listDiscoverAlbums, 'function');
        const queries = [];
        const env = {
            img_d1: {
                prepare(sql) {
                    queries.push(sql);
                    return { bind: () => ({ all: async () => ({ results: [{
                        id: 'album-id', slug: 'summer', name: 'Summer', description: '', updated_at: 1,
                        creator_name: 'Master', creator_handle: 'master', cover_id: 'cover.png',
                        cover_type: 'image/png', cover_visibility: 'private', cover_timestamp: 1, item_count: 1,
                    }] }) }) };
                },
            },
        };
        const albums = await catalog.listDiscoverAlbums(env, 'https://example.test/api/public/discover');
        assert.match(queries[0], /a\.visibility = 'public'/);
        assert.match(queries[0], /FROM album_covers ac/);
        assert.match(queries[0], /ai\.file_id = ac\.file_id/);
        assert.match(queries[0], /f\.file_type LIKE 'image\/%'/);
        assert.doesNotMatch(queries[0].split('), explicit_covers AS')[0], /file_type LIKE/);
        assert.match(queries[0], /f\.moderation_status = 'active'/);
        assert.strictEqual((queries[0].match(/f\.visibility = 'public'/g) || []).length, 3);
        assert.strictEqual(albums[0].url, 'https://example.test/gallery/master/summer');
        assert.strictEqual(albums[0].coverUrl, null);
        assert.strictEqual(albums[0].coverThumbnailUrl, null);
    });

    it('uses a public selected image and its saved focal point for Discover', () => {
        const album = catalog.presentDiscoverAlbum({
            id: 'album-id', slug: 'summer', name: 'Summer', updated_at: 1,
            creator_name: 'Master', creator_handle: 'master', cover_id: 'cover.png',
            cover_type: 'image/png', cover_visibility: 'public', cover_timestamp: 1, cover_position_x: 18, cover_position_y: 76,
        }, 'https://example.test/api/public/discover');
        assert.strictEqual(album.coverUrl, 'https://example.test/file/cover.png');
        assert.strictEqual(album.coverThumbnailUrl, 'https://example.test/thumb/cover.png?v=1');
        assert.strictEqual(album.coverPositionX, 18);
        assert.strictEqual(album.coverPositionY, 76);
    });

    it('keeps the existing public video fallback when no eligible image cover is selected', () => {
        const album = catalog.presentDiscoverAlbum({
            id: 'album-id', slug: 'summer', name: 'Summer', updated_at: 1,
            creator_name: 'Master', creator_handle: 'master', cover_id: 'clip.webm',
            cover_type: 'video/webm', cover_visibility: 'public', cover_timestamp: 1,
        }, 'https://example.test/api/public/discover');
        assert.strictEqual(album.coverUrl, 'https://example.test/file/clip.webm');
        assert.strictEqual(album.coverThumbnailUrl, null);
        assert.strictEqual(album.coverType, 'video/webm');
    });
});
