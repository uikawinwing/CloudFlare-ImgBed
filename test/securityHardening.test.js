import assert from 'assert';
import { Blob } from 'buffer';
import { readFileSync } from 'fs';
import {
    ALLOWED_UPLOAD_TYPES,
    canonicalExtensionForMediaType,
    isTrustedDiscordAttachmentUrl,
    matchesAllowedFileSignature,
    validateDiscordAttachment,
    validateImageDimensions,
} from '../functions/utils/fileSignature.js';
import { DiscordAPI } from '../functions/utils/storage/discordAPI.js';
import { setCommonHeaders } from '../functions/file/fileTools.js';

function mediaBlob(bytes, type) {
    return new Blob([Uint8Array.from(bytes)], { type });
}

function ftypBox(majorBrand, compatibleBrand = majorBrand) {
    const bytes = new Uint8Array(24);
    bytes.set([0x00, 0x00, 0x00, 0x18], 0);
    bytes.set([...Buffer.from('ftyp')], 4);
    bytes.set([...Buffer.from(majorBrand)], 8);
    bytes.set([0x00, 0x00, 0x00, 0x00], 12);
    bytes.set([...Buffer.from(compatibleBrand)], 16);
    return bytes;
}

describe('media security hardening', () => {
    it('keeps the upload allowlist media-only with validated WebM support', () => {
        assert.strictEqual(ALLOWED_UPLOAD_TYPES.has('image/svg+xml'), false);
        assert.strictEqual(ALLOWED_UPLOAD_TYPES.has('text/html'), false);
        assert.strictEqual(ALLOWED_UPLOAD_TYPES.has('video/webm'), true);
        assert.strictEqual(ALLOWED_UPLOAD_TYPES.has('video/mp4'), true);
    });

    it('keeps WebM enabled in the integrated upload UI', () => {
        const uploadSource = readFileSync(new URL('../frontend-dist/account/upload-in-files.js', import.meta.url), 'utf8');
        assert.match(uploadSource, /const ACCEPTED_FILE = .*webm/i);
        assert.match(uploadSource, /input\.accept = .*video\/webm/i);
        assert.match(uploadSource, /file\.type !== 'video\/webm'/);
        assert.match(uploadSource, /MP4 与 WebM/);
    });

    it('uses the verified MIME type for canonical storage extensions instead of the user filename', () => {
        assert.strictEqual(canonicalExtensionForMediaType('image/png'), 'png');
        assert.strictEqual(canonicalExtensionForMediaType('video/mp4'), 'mp4');
        const uploadToolsSource = readFileSync(new URL('../functions/upload/uploadTools.js', import.meta.url), 'utf8');
        assert.match(uploadToolsSource, /canonicalExtensionForMediaType\(fileType\) \|\| resolveFileExt\(fileName, fileType\)/);
    });

    it('accepts real MP4 brands and rejects AVIF containers disguised as video/mp4', async () => {
        const mp4 = mediaBlob(ftypBox('isom', 'mp42'), 'video/mp4');
        const disguisedAvif = mediaBlob(ftypBox('avif', 'avif'), 'video/mp4');
        assert.strictEqual(await matchesAllowedFileSignature(mp4, 'video/mp4'), true);
        assert.strictEqual(await matchesAllowedFileSignature(disguisedAvif, 'video/mp4'), false);
    });

    it('continues to validate normal PNG signatures', async () => {
        const png = mediaBlob([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png');
        assert.strictEqual(await matchesAllowedFileSignature(png, 'image/png'), true);
        assert.strictEqual(await matchesAllowedFileSignature(png, 'image/jpeg'), false);
    });

    it('rejects oversized decoded image dimensions', () => {
        assert.strictEqual(validateImageDimensions({ width: 4096, height: 4096 }), null);
        assert.match(validateImageDimensions({ width: 20000, height: 100 }), /16384px/);
        assert.match(validateImageDimensions({ width: 12000, height: 12000 }), /100000000 pixel/);
    });

    it('accepts only HTTPS Discord attachment hosts and paths', () => {
        assert.strictEqual(
            isTrustedDiscordAttachmentUrl('https://cdn.discordapp.com/attachments/1/2/file.png?ex=abc'),
            true,
        );
        assert.strictEqual(
            isTrustedDiscordAttachmentUrl('https://media.discordapp.net/attachments/1/2/file.png'),
            true,
        );
        assert.strictEqual(isTrustedDiscordAttachmentUrl('https://evil.example/attachments/1/2/file.png'), false);
        assert.strictEqual(isTrustedDiscordAttachmentUrl('http://cdn.discordapp.com/attachments/1/2/file.png'), false);
        assert.strictEqual(isTrustedDiscordAttachmentUrl('https://cdn.discordapp.com/not-attachments/file.png'), false);
    });

    it('verifies Discord attachment size, MIME and canonical filename before accepting it', () => {
        const attachment = {
            url: 'https://cdn.discordapp.com/attachments/1/2/asset.png',
            file_size: 1234,
            content_type: 'image/png',
            file_name: 'asset.png',
        };
        const expected = { size: 1234, fileType: 'image/png', fileName: 'asset.png' };
        assert.strictEqual(validateDiscordAttachment(attachment, expected), null);
        assert.match(validateDiscordAttachment({ ...attachment, file_size: 12 }, expected), /size/);
        assert.match(validateDiscordAttachment({ ...attachment, content_type: 'text/html' }, expected), /content type/);
        assert.match(validateDiscordAttachment({ ...attachment, file_name: 'asset.html' }, expected), /filename/);
        assert.match(
            validateDiscordAttachment({ ...attachment, url: 'https://evil.example/attachments/1/2/asset.png' }, expected),
            /untrusted attachment URL/,
        );
    });

    it('DiscordAPI refuses untrusted attachment URLs both after upload and on later refresh', async () => {
        const api = new DiscordAPI('test-token');
        const unsafeMessage = {
            id: 'message-id',
            attachments: [{
                id: 'attachment-id',
                filename: 'asset.png',
                size: 10,
                content_type: 'image/png',
                url: 'https://evil.example/attachments/1/2/asset.png',
                proxy_url: 'https://evil.example/asset.png',
            }],
        };
        assert.strictEqual(api.getFileInfo(unsafeMessage), null);
        api.getMessage = async () => unsafeMessage;
        assert.strictEqual(await api.getFileURL('channel', 'message'), null);
    });

    it('serves safe media inline but forces legacy active content to download with nosniff', () => {
        const imageHeaders = new Headers();
        setCommonHeaders(imageHeaders, 'image.png', 'image/png');
        assert.match(imageHeaders.get('Content-Disposition'), /^inline;/);
        assert.strictEqual(imageHeaders.get('X-Content-Type-Options'), 'nosniff');

        const htmlHeaders = new Headers();
        setCommonHeaders(htmlHeaders, 'payload.html', 'text/html');
        assert.match(htmlHeaders.get('Content-Disposition'), /^attachment;/);
        assert.strictEqual(htmlHeaders.get('X-Content-Type-Options'), 'nosniff');
    });
});
