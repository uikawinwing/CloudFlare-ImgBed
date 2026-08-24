import assert from 'assert';
import { onRequestGet as stableCharInfoGet } from '../functions/api/public/charinfo/[albumId].js';

describe('stable CharInfo visual URL', () => {
    it('keeps one album UUID URL while visual settings and gallery contents update', async () => {
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
        assert.strictEqual(firstPack.visual.entranceQuote, 'Hello');
        assert.strictEqual(firstPack.visual.avatarUrl, 'https://example.test/file/first.png');
        assert.strictEqual(firstPack.visual.coverUrl, null, 'non-public files must never be resolved into public visual URLs');
        assert.strictEqual('skills' in firstPack.visual, false);
        assert.strictEqual('mvu' in firstPack.visual, false);
        assert.deepStrictEqual(firstPack.gallery.map((item) => item.title), ['First.png', 'Second.webm']);
        assert.strictEqual(firstPack.gallery[1].viewerVisible, false);

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
        assert.notStrictEqual(privateEtag, thirdEtag, 'visibility changes must invalidate the ETag');
        const privatePack = await privateResponse.json();
        assert.strictEqual(privatePack.gallery.find(item => item.title === 'First.png').thumbnail, null, 'shared private files must use the original instead of the public-only thumbnail endpoint');

        const unchangedResponse = await stableCharInfoGet({
            request: new Request(url, { headers: { 'If-None-Match': privateEtag } }),
            env,
            params: { albumId: 'album-id' },
        });
        assert.strictEqual(unchangedResponse.status, 304);

        visualConfig = '{broken';
        const brokenResponse = await stableCharInfoGet({ request: new Request(url), env, params: { albumId: 'album-id' } });
        assert.strictEqual(brokenResponse.status, 200);
        const brokenPack = await brokenResponse.json();
        assert.strictEqual(brokenPack.visual, null, 'broken visual config must be ignored instead of clearing local visual state');
        assert.deepStrictEqual(brokenPack.gallery.map((item) => item.title), ['First.png', 'Second.webm', 'Third.png']);
    });
});
