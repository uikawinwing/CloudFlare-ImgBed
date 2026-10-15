import assert from 'node:assert/strict';
import { compressVideo, MAX_COMPRESSION_BYTES } from '../frontend-dist/account/video-compression.js';

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
