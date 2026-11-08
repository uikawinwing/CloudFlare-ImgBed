import assert from 'assert';
import { readFileSync } from 'fs';

describe('default sharing visibility', () => {
    it('makes new uploads public by default and preserves stable album handles', () => {
        const uploadSource = readFileSync(new URL('../functions/upload/index.js', import.meta.url), 'utf8');
        const huggingFaceSource = readFileSync(new URL('../functions/upload/huggingface/commitUpload.js', import.meta.url), 'utf8');
        const handleSource = readFileSync(new URL('../functions/api/user/handle.js', import.meta.url), 'utf8');

        assert.match(uploadSource, /metadata\.Visibility = 'public'/);
        assert.match(huggingFaceSource, /Hugging Face direct uploads are disabled/);
        assert.match(huggingFaceSource, /status: 410/);
        assert.match(handleSource, /SELECT 1 FROM albums WHERE owner_id = \? LIMIT 1/);
        assert.doesNotMatch(handleSource, /albums WHERE owner_id = \? AND visibility = 'public'/);
        assert.match(handleSource, /current\?\.public_handle && current\.public_handle !== handle/);
    });
});
