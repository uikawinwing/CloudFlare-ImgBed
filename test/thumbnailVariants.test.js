import assert from 'assert';
import sharp from 'sharp';
import { dockerImageProcessor } from '../deploy/server/imageProcessor.js';
import {
    THUMBNAIL_CONTENT_TYPE,
    THUMBNAIL_VARIANTS,
    absoluteThumbnailUrl,
    createThumbnailTransform,
    ensurePermanentThumbnail,
    thumbnailContentVersion,
    thumbnailVariantUrls,
} from '../functions/utils/thumbnail.js';

describe('thumbnail variants', () => {
    it('defines WebP avatar, library, and gallery variants at 160, 256, and 720 pixels', () => {
        assert.deepStrictEqual(
            Object.fromEntries(Object.entries(THUMBNAIL_VARIANTS).map(([name, variant]) => [name, {
                width: variant.width,
                outputFormat: variant.outputFormat,
            }])),
            {
                avatar: { width: 160, outputFormat: THUMBNAIL_CONTENT_TYPE },
                library: { width: 256, outputFormat: THUMBNAIL_CONTENT_TYPE },
                gallery: { width: 720, outputFormat: THUMBNAIL_CONTENT_TYPE },
            }
        );
    });

    it('uses one scale-down WebP transform description and never upscales smaller originals', async () => {
        assert.deepStrictEqual(createThumbnailTransform({ Width: 120 }, 'avatar'), {
            requested: true,
            options: { width: 120, fit: 'scale-down' },
            outputFormat: THUMBNAIL_CONTENT_TYPE,
            fallback: null,
        });
        assert.deepStrictEqual(createThumbnailTransform({ Width: 800 }, 'library').options, {
            width: 256,
            fit: 'scale-down',
        });
        assert.deepStrictEqual(createThumbnailTransform({ Width: 1200 }).options, {
            width: 720,
            fit: 'scale-down',
        });
        const input = await sharp({
            create: { width: 80, height: 40, channels: 4, background: '#336699' },
        }).png().toBuffer();
        const response = await dockerImageProcessor.transform(new Blob([input]).stream(), {
            width: 160,
            fit: 'scale-down',
            sourceType: 'image/png',
            outputFormat: 'image/webp',
        });
        const output = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
        assert.strictEqual(output.width, 80);
        assert.strictEqual(output.height, 40);
        assert.strictEqual(output.format, 'webp');
    });

    it('keeps the legacy gallery URL while generating stable avatar and library URLs', () => {
        const requestUrl = 'http://example.test/api/public/gallery/master/elfa1?ignored=value';
        assert.strictEqual(absoluteThumbnailUrl(requestUrl, 'portrait.png'), 'https://example.test/thumb/portrait.png');
        assert.strictEqual(absoluteThumbnailUrl(requestUrl, 'portrait.png', 'gallery'), 'https://example.test/thumb/portrait.png');
        assert.strictEqual(absoluteThumbnailUrl(requestUrl, 'portrait.png', 'avatar'), 'https://example.test/thumb/portrait.png?variant=avatar');
        assert.strictEqual(absoluteThumbnailUrl(requestUrl, 'portrait.png', 'library'), 'https://example.test/thumb/portrait.png?variant=library');
        assert.strictEqual(absoluteThumbnailUrl(requestUrl, 'portrait.png', 'gallery', 123), 'https://example.test/thumb/portrait.png?v=123');
        assert.strictEqual(absoluteThumbnailUrl(requestUrl, 'portrait.png', 'avatar', 123), 'https://example.test/thumb/portrait.png?variant=avatar&v=123');
        assert.notStrictEqual(
            absoluteThumbnailUrl(requestUrl, 'portrait.png', 'library', 123),
            absoluteThumbnailUrl(requestUrl, 'portrait.png', 'library', 124),
        );
    });

    it('encodes nested file-id path segments without changing the selected variant', () => {
        const url = absoluteThumbnailUrl(
            'https://example.test/x',
            'users/589790434960867328/a b#1.png',
            'library',
            456,
        );
        assert.strictEqual(url, 'https://example.test/thumb/users/589790434960867328/a%20b%231.png?variant=library&v=456');
        assert.deepStrictEqual(thumbnailVariantUrls('https://example.test/x', 'users/master/a b.png', 456), [
            'https://example.test/thumb/users/master/a%20b.png?variant=avatar&v=456',
            'https://example.test/thumb/users/master/a%20b.png?variant=library&v=456',
            'https://example.test/thumb/users/master/a%20b.png?v=456',
        ]);
    });

    it('allows private images with an existing permanent thumbnail through the generation precondition', async () => {
        const metadata = {
            Visibility: 'private',
            FileType: 'image/png',
            Thumbnail: { Channel: 'Discord', DiscordMessageId: 'message-id' },
        };
        const result = await ensurePermanentThumbnail({ env: {}, request: new Request('https://example.test/upload') }, 'private.png', metadata);
        assert.deepStrictEqual(result, { metadata, ready: true, created: false });
    });

    it('changes the immutable URL version when the permanent thumbnail source is created', () => {
        assert.strictEqual(thumbnailContentVersion({ TimeStamp: 123 }), '123');
        assert.strictEqual(thumbnailContentVersion({
            TimeStamp: 123,
            Thumbnail: { CreatedAt: 456 },
        }), '456');
        assert.strictEqual(thumbnailContentVersion({
            timestamp: 123,
            thumbnail_created_at: 456,
        }), '456');
    });
});
