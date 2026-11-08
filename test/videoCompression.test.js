import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compressVideo, MAX_COMPRESSION_BYTES } from '../frontend-dist/account/video-compression.js';

const workerSource = readFileSync(new URL('../frontend-dist/account/video-compression-worker.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, '');

describe('video compression track selection', function () {
    async function runWorker(discardedTracks) {
        const messages = [];
        let conversionOptions;
        const worker = { postMessage: message => messages.push(message) };
        const video = { canBeTransparent: async () => false, canDecode: async () => true };
        vm.runInNewContext(workerSource, {
            self: worker,
            VideoEncoder: class {}, VideoDecoder: class {},
            ALL_FORMATS: [], BlobSource: class {}, Quality: class {}, Mp4OutputFormat: class {},
            Input: class { async getVideoTracks() { return [video]; } dispose() {} },
            BufferTarget: class { buffer = new ArrayBuffer(4); on() {} },
            Output: class { async cancel() {} },
            Conversion: { async init(options) {
                conversionOptions = options;
                return { isValid: true, discardedTracks, async execute() {}, async cancel() {} };
            } },
        });
        await worker.onmessage({ data: { file: new File(['video with audio'], 'example.mp4'), maxBytes: MAX_COMPRESSION_BYTES } });
        return { messages, conversionOptions };
    }

    it('discards audio while allowing the video conversion to finish', async function () {
        const { messages, conversionOptions } = await runWorker([{ track: { type: 'audio' }, reason: 'discarded_by_user' }]);
        assert.equal(conversionOptions.audio.discard, true);
        assert.equal(conversionOptions.audio.codec, undefined);
        assert.equal(messages.at(-1).type, 'done');
    });

    it('still rejects discarded video and unexpectedly discarded audio', async function () {
        for (const discarded of [
            { track: { type: 'video' }, reason: 'no_encodable_target_codec' },
            { track: { type: 'audio' }, reason: 'undecodable_source_codec' },
        ]) {
            const { messages } = await runWorker([discarded]);
            assert.equal(messages.at(-1).type, 'error');
            assert.equal(messages.at(-1).code, 'unsupported');
        }
    });
});

describe('browser video compression lifecycle', function () {
    let originalWorker;
    let workers;
    beforeEach(function () {
        originalWorker = globalThis.Worker;
        workers = [];
        globalThis.Worker = class {
            constructor(url, options) { this.url = url; this.options = options; workers.push(this); }
            postMessage(message) { this.message = message; }
            terminate() { this.terminated = true; }
            send(data) { this.onmessage({ data }); }
        };
    });
    afterEach(function () {
        if (originalWorker === undefined) delete globalThis.Worker;
        else globalThis.Worker = originalWorker;
    });

    it('cancels encoding and ignores late worker results', async function () {
        const controller = new AbortController();
        const progress = [];
        const task = compressVideo(new File(['source'], 'example.mov'), { signal: controller.signal, onProgress: value => progress.push(value) });
        const worker = workers[0];
        worker.send({ type: 'progress', progress: 0.2 });
        controller.abort();
        await assert.rejects(task, { code: 'aborted' });
        assert.equal(worker.terminated, true);
        worker.send({ type: 'progress', progress: 0.9 });
        worker.send({ type: 'done', buffer: new ArrayBuffer(4) });
        assert.deepEqual(progress, [0.2]);
    });

    it('returns an MP4 file while preserving the local source', async function () {
        const source = new File(['unchanged source'], 'example.mov', { type: 'video/quicktime', lastModified: 123 });
        const task = compressVideo(source);
        workers[0].send({ type: 'done', buffer: new Uint8Array([1, 2, 3]).buffer });
        const compressed = await task;
        assert.equal(compressed.name, 'example.compressed.mp4');
        assert.equal(compressed.type, 'video/mp4');
        assert.equal(compressed.lastModified, 123);
        assert.equal(compressed.size, 3);
        assert.equal(await source.text(), 'unchanged source');
        assert.equal(workers[0].terminated, true);
    });

    it('releases the worker and reports unsupported codecs without creating an upload', async function () {
        const task = compressVideo(new File(['source'], 'example.mp4'));
        workers[0].send({ type: 'error', code: 'unsupported', message: 'No encoder' });
        await assert.rejects(task, { code: 'unsupported' });
        assert.equal(workers[0].terminated, true);
    });

    it('rejects a worker crash and releases the encoding task', async function () {
        const task = compressVideo(new File(['source'], 'example.mp4'));
        let prevented = false;
        workers[0].onerror({ preventDefault() { prevented = true; } });
        await assert.rejects(task, { code: 'failed' });
        assert.equal(prevented, true);
        assert.equal(workers[0].terminated, true);
    });

    it('does not start a worker for an already canceled or oversized input', async function () {
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(compressVideo(new File(['source'], 'example.mp4'), { signal: controller.signal }), { code: 'aborted' });
        const source = new File(['source'], 'example.mp4');
        Object.defineProperty(source, 'size', { value: MAX_COMPRESSION_BYTES + 1 });
        await assert.rejects(compressVideo(source), { code: 'too_large' });
        assert.equal(workers.length, 0);
    });
});
