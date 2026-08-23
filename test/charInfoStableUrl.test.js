import assert from 'assert';
import { onRequestGet as stableCharInfoGet } from '../functions/api/public/charinfo/[albumId].js';

describe('stable CharInfo gallery URL', () => {
    it('keeps one album UUID URL while gallery contents update', async () => {
        const album = {
            id: 'album-id',
            name: 'Summer Gallery',
            description: '',
            char_info_character_name: '维奥莱塔·马克西姆·奥古斯塔',
            updated_at: 100,
            discord_id: 'discord-id',
            username: 'Master',
            public_handle: 'master',
        };
        let files = [
            { id: 'first.png', file_name: 'First.png', file_type: 'image/png', timestamp: 1 },
        ];

        const env = {
            img_d1: {
                prepare(sql) {
                    if (sql.includes('FROM albums a JOIN users u')) {
                        assert.match(sql, /a\.id = \?/);
                        assert.match(sql, /a\.visibility = 'public'/);
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
                    throw new Error(`Unexpected SQL: ${sql}`);
                },
            },
        };

        const url = 'https://example.test/api/public/charinfo/album-id';
        const firstResponse = await stableCharInfoGet({ request: new Request(url), env, params: { albumId: 'album-id' } });
        assert.strictEqual(firstResponse.status, 200);
        const firstEtag = firstResponse.headers.get('etag');
        const firstPack = await firstResponse.json();
        assert.strictEqual(firstPack.profileId, 'album-id');
        assert.deepStrictEqual(firstPack.gallery.map((item) => item.title), ['First.png']);

        files = [
            ...files,
            { id: 'second.webm', file_name: 'Second.webm', file_type: 'video/webm', timestamp: 2 },
        ];

        const secondResponse = await stableCharInfoGet({ request: new Request(url), env, params: { albumId: 'album-id' } });
        assert.strictEqual(secondResponse.status, 200);
        const secondEtag = secondResponse.headers.get('etag');
        const secondPack = await secondResponse.json();
        assert.notStrictEqual(secondEtag, firstEtag);
        assert.deepStrictEqual(secondPack.gallery.map((item) => item.title), ['First.png', 'Second.webm']);

        const unchangedResponse = await stableCharInfoGet({
            request: new Request(url, { headers: { 'If-None-Match': secondEtag } }),
            env,
            params: { albumId: 'album-id' },
        });
        assert.strictEqual(unchangedResponse.status, 304);
    });
});
