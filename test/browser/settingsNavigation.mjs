import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CHARINFO_PLAYWRIGHT_MODULE || 'playwright');
const origin = 'https://imgbed-settings.test';
const assets = new URL('../../frontend-dist/', import.meta.url);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png' };
const names = ['存储渠道', '网站设置', '欢迎页壁纸', '安全与自动化', '其他设置'];
const configPath = '/api/manage/sysConfig/';

async function fixture(page, { role = 'owner', handleSettings } = {}) {
  await page.route(origin + '/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (data, status = 200) => route.fulfill({ json: data, status });
    if (pathname === '/api/user/me') return json({ authenticated: true, user: { id: 'fixture', username: 'Fixture', role } });
    if (pathname === '/api/user/files') return json({ files: [] });
    if (pathname === '/api/user/albums') return json({ albums: [] });
    if (pathname.startsWith(configPath) || pathname === '/api/manage/apiTokens') return handleSettings(pathname, request, json);
    if (pathname.startsWith('/api/')) return json({});
    if (['/customerConfig', '/systemConfig'].includes(pathname)) return route.fulfill({ contentType: types.html, body: '<title>Legacy tools</title>' });
    const file = pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '');
    return route.fulfill({ body: readFileSync(new URL(file, assets)), contentType: types[file.split('.').at(-1)] });
  });
}

test('native settings share navigation order, warm reads, and saved website configuration', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const reads = new Map();
    const config = [
      { id: 'siteTitle', label: '网页标题', value: 'Example' },
      { id: 'welcomeWallpaper', value: { enabled: true, intervalSeconds: 8, opacity: 1, items: [] } },
    ];
    let releasePageRead;
    const pageRead = new Promise(resolve => { releasePageRead = resolve; });
    await fixture(page, { handleSettings: async (path, request, json) => {
      if (request.method() === 'GET') reads.set(path, (reads.get(path) || 0) + 1);
      if (path === `${configPath}page`) {
        if (request.method() === 'GET') await pageRead;
        else if (request.method() === 'PATCH') config[0].value = request.postDataJSON().pageValues.siteTitle;
        return json({ config });
      }
      if (path === '/api/manage/apiTokens') return json({ tokens: [] });
      return json({});
    } });

    const panel = page.locator('#nativeToolHost');
    const tabs = panel.getByRole('navigation', { name: '系统设置' });
    const sidebar = page.locator('#legacyShell');
    const heading = () => panel.locator('h1').innerText();
    const tab = name => tabs.getByRole('link', { name, exact: true });
    const side = name => sidebar.getByRole('link', { name, exact: true });
    const assertWarmSwitch = async (name, link = tab(name)) => {
      const result = await link.evaluate(element => {
        element.click();
        const host = document.querySelector('#nativeToolHost');
        return { heading: host.querySelector('h1')?.textContent, loading: Boolean(host.querySelector('.loading-state')) };
      });
      assert.deepEqual(result, { heading: name, loading: false });
    };

    await page.goto(`${origin}/account/?tool=system-upload`);
    await panel.getByRole('heading', { name: 'Telegram' }).waitFor();
    assert.equal(await heading(), '存储渠道');
    assert.deepEqual(await tabs.getByRole('link').allTextContents(), names);
    const sideNames = await sidebar.locator('a[href^="/account/?tool=system-"] span').allTextContents();
    assert.deepEqual(sideNames, names);
    assert.equal(await sidebar.getByRole('button', { name: '切换语言' }).count(), 0);
    const theme = await page.locator('html').getAttribute('data-theme');
    await sidebar.getByRole('button', { name: '切换主题' }).click();
    assert.notEqual(await page.locator('html').getAttribute('data-theme'), theme);
    assert.equal(reads.get('/api/manage/apiTokens'), undefined);

    // Rapid clicks during a cold shared read keep the tabs usable and render only the last target.
    await tab('网站设置').click();
    await panel.getByRole('status').getByText('正在读取设置…').waitFor();
    await tab('欢迎页壁纸').click();
    assert.equal(await heading(), '欢迎页壁纸');
    releasePageRead();
    await panel.getByRole('heading', { name: '播放设置' }).waitFor();
    assert.equal(reads.get(`${configPath}page`), 1);

    await assertWarmSwitch('网站设置', side('网站设置'));
    assert.equal(await tabs.locator('[aria-current="page"]').innerText(), '网站设置');
    await panel.getByRole('textbox', { name: '网页标题' }).fill('Saved site');
    await tab('欢迎页壁纸').click();
    await page.getByRole('alertdialog').getByRole('button', { name: '继续编辑' }).click();
    assert.equal(await heading(), '网站设置');
    assert.equal(await panel.getByRole('textbox', { name: '网页标题' }).inputValue(), 'Saved site');
    await panel.getByRole('button', { name: '保存更改' }).click();
    await panel.getByText('设置已保存。').waitFor();
    await assertWarmSwitch('欢迎页壁纸');
    await assertWarmSwitch('网站设置');
    assert.equal(await panel.getByRole('textbox', { name: '网页标题' }).inputValue(), 'Saved site');
    assert.equal(reads.get(`${configPath}page`), 1);

    await assertWarmSwitch('其他设置');
    assert.equal(await side('其他设置').getAttribute('aria-current'), 'page');
    const other = panel.locator('[data-other-field="randomImageAPI.allowedDir"]');
    await other.fill('/unsaved');
    await side('存储渠道').click();
    await page.getByRole('alertdialog').getByRole('button', { name: '放弃更改' }).click();
    await assertWarmSwitch('其他设置');
    assert.equal(await other.inputValue(), '');

    await side('安全与自动化').click();
    await panel.getByRole('heading', { name: '管理 API Token' }).waitFor();
    assert.equal(reads.get('/api/manage/apiTokens'), 1);
    await assertWarmSwitch('存储渠道');
    await page.goBack();
    await panel.getByRole('heading', { name: '管理 API Token' }).waitFor();
    assert.equal(reads.get('/api/manage/apiTokens'), 1);
    await page.clock.setFixedTime(Date.now() + 31_000);
    await side('存储渠道').click();
    await panel.getByRole('heading', { name: 'Telegram' }).waitFor();
    assert.equal(reads.get(`${configPath}upload`), 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('settings read errors preserve the tabs and non-admins do not prefetch configuration', async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(7000);
    let uploads = 0;
    await fixture(page, { handleSettings: (path, request, json) => path === `${configPath}upload` && ++uploads === 1 ? json({ error: '暂时无法连接' }, 503) : json({}) });
    await page.goto(`${origin}/account/?tool=system-upload`);
    await page.getByRole('heading', { name: '无法读取设置' }).waitFor();
    assert.deepEqual(await page.getByRole('navigation', { name: '系统设置' }).getByRole('link').allTextContents(), names);
    await page.getByRole('button', { name: '重新加载' }).click();
    await page.getByRole('heading', { name: 'Telegram' }).waitFor();
    assert.equal(uploads, 2);
    const nativeHost = page.locator('#nativeToolHost');
    assert.equal(await nativeHost.evaluate(element => element.scrollWidth), 390);

    const member = await browser.newPage();
    const requests = [];
    await fixture(member, { role: 'member', handleSettings: (path, request, json) => { requests.push(path); return json({}); } });
    await member.goto(`${origin}/account/?tool=system-upload`);
    await member.getByRole('heading', { name: '无权访问系统设置' }).waitFor();
    assert.deepEqual(requests, []);
  } finally { await browser.close(); }
});
