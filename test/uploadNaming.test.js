import assert from 'assert';
import {
    buildHuggingFaceFilePath,
    isOwnedCanonicalFileId,
    resolveStorageFileName,
} from '../functions/upload/uploadNaming.js';

describe('owned upload naming', () => {
    const authenticatedContext = { discordIdentity: { id: '589790434960867328' } };
    const canonicalId = 'users/589790434960867328/55226fd2-d75d-44d7-be34-f392ce2bd2d8.png';

    it('uses the canonical UUID basename as the physical attachment filename', () => {
        assert.strictEqual(
            resolveStorageFileName(authenticatedContext, canonicalId),
            '55226fd2-d75d-44d7-be34-f392ce2bd2d8.png',
        );
    });

    it('rejects ownerless or cross-owner storage ids', () => {
        assert.throws(() => resolveStorageFileName({}, canonicalId), /Owned canonical file id is required/);
        assert.throws(
            () => resolveStorageFileName({ discordIdentity: { id: 'someone-else' } }, canonicalId),
            /Owned canonical file id is required/,
        );
        assert.strictEqual(isOwnedCanonicalFileId(authenticatedContext.discordIdentity, canonicalId), true);
    });

    it('uses the same canonical path on HuggingFace', () => {
        assert.strictEqual(buildHuggingFaceFilePath(authenticatedContext, canonicalId), canonicalId);
    });
});
