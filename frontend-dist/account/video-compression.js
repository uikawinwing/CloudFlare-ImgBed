export const MAX_COMPRESSION_BYTES = 95 * 1024 * 1024;

function compressionError(code, message) {
    return Object.assign(new Error(message), { code });
}

export function compressVideo(file, { onProgress = () => {}, signal } = {}) {
    if (signal?.aborted) return Promise.reject(compressionError('aborted', 'Compression canceled.'));
    if (!(file instanceof File) || !file.size) return Promise.reject(compressionError('failed', 'Invalid video file.'));
    if (file.size > MAX_COMPRESSION_BYTES) return Promise.reject(compressionError('too_large', 'Video exceeds the browser compression limit.'));
    if (typeof Worker === 'undefined') return Promise.reject(compressionError('unsupported', 'Video compression is unavailable in this browser.'));

    return new Promise((resolve, reject) => {
        let worker;
        let settled = false;
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', abort);
            worker?.terminate();
            if (error) reject(error);
            else resolve(result);
        };
        const abort = () => finish(compressionError('aborted', 'Compression canceled.'));
        try {
            worker = new Worker(new URL('./video-compression-worker.js', import.meta.url), { type: 'module' });
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) return abort();
            worker.onerror = (event) => {
                event.preventDefault();
                finish(compressionError('failed', 'The video compressor could not run.'));
            };
            worker.onmessageerror = () => finish(compressionError('failed', 'The video compressor returned an invalid result.'));
            worker.onmessage = ({ data }) => {
                if (settled) return;
                if (data.type === 'progress') {
                    try { onProgress(Math.max(0, Math.min(1, data.progress))); }
                    catch (error) { finish(error); }
                } else if (data.type === 'done') {
                    const name = file.name.replace(/\.[^.]*$/, '') + '.compressed.mp4';
                    finish(null, new File([data.buffer], name, { type: 'video/mp4', lastModified: file.lastModified }));
                } else if (data.type === 'error') {
                    finish(compressionError(data.code, data.message));
                }
            };
            worker.postMessage({ file, maxBytes: MAX_COMPRESSION_BYTES });
        } catch (error) {
            finish(compressionError('failed', error.message || 'The video compressor could not start.'));
        }
    });
}
