import assert from 'assert';
import {
    decodeCursor,
    encodeCursor,
    isPublicCatalogFile,
    parseDiscoverQuery,
    presentDiscoverFile,
    resolveFilePublication,
    listDiscover,
    listPublicAlbumFiles,
} from '../functions/utils/publicCatalog.js';

describe('public catalog policy', () => {
    const activeOwner = { status: 'active' };

    it('excludes private and unlisted files from every public catalog', () => {
        assert.strictEqual(isPublicCatalogFile({ visibility: 'private', moderation_status: 'active', discover_eligible: 1 }, activeOwner), false);
        assert.strictEqual(isPublicCatalogFile({ visibility: 'unlisted', moderation_status: 'active', discover_eligible: 1 }, activeOwner), false);
        assert.strictEqual(isPublicCatalogFile({ visibility: 'public', moderation_status: 'active', discover_eligible: 1 }, activeOwner), true);
        assert.strictEqual(isPublicCatalogFile({ visibility: 'public', moderation_status: 'active', discover_eligible: 0 }, activeOwner, { discover: true }), false);
    });

    it('only enables Discover for public files', () => {
        assert.deepStrictEqual(resolveFilePublication({ Visibility: 'private', DiscoverEligible: false }, { visibility: 'public', discoverEligible: true }), { visibility: 'public', discoverEligible: 1 });
        assert.deepStrictEqual(resolveFilePublication({ Visibility: 'public', DiscoverEligible: true }, { visibility: 'unlisted' }), { visibility: 'unlisted', discoverEligible: 0 });
        assert.deepStrictEqual(resolveFilePublication({ Visibility: 'public', DiscoverEligible: '0' }, { visibility: 'public' }), { visibility: 'public', discoverEligible: 0 });
        assert.strictEqual(resolveFilePublication({ Visibility: 'public', DiscoverEligible: false }, { visibility: 'unlisted', discoverEligible: true }), null);
        assert.deepStrictEqual(resolveFilePublication({ Visibility: 'public', DiscoverEligible: true }, { visibility: 'private', discoverEligible: false }), { visibility: 'private', discoverEligible: 0 });
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

    it('falls back to the original when a source cannot be resized', () => {
        const image = presentDiscoverFile({ id: 'art.gif', file_name: 'Art', file_type: 'image/gif', timestamp: 1 }, 'https://example.test/api/public/discover');
        assert.strictEqual(image.thumbnailUrl, 'https://example.test/file/art.gif?width=720&fit=cover&fallback=original');
    });

    it('puts the public-only rule in both public SQL queries', async () => {
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
        await listPublicAlbumFiles(env, 'album-id');
        for (const sql of queries) {
            assert.match(sql, /f\.visibility = 'public'/);
            assert.match(sql, /f\.moderation_status = 'active'/);
            assert.match(sql, /u\.status = 'active'/);
        }
        assert.match(queries[0], /f\.discover_eligible = 1/);
    });
});
