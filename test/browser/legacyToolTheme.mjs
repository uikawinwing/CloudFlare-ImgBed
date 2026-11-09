import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CHARINFO_PLAYWRIGHT_MODULE || 'playwright');
const assets = new URL('../../frontend-dist/', import.meta.url);
const origin = 'https://imgbed-legacy.test';
const legacyPaths = new Set(['/customerConfig', '/systemConfig']);
const types = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2',
};

test('both embedded legacy tools follow the workspace theme through startup and theme changes', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1200, height: 860 } });
    await context.addInitScript(() => {
      if (window.top === window) {
        localStorage.setItem('imgbed-theme', 'dark');
        localStorage.setItem('vuex', JSON.stringify({ cusDarkMode: true, useDarkMode: false }));
      }
    });
    await context.route(origin + '/**', async route => {
      const { pathname } = new URL(route.request().url());
      const json = data => route.fulfill({ json: data });
      if (pathname === '/api/user/me') return json({ authenticated: true, user: { id: 'fixture', username: 'Fixture', role: 'owner' } });
      if (pathname === '/api/auth/sessionCheck') return json({ valid: true, authType: 'admin', adminRequired: true });
      if (pathname === '/api/user/files') return json({ files: [], usedBytes: 0 });
      if (pathname === '/api/user/albums') return json({ albums: [] });
      if (pathname === '/api/uploadPolicy') return route.fulfill({ contentType: types.js, body: '' });
      if (pathname === '/api/userConfig') {
        // The legacy bundle applies its stored mode only after loading this configuration.
        await new Promise(resolve => setTimeout(resolve, 100));
        return json({});
      }
      if (pathname === '/api/manage/cusConfig/list') return json([{ ip: '192.0.2.1', address: 'Example', count: 2 }]);
      if (pathname === '/api/manage/cusConfig/blockipList') return route.fulfill({ contentType: 'text/plain', body: '' });
      if (pathname === '/api/manage/list') return json({
        totalFiles: 2, channelDistribution: { Discord: 2 }, typeDistribution: { normal: 2 },
        uploadTrend: { labels: ['2026-11-08'], total: [2], groupBy: { channel: { series: [] } } },
      });
      const file = legacyPaths.has(pathname) ? 'legacy.html' : pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '');
      return route.fulfill({ body: readFileSync(new URL(file, assets)), contentType: types[file.split('.').at(-1)] });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/account/?tool=access');
    const access = page.frameLocator('iframe[title="上传访问"]');
    const maintenance = page.frameLocator('iframe[title="维护工具"]');
    await access.getByText('192.0.2.1', { exact: true }).waitFor();
    const table = access.locator('.el-table');
    const card = maintenance.locator('.overview-card').first();
    const appearance = locator => locator.evaluate(element => ({
      theme: document.documentElement.dataset.theme,
      dark: document.documentElement.classList.contains('dark'),
      background: getComputedStyle(element).backgroundColor,
    }));
    const darkTable = await appearance(table);
    await page.getByRole('link', { name: '维护工具' }).click();
    await maintenance.locator('.trend-chart-card canvas').waitFor();
    const darkCard = await appearance(card);
    assert.deepEqual([darkTable.theme, darkTable.dark, darkCard.theme, darkCard.dark], ['dark', true, 'dark', true]);

    await page.locator('[data-legacy-command="theme"]').click();
    await maintenance.locator('html[data-theme="light"]:not(.dark)').waitFor();
    assert.notEqual((await appearance(card)).background, darkCard.background);
    await page.getByRole('link', { name: '上传访问' }).click();
    await access.locator('html[data-theme="light"]:not(.dark)').waitFor();
    assert.notEqual((await appearance(table)).background, darkTable.background);

    await page.locator('[data-legacy-command="theme"]').click();
    await access.locator('html[data-theme="dark"].dark').waitFor();
    assert.deepEqual(await appearance(table), darkTable);
    await page.getByRole('link', { name: '维护工具' }).click();
    assert.deepEqual(await appearance(card), darkCard);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
