import assert from 'node:assert/strict';
import { getPageConfig, onRequest as pageSettings } from '../functions/api/manage/sysConfig/page.js';
import { onRequest as userConfig } from '../functions/api/userConfig.js';
import { getDefaultWelcomeWallpaper } from '../functions/utils/welcomeWallpaper.js';

const settingsKey = 'manage@sysConfig@page';

function createKv(settings) {
    const values = new Map(settings ? [[settingsKey, JSON.stringify(settings)]] : []);
    let writes = 0;
    return { values, get: async key => values.get(key) ?? null, put: async (key, value) => { writes++; values.set(key, value); }, get writes() { return writes; } };
}

function request(body, method = 'PATCH', origin = 'https://example.test') {
    return new Request('https://example.test/api/manage/sysConfig/page', {
        method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(body),
    });
}

function valueOf(settings, id) {
    return settings.config.find(item => item.id === id)?.value;
}

describe('page values settings', () => {
    it('describes the modern branding and workspace wallpaper without changing the legacy field IDs', async () => {
        const settings = await getPageConfig(createKv(), {});
        for (const id of ['siteTitle', 'ownerName']) assert.equal(settings.config.find(item => item.id === id).placeholder, 'Charatopia');
        assert.equal(valueOf(settings, 'bkInterval'), 3000);
        assert.equal(valueOf(settings, 'bkOpacity'), 1);
        for (const id of ['bkInterval', 'bkOpacity', 'wallpaperEnabled']) assert.match(settings.config.find(item => item.id === id).label, /工作区/);
        for (const id of ['uploadBkImg', 'adminBkImg']) assert.doesNotMatch(settings.config.find(item => item.id === id).tooltip, /bing/);
        assert.ok(settings.config.some(item => item.id === 'loginBkImg'));
        assert.ok(settings.config.some(item => item.id === 'adminLoginBkImg'));
    });

    it('patches only the submitted values and preserves the queue, unknown saved fields, and announcement state', async () => {
        const original = {
            announcementRefreshAt: 123,
            retainedMetadata: 'keep',
            config: [
                { id: 'welcomeWallpaper', value: getDefaultWelcomeWallpaper() },
                { id: 'siteTitle', value: 'Old title' },
                { id: 'ownerName', value: 'Existing name' },
                { id: 'announcement', value: 'Keep this announcement' },
                { id: 'uploadBkImg', value: 'bing' },
                { id: 'unknown-old-setting', value: ['keep'] },
            ],
        };
        const kv = createKv(original);
        const response = await pageSettings({ env: { img_url: kv }, request: request({ pageValues: { siteTitle: ' New title ', urlPrefix: 'https://cdn.example/file/' } }) });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        assert.equal(valueOf(persisted, 'siteTitle'), 'New title');
        assert.equal(valueOf(persisted, 'urlPrefix'), 'https://cdn.example/file/');
        assert.deepEqual(persisted.config.filter(item => !['siteTitle', 'urlPrefix'].includes(item.id)), original.config.filter(item => item.id !== 'siteTitle'));
        assert.equal(persisted.announcementRefreshAt, 123);
        assert.equal(persisted.retainedMetadata, 'keep');
        const returned = await response.json();
        assert.equal(valueOf(returned, 'siteTitle'), 'New title');
        assert.deepEqual(JSON.parse(valueOf(returned, 'welcomeWallpaper')), getDefaultWelcomeWallpaper());
        assert.equal(kv.writes, 1);
    });

    it('normalizes legacy numeric strings and supports URLs, URL arrays, and JSON URL arrays', async () => {
        const kv = createKv();
        const patch = {
            bkInterval: '5000', bkOpacity: '0.45', wallpaperEnabled: false,
            uploadBkImg: ['/files/壁纸 1.jpg', 'https://images.example/b.jpg'],
            adminBkImg: '["/admin-one.jpg","https://images.example/admin-two.jpg"]',
            siteIcon: '/icons/site.svg', logoUrl: 'https://images.example/logo.png', logoLink: '/discover/',
        };
        const response = await pageSettings({ env: { img_url: kv }, request: request({ pageValues: patch }) });
        assert.equal(response.status, 200);
        const config = await (await userConfig({ env: { img_url: kv } })).json();
        assert.equal(config.bkInterval, 5000);
        assert.equal(config.bkOpacity, 0.45);
        assert.equal(config.wallpaperEnabled, false);
        assert.deepEqual(config.uploadBkImg, ['/files/%E5%A3%81%E7%BA%B8%201.jpg', 'https://images.example/b.jpg']);
        assert.deepEqual(config.adminBkImg, ['/admin-one.jpg', 'https://images.example/admin-two.jpg']);
        assert.equal(config.logoLink, '/discover/');
        const single = await pageSettings({ env: { img_url: kv }, request: request({ pageValues: { uploadBkImg: '/single.jpg' } }) });
        assert.equal(single.status, 200);
        assert.equal(valueOf(JSON.parse(kv.values.get(settingsKey)), 'uploadBkImg'), '/single.jpg');
    });

    it('allows clearing configurable values to use their defaults', async () => {
        const kv = createKv();
        const cleared = Object.fromEntries(['siteTitle', 'ownerName', 'siteIcon', 'logoUrl', 'logoLink', 'urlPrefix', 'bkInterval', 'bkOpacity', 'uploadBkImg', 'adminBkImg'].map(id => [id, '']));
        const response = await pageSettings({ env: { img_url: kv }, request: request({ pageValues: cleared }) });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        for (const id of Object.keys(cleared)) assert.equal(valueOf(persisted, id), '');
    });

    it('refreshes the announcement only when its content changes', async () => {
        const kv = createKv({ announcementRefreshAt: 123, config: [{ id: 'announcement', value: 'Original' }] });
        const unchanged = await pageSettings({ env: { img_url: kv }, request: request({ pageValues: { announcement: 'Original' } }) });
        assert.equal(unchanged.status, 200);
        assert.equal(JSON.parse(kv.values.get(settingsKey)).announcementRefreshAt, 123);
        const changed = await pageSettings({ env: { img_url: kv }, request: request({ pageValues: { announcement: 'Updated' } }) });
        assert.equal(changed.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        assert.ok(persisted.announcementRefreshAt > 123);
        assert.equal(valueOf(persisted, 'announcement'), 'Updated');
    });

    it('does not refresh an environment-provided announcement when patching another field', async () => {
        const kv = createKv({ announcementRefreshAt: 123, config: [] });
        const response = await pageSettings({ env: { img_url: kv, USER_CONFIG: JSON.stringify({ announcement: 'Environment announcement' }) }, request: request({ pageValues: { siteTitle: 'Charatopia' } }) });
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(kv.values.get(settingsKey)).announcementRefreshAt, 123);
    });

    it('rejects unknown fields, wallpaper-through-pageValues, and mixed PATCH payloads without writing', async () => {
        const kv = createKv();
        const invalid = [
            { pageValues: { unknown: true } },
            { pageValues: { welcomeWallpaper: getDefaultWelcomeWallpaper() } },
            { pageValues: [], },
            { pageValues: null },
            { pageValues: { siteTitle: 'Title' }, welcomeWallpaper: getDefaultWelcomeWallpaper() },
        ];
        for (const body of invalid) assert.equal((await pageSettings({ env: { img_url: kv }, request: request(body) })).status, 400);
        assert.equal(kv.writes, 0);
    });

    it('validates branding URLs and workspace numeric/image values in PATCH and changed full POST fields', async () => {
        const invalid = [
            ...['siteIcon', 'logoUrl', 'logoLink', 'urlPrefix'].flatMap(id => ['javascript:alert(1)', '//images.example/a.jpg', '/\\images.example/a.jpg', 'https://user:pass@images.example/a.jpg', 'https://images.example/\na.jpg'].map(value => [id, value])),
            ...['https://cdn.example/file/?token=abc', 'https://cdn.example/file/#fragment', '/file/?', '/file/#'].map(value => ['urlPrefix', value]),
            ['siteTitle', {}], ['ownerName', []], ['bkInterval', 999], ['bkInterval', 3600001], ['bkInterval', 'not a number'], ['bkInterval', 1000.5],
            ['bkOpacity', -0.1], ['bkOpacity', '1.01'], ['wallpaperEnabled', 'not a boolean'],
            ['uploadBkImg', 'bing'], ['uploadBkImg', '["/ok.jpg", "javascript:bad"]'], ['adminBkImg', ['/ok.jpg', 'data:image/png;base64,abc']],
        ];
        for (const [id, value] of invalid) for (const method of ['PATCH', 'POST']) {
            const kv = createKv();
            const body = method === 'PATCH' ? { pageValues: { [id]: value } } : { config: [{ id, value }] };
            const response = await pageSettings({ env: { img_url: kv }, request: request(body, method) });
            assert.equal(response.status, 400, `${method} ${id} ${JSON.stringify(value)}`);
            assert.ok((await response.json()).field.startsWith(`pageValues.${id}`));
            assert.equal(kv.writes, 0);
        }
    });

    it('allows a full legacy POST to retain unchanged old values while validating changes', async () => {
        const original = {
            announcementRefreshAt: 123,
            config: [
                { id: 'uploadBkImg', value: 'bing' }, { id: 'logoLink', value: '#' },
                { id: 'bkInterval', value: '500' }, { id: 'announcement', value: 'Same announcement' },
            ],
        };
        const kv = createKv(original);
        const settings = await getPageConfig(kv, { img_url: kv });
        settings.config.find(item => item.id === 'siteTitle').value = 'Updated title';
        const response = await pageSettings({ env: { img_url: kv }, request: request(settings, 'POST') });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        for (const id of ['uploadBkImg', 'logoLink', 'bkInterval']) assert.equal(valueOf(persisted, id), valueOf(original, id));
        assert.equal(valueOf(persisted, 'siteTitle'), 'Updated title');
        assert.equal(persisted.announcementRefreshAt, 123);
    });

    it('keeps query parameters and fragments valid for brand URLs while restricting public file prefixes', async () => {
        const kv = createKv();
        const values = { siteIcon: '/icon.svg?v=2', logoUrl: 'https://images.example/logo.svg?v=2#mark', logoLink: '/discover/?query=flowers#gallery', urlPrefix: '/file/encoded%3Fname/' };
        const response = await pageSettings({ env: { img_url: kv }, request: request({ pageValues: values }) });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        for (const [id, value] of Object.entries(values)) assert.equal(valueOf(persisted, id), value);
    });

    it('keeps the welcome-only PATCH working and rejects cross-site page writes', async () => {
        const kv = createKv({ config: [{ id: 'siteTitle', value: 'Retained title' }] });
        const wallpaper = getDefaultWelcomeWallpaper();
        wallpaper.intervalSeconds = 30;
        const response = await pageSettings({ env: { img_url: kv }, request: request({ welcomeWallpaper: wallpaper }) });
        assert.equal(response.status, 200);
        const persisted = JSON.parse(kv.values.get(settingsKey));
        assert.equal(valueOf(persisted, 'siteTitle'), 'Retained title');
        assert.deepEqual(valueOf(persisted, 'welcomeWallpaper'), wallpaper);
        assert.equal((await pageSettings({ env: { img_url: kv }, request: request({ pageValues: { siteTitle: 'Changed' } }, 'PATCH', 'https://other.test') })).status, 403);
        assert.equal(kv.writes, 1);
    });
});
