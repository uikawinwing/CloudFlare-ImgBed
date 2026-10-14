import assert from 'node:assert/strict';
import { getUploadConfig, onRequest as saveUploadConfig } from '../functions/api/manage/sysConfig/upload.js';
import { onRequestPost as getUploadUrl } from '../functions/upload/huggingface/getUploadUrl.js';
import { onRequestPost as commitUpload } from '../functions/upload/huggingface/commitUpload.js';
import { onRequestPost as completeMultipart } from '../functions/upload/huggingface/completeMultipart.js';
import { onRequest as webdav } from '../functions/dav/[[path]].js';
import { getOthersConfig, onRequest as saveOthersConfig } from '../functions/api/manage/sysConfig/others.js';
import { deleteFile } from '../functions/api/manage/delete/[[path]].js';
import { DiscordAPI } from '../functions/utils/storage/discordAPI.js';

describe('phase 1 storage retirement', () => {
    it('rejects retired upload and DAV routes before touching storage', async () => {
        for (const handler of [getUploadUrl, commitUpload, completeMultipart, webdav]) {
            const response = await handler({});
            assert.equal(response.status, 410);
        }
    });

    it('omits retired storage UI slots without returning their credentials', async () => {
        const config = await getUploadConfig({ get: async () => JSON.stringify({ s3: { channels: [{ secretAccessKey: 'retired' }] }, webdav: { channels: [{ password: 'retired' }] } }) }, { img_r2: {} });
        assert.equal(config.s3, undefined);
        assert.equal(config.webdav, undefined);
        assert.ok(!JSON.stringify(config).includes('retired'));
        assert.equal(config.cfr2.channels.length, 1);
    });

    it('drops retired backend settings when an old payload is saved', async () => {
        let saved;
        const response = await saveUploadConfig({
            env: { img_url: { get: async () => null, put: async (key, value) => { saved = JSON.parse(value); } } },
            request: new Request('https://example.test/api/manage/sysConfig/upload', { method: 'POST', body: JSON.stringify({ telegram: { channels: [], loadBalance: { enabled: false, channels: [] } }, s3: { channels: ['retired'] }, webdav: { channels: ['retired'] } }) }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(saved, { telegram: { channels: [], loadBalance: { enabled: false, channels: [] } }, cfr2: { channels: [], loadBalance: { enabled: false, channels: [] } }, discord: { channels: [], loadBalance: { enabled: false, channels: [] } }, huggingface: { channels: [], loadBalance: { enabled: false, channels: [] } } });
    });

    it('keeps retired file records when their physical storage cannot be deleted', async () => {
        for (const channel of ['S3', 'WebDAV']) {
            const env = { img_url: {
                get: async () => null,
                getWithMetadata: async () => ({ value: '', metadata: { Channel: channel } }),
                delete: async () => { throw new Error('Retired record must remain'); },
            } };
            assert.equal(await deleteFile(env, 'legacy.png', 'https://example.test/file/legacy.png', new URL('https://example.test')), false);
        }
    });

    it('revokes the old DAV token on settings save without exposing WebDAV in GET', async () => {
        const values = new Map([
            ['manage@sysConfig@others', JSON.stringify({ webDAV: { enabled: true, internalToken: 'retired-secret', internalTokenId: 'dav-token', password: 'retired-secret' } })],
            ['manage@sysConfig@security', JSON.stringify({ apiTokens: { tokens: { 'dav-token': { token: 'retired-secret' }, keep: { token: 'keep' } } } })],
        ]);
        const kv = { get: async key => values.get(key) || null, put: async (key, value) => values.set(key, value) };
        const settings = await getOthersConfig(kv, {});
        assert.equal(settings.webDAV, undefined);
        assert.ok(!JSON.stringify(settings).includes('retired-secret'));
        const response = await saveOthersConfig({ env: { img_url: kv }, request: new Request('https://example.test/api/manage/sysConfig/others', { method: 'POST', body: JSON.stringify(settings) }) });
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(values.get('manage@sysConfig@others')).webDAV, undefined);
        assert.deepEqual(Object.keys(JSON.parse(values.get('manage@sysConfig@security')).apiTokens.tokens), ['keep']);
    });
});

describe('Discord bot upload limits', () => {
    let originalFetch;
    beforeEach(() => { originalFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('reports Discord HTTP and JSON size-limit errors as 413', async () => {
        for (const [status, body] of [[413, ''], [400, JSON.stringify({ code: 40005, message: 'Request entity too large' })]]) {
            globalThis.fetch = async () => new Response(body, { status });
            await assert.rejects(new DiscordAPI('bot').sendFile(new Blob(['image']), 'channel'), error => error.status === 413 && /upload limit/.test(error.message));
        }
        globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Missing permissions' }), { status: 403 });
        await assert.rejects(new DiscordAPI('bot').sendFile(new Blob(['image']), 'channel'), error => error.status === 403);
    });

    it('uploads small files without extra channel or guild lookups', async () => {
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push([String(url), options.method]);
            return new Response(JSON.stringify({ id: 'message' }));
        };
        await new DiscordAPI('bot').sendFile(new Blob(['image']), 'channel', 'file.png');
        assert.deepEqual(calls, [['https://discord.com/api/v10/channels/channel/messages', 'POST']]);
    });
});
