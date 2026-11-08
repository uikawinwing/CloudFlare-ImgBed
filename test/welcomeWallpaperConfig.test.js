import assert from 'node:assert/strict';
import { getPageConfig, onRequest as pageSettings } from '../functions/api/manage/sysConfig/page.js';
import { onRequest as userConfig } from '../functions/api/userConfig.js';
import { getDefaultWelcomeWallpaper, validateWelcomeWallpaper } from '../functions/utils/welcomeWallpaper.js';

const settingsKey = 'manage@sysConfig@page';

function createKv(settings) {
    const values = new Map(settings ? [[settingsKey, JSON.stringify(settings)]] : []);
    const writes = [];
    return {
        values,
        writes,
        get: async key => values.get(key) ?? null,
        put: async (key, value) => { values.set(key, value); writes.push({ key, value }); },
    };
}

function request(method, body, origin = 'https://example.test') {
    return new Request('https://example.test/api/manage/sysConfig/page', {
        method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
    });
}

function wallpaperItem(settings) {
    return settings.config.find(item => item.id === 'welcomeWallpaper');
}

describe('welcome wallpaper configuration', () => {
    it('exposes the bundled wallpaper as the default without persisting a new setting', async () => {
        const kv = createKv();
        const env = { img_url: kv };
        const settings = await getPageConfig(kv, env);
        assert.equal(typeof wallpaperItem(settings).value, 'string');
        assert.deepEqual(JSON.parse(wallpaperItem(settings).value), getDefaultWelcomeWallpaper());
        const response = await userConfig({ env });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).welcomeWallpaper, getDefaultWelcomeWallpaper());
        assert.equal(kv.writes.length, 0);
    });

    it('patches only the queue while preserving other settings and the announcement version', async () => {
        const original = {
            announcementRefreshAt: 12345,
            retainedMetadata: 'keep',
            config: [
                { id: 'siteTitle', value: 'Charatopia' },
                { id: 'announcement', value: 'Existing announcement' },
                { id: 'uploadBkImg', value: ['https://example.test/workspace.png'] },
                { id: 'custom-retained-setting', value: 'keep this too' },
            ],
        };
        const kv = createKv(original);
        const wallpaper = getDefaultWelcomeWallpaper();
        wallpaper.items = [
            { url: 'https://art.example/second.png', positionX: 25, positionY: 40, mobilePositionX: 75, mobilePositionY: 10 },
            { url: '/welcome/wallpaper.jpg', positionX: 50, positionY: 50, mobilePositionX: 60, mobilePositionY: 0 },
        ];
        const response = await pageSettings({ env: { img_url: kv }, request: request('PATCH', { welcomeWallpaper: wallpaper }) });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        assert.deepEqual(persisted.config.slice(0, original.config.length), original.config);
        assert.equal(persisted.announcementRefreshAt, original.announcementRefreshAt);
        assert.equal(persisted.retainedMetadata, original.retainedMetadata);
        assert.deepEqual(wallpaperItem(persisted).value, wallpaper);
        const responseWallpaper = wallpaperItem(await response.json()).value;
        assert.equal(typeof responseWallpaper, 'string');
        assert.deepEqual(JSON.parse(responseWallpaper), wallpaper);
        assert.deepEqual((await (await userConfig({ env: { img_url: kv } })).json()).welcomeWallpaper, wallpaper);
        assert.equal(kv.writes.length, 1);
    });

    it('replaces an existing queue and supports an empty queue or disabling wallpaper', async () => {
        const kv = createKv({ config: [{ id: 'welcomeWallpaper', value: getDefaultWelcomeWallpaper() }] });
        const wallpaper = { enabled: false, intervalSeconds: 30, opacity: 0.5, items: [] };
        const response = await pageSettings({ env: { img_url: kv }, request: request('PATCH', { welcomeWallpaper: wallpaper }) });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        assert.equal(persisted.config.length, 1);
        assert.deepEqual(wallpaperItem(persisted).value, wallpaper);
    });

    it('accepts a legacy JSON textarea value and keeps the submitted queue order', async () => {
        const kv = createKv({ announcementRefreshAt: 123, config: [{ id: 'announcement', value: 'same' }] });
        const wallpaper = getDefaultWelcomeWallpaper();
        wallpaper.items = [{ url: '/b.jpg' }, { url: 'https://art.example/壁纸 1.png' }];
        const response = await pageSettings({ env: { img_url: kv }, request: request('POST', {
            config: [{ id: 'announcement', value: 'same' }, { id: 'welcomeWallpaper', value: JSON.stringify(wallpaper) }],
        }) });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        assert.equal(persisted.announcementRefreshAt, 123);
        const items = wallpaperItem(persisted).value.items;
        assert.deepEqual(items.map(item => item.url), ['/b.jpg', 'https://art.example/%E5%A3%81%E7%BA%B8%201.png']);
        assert.deepEqual(items[0], { ...getDefaultWelcomeWallpaper().items[0], url: '/b.jpg' });
        const responseWallpaper = wallpaperItem(await response.json()).value;
        assert.equal(typeof responseWallpaper, 'string');
        assert.deepEqual(JSON.parse(responseWallpaper), wallpaperItem(persisted).value);
    });

    it('returns object and legacy string configurations as textarea JSON without double encoding', async () => {
        const wallpaper = getDefaultWelcomeWallpaper();
        for (const value of [wallpaper, JSON.stringify(wallpaper)]) {
            const kv = createKv({ config: [{ id: 'welcomeWallpaper', value }] });
            const env = { img_url: kv };
            const get = await pageSettings({ env, request: new Request('https://example.test/api/manage/sysConfig/page') });
            const textareaValue = wallpaperItem(await get.json()).value;
            assert.equal(typeof textareaValue, 'string');
            assert.deepEqual(JSON.parse(textareaValue), wallpaper);
            assert.deepEqual((await (await userConfig({ env })).json()).welcomeWallpaper, wallpaper);
            assert.equal(kv.writes.length, 0);
        }
    });

    it('rejects invalid URLs and value ranges through both PATCH and the full POST settings path', async () => {
        const invalidValues = [
            ['enabled', 'yes'],
            ['intervalSeconds', 4],
            ['intervalSeconds', 3601],
            ['intervalSeconds', 5.5],
            ['opacity', 1.01],
            ['opacity', -0.1],
            ['items', Array.from({ length: 21 }, () => ({ url: '/a.jpg' }))],
            ...['javascript:alert(1)', 'data:image/png;base64,abc', '//art.example/a.png', '/\\art.example/a.png', 'https://u:p@art.example/a.png', 'https://'].map(url => ['items', [{ url }]]),
            ['items', [{ url: '/a.jpg', positionX: 101 }]],
            ['items', [{ url: '/a.jpg', mobilePositionY: -1 }]],
        ];
        for (const [field, value] of invalidValues) {
            const wallpaper = { ...getDefaultWelcomeWallpaper(), [field]: value };
            for (const method of ['PATCH', 'POST']) {
                const kv = createKv();
                const body = method === 'PATCH' ? { welcomeWallpaper: wallpaper } : { config: [{ id: 'welcomeWallpaper', value: wallpaper }] };
                const response = await pageSettings({ env: { img_url: kv }, request: request(method, body) });
                assert.equal(response.status, 400, `${method}: ${field} ${JSON.stringify(value)}`);
                assert.ok((await response.json()).field.startsWith('welcomeWallpaper.'));
                assert.equal(kv.writes.length, 0);
            }
        }
    });

    it('rejects unrelated PATCH fields, malformed JSON, and cross-site writes without storing anything', async () => {
        const kv = createKv();
        const env = { img_url: kv };
        for (const body of [{}, { siteTitle: 'changed' }, { welcomeWallpaper: getDefaultWelcomeWallpaper(), siteTitle: 'changed' }]) {
            assert.equal((await pageSettings({ env, request: request('PATCH', body) })).status, 400);
        }
        for (const method of ['PATCH', 'POST']) {
            const malformed = new Request('https://example.test/api/manage/sysConfig/page', { method, body: '{' });
            assert.equal((await pageSettings({ env, request: malformed })).status, 400);
            assert.equal((await pageSettings({ env, request: request(method, { welcomeWallpaper: getDefaultWelcomeWallpaper() }, 'https://other.test') })).status, 403);
        }
        assert.equal(kv.writes.length, 0);
    });

    it('returns fresh defaults and rejects non-object textarea content', () => {
        const first = getDefaultWelcomeWallpaper();
        first.items[0].positionX = 0;
        assert.equal(getDefaultWelcomeWallpaper().items[0].positionX, 50);
        assert.throws(() => validateWelcomeWallpaper('null'), /完整/);
        assert.throws(() => validateWelcomeWallpaper('{'), /JSON/);
    });
});
