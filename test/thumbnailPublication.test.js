import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { TestD1 } from './helpers/d1.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let upload;
let patchFile;

function fixture() {
    const d1 = new TestD1();
    const prepare = d1.prepare.bind(d1);
    d1.prepare = sql => {
        const statement = prepare(sql);
        const bind = statement.bind.bind(statement);
        statement.bind = (...params) => bind(...params.map(value => typeof value === 'boolean' ? Number(value) : value));
        return statement;
    };
    d1.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
    d1.exec("INSERT INTO users (discord_id, username, role, status, used_bytes, created_at, updated_at) VALUES ('owner-id', 'Owner', 'member', 'active', 0, 1, 1)");
    const values = new Map([
        ['manage@session@owner', JSON.stringify({ authType: 'user', expiresAt: Date.now() + 60_000, identity: { id: 'owner-id' } })],
        ['manage@sysConfig@page', JSON.stringify({ config: [{ id: 'defaultUploadChannel', value: 'cfr2' }] })],
    ]);
    const originals = new Map();
    const thumbnails = new Map();
    const transforms = [];
    const env = {
        DISCORD_CLIENT_ID: 'test-client', DISCORD_CLIENT_SECRET: 'test-secret',
        img_d1: d1,
        img_url: {
            get: async key => values.get(key) ?? null,
            put: async (key, value) => { values.set(key, value); },
            delete: async key => { values.delete(key); },
        },
        img_r2: { put: async (key, value) => { originals.set(key, value); } },
        THUMBNAILS: {
            put: async (key, value) => { thumbnails.set(key, value); },
            delete: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) thumbnails.delete(key); },
        },
        IMAGE_PROCESSOR: {
            transform: async (stream, options) => {
                transforms.push(options);
                assert.deepEqual(Buffer.from(await new Response(stream).arrayBuffer()), PNG);
                return new Response('webp-image', { headers: { 'Content-Type': 'image/webp' } });
            },
        },
    };
    return { d1, env, originals, thumbnails, transforms, values };
}

function seedFile(d1, extra = {}) {
    const metadata = { OwnerId: 'owner-id', FileType: 'image/png', Width: 1000, Height: 800, TimeStamp: 123, Visibility: 'private', ModerationStatus: 'active', Tags: ['original'], ...extra };
    d1.db.prepare('INSERT INTO files (id, value, metadata, owner_id, visibility, moderation_status, timestamp, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('image.png', '', JSON.stringify(metadata), metadata.OwnerId, metadata.Visibility, metadata.ModerationStatus, metadata.TimeStamp, metadata.FileType);
    return metadata;
}

function requestPatch(env, visibility = 'public') {
    return patchFile({
        env, params: { path: 'image.png' },
        request: new Request('https://example.test/api/user/files/image.png', {
            method: 'PATCH', headers: { Cookie: 'user_session=owner', 'Content-Type': 'application/json' },
            body: JSON.stringify({ visibility }),
        }),
    });
}

describe('permanent thumbnail publication flow', () => {
    let previousCaches;
    before(async () => {
        const modules = await Promise.all(['functions/upload/index.js', 'functions/api/user/files/[[path]].js'].map(async entry => {
            const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'browser' });
            const bundled = { exports: {} };
            new Function('module', 'exports', result.outputFiles[0].text)(bundled, bundled.exports);
            return bundled.exports;
        }));
        upload = modules[0].onRequest;
        patchFile = modules[1].onRequestPatch;
    });
    beforeEach(() => {
        previousCaches = globalThis.caches;
        globalThis.caches = { default: { delete: async () => true, put: async () => {} } };
    });
    afterEach(() => {
        if (previousCaches === undefined) delete globalThis.caches;
        else globalThis.caches = previousCaches;
    });

    it('generates all variants from the already uploaded File without fetching its public URL', async () => {
        const { d1, env, originals, thumbnails, transforms } = fixture();
        const previousFetch = globalThis.fetch;
        globalThis.fetch = async () => { throw new Error('upload must not download its original again'); };
        const pending = [];
        try {
            const form = new FormData();
            form.append('file', new File([PNG], 'image.png', { type: 'image/png' }));
            const response = await upload({ env, request: new Request('https://example.test/upload', { method: 'POST', headers: { Cookie: 'user_session=owner', Origin: 'https://example.test' }, body: form }), waitUntil: promise => pending.push(promise) });
            assert.equal(response.status, 200, await response.clone().text());
            assert.match(response.headers.get('Content-Type'), /application\/json/);
            const [result] = await response.json();
            assert.equal(result.thumbnailReady, true);
            assert.equal(result.thumbnailCreated, true);
            assert.equal(originals.size, 1);
            assert.equal(thumbnails.size, 3);
            assert.equal(transforms.length, 3);
            const row = d1.db.prepare('SELECT metadata FROM files').get();
            const metadata = JSON.parse(row.metadata);
            assert.equal(metadata.Visibility, 'public');
            assert.equal(metadata.ThumbnailStatus, 'ready');
            assert.ok(metadata.Thumbnail);
        } finally {
            await Promise.allSettled(pending);
            globalThis.fetch = previousFetch;
            d1.db.close();
        }
    });

    it('keeps a successful original upload when thumbnail storage is not configured', async () => {
        const { d1, env, originals } = fixture();
        delete env.THUMBNAILS;
        const pending = [];
        try {
            const form = new FormData();
            form.append('file', new File([PNG], 'image.png', { type: 'image/png' }));
            const response = await upload({ env, request: new Request('https://example.test/upload', { method: 'POST', headers: { Cookie: 'user_session=owner', Origin: 'https://example.test' }, body: form }), waitUntil: promise => pending.push(promise) });
            assert.equal(response.status, 200, await response.clone().text());
            const [result] = await response.json();
            assert.equal(result.thumbnailReady, false);
            assert.ok(result.thumbnailReason);
            assert.match(result.warning, /Original stored/);
            assert.ok(result.src);
            assert.equal(originals.size, 1);
            assert.equal(JSON.parse(d1.db.prepare('SELECT metadata FROM files').get().metadata).ThumbnailStatus, 'failed');
            assert.equal(d1.db.prepare('SELECT used_bytes FROM users').get().used_bytes, PNG.length);
        } finally {
            await Promise.allSettled(pending);
            d1.db.close();
        }
    });

    it('uploads only the original to Discord and puts all derived images in R2', async () => {
        const { d1, env, values, thumbnails, transforms } = fixture();
        values.set('manage@sysConfig@page', JSON.stringify({ config: [{ id: 'defaultUploadChannel', value: 'discord' }] }));
        values.set('manage@sysConfig@upload', JSON.stringify({ discord: { channels: [{ name: 'DC test', enabled: true, botToken: 'test-bot-token', channelId: 'test-channel' }], loadBalance: { enabled: false } } }));
        const previousFetch = globalThis.fetch;
        const pending = [];
        let discordCalls = 0;
        globalThis.fetch = async (url, options) => {
            assert.equal(url, 'https://discord.com/api/v10/channels/test-channel/messages');
            assert.equal(options.method, 'POST', 'no message lookup or CDN download is needed after upload');
            discordCalls++;
            const original = options.body.get('files[0]');
            return new Response(JSON.stringify({ id: 'original-message', attachments: [{ id: 'attachment', filename: original.name, content_type: original.type, size: original.size, url: 'https://cdn.discordapp.com/attachments/test-channel/attachment/image.png' }] }), { headers: { 'Content-Type': 'application/json' } });
        };
        try {
            const form = new FormData();
            form.append('file', new File([PNG], 'image.png', { type: 'image/png' }));
            const response = await upload({ env, request: new Request('https://example.test/upload', { method: 'POST', headers: { Cookie: 'user_session=owner', Origin: 'https://example.test' }, body: form }), waitUntil: promise => pending.push(promise) });
            assert.equal(response.status, 200, await response.clone().text());
            const [result] = await response.json();
            assert.equal(result.thumbnailReady, true);
            assert.equal(discordCalls, 1);
            assert.equal(thumbnails.size, 3);
            assert.equal(transforms.length, 3);
            const metadata = JSON.parse(d1.db.prepare('SELECT metadata FROM files').get().metadata);
            assert.equal(metadata.Channel, 'Discord');
            assert.equal(metadata.DiscordMessageId, 'original-message');
            assert.equal(metadata.Thumbnail.Channel, 'CloudflareR2');
        } finally {
            await Promise.allSettled(pending);
            globalThis.fetch = previousFetch;
            d1.db.close();
        }
    });

    it('does not attempt thumbnails or report thumbnail failure for video uploads', async () => {
        const { d1, env, originals, transforms } = fixture();
        const pending = [];
        try {
            const form = new FormData();
            form.append('file', new File([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]), 'webm'], 'clip.webm', { type: 'video/webm' }));
            const response = await upload({ env, request: new Request('https://example.test/upload', { method: 'POST', headers: { Cookie: 'user_session=owner', Origin: 'https://example.test' }, body: form }), waitUntil: promise => pending.push(promise) });
            assert.equal(response.status, 200, await response.clone().text());
            const [result] = await response.json();
            assert.equal(result.thumbnailReady, undefined);
            assert.equal(result.thumbnailReason, undefined);
            assert.equal(originals.size, 1);
            assert.equal(transforms.length, 0);
        } finally {
            await Promise.allSettled(pending);
            d1.db.close();
        }
    });

    it('preserves newer visibility and tags while thumbnail generation is in progress', async () => {
        const { d1, env, thumbnails } = fixture();
        seedFile(d1);
        const previousFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
        const transform = env.IMAGE_PROCESSOR.transform;
        let changed = false;
        env.IMAGE_PROCESSOR.transform = async (...args) => {
            if (!changed) {
                changed = true;
                d1.exec(`UPDATE files SET visibility = 'private', metadata = json_set(metadata, '$.Visibility', 'private', '$.Tags', json('["newer"]')) WHERE id = 'image.png'`);
            }
            return transform(...args);
        };
        try {
            const response = await requestPatch(env);
            assert.equal(response.status, 200);
            const result = await response.json();
            assert.equal(result.visibility, 'private');
            assert.equal(result.thumbnailReady, true);
            const current = JSON.parse(d1.db.prepare('SELECT metadata FROM files WHERE id = ?').get('image.png').metadata);
            assert.equal(current.Visibility, 'private');
            assert.deepEqual(current.Tags, ['newer']);
            assert.equal(current.ThumbnailStatus, 'ready');
            assert.equal(thumbnails.size, 3);
        } finally {
            globalThis.fetch = previousFetch;
            d1.db.close();
        }
    });

    it('does not resurrect a file removed while generating thumbnails', async () => {
        const { d1, env, thumbnails } = fixture();
        seedFile(d1);
        const previousFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
        env.IMAGE_PROCESSOR.transform = async () => {
            d1.exec("DELETE FROM files WHERE id = 'image.png'");
            return new Response('webp-image', { headers: { 'Content-Type': 'image/webp' } });
        };
        try {
            const response = await requestPatch(env);
            assert.equal(response.status, 409);
            assert.equal(d1.db.prepare('SELECT COUNT(*) AS count FROM files').get().count, 0);
            assert.equal(thumbnails.size, 0);
        } finally {
            globalThis.fetch = previousFetch;
            d1.db.close();
        }
    });

    it('refuses to publish a file quarantined after the initial owner check', async () => {
        const { d1, env, transforms } = fixture();
        seedFile(d1);
        const prepare = d1.prepare.bind(d1);
        d1.prepare = sql => {
            if (sql.includes("SET metadata = json_set(metadata, '$.Visibility'")) {
                d1.exec("UPDATE files SET moderation_status = 'quarantined', metadata = json_set(metadata, '$.ModerationStatus', 'quarantined') WHERE id = 'image.png'");
            }
            return prepare(sql);
        };
        try {
            const response = await requestPatch(env);
            assert.equal(response.status, 409);
            const row = d1.db.prepare('SELECT visibility, moderation_status FROM files').get();
            assert.equal(row.visibility, 'private');
            assert.equal(row.moderation_status, 'quarantined');
            assert.equal(transforms.length, 0);
        } finally {
            d1.db.close();
        }
    });
});

describe('upload thumbnail status wording', () => {
    it('keeps original links and displays failed thumbnails as a stored original', () => {
        const source = readFileSync(new URL('../frontend-dist/account/upload-in-files.js', import.meta.url), 'utf8');
        const context = vm.createContext({
            URL, URLSearchParams,
            location: { origin: 'https://example.test', search: '?view=files' },
            sessionStorage: { getItem: () => null, removeItem() {} },
            document: { addEventListener() {}, querySelector: () => null },
            MutationObserver: class { observe() {} },
        });
        // The event wiring is irrelevant to the response parser and result markup.
        vm.runInContext(source.slice(0, source.indexOf("document.addEventListener('click'")), context);
        const result = vm.runInContext(`parseUploadResponse({status:200,responseText:JSON.stringify([{src:'/file/image.png',thumbnailReady:false,thumbnailReason:'transform-501'}])},'image.png')`, context);
        assert.equal(result.url, 'https://example.test/file/image.png');
        assert.match(result.notice, /原图已保存，缩略图尚未就绪/);
        const video = vm.runInContext(`parseUploadResponse({status:200,responseText:JSON.stringify([{src:'/file/video.mp4'}])},'video.mp4')`, context);
        assert.equal(video.notice, '');
    });
});
