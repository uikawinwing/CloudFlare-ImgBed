import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { TestD1 } from './helpers/d1.js';
import { onRequest as userMiddleware } from '../functions/api/user/_middleware.js';
import { onRequest as createAlbum } from '../functions/api/user/albums/index.js';
import { onRequestPost as addAlbumItem } from '../functions/api/user/albums/[[id]]/items.js';
import { onRequestPost as completeCharInfo } from '../functions/api/user/charinfo/complete.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let upload;

function fixture(channel) {
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
        ['manage@sysConfig@page', JSON.stringify({ config: [{ id: 'defaultUploadChannel', value: channel }, { id: 'urlPrefix', value: 'https://media.example.test/file/' }] })],
        ['manage@sysConfig@upload', JSON.stringify({
            telegram: { channels: [{ name: 'TG test', enabled: true, botToken: 'test-bot', chatId: 'test-chat' }], loadBalance: { enabled: false } },
            discord: { channels: [{ name: 'DC test', enabled: true, botToken: 'test-bot', channelId: 'test-channel' }], loadBalance: { enabled: false } },
        })],
    ]);
    const originals = new Map();
    const env = {
        DISCORD_CLIENT_ID: 'test-client', DISCORD_CLIENT_SECRET: 'test-secret', img_d1: d1,
        img_url: {
            get: async key => values.get(key) ?? null,
            put: async (key, value) => { values.set(key, value); },
            delete: async key => { values.delete(key); },
        },
        img_r2: { put: async (key, value) => { originals.set(key, value); } },
    };
    return { d1, env, values, originals };
}

describe('upload file ID contract', () => {
    let previousFetch;
    let previousCaches;
    before(async () => {
        const result = await build({ entryPoints: ['functions/upload/index.js'], bundle: true, write: false, format: 'cjs', platform: 'browser' });
        const module = { exports: {} };
        new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
        upload = module.exports.onRequest;
    });
    beforeEach(() => {
        previousFetch = globalThis.fetch;
        previousCaches = globalThis.caches;
        globalThis.caches = { default: { delete: async () => true, put: async () => {} } };
        globalThis.fetch = async (url, options) => {
            if (url.includes('/getFile?')) {
                return Response.json({ ok: true, result: { file_path: 'photos/test.png' } });
            }
            if (url.startsWith('https://api.telegram.org/')) {
                const file = options.body.get('photo') || options.body.get('document') || options.body.get('video');
                return Response.json({ ok: true, result: { document: { file_id: 'telegram-storage-id', file_size: file.size } } });
            }
            if (url.startsWith('https://discord.com/')) {
                const file = options.body.get('files[0]');
                return Response.json({ id: 'message-id', attachments: [{ id: 'attachment-id', filename: file.name, content_type: file.type, size: file.size, url: 'https://cdn.discordapp.com/attachments/test-channel/attachment/test.png' }] });
            }
            throw new Error(`Unexpected upload fetch: ${url}`);
        };
    });
    afterEach(() => {
        globalThis.fetch = previousFetch;
        if (previousCaches === undefined) delete globalThis.caches;
        else globalThis.caches = previousCaches;
    });

    async function send(env, file = new File([PNG], 'image.png', { type: 'image/png' }), onResponse) {
        const pending = [];
        const form = new FormData();
        form.append('file', file);
        try {
            const response = await upload({ env, request: new Request('https://example.test/upload?returnFormat=full', {
                method: 'POST', headers: { Cookie: 'user_session=owner', Origin: 'https://example.test' }, body: form,
            }), waitUntil: promise => pending.push(promise) });
            await onResponse?.(response);
            return response;
        } finally {
            await Promise.allSettled(pending);
        }
    }

    for (const channel of ['cfr2', 'telegram', 'discord']) {
        it(`can create and populate an NPC album before ${channel} background indexing completes`, async () => {
            const { env, d1 } = fixture(channel);
            let releaseBackground, markBackgroundStarted;
            const blocked = new Promise(resolve => { releaseBackground = resolve; });
            const backgroundStarted = new Promise(resolve => { markBackgroundStarted = resolve; });
            let backgroundFinished = false;
            globalThis.caches.default.put = async key => {
                if (!String(key).includes('/api/randomFileList?')) return;
                markBackgroundStarted();
                await blocked;
                backgroundFinished = true;
            };
            const write = (path, handler, body, params = {}) => {
                const request = new Request(`https://example.test${path}`, {
                    method: 'POST', headers: { Cookie: 'user_session=owner', Origin: 'https://example.test', 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const context = { env, request, params };
                return userMiddleware({ ...context, next: () => handler(context) });
            };
            try {
                await send(env, undefined, async response => {
                    try {
                        assert.equal(response.status, 200);
                        await backgroundStarted;
                        const [uploaded] = await response.clone().json();
                        const row = d1.db.prepare('SELECT id, owner_id FROM files WHERE id = ?').get(uploaded.fileId);
                        assert.equal(row.owner_id, 'owner-id');
                        const created = await write('/api/user/albums', createAlbum, { name: '旅人', charInfoCharacterName: '旅人' });
                        assert.equal(created.status, 201);
                        const album = await created.json();
                        const added = await write(`/api/user/albums/${album.id}/items`, addAlbumItem, { fileId: uploaded.fileId }, { id: album.id });
                        assert.equal(added.status, 200);
                        assert.equal(d1.db.prepare('SELECT file_id FROM album_items WHERE album_id = ?').get(album.id).file_id, uploaded.fileId);
                        // The existing Creator also requires a public handle to
                        // publish its separate human-readable gallery link.
                        d1.exec("UPDATE users SET public_handle = 'owner'");
                        const completed = await write('/api/user/charinfo/complete', completeCharInfo, {
                            draftId: '12345678-1234-4234-8234-123456789abc', characterName: '旅人',
                            fileIds: [uploaded.fileId], config: { mainFileId: uploaded.fileId },
                        });
                        assert.equal(completed.status, 200, await completed.clone().text());
                        assert.equal(backgroundFinished, false, 'association must not depend on background cache/index maintenance');
                    } finally {
                        releaseBackground();
                    }
                });
            } finally {
                releaseBackground();
                d1.db.close();
            }
        });

        it(`returns the persisted ID and preserves links for ${channel}`, async () => {
            const { env, d1 } = fixture(channel);
            try {
                const response = await send(env);
                assert.equal(response.status, 200, await response.clone().text());
                const [result] = await response.json();
                const row = d1.db.prepare('SELECT id FROM files').get();
                assert.equal(result.fileId, row.id);
                assert.match(result.fileId, /^users\/owner-id\/[\da-f-]{36}\.png$/);
                assert.equal(result.src, `https://example.test/file/${row.id}`);
                assert.equal(result.publicUrl, `https://media.example.test/file/${row.id}`);
                assert.equal(result.thumbnailReady, false);
                assert.match(result.warning, /Original stored/);
            } finally {
                d1.db.close();
            }
        });
    }

    it('returns the final file ID for a Telegram upload split on the server', async () => {
        const { env, d1 } = fixture('telegram');
        const bytes = Buffer.alloc(16 * 1024 * 1024 + 8);
        bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
        bytes.set(Buffer.from('webm'), 8);
        try {
            const response = await send(env, new File([bytes], 'clip.webm', { type: 'video/webm' }));
            assert.equal(response.status, 200, await response.clone().text());
            const [result] = await response.json();
            const row = d1.db.prepare('SELECT id, value FROM files').get();
            assert.equal(result.fileId, row.id);
            assert.equal(result.src, `https://example.test/file/${row.id}`);
            assert.equal(result.publicUrl, `https://media.example.test/file/${row.id}`);
            assert.equal(JSON.parse(row.value).length, 2);
            assert.equal(result.thumbnailReady, undefined);
        } finally {
            d1.db.close();
        }
    });

    it('keeps the moderation status and warning alongside the stored ID', async () => {
        const { env, d1, values } = fixture('discord');
        values.set('manage@sysConfig@security', JSON.stringify({ upload: { moderate: {
            enabled: true, channel: 'moderatecontent.com', moderateContentApiKey: '',
        } } }));
        try {
            const response = await send(env);
            assert.equal(response.status, 200, await response.clone().text());
            const [result] = await response.json();
            const row = d1.db.prepare('SELECT id, moderation_status FROM files').get();
            assert.equal(result.fileId, row.id);
            assert.equal(result.moderationStatus, 'quarantined');
            assert.equal(row.moderation_status, 'quarantined');
            assert.match(result.warning, /pending moderation review/);
        } finally {
            d1.db.close();
        }
    });

    for (const [channel, status] of [['huggingface', 503], ['s3', 410], ['webdav', 410]]) {
        it(`keeps ${channel} disabled without returning a success ID`, async () => {
            const { env, d1 } = fixture(channel);
            try {
                const response = await send(env);
                assert.equal(response.status, status);
                assert.ok(!(await response.text()).includes('fileId'));
                assert.equal(d1.db.prepare('SELECT COUNT(*) AS count FROM files').get().count, 0);
            } finally {
                d1.db.close();
            }
        });
    }

    it('does not return a success ID when Discord rejects storage', async () => {
        const { env, d1 } = fixture('discord');
        globalThis.fetch = async () => new Response('Storage unavailable', { status: 503 });
        try {
            const response = await send(env);
            assert.equal(response.status, 500);
            assert.ok(!(await response.text()).includes('fileId'));
            assert.equal(d1.db.prepare('SELECT COUNT(*) AS count FROM files').get().count, 0);
        } finally {
            d1.db.close();
        }
    });
});
