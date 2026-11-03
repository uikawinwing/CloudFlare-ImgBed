import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { TestD1 } from './helpers/d1.js';
import { onRequestGet as publicGallery } from '../functions/api/public/album-gallery/[albumId].js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const origin = 'https://imgbed.example';
const connectionId = 'c'.repeat(48);
const grantHash = 'd'.repeat(64);
const identity = { id: 'a', role: 'member', _uploadAuthorization: { connectionId, sessionId: 'upload-session', grantHash } };
const knownAlbum = '12345678-1234-4234-8234-123456789abc';
let operations;

class DigestStream extends WritableStream {
    constructor() {
        const hash = createHash('sha256');
        let resolve, reject;
        const digest = new Promise((yes, no) => { resolve = yes; reject = no; });
        super({ write: chunk => hash.update(chunk), close: () => resolve(hash.digest()), abort: error => reject(error) });
        this.digest = digest;
    }
}

class FixedLengthStream {
    constructor(length) {
        let size = 0;
        const stream = new TransformStream({ transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > length) throw new Error('Fixed length exceeded');
            controller.enqueue(chunk);
        }, flush() { if (size !== length) throw new Error('Fixed length mismatch'); } });
        this.readable = stream.readable;
        this.writable = stream.writable;
    }
}

function bucket() {
    const values = new Map();
    let puts = 0;
    return {
        values, get puts() { return puts; },
        async put(key, body, options = {}) {
            puts++;
            if (options.onlyIf && values.has(key)) return null;
            const bytes = new Uint8Array(await new Response(body).arrayBuffer());
            const item = { bytes, size: bytes.byteLength, etag: createHash('sha256').update(bytes).digest('hex'), customMetadata: options.customMetadata || {} };
            values.set(key, item);
            return { ...item };
        },
        async head(key) { const item = values.get(key); return item ? { ...item } : null; },
        async get(key) {
            const item = values.get(key);
            return item ? { ...item, body: new Blob([item.bytes]).stream(), blob: async () => new Blob([item.bytes]) } : null;
        },
        async delete(key) { for (const item of Array.isArray(key) ? key : [key]) values.delete(item); },
    };
}

function fixture(channel = 'cfr2') {
    const kvWrites = { put: 0, delete: 0 };
    const db = new TestD1();
    const originalPrepare = db.prepare.bind(db);
    db.prepare = sql => {
        const statement = originalPrepare(sql);
        const originalBind = statement.bind.bind(statement);
        statement.bind = (...params) => originalBind(...params.map(value => typeof value === 'boolean' ? Number(value) : value));
        return statement;
    };
    db.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO users (discord_id,username,created_at,updated_at) VALUES ('a','A',1,1),('b','B',1,1)`);
    const now = Date.now();
    for (const [key, value, type] of [
        [`charinfo-upload:pair:${connectionId}`, { userId: 'a', parentOrigin: 'http://localhost:8000', status: 'approved', sessionId: 'upload-session', grantHash, sessionExpiresAt: now + 12 * 60 * 1000 }, 'charinfo_upload_pair'],
        [`charinfo-upload:grant:${grantHash}`, { userId: 'a', parentOrigin: 'http://localhost:8000', revoked: false, expiresAt: now + 24 * 60 * 60 * 1000 }, 'charinfo_upload_grant'],
    ]) db.db.prepare('INSERT INTO other_data (key,value,type) VALUES (?,?,?)').run(key, JSON.stringify(value), type);
    const config = new Map([
        ['manage@sysConfig@page', JSON.stringify({ config: [{ id: 'defaultUploadChannel', value: channel }] })],
        ['manage@sysConfig@upload', JSON.stringify({
            telegram: { channels: [{ name: 'TG', enabled: true, botToken: 'test-token', chatId: 'test-chat' }], loadBalance: { enabled: false } },
            discord: { channels: [{ name: 'Discord', enabled: true, botToken: 'test-token', channelId: 'test-channel' }], loadBalance: { enabled: false } },
        })],
    ]);
    const staging = bucket();
    const originals = bucket();
    const env = { img_d1: db, img_r2: originals, CHARINFO_UPLOAD_STAGING: staging,
        img_url: { get: async key => config.get(key) ?? null,
            put: async (key, value) => { kvWrites.put++; return config.set(key, value); },
            delete: async key => { kvWrites.delete++; return config.delete(key); } } };
    let authorized = true;
    const authorize = async () => {
        if (!authorized) throw Object.assign(new Error('Authorization required'), { code: 'AUTH_REQUIRED' });
        return identity;
    };
    const base = { env, identity, authorize, requestUrl: origin };
    const input = (requestId = 'save_1', count = 1) => ({ requestId, albumId: null, characterName: '旅行者',
        files: Array.from({ length: count }, (_, i) => ({ id: `upload_${i}`, title: `图片 ${i}`, name: `image${i}.png`, type: 'image/png', size: PNG.length })),
        order: Array.from({ length: count }, (_, i) => ({ uploadId: `upload_${i}` })) });
    const prepare = body => operations.prepareUploadOperation({ ...base, body });
    const stage = (requestId = 'save_1', uploadId = 'upload_0', file = new File([PNG], 'image0.png', { type: 'image/png' })) => operations.stageUploadOperationFile({ ...base, requestId, uploadId, file });
    const commit = (requestId = 'save_1', override = {}) => operations.commitUploadOperation({ ...base, requestId, ...override });
    const ledger = () => JSON.parse(db.db.prepare("SELECT value FROM other_data WHERE type = 'charinfo_upload' ORDER BY rowid DESC LIMIT 1").get().value);
    const count = table => db.db.prepare(`SELECT COUNT(*) AS count FROM ${table}${table === 'other_data' ? " WHERE type='charinfo_upload'" : ''}`).get().count;
    const used = () => db.db.prepare("SELECT used_bytes FROM users WHERE discord_id='a'").get().used_bytes;
    const addFile = (id, owner = 'a', position = 0) => {
        const metadata = { OwnerId: owner, FileType: 'image/png', FileName: id.split('/').pop(), FileSizeBytes: PNG.length, Channel: 'CloudflareR2', ModerationStatus: 'active', ListType: 'None', Label: 'None' };
        db.db.prepare(`INSERT INTO files (id,metadata,file_name,file_type,file_size_bytes,owner_id,visibility,moderation_status,timestamp)
            VALUES (?,?,?,'image/png',?,?,'public','active',1)`).run(id, JSON.stringify(metadata), metadata.FileName, PNG.length, owner);
        db.db.prepare('INSERT INTO album_items (album_id,file_id,position,created_at) VALUES (?,?,?,1)').run(knownAlbum, id, position);
    };
    const addAlbum = (owner = 'a') => db.db.prepare(`INSERT INTO albums (id,owner_id,slug,name,char_info_character_name,created_at,updated_at)
        VALUES (?,?,'traveler','旅行者','旅行者',1,1)`).run(knownAlbum, owner);
    return { ...base, db, staging, originals, config, kvWrites, input, prepare, stage, commit, ledger, count, used, addAlbum, addFile,
        revoke: () => { authorized = false; }, grant: () => { authorized = true; } };
}

describe('durable CharInfo upload operations', function () {
    this.timeout(10000);
    let oldFetch, oldCaches, oldDigest, oldFixed;
    before(async () => {
        const bundled = await build({ entryPoints: ['functions/utils/charinfoUploadOperations.js'], bundle: true, write: false, format: 'cjs', platform: 'browser' });
        const module = { exports: {} };
        new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
        operations = module.exports;
    });
    beforeEach(() => {
        oldFetch = globalThis.fetch;
        oldCaches = globalThis.caches;
        oldDigest = crypto.DigestStream;
        oldFixed = globalThis.FixedLengthStream;
        crypto.DigestStream = DigestStream;
        globalThis.FixedLengthStream = FixedLengthStream;
        globalThis.caches = { default: { delete: async () => true, put: async () => {} } };
        globalThis.fetch = async (url, options) => {
            if (String(url).includes('/getFile?')) return Response.json({ ok: true, result: { file_path: 'photos/image.png' } });
            if (String(url).startsWith('https://api.telegram.org/')) {
                const file = options.body.get('photo') || options.body.get('document');
                return Response.json({ ok: true, result: { document: { file_id: 'telegram-file', file_size: file.size } } });
            }
            if (String(url).startsWith('https://discord.com/')) {
                const file = options.body.get('files[0]');
                return Response.json({ id: 'discord-message', attachments: [{ id: 'attachment', filename: file.name, size: file.size, content_type: file.type,
                    url: 'https://cdn.discordapp.com/attachments/channel/attachment/image.png' }] });
            }
            throw new Error(`Unexpected network request: ${url}`);
        };
    });
    afterEach(() => {
        globalThis.fetch = oldFetch;
        globalThis.caches = oldCaches;
        if (oldDigest === undefined) delete crypto.DigestStream; else crypto.DigestStream = oldDigest;
        if (oldFixed === undefined) delete globalThis.FixedLengthStream; else globalThis.FixedLengthStream = oldFixed;
    });

    it('binds an immutable manifest to actor/request and mints one stable new album identity', async () => {
        const f = fixture();
        const initial = await f.prepare(f.input());
        const repeated = await f.prepare(f.input());
        assert.equal(initial.albumId, repeated.albumId); assert.match(initial.albumId, /^[0-9a-f-]{36}$/);
        const different = f.input(); different.files[0].title = 'changed';
        await assert.rejects(f.prepare(different), { code: 'REQUEST_MISMATCH' });
        assert.equal(f.count('albums'), 0); assert.equal(f.count('files'), 0); assert.equal(f.used(), 0);
        const record = f.ledger(); assert.equal(record.actor, 'a'); assert.match(record.digest, /^[a-f0-9]{64}$/);
        assert.match(record.files[0].fileId, /^users\/a\/[a-f0-9-]{36}\.png$/);
        f.db.db.close();
    });

    it('rejects the full invalid input and aggregate quota before creating a gallery or user file', async () => {
        const mutations = [body => body.files.push(body.files[0]), body => body.order.push(body.order[0]), body => body.order = [],
            body => body.files[0].size = 96 * 1024 * 1024, body => body.files[0].type = 'image/svg+xml',
            body => body.files[0].id = '../bad', body => body.order[0] = { uploadId: 'missing' }, body => body.characterName = ''];
        for (const change of mutations) {
            const f = fixture(); const body = f.input(); change(body);
            await assert.rejects(f.prepare(body), { code: 'INPUT_REJECTED' });
            assert.equal(f.count('albums'), 0); assert.equal(f.count('files'), 0); assert.equal(f.used(), 0); f.db.db.close();
        }
        const f = fixture(); f.db.exec(`UPDATE users SET used_bytes = ${200 * 1024 * 1024 - PNG.length + 1} WHERE discord_id='a'`);
        await assert.rejects(f.prepare(f.input()), { code: 'INPUT_REJECTED' }); assert.equal(f.count('other_data'), 0); f.db.db.close();
    });

    it('streams and validates every new file before reserving quota or publishing anything', async () => {
        const f = fixture(); await f.prepare(f.input('save_1', 2)); await f.stage();
        await assert.rejects(f.commit(), { code: 'STAGING_INCOMPLETE' });
        assert.equal(f.count('files'), 0); assert.equal(f.count('albums'), 0); assert.equal(f.used(), 0);
        const invalid = new File([Buffer.alloc(PNG.length)], 'image1.png', { type: 'image/png' });
        await assert.rejects(f.stage('save_1', 'upload_1', invalid), { code: 'INPUT_REJECTED' });
        assert.equal(f.used(), 0); assert.equal(f.originals.puts, 0); assert.equal(f.ledger().status, 'rejected');
        await assert.rejects(f.commit(), { code: 'INPUT_REJECTED' }); f.db.db.close();
    });

    it('accepts raw request streams without a Blob, checks actual size and binds the server digest', async () => {
        const f = fixture(); await f.prepare(f.input());
        const raw = { type: 'image/png', stream: () => new Blob([PNG.subarray(0, 7), PNG.subarray(7)]).stream() };
        await f.stage('save_1', 'upload_0', raw);
        assert.equal(f.ledger().files[0].digest, createHash('sha256').update(PNG).digest('hex'));
        assert.equal(f.staging.values.size, 1);
        await f.stage('save_1', 'upload_0', raw); assert.equal(f.staging.values.size, 1);
        const changed = Buffer.from(PNG); changed[changed.length - 1] ^= 1;
        await assert.rejects(f.stage('save_1', 'upload_0', { type: 'image/png', stream: () => new Blob([changed]).stream() }), { code: 'REQUEST_MISMATCH' });
        assert.equal(f.staging.values.size, 1); f.db.db.close();
        for (const bytes of [PNG.subarray(1), Buffer.concat([PNG, Buffer.from([1])])]) {
            const bad = fixture(); await bad.prepare(bad.input());
            await assert.rejects(bad.stage('save_1', 'upload_0', { type: 'image/png', stream: () => new Blob([bytes]).stream() }), { code: 'INPUT_REJECTED' });
            assert.equal(bad.count('files'), 0); assert.equal(bad.used(), 0); bad.db.db.close();
        }
    });

    for (const missing of [true, false]) it(`restages the same immutable bytes after the previous staging object is ${missing ? 'expired' : 'mismatched'}`, async () => {
        const f = fixture(); const prepared = await f.prepare(f.input()); await f.stage();
        const before = f.ledger().files[0];
        if (missing) await f.staging.delete(before.stageKey);
        else f.staging.values.get(before.stageKey).etag = 'stale-object';
        await assert.rejects(f.commit(), { code: 'STAGING_MISSING' });
        assert.equal(f.used(), 0); assert.equal(f.originals.puts, 0);
        await f.stage();
        const restored = f.ledger().files[0];
        assert.notEqual(restored.stageKey, before.stageKey);
        assert.equal(restored.digest, before.digest); assert.equal(restored.fileId, before.fileId); assert.equal(restored.state, 'staged');
        const object = await f.staging.head(restored.stageKey);
        assert.equal(object.etag, restored.stageEtag); assert.equal(object.size, PNG.length);
        await f.commit(); const result = await f.commit();
        assert.equal(result.albumId, prepared.albumId); assert.equal(result.items.length, 1);
        assert.equal(f.used(), PNG.length); assert.equal(f.originals.puts, 1); assert.equal(f.count('files'), 1); f.db.db.close();
    });

    it('restages missing bytes without resetting uncertain or inflight external uploads or resending them', async () => {
        for (const channel of ['telegram', 'discord']) for (const state of ['inflight', 'uncertain']) {
            const f = fixture(channel); await f.prepare(f.input()); await f.stage();
            let posts = 0; globalThis.fetch = async () => { posts++; throw new Error('upstream response lost'); };
            await assert.rejects(f.commit(), { code: 'UPLOAD_UNCERTAIN' });
            if (state === 'inflight') f.db.exec("UPDATE other_data SET value=json_set(value,'$.files[0].state','inflight') WHERE type='charinfo_upload'");
            const before = f.ledger().files[0]; await f.staging.delete(before.stageKey);
            await f.stage();
            const restored = f.ledger().files[0];
            assert.notEqual(restored.stageKey, before.stageKey); assert.equal(restored.state, state);
            assert.equal(restored.digest, before.digest); assert.equal(restored.fileId, before.fileId);
            assert.deepEqual(restored.target, before.target); assert.equal(f.ledger().quotaReserved, true);
            await assert.rejects(f.commit(), { code: 'UPLOAD_UNCERTAIN' });
            assert.equal(posts, 1); assert.equal(f.used(), PNG.length); assert.equal(f.count('files'), 0); assert.equal(f.count('albums'), 0);
            f.db.db.close();
        }
    });

    it('preserves completed per-file progress when restoring an expired staging object', async () => {
        const f = fixture(); await f.prepare(f.input('save_1', 2)); await f.stage();
        await f.stage('save_1', 'upload_1', new File([PNG], 'image1.png', { type: 'image/png' }));
        await f.commit(); const before = f.ledger().files[0]; assert.equal(before.state, 'uploaded');
        await f.staging.delete(before.stageKey); const staged = await f.stage();
        assert.equal(staged.completed, 1); assert.equal(f.ledger().files[0].state, 'uploaded');
        await f.commit(); const result = await f.commit(); assert.equal(result.items.length, 2);
        assert.equal(f.originals.puts, 2); assert.equal(f.used(), PNG.length * 2); f.db.db.close();
    });

    for (const channel of ['cfr2', 'telegram', 'discord']) it(`publishes through existing ${channel} logic, charges once and returns canonical ordered public results`, async () => {
        const f = fixture(channel); const prepared = await f.prepare(f.input()); await f.stage();
        const uploaded = await f.commit(); assert.equal(uploaded.pending, true); assert.equal(uploaded.completed, 1);
        assert.equal(f.count('albums'), 0); assert.equal(f.used(), PNG.length);
        const result = await f.commit(); assert.equal(result.albumId, prepared.albumId);
        assert.equal(result.remoteGalleryUrl, `${origin}/api/public/album-gallery/${result.albumId}`);
        assert.equal(result.items.length, 1); assert.match(result.items[0].id, /^[a-f0-9]{64}$/);
        assert.match(result.items[0].title, /^[a-f0-9-]{36}\.png$/); assert.equal(result.items[0].kind, 'image');
        const again = await f.commit(); assert.deepEqual(again, result); assert.equal(f.used(), PNG.length);
        assert.equal(f.count('files'), 1); assert.equal(f.count('albums'), 1); assert.match(f.ledger().finalVersion, /^[a-f0-9]{64}$/);
        const packResponse = await publicGallery({ env: f.env, params: { albumId: result.albumId }, request: new Request(result.remoteGalleryUrl) });
        assert.equal(packResponse.status, 200); const pack = await packResponse.json();
        assert.equal(pack.gallery[0].sources[0], result.items[0].url); assert.equal(pack.gallery[0].title, result.items[0].title);
        const loaded = await operations.readUploadGallery({ env: f.env, identity, authorize: f.authorize, albumId: result.albumId, characterName: '旅行者', requestUrl: origin });
        assert.deepEqual(loaded.items, result.items);
        assert.deepEqual(f.kvWrites, { put: 0, delete: 0 }); f.db.db.close();
    });

    it('recovers an existing account operation after authorization is replaced, preserving uploaded files and quota', async () => {
        const f = fixture(); await f.prepare(f.input('save_1', 2)); await f.stage();
        await f.stage('save_1', 'upload_1', new File([PNG], 'image1.png', { type: 'image/png' }));
        await f.commit(); f.revoke(); await assert.rejects(f.commit(), { code: 'AUTH_REQUIRED' });
        f.grant(); const authorize = async () => identity;
        const status = await f.prepare(f.input('save_1', 2)); assert.equal(status.completed, 1);
        await f.commit('save_1', { authorize }); const result = await f.commit('save_1', { authorize });
        assert.equal(result.items.length, 2); assert.equal(f.used(), PNG.length * 2); assert.equal(f.originals.puts, 2); f.db.db.close();
    });

    it('reuses a specified owned gallery, maps ASCII member IDs and only unlinks omitted originals', async () => {
        const f = fixture(); f.addAlbum(); f.addFile('old-a.png'); f.addFile('old-b.png', 'a', 1);
        const read = await operations.readUploadGallery({ env: f.env, identity, authorize: f.authorize, albumId: knownAlbum, characterName: '旅行者', requestUrl: origin });
        assert.match(read.items[0].id, /^[a-f0-9]{64}$/); assert.notEqual(read.items[0].id, 'old-a.png');
        const body = { requestId: 'reorder', albumId: knownAlbum, characterName: '旅行者', files: [], order: [{ itemId: read.items[1].id }] };
        await f.prepare(body); const result = await f.commit('reorder');
        assert.equal(result.albumId, knownAlbum); assert.equal(result.items.length, 1); assert.equal(f.count('files'), 2);
        assert.equal(f.db.db.prepare('SELECT file_id FROM album_items').get().file_id, 'old-b.png'); assert.equal(f.used(), 0); f.db.db.close();
    });

    it('rejects foreign owners and character mismatches without leaking gallery members', async () => {
        for (const [owner, name] of [['b', '旅行者'], ['a', '另一个人']]) {
            const f = fixture(); f.addAlbum(owner); f.addFile('old.png', owner);
            await assert.rejects(operations.readUploadGallery({ ...f, albumId: knownAlbum, characterName: name, requestUrl: origin }), { code: 'GALLERY_UNAVAILABLE' });
            const body = f.input(); body.albumId = knownAlbum; body.characterName = name;
            await assert.rejects(f.prepare(body), { code: 'GALLERY_UNAVAILABLE' }); assert.equal(f.count('other_data'), 0); f.db.db.close();
        }
    });

    it('detects member changes even if the ordinary album updated_at is unchanged', async () => {
        const f = fixture(); f.addAlbum(); f.addFile('old-a.png'); f.addFile('old-b.png', 'a', 1);
        const read = await operations.readUploadGallery({ ...f, albumId: knownAlbum, characterName: '旅行者', requestUrl: origin });
        await f.prepare({ requestId: 'reorder', albumId: knownAlbum, characterName: '旅行者', files: [], order: [{ itemId: read.items[1].id }, { itemId: read.items[0].id }] });
        f.db.exec('UPDATE album_items SET position=position+10');
        await assert.rejects(f.commit('reorder'), { code: 'GALLERY_CONFLICT' });
        assert.equal(f.db.db.prepare('SELECT MIN(position) AS position FROM album_items').get().position, 10);
        assert.equal(f.ledger().result, undefined); f.db.db.close();
    });

    it('enforces durable leases and cancellation fences while permitting explicit later resume', async () => {
        const f = fixture(); await f.prepare(f.input()); await f.stage();
        const originalPut = f.originals.put.bind(f.originals);
        let release, started;
        const startedPromise = new Promise(resolve => { started = resolve; });
        f.originals.put = async (...args) => { started(); await new Promise(resolve => { release = resolve; }); return originalPut(...args); };
        const pending = f.commit(); await startedPromise;
        await assert.rejects(f.commit(), { code: 'OPERATION_BUSY' });
        await operations.cancelUploadOperation({ ...f, requestId: 'save_1' }); release();
        await assert.rejects(pending, { code: 'OPERATION_BUSY' }); assert.equal(f.count('albums'), 0);
        f.originals.put = originalPut;
        await f.commit(); const result = await f.commit(); assert.equal(result.items.length, 1); assert.equal(f.used(), PNG.length); assert.equal(f.originals.puts, 1); f.db.db.close();
    });

    it('never resends unknown Telegram or Discord uploads and never reports their failures as input rejection', async () => {
        for (const channel of ['telegram', 'discord']) {
            const f = fixture(channel); await f.prepare(f.input()); await f.stage();
            let posts = 0; globalThis.fetch = async () => { posts++; throw new Error('upstream response lost'); };
            await assert.rejects(f.commit(), { code: 'UPLOAD_UNCERTAIN', fileId: 'upload_0' });
            await assert.rejects(f.commit(), { code: 'UPLOAD_UNCERTAIN' });
            assert.equal(posts, 1); assert.equal(f.used(), PNG.length); assert.equal(f.count('files'), 0); assert.equal(f.count('albums'), 0);
            assert.equal(f.staging.values.size, 1); assert.equal(f.ledger().files[0].state, 'uncertain'); f.db.db.close();
        }
    });

    it('rolls back final gallery and result writes atomically on database failure', async () => {
        const f = fixture(); await f.prepare(f.input()); await f.stage(); await f.commit();
        f.db.failOnStatement = 2;
        await assert.rejects(f.commit(), /forced batch failure/);
        assert.equal(f.count('albums'), 0); assert.equal(f.ledger().result, undefined); assert.equal(f.count('files'), 1); assert.equal(f.used(), PNG.length);
        f.db.failOnStatement = null; const result = await f.commit(); assert.equal(result.items.length, 1); f.db.db.close();
    });

    it('rechecks aggregate quota atomically when another upload consumes it after staging', async () => {
        const f = fixture(); await f.prepare(f.input()); await f.stage();
        const before = 200 * 1024 * 1024 - PNG.length;
        f.db.exec(`UPDATE users SET used_bytes=${before} WHERE discord_id='a'`);
        const batch = f.db.batch.bind(f.db);
        let raced = false;
        f.db.batch = async statements => {
            if (!raced && statements.some(statement => statement.sql.includes('UPDATE users SET used_bytes'))) {
                raced = true; f.db.exec("UPDATE users SET used_bytes=used_bytes+1 WHERE discord_id='a'");
            }
            return batch(statements);
        };
        await assert.rejects(f.commit(), { code: 'INPUT_REJECTED' });
        assert.equal(f.used(), before + 1); assert.equal(f.ledger().quotaReserved, false); assert.equal(f.ledger().status, 'rejected');
        assert.equal(f.count('files'), 0); assert.equal(f.count('albums'), 0); assert.equal(f.originals.puts, 0); f.db.db.close();
    });

    it('does not repeat quota reservation after a recoverable R2 write failure', async () => {
        const f = fixture(); await f.prepare(f.input()); await f.stage();
        const put = f.originals.put.bind(f.originals);
        f.originals.put = async () => { throw new Error('R2 unavailable'); };
        await assert.rejects(f.commit(), { code: 'UPLOAD_FAILED' }); assert.equal(f.used(), PNG.length);
        f.originals.put = put;
        await f.commit(); const result = await f.commit(); assert.equal(result.items.length, 1); assert.equal(f.used(), PNG.length); f.db.db.close();
    });

    it('rechecks authorization after provider side effects and recovers without another upload', async () => {
        const f = fixture(); await f.prepare(f.input()); await f.stage();
        const put = f.originals.put.bind(f.originals);
        f.originals.put = async (...args) => { const result = await put(...args); f.revoke(); return result; };
        await assert.rejects(f.commit(), { code: 'AUTH_REQUIRED' });
        assert.equal(f.count('files'), 1); assert.equal(f.count('albums'), 0); assert.equal(f.used(), PNG.length);
        f.grant(); await f.commit(); const result = await f.commit();
        assert.equal(result.items.length, 1); assert.equal(f.originals.puts, 1); assert.equal(f.used(), PNG.length); f.db.db.close();
    });

    it('disables automatic Telegram POST retries for the internal large-file path', async () => {
        const f = fixture('telegram'); const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
        bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, ...Buffer.from('webm')]);
        const body = f.input(); body.files[0] = { id: 'upload_0', title: '视频', name: 'clip.webm', type: 'video/webm', size: bytes.length };
        await f.prepare(body); await f.stage('save_1', 'upload_0', new File([bytes], 'clip.webm', { type: 'video/webm' }));
        let posts = 0; globalThis.fetch = async () => { posts++; throw new Error('response lost'); };
        await assert.rejects(f.commit(), { code: 'UPLOAD_UNCERTAIN' });
        await assert.rejects(f.commit(), { code: 'UPLOAD_UNCERTAIN' }); assert.equal(posts, 1);
        assert.equal(f.used(), bytes.length); assert.equal(f.count('albums'), 0); f.db.db.close();
    });

    for (const interruption of ['revoke', 'cancel']) it(`stops before the second Telegram chunk after ${interruption} and retains the first uploaded chunk`, async () => {
        const f = fixture('telegram'); const bytes = new Uint8Array(16 * 1024 * 1024 + 1);
        bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, ...Buffer.from('webm')]);
        const body = f.input(); body.files[0] = { id: 'upload_0', title: '视频', name: 'clip.webm', type: 'video/webm', size: bytes.length };
        await f.prepare(body); await f.stage('save_1', 'upload_0', new File([bytes], 'clip.webm', { type: 'video/webm' }));
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push({ url: String(url), method: options.method });
            const file = options.body.get('document');
            if (calls.length === 1) {
                if (interruption === 'revoke') f.revoke();
                else await operations.cancelUploadOperation({ ...f, requestId: 'save_1' });
            }
            return Response.json({ ok: true, result: { document: { file_id: 'first-uploaded-chunk', file_size: file.size } } });
        };
        await assert.rejects(f.commit(), { code: interruption === 'revoke' ? 'AUTH_REQUIRED' : 'OPERATION_BUSY' });
        assert.equal(calls.length, 1, 'no second chunk or cleanup request may be sent');
        assert.equal(calls[0].method, 'POST'); assert.ok(calls[0].url.endsWith('/sendDocument'));
        assert.equal(f.used(), bytes.length); assert.equal(f.staging.values.size, 1);
        assert.equal(f.count('files'), 0); assert.equal(f.count('albums'), 0);
        f.grant(); await assert.rejects(f.commit(), { code: 'UPLOAD_UNCERTAIN' });
        assert.equal(calls.length, 1, 'a new authorized retry must not resend the uncertain upload');
        assert.equal(f.used(), bytes.length); f.db.db.close();
    });

    it('rejects array-coerced IDs rather than accepting their string representation', async () => {
        for (const mutate of [body => body.requestId = ['save_1'], body => body.albumId = [knownAlbum],
            body => body.files[0].id = ['upload_0'], body => body.order[0].uploadId = ['upload_0']]) {
            const f = fixture(); const body = f.input(); mutate(body);
            await assert.rejects(f.prepare(body), { code: 'INPUT_REJECTED' }); assert.equal(f.count('files'), 0); f.db.db.close();
        }
    });

    it('requires server authorization claims before preparing any operation', async () => {
        const f = fixture();
        await assert.rejects(operations.prepareUploadOperation({ env: f.env, identity: { id: 'a' }, authorize: async () => ({ id: 'a' }), body: f.input(), requestUrl: origin }), { code: 'AUTH_REQUIRED' });
        assert.equal(f.count('other_data'), 0); assert.equal(f.staging.values.size, 0); f.db.db.close();
    });

    it('checks actual grant revocation and expiry inside the final transaction', async () => {
        for (const change of ["json_set(value,'$.revoked',1)", `json_set(value,'$.expiresAt',${Date.now() - 1000})`]) {
            const f = fixture(); await f.prepare(f.input()); await f.stage(); await f.commit();
            const batch = f.db.batch.bind(f.db);
            f.db.batch = async statements => {
                if (statements.some(statement => statement.sql.includes('INSERT INTO albums'))) {
                    f.db.db.prepare(`UPDATE other_data SET value=${change} WHERE key=?`).run(`charinfo-upload:grant:${grantHash}`);
                }
                return batch(statements);
            };
            await assert.rejects(f.commit(), { code: 'AUTH_REQUIRED' });
            assert.equal(f.count('albums'), 0); assert.equal(f.count('files'), 1); assert.equal(f.ledger().result, undefined); f.db.db.close();
        }
    });

    it('preserves legacy main/hidden settings while using real public-pack order and titles', async () => {
        const f = fixture(); f.addAlbum(); f.addFile('old-a.png'); f.addFile('old-b.png', 'a', 1);
        const visual = JSON.stringify({ mainFileId: 'old-b.png', viewerHiddenFileIds: ['old-b.png'], metadata: { author: '原作者' }, entranceQuote: '保留原句' });
        f.db.db.prepare("INSERT INTO other_data (key,value,type) VALUES (?,?,'charinfo_visual')").run(`charinfo.visual:${knownAlbum}`, visual);
        const loaded = await operations.readUploadGallery({ ...f, albumId: knownAlbum, characterName: '旅行者', requestUrl: origin });
        assert.equal(loaded.items[0].title, 'old-a.png');
        await f.prepare({ requestId: 'same', albumId: knownAlbum, characterName: '旅行者', files: [], order: loaded.items.map(item => ({ itemId: item.id })) });
        const result = await f.commit('same'); assert.equal(result.items[0].title, 'old-a.png');
        assert.equal(f.db.db.prepare('SELECT value FROM other_data WHERE key=?').get(`charinfo.visual:${knownAlbum}`).value, visual);
        const response = await publicGallery({ env: f.env, params: { albumId: knownAlbum }, request: new Request(result.remoteGalleryUrl) });
        const pack = await response.json(); assert.equal(pack.gallery[1].viewerVisible, false);
        assert.deepEqual(result.items.map(item => item.url), pack.gallery.map(item => item.sources[0])); f.db.db.close();
    });

    it('rejects a final all-hidden gallery before side effects and detects concurrent visual changes', async () => {
        const f = fixture(); f.addAlbum(); f.addFile('old.png');
        const visible = await operations.readUploadGallery({ ...f, albumId: knownAlbum, characterName: '旅行者', requestUrl: origin });
        f.db.db.prepare("INSERT INTO other_data (key,value,type) VALUES (?,?,'charinfo_visual')")
            .run(`charinfo.visual:${knownAlbum}`, JSON.stringify({ viewerHiddenFileIds: ['old.png'] }));
        await assert.rejects(f.prepare({ requestId: 'hidden', albumId: knownAlbum, characterName: '旅行者', files: [], order: [{ itemId: visible.items[0].id }] }), { code: 'INPUT_REJECTED' });
        assert.equal(f.count('other_data'), 0); assert.equal(f.used(), 0);
        f.db.db.prepare('DELETE FROM other_data WHERE key=?').run(`charinfo.visual:${knownAlbum}`);
        await f.prepare({ requestId: 'visual-race', albumId: knownAlbum, characterName: '旅行者', files: [], order: [{ itemId: visible.items[0].id }] });
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async statements => {
            if (statements.some(statement => statement.sql.includes('INSERT INTO albums'))) f.db.db.prepare("INSERT INTO other_data (key,value,type) VALUES (?,?,'charinfo_visual')")
                .run(`charinfo.visual:${knownAlbum}`, JSON.stringify({ viewerHiddenFileIds: ['old.png'] }));
            return batch(statements);
        };
        await assert.rejects(f.commit('visual-race'), { code: 'GALLERY_CONFLICT' });
        assert.equal(f.ledger().result, undefined); assert.equal(f.count('album_items'), 1); f.db.db.close();
    });
});
