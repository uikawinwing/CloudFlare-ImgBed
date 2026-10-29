import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality } from './vendor/mediabunny.mjs';

function compressionError(code, message) {
    return Object.assign(new Error(message), { code });
}

self.onmessage = async ({ data: { file, maxBytes } }) => {
    let input;
    let output;
    let conversion;
    try {
        if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
            throw compressionError('unsupported', 'This browser does not support video encoding.');
        }
        input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
        const videos = await input.getVideoTracks();
        if (!videos.length) throw compressionError('unsupported', 'No supported video track was found.');
        for (const track of videos) {
            if (await track.canBeTransparent()) throw compressionError('unsupported', 'Transparent video cannot be preserved in H.264 MP4.');
            if (!await track.canDecode()) throw compressionError('unsupported', 'This browser cannot decode the source video.');
        }

        const target = new BufferTarget();
        target.on('write', ({ end }) => {
            if (end > maxBytes) throw compressionError('too_large', 'Compressed output exceeds the browser memory limit.');
        });
        output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
        conversion = await Conversion.init({
            input,
            output,
            video: { codec: 'avc', quality: new Quality(0.55), forceTranscode: true },
            audio: { discard: true },
        });
        if (!conversion.isValid || conversion.discardedTracks.some(({ track, reason }) => track.type !== 'audio' || reason !== 'discarded_by_user')) {
            throw compressionError('unsupported', 'This browser cannot preserve every video track in MP4.');
        }
        let lastProgress = -1;
        conversion.onProgress = (value) => {
            const progress = Math.floor(value * 100) / 100;
            if (progress > lastProgress) {
                lastProgress = progress;
                self.postMessage({ type: 'progress', progress });
            }
        };
        await conversion.execute();
        const buffer = target.buffer;
        if (!buffer?.byteLength) throw compressionError('failed', 'Video compression returned an empty file.');
        if (buffer.byteLength > maxBytes) throw compressionError('too_large', 'Compressed output exceeds the browser memory limit.');
        self.postMessage({ type: 'done', buffer }, [buffer]);
    } catch (error) {
        if (conversion) await conversion.cancel().catch(() => {});
        else if (output) await output.cancel().catch(() => {});
        self.postMessage({ type: 'error', code: error.code || (error.name === 'UnsupportedInputFormatError' ? 'unsupported' : 'failed'), message: error.message || 'Video compression failed.' });
    } finally {
        input?.dispose();
    }
};
