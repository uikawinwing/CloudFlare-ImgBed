import assert from 'assert';
import { readFileSync } from 'fs';

describe('default sharing visibility', () => {
    it('makes new uploads and albums public by default', () => {
        const uploadSource = readFileSync(new URL('../functions/upload/index.js', import.meta.url), 'utf8');
        const huggingFaceSource = readFileSync(new URL('../functions/upload/huggingface/commitUpload.js', import.meta.url), 'utf8');
        const albumSource = readFileSync(new URL('../functions/api/user/albums/index.js', import.meta.url), 'utf8');
        const handleSource = readFileSync(new URL('../functions/api/user/handle.js', import.meta.url), 'utf8');
        const charInfoSource = readFileSync(new URL('../frontend-dist/charinfo/charinfo.js', import.meta.url), 'utf8');

        assert.match(uploadSource, /metadata\.Visibility = 'public'/);
        assert.match(huggingFaceSource, /Visibility: 'public'/);
        assert.match(albumSource, /payload\.visibility \|\| 'public'/);
        assert.match(charInfoSource, /visibility: 'public'/);
        assert.match(handleSource, /SELECT 1 FROM albums WHERE owner_id = \? LIMIT 1/);
        assert.doesNotMatch(handleSource, /albums WHERE owner_id = \? AND visibility = 'public'/);
        assert.match(handleSource, /current\?\.public_handle && current\.public_handle !== handle/);
    });
});
