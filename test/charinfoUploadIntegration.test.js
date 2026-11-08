import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://imgbed-staging.uika.cc.cd';
const connectionId = '1'.repeat(48);
const proof = '2'.repeat(64);
const parentOrigin = 'http://192.168.1.41:8000';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

describe('upload HTTP routes with native Worker D1, R2 and streaming crypto', function () {
    this.timeout(60000);
    let runtime, db, sessionId, launchCookie;
    before(async () => {
        const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser', stdin: {
            resolveDir: fileURLToPath(new URL('..', import.meta.url)),
            contents: `import { onRequestPost as pair } from './functions/api/charinfo-upload/pair.js';
                import { onRequestPost as auth } from './functions/api/charinfo-upload/auth.js';
                import { onRequestPost as launch } from './functions/api/charinfo-upload/launch.js';
                import { onRequestPost as gallery } from './functions/api/charinfo-upload/gallery.js';
                import { onRequestPost as file } from './functions/api/charinfo-upload/file.js';
                import { onRequestGet as pack } from './functions/api/public/album-gallery/[albumId].js';
                export default { async fetch(request,env,ctx) {
                    const path=new URL(request.url).pathname;
                    const context={request,env,waitUntil:ctx.waitUntil.bind(ctx)};
                    if(path.startsWith('/api/public/album-gallery/')) return pack({...context,params:{albumId:path.split('/').pop()}});
                    const handler={pair,auth,launch,gallery,file}[path.split('/').pop()];
                    return request.method==='POST'&&handler?handler(context):new Response('Not found',{status:404});
                } };`,
        } });
        runtime = new Miniflare(convertV4MiniflareOptions({ name: 'upload-integration', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-25',
            d1Databases: ['img_d1'], kvNamespaces: ['img_url'], r2Buckets: ['img_r2', 'CHARINFO_UPLOAD_STAGING'] }));
        db = await runtime.getD1Database('img_d1');
        const schema = readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, '');
        for (const statement of schema.match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g) || []) await db.prepare(statement).run();
        await db.prepare("INSERT INTO users(discord_id,username,role,status,created_at,updated_at) VALUES ('a','Test player','member','active',1,1)").run();
        const kv = await runtime.getKVNamespace('img_url');
        await kv.put('manage@session@test-session', JSON.stringify({ authType: 'user', expiresAt: Date.now() + 600000, identity: { id: 'a' } }));
        await kv.put('manage@sysConfig@page', JSON.stringify({ config: [{ id: 'defaultUploadChannel', value: 'cfr2' }] }));
    });
    after(async () => { await runtime?.dispose(); });

    async function post(path, body, { login = false, secret = proof, suppliedOrigin = origin } = {}) {
        return runtime.dispatchFetch(origin + path, { method: 'POST', headers: { Origin: suppliedOrigin,
            'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...(secret ? { 'X-CharInfo-Pair-Proof': secret } : {}),
            ...((login || launchCookie) ? { Cookie: [login ? 'user_session=test-session' : '', launchCookie || ''].filter(Boolean).join('; ') } : {}) }, body: JSON.stringify(body) });
    }
    const auth = (action, fields = {}, options) => post('/api/charinfo-upload/auth', { action, connectionId, ...fields }, options);
    const gallery = (action, requestId, fields = {}) => post('/api/charinfo-upload/gallery', { action, requestId, connectionId, sessionId, ...fields });

    it('requires actual consent and a private proof before any upload route can run', async () => {
        assert.equal((await post('/api/charinfo-upload/pair', { connectionId, parentOrigin, proof })).status, 200);
        assert.deepEqual(await (await auth('status')).json(), { connected: false });
        assert.equal((await auth('approve', {}, { login: true, secret: null })).status, 403);
        assert.equal((await auth('approve')).status, 403);
        const launched = await runtime.dispatchFetch(origin + '/api/charinfo-upload/launch', { method: 'POST', redirect: 'manual',
            headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate', 'MF-Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
                'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ connectionId, proof }).toString() });
        assert.equal(launched.status, 303, await launched.clone().text());
        launchCookie = launched.headers.get('Set-Cookie').split(';')[0];
        const inspection = await auth('inspect', {}, { login: true, secret: null });
        assert.equal(inspection.status, 200);
        const inspectedAccountId = (await inspection.json()).accountId;
        assert.equal((await auth('approve', { accountId: inspectedAccountId }, { login: true })).status, 200);
        sessionId = (await (await auth('status')).json()).sessionId;
        assert.ok(sessionId);
    });

    it('streams two files, returns the real public pack, resumes without duplication and preserves removed originals', async () => {
        const files = ['one', 'two'].map(id => ({ id, title: id, name: `${id}.png`, type: 'image/png', size: png.length }));
        files[1].nsfw = true;
        const order = [{ uploadId: 'two' }, { uploadId: 'one' }];
        let response = await gallery('prepare', 'native_save', { albumId: null, characterName: '测试角色', files, order });
        assert.equal(response.status, 200, await response.clone().text());
        const prepared = await response.json();
        for (const item of files) {
            response = await runtime.dispatchFetch(origin + '/api/charinfo-upload/file?' + new URLSearchParams({ connection_id: connectionId, request_id: 'native_save', upload_id: item.id }),
                { method: 'POST', headers: { Origin: origin, 'Content-Type': item.type, 'X-CharInfo-Pair-Proof': proof, 'X-CharInfo-Session': sessionId }, body: png });
            assert.equal(response.status, 200, await response.clone().text());
        }
        let result;
        for (let step = 0; step < 4; step++) {
            response = await gallery('commit', 'native_save');
            assert.equal(response.status, 200, await response.clone().text());
            result = await response.json();
            if (!result.pending) break;
        }
        assert.equal(result.albumId, prepared.albumId);
        assert.equal(result.items.length, 2);
        assert.equal(result.remoteGalleryUrl, `${origin}/api/public/album-gallery/${result.albumId}`);
        const packResponse = await runtime.dispatchFetch(result.remoteGalleryUrl);
        assert.equal(packResponse.status, 200);
        const pack = await packResponse.json();
        assert.deepEqual(result.items.map(item => item.url), pack.gallery.map(item => item.sources[0]));
        const stored = await db.prepare("SELECT id, json_type(metadata, '$.NSFW') AS nsfw FROM files").all();
        const flagged = stored.results.filter(file => file.nsfw === 'true');
        assert.equal(flagged.length, 1);
        assert.ok(new URL(result.items[0].url).pathname.endsWith(`/${flagged[0].id}`));
        assert.deepEqual(await (await gallery('prepare', 'native_save', { albumId: null, characterName: '测试角色', files, order })).json(), result);
        const changed = await gallery('prepare', 'native_save', { albumId: null, characterName: '测试角色', files: [files[0], { ...files[1], nsfw: false }], order });
        assert.equal((await changed.json()).code, 'REQUEST_MISMATCH');
        assert.equal((await db.prepare("SELECT used_bytes FROM users WHERE discord_id='a'").first()).used_bytes, png.length * 2);
        assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM files').first()).count, 2);
        const read = await (await gallery('read', 'native_read', { albumId: result.albumId, characterName: '测试角色' })).json();
        assert.deepEqual(read.items, result.items);
        assert.equal((await gallery('prepare', 'native_reorder', { albumId: result.albumId, characterName: '测试角色', files: [], order: [{ itemId: result.items[1].id }] })).status, 200);
        const reordered = await (await gallery('commit', 'native_reorder')).json();
        assert.deepEqual(reordered.items.map(item => item.id), [result.items[1].id]);
        assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM files').first()).count, 2);
    });

    it('keeps cross-site calls and revoked sessions rejected by the real HTTP wrappers', async () => {
        const unexpected = await gallery('read', 'bad_fields', { albumId: '12345678-1234-4234-8234-123456789abc', characterName: '测试角色', biography: 'Must not be accepted' });
        assert.equal(unexpected.status, 400);
        assert.equal((await unexpected.json()).code, 'BAD_REQUEST');
        assert.equal((await auth('status', {}, { suppliedOrigin: 'https://evil.example' })).status, 403);
        assert.equal((await auth('disconnect', { sessionId })).status, 200);
        const response = await gallery('commit', 'native_save');
        assert.equal(response.status, 401);
        assert.equal((await response.json()).code, 'AUTH_REQUIRED');
    });
});
