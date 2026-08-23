import assert from 'assert';
import {
    charInfoVisualStorageKey,
    normalizeCharInfoVisualConfig,
    parseStoredCharInfoVisualConfig,
    validateCharInfoVisualConfig,
} from '../functions/utils/charInfoVisualConfig.js';

describe('CharInfo visual config', () => {
    it('keeps only the visual profile fields that ImgBed is allowed to own', () => {
        const config = normalizeCharInfoVisualConfig({
            entranceQuote: '  hello  ',
            raceColor: '#a9dbc3',
            tierColor: '#b7d9e8',
            mainFileId: 'main.webp',
            avatarFileId: 'avatar.webp',
            coverFileId: 'cover.webp',
            viewerHiddenFileIds: ['album.webp', 'album.webp'],
            metadata: {
                author: 'Master',
                version: 'v1',
                authorNote: 'note',
                sex: '女',
                race: '妖精',
                storySections: [{ title: 'One', content: 'Story' }],
            },
            skills: ['must not survive'],
            mvu: { hp: 0 },
            worldbook: 'must not survive',
        });
        assert.deepStrictEqual(config, {
            version: 1,
            entranceQuote: 'hello',
            raceColor: '#A9DBC3',
            tierColor: '#B7D9E8',
            mainFileId: 'main.webp',
            avatarFileId: 'avatar.webp',
            coverFileId: 'cover.webp',
            viewerHiddenFileIds: ['album.webp'],
            metadata: {
                author: 'Master',
                version: 'v1',
                author_note: 'note',
                sex: '女',
                race: '妖精',
                story_sections: [{ title: 'One', content: 'Story' }],
            },
        });
        assert.strictEqual('skills' in config, false);
        assert.strictEqual('mvu' in config, false);
        assert.strictEqual('worldbook' in config, false);
    });

    it('rejects invalid colors and a hidden main portrait', () => {
        const result = validateCharInfoVisualConfig({
            raceColor: 'red',
            tierColor: '#AABBCCEXTRA',
            mainFileId: 'main.webp',
            viewerHiddenFileIds: ['main.webp'],
        });
        assert.strictEqual(result.config.raceColor, '');
        assert.strictEqual(result.config.tierColor, '');
        assert.ok(result.errors.filter(error => error.includes('#RRGGBB')).length >= 2);
        assert.ok(result.errors.some(error => error.includes('Main portrait')));
    });

    it('fails closed to an empty visual config when stored JSON is broken', () => {
        const config = parseStoredCharInfoVisualConfig('{broken');
        assert.strictEqual(config.version, 1);
        assert.strictEqual(config.entranceQuote, '');
        assert.deepStrictEqual(config.viewerHiddenFileIds, []);
    });

    it('namespaces storage by immutable album id', () => {
        assert.strictEqual(charInfoVisualStorageKey('album-id'), 'charinfo.visual:album-id');
    });
});
