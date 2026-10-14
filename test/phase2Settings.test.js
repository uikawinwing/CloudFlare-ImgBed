import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest as uploadSettings, getUploadConfig } from '../functions/api/manage/sysConfig/upload.js';
import { onRequest as otherSettings } from '../functions/api/manage/sysConfig/others.js';
import { TestD1 } from './helpers/d1.js';

function createKv(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { values, get: async key => values.get(key) || null, put: async (key, value) => values.set(key, value) };
}

function group(channels = []) {
    return { channels, loadBalance: { enabled: false, channels: ['keep-this-list'] } };
}

function request(path, body, origin) {
    return new Request(`https://example.test${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
    });
}

function initialUpload() {
    return {
        telegram: group([{ id: 1, name: 'Telegram A', type: 'telegram', enabled: true, botToken: 'tg-token', chatId: 'tg-chat' }]),
        cfr2: group(),
        discord: group([{ id: 1, name: 'Discord A', type: 'discord', enabled: true, botToken: 'dc-token', channelId: 'old-channel' }]),
        huggingface: group([{ id: 1, name: 'HF A', type: 'huggingface', enabled: false, token: 'hf-token', repo: 'repo-a' }]),
    };
}

describe('phase 2 settings contract', () => {
    it('returns only retained groups and never exposes environment credentials through GET', async () => {
        const kv = createKv({ 'manage@sysConfig@upload': JSON.stringify(initialUpload()) });
        const response = await uploadSettings({
            env: { img_url: kv, img_r2: {}, TG_BOT_TOKEN: 'env-tg', TG_CHAT_ID: 'env-chat', DISCORD_BOT_TOKEN: 'env-dc', DISCORD_CHANNEL_ID: 'env-channel', HF_TOKEN: 'env-hf', HF_REPO: 'env-repo' },
            request: new Request('https://example.test/api/manage/sysConfig/upload'),
        });
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ['cfr2', 'discord', 'huggingface', 'telegram']);
        assert.ok(!JSON.stringify(body).includes('env-tg'));
        assert.ok(!JSON.stringify(body).includes('env-hf'));
        assert.equal(body.telegram.channels[0].fixed, true);
        assert.equal(body.telegram.channels[0].botToken, undefined);
    });

    it('rejects cross-site upload and other-settings writes before persisting', async () => {
        const kv = createKv();
        const env = { img_url: kv };
        const upload = await uploadSettings({ env, request: request('/api/manage/sysConfig/upload', {}, 'https://elsewhere.test') });
        const others = await otherSettings({ env, request: request('/api/manage/sysConfig/others', { telemetry: { enabled: true } }, 'https://elsewhere.test') });
        assert.equal(upload.status, 403);
        assert.equal(others.status, 403);
        assert.equal(kv.values.size, 0);
    });

    it('preserves omitted groups, fixed mutable state, disabled credentials, and load-balance membership', async () => {
        const saved = initialUpload();
        saved.telegram.channels.unshift({ id: 1, name: 'Telegram_env', type: 'telegram', savePath: 'environment variable', enabled: false, proxyUrl: 'https://proxy.example' });
        const kv = createKv({ 'manage@sysConfig@upload': JSON.stringify(saved) });
        const response = await uploadSettings({
            env: { img_url: kv, TG_BOT_TOKEN: 'env-tg', TG_CHAT_ID: 'env-chat' },
            request: request('/api/manage/sysConfig/upload', { telegram: group([{ id: 1, name: 'Telegram A', enabled: false, botToken: '', chatId: '' }]) }),
        });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get('manage@sysConfig@upload'));
        assert.equal(persisted.telegram.channels[0].enabled, false);
        assert.equal(persisted.telegram.channels[0].proxyUrl, 'proxy.example');
        assert.equal(persisted.telegram.channels[0].botToken, undefined);
        assert.equal(persisted.telegram.channels[1].botToken, 'tg-token');
        assert.equal(persisted.telegram.channels[1].chatId, 'tg-chat');
        assert.deepEqual(persisted.telegram.loadBalance.channels, ['keep-this-list']);
        assert.deepEqual(persisted.discord, saved.discord);
    });

    it('validates duplicate names, enabled credentials, and R2 bindings', async () => {
        const kv = createKv();
        const env = { img_url: kv };
        const duplicate = await uploadSettings({ env, request: request('/api/manage/sysConfig/upload', {
            telegram: group([{ name: 'same', enabled: false }, { name: 'same', enabled: false }]),
        }) });
        assert.equal(duplicate.status, 400);
        const r2 = await uploadSettings({ env, request: request('/api/manage/sysConfig/upload', {
            cfr2: group([{ name: 'r2', enabled: true, quota: 'not-a-number' }]),
        }) });
        assert.equal(r2.status, 400);
        assert.equal(kv.values.size, 0);
    });

    it('preserves the R2 quota object and fixed channel identity without copying environment secrets', async () => {
        const kv = createKv();
        const response = await uploadSettings({ env: { img_url: kv, img_r2: {} }, request: request('/api/manage/sysConfig/upload', {
            cfr2: group([{ id: 99, name: 'changed-name', savePath: 'environment variable', enabled: true, quota: { enabled: true, limitGB: '10', threshold: '95' }, token: 'must-not-persist' }]),
        }) });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get('manage@sysConfig@upload')).cfr2.channels[0];
        assert.equal(persisted.name, 'R2_env');
        assert.equal(persisted.id, 1);
        assert.deepEqual(persisted.quota, { enabled: true, limitGB: 10, threshold: 95 });
        assert.equal(persisted.token, undefined);
        for (const quota of [10, { enabled: true, limitGB: 0, threshold: 95 }, { enabled: true, limitGB: 10, threshold: 101 }]) {
            const rejected = await uploadSettings({ env: { img_url: kv, img_r2: {} }, request: request('/api/manage/sysConfig/upload', {
                cfr2: group([{ name: 'R2_env', savePath: 'environment variable', enabled: true, quota }]),
            }) });
            assert.equal(rejected.status, 400);
            assert.deepEqual(JSON.parse(kv.values.get('manage@sysConfig@upload')).cfr2.channels[0].quota, persisted.quota);
        }
    });

    it('blocks deletion and target changes for referenced channels while allowing token rotation', async () => {
        const d1 = new TestD1();
        d1.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
        d1.exec(`INSERT INTO files (id, metadata, channel, channel_name) VALUES ('old.png', '{"Channel":"Discord","ChannelName":"Discord A"}', 'Discord', 'Discord A')`);
        const statements = [];
        const prepare = d1.prepare.bind(d1);
        d1.prepare = sql => { statements.push(sql); return prepare(sql); };
        const kv = createKv({ 'manage@sysConfig@upload': JSON.stringify(initialUpload()) });
        try {
            const changedTarget = await uploadSettings({ env: { img_url: kv, img_d1: d1 }, request: request('/api/manage/sysConfig/upload', {
                discord: group([{ name: 'Discord A', enabled: true, botToken: 'rotated', channelId: 'new-channel' }]),
            }) });
            assert.equal(changedTarget.status, 409);
            assert.equal((await changedTarget.json()).error, '已有文件仍引用该渠道，请停用并保留凭据');
            assert.match(statements.find(sql => sql.includes('SELECT 1 FROM files')), /WHERE[\s\S]*LIMIT 1/);
            assert.equal(JSON.parse(kv.values.get('manage@sysConfig@upload')).discord.channels[0].channelId, 'old-channel');

            const rotation = await uploadSettings({ env: { img_url: kv, img_d1: d1 }, request: request('/api/manage/sysConfig/upload', {
                discord: group([{ name: 'Discord A', enabled: true, botToken: 'rotated', channelId: 'old-channel' }]),
            }) });
            assert.equal(rotation.status, 200);
            assert.equal(JSON.parse(kv.values.get('manage@sysConfig@upload')).discord.channels[0].botToken, 'rotated');
        } finally {
            d1.db.close();
        }
    });

    it('protects legacy files whose channels are resolved by persisted identity instead of name', async () => {
        const d1 = new TestD1();
        d1.exec(readFileSync(new URL('../database/init.sql', import.meta.url), 'utf8'));
        try {
            for (const [groupName, metadata] of [
                ['huggingface', { Channel: 'HuggingFace', HfRepo: 'repo-a' }],
                ['telegram', { Channel: 'TelegramNew', TgBotToken: 'tg-token', TgChatId: 'tg-chat' }],
                ['discord', { Channel: 'Discord', DiscordBotToken: 'dc-token', DiscordChannelId: 'old-channel' }],
            ]) {
                d1.db.prepare('INSERT INTO files (id, metadata) VALUES (?, ?)').run(`${groupName}.png`, JSON.stringify(metadata));
                const kv = createKv({ 'manage@sysConfig@upload': JSON.stringify(initialUpload()) });
                const response = await uploadSettings({ env: { img_url: kv, img_d1: d1 }, request: request('/api/manage/sysConfig/upload', { [groupName]: group() }) });
                assert.equal(response.status, 409, groupName);
                assert.equal(JSON.parse(kv.values.get('manage@sysConfig@upload'))[groupName].channels.length, 1);
            }
        } finally { d1.db.close(); }
    });

    it('removes WebDAV from GET while revoking its old token on a same-origin save', async () => {
        const kv = createKv({
            'manage@sysConfig@others': JSON.stringify({ webDAV: { internalTokenId: 'dav-token' }, telemetry: { enabled: false } }),
            'manage@sysConfig@security': JSON.stringify({ apiTokens: { tokens: { 'dav-token': { token: 'retired' } } } }),
        });
        const get = await otherSettings({ env: { img_url: kv }, request: new Request('https://example.test/api/manage/sysConfig/others') });
        assert.equal((await get.json()).webDAV, undefined);
        const post = await otherSettings({ env: { img_url: kv }, request: request('/api/manage/sysConfig/others', { telemetry: { enabled: true }, randomImageAPI: {}, cloudflareApiToken: {}, publicBrowse: {} }) });
        assert.equal(post.status, 200);
        assert.equal(JSON.parse(kv.values.get('manage@sysConfig@others')).webDAV, undefined);
        assert.deepEqual(JSON.parse(kv.values.get('manage@sysConfig@security')).apiTokens.tokens, {});
    });
});
