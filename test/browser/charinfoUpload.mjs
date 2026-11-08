// Opt-in: CHARINFO_PLAYWRIGHT_MODULE=/path/to/playwright node --test test/browser/charinfoUpload.mjs
// OAuth identities and storage are isolated fixtures; no Discord or deployed data is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CHARINFO_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../..', import.meta.url));
const charinfo = process.env.CHARINFO_MANAGER_ROOT || path.resolve(root, '../../poem-of-destiny/CharInfo-Manager');
const httpsOrigin = 'https://imgbed-staging.uika.cc.cd';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function runtimeFixture() {
  const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'browser', stdin: {
    resolveDir: root,
    contents: `import {onRequestPost as pair} from './functions/api/charinfo-upload/pair.js';
      import {onRequestPost as launch} from './functions/api/charinfo-upload/launch.js';
      import {onRequestPost as auth} from './functions/api/charinfo-upload/auth.js';
      import {onRequestPost as gallery} from './functions/api/charinfo-upload/gallery.js';
      import {onRequestPost as file} from './functions/api/charinfo-upload/file.js';
      import {onRequestGet as pack} from './functions/api/public/album-gallery/[albumId].js';
      export default {fetch(request,env,ctx){const url=new URL(request.url),context={request,env,waitUntil:ctx.waitUntil.bind(ctx)};
        if(url.pathname.startsWith('/api/public/album-gallery/'))return pack({...context,params:{albumId:url.pathname.split('/').pop()}});
        const handler={pair,launch,auth,gallery,file}[url.pathname.split('/').pop()];
        return handler&&request.method==='POST'?handler(context):new Response('Not found',{status:404});}}`,
  } });
  const runtime = new Miniflare(convertV4MiniflareOptions({ name: 'browser-upload', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-25',
    d1Databases: ['img_d1'], kvNamespaces: ['img_url'], r2Buckets: ['img_r2', 'CHARINFO_UPLOAD_STAGING'] }));
  const db = await runtime.getD1Database('img_d1');
  const schema = readFileSync(path.join(root, 'database/init.sql'), 'utf8').replace(/^--.*$/gm, '');
  for (const sql of schema.match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/g) || []) await db.prepare(sql).run();
  await db.prepare("INSERT INTO users(discord_id,username,role,status,created_at,updated_at) VALUES ('a','Simulated Discord A','member','active',1,1),('b','Simulated Discord B','member','active',1,1)").run();
  const kv = await runtime.getKVNamespace('img_url');
  for (const id of ['a', 'b']) await kv.put(`manage@session@browser-${id}`, JSON.stringify({ authType: 'user', expiresAt: Date.now() + 600000, identity: { id } }));
  await kv.put('manage@sysConfig@page', JSON.stringify({ config: [{ id: 'defaultUploadChannel', value: 'cfr2' }] }));
  return { runtime, db };
}

async function scriptFixture(origin, stOrigin) {
  const bundle = await build({ bundle: true, write: false, format: 'iife', globalName: 'Upload', platform: 'browser',
    entryPoints: [path.join(charinfo, 'src/char_info_profile_editor/services/imgbedUploadBridge.ts')],
    plugins: [{ name: 'test-service-origin', setup(builder) {
      builder.onResolve({ filter: /services\/imgbedBridge$/ }, () => ({ path: 'test-origin', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const IMG_BED_ORIGIN=${JSON.stringify(origin)};
        export function canonicalImgbedGalleryUrl(value){return /^[0-9a-f-]{36}$/.test(value)?IMG_BED_ORIGIN+'/api/public/album-gallery/'+value:null;}` }));
    } }],
  });
  return `${bundle.outputFiles[0].text}
    window.upload=Upload.createImgbedUploadBridge(window,${JSON.stringify(stOrigin)});
    const editor=parent.document.createElement('iframe');editor.title='角色档案编辑器';editor.style='width:100%;height:250px';
    editor.onload=()=>{const point=editor.contentDocument.body,button=editor.contentDocument.createElement('button');
      button.textContent='连接 ImgBed';button.onclick=()=>{window.result=upload.connect(point).catch(e=>e.code)};point.append(button);window.mounted=true;};
    editor.srcdoc='<!doctype html><meta charset=utf-8><body></body>';parent.document.body.append(editor);`;
}

function staticResponse(url) {
  let pathname = url.pathname;
  if (pathname === '/charinfo-upload/') pathname += 'index.html';
  else if (['/charinfo-upload/launcher', '/charinfo-upload/connect'].includes(pathname)) pathname += '.html';
  // Branding and theme startup are unrelated to authorization and make extra API calls.
  if (['/site.js', '/theme.js'].includes(pathname)) return { status: 200, headers: { 'Content-Type': 'text/javascript' }, body: 'export {}' };
  try {
    const body = readFileSync(path.join(root, 'frontend-dist', pathname));
    const headers = { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'Referrer-Policy': pathname.includes('/launcher') ? 'same-origin' : 'no-referrer' };
    if (pathname.includes('/connect')) { headers['Content-Security-Policy'] = "frame-ancestors 'none'"; headers['X-Frame-Options'] = 'DENY'; }
    return { status: 200, headers, body };
  } catch { return { status: 404, body: 'Not found' }; }
}

async function dispatch(runtime, url, method, headers, body) {
  // Miniflare's dispatchFetch overwrites Sec-Fetch-Mode; its documented proxy header preserves it.
  if (headers['sec-fetch-mode']) headers['MF-Sec-Fetch-Mode'] = headers['sec-fetch-mode'];
  return runtime.dispatchFetch(url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, redirect: 'manual' });
}

test('native Chrome form metadata + HttpOnly launch cookie authorize without opener under COOP (simulated account)', async () => {
  const { runtime } = await runtimeFixture();
  const launches = [], errors = [];
  let ownOrigin, stOrigin, script;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, ownOrigin);
      if (url.pathname === '/api/auth/discord') {
        const returnTo = url.searchParams.get('returnTo');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<h1>模拟 Discord 登录</h1><a href="/fixture-oauth-complete?returnTo=${encodeURIComponent(returnTo)}">模拟账号登录</a>`);
        return;
      }
      if (url.pathname === '/fixture-oauth-complete') {
        response.writeHead(302, { Location: url.searchParams.get('returnTo'), 'Set-Cookie': 'user_session=browser-a; Path=/; HttpOnly; SameSite=Strict' });
        response.end(); return;
      }
      if (url.pathname.startsWith('/api/')) {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        if (url.pathname.endsWith('/launch')) launches.push({ ...request.headers });
        const result = await dispatch(runtime, url.href, request.method, { ...request.headers }, Buffer.concat(chunks));
        response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
      } else { const result = staticResponse(url); response.writeHead(result.status, result.headers); response.end(result.body); }
    } catch (error) { errors.push(error.message); response.writeHead(500); response.end('Fixture failure'); }
  });
  const st = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': request.url === '/script.js' ? 'text/javascript' : 'text/html; charset=utf-8', 'Cross-Origin-Opener-Policy': 'same-origin' });
    response.end(request.url === '/script.js' ? script : `<iframe name="tavern-script" hidden srcdoc="&lt;script src='${stOrigin}/script.js'&gt;&lt;/script&gt;"></iframe>`);
  });
  await new Promise(resolve => server.listen(0, resolve)); ownOrigin = `http://localhost:${server.address().port}`;
  await new Promise(resolve => st.listen(0, resolve)); stOrigin = `http://127.0.0.1:${st.address().port}`;
  script = await scriptFixture(ownOrigin, stOrigin);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext(); context.setDefaultTimeout(7000);
    const page = await context.newPage(); await page.goto(stOrigin);
    const scriptFrame = page.frame({ name: 'tavern-script' }); await scriptFrame.waitForFunction(() => window.mounted);
    await page.frameLocator('iframe[title="角色档案编辑器"]').getByRole('button', { name: '连接 ImgBed', exact: true }).click();
    const opened = context.waitForEvent('page');
    await page.frameLocator('iframe[title="角色档案编辑器"]').frameLocator('iframe[title="连接 ImgBed"]').getByRole('button', { name: '连接 ImgBed' }).click();
    const popup = await opened;
    await popup.getByRole('heading', { name: '模拟 Discord 登录' }).waitFor();
    assert.equal(await popup.evaluate(() => window.opener), null);
    assert.equal(launches.length, 1);
    assert.equal(launches[0].origin, ownOrigin);
    for (const [name, expected] of Object.entries({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })) assert.equal(launches[0][name], expected);
    assert.equal(new URL(popup.url()).pathname, '/api/auth/discord');
    await popup.getByRole('link', { name: '模拟账号登录' }).click();
    await popup.getByRole('button', { name: '允许连接' }).waitFor();
    await popup.waitForFunction(() => !document.querySelector('#approveConnection').disabled);
    assert.equal(await popup.locator('#connectionOrigin').textContent(), stOrigin);
    assert.equal(await popup.locator('#connectionAccount').textContent(), 'Simulated Discord A');
    assert.equal(await popup.evaluate(() => document.cookie.includes('charinfo-upload')), false);
    await popup.getByRole('button', { name: '允许连接' }).click();
    await scriptFrame.waitForFunction(() => window.upload.getState().status === 'connected');
    assert.equal(await scriptFrame.evaluate(() => window.upload.getState().accountName), 'Simulated Discord A');
    const pageCount = context.pages().length;
    await scriptFrame.evaluate(async () => {
      window.upload.destroy();
      window.upload = Upload.createImgbedUploadBridge(window, parent.location.origin);
      await window.upload.status();
    });
    assert.equal(await scriptFrame.evaluate(() => window.upload.getState().status), 'connected');
    assert.equal(context.pages().length, pageCount, 'A valid saved authorization resumes without another login popup');
    await scriptFrame.evaluate(() => window.upload.disconnect());
    assert.equal(await scriptFrame.evaluate(() => window.upload.getState().status), 'required');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await new Promise(resolve => st.close(resolve)); await runtime.dispose(); }
});

for (const stOrigin of ['http://localhost:8000', 'http://192.168.1.41:8000', 'http://100.75.12.3:8000']) {
  test(`real frontends + Worker upload/reuse at ${stOrigin} with COOP (simulated OAuth and HTTPS transport)`, async () => {
    const { runtime, db } = await runtimeFixture();
    const script = await scriptFixture(httpsOrigin, stOrigin);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: stOrigin.includes('192.168') ? { width: 360, height: 800 } : { width: 1280, height: 800 } }); context.setDefaultTimeout(7000);
      const errors = [], messages = [], navigation = [], consoleProblems = [];
      context.on('page', page => {
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
          if (['error', 'warning'].includes(message.type()) && /Uncaught|SecurityError|Blocked form|sandboxed|target origin/.test(message.text())) consoleProblems.push(message.text());
        });
      });
      await context.addCookies([{ name: 'user_session', value: 'browser-a', url: httpsOrigin, httpOnly: true, secure: true }]);
      await context.route(`${stOrigin}/**`, route => route.fulfill({ contentType: route.request().url().endsWith('/script.js') ? 'text/javascript' : 'text/html; charset=utf-8',
        headers: { 'Cross-Origin-Opener-Policy': 'same-origin' }, body: route.request().url().endsWith('/script.js') ? script : `<script>addEventListener('message',e=>{});</script><iframe name="tavern-script" hidden srcdoc="&lt;script src='${stOrigin}/script.js'&gt;&lt;/script&gt;"></iframe>` }));
      await context.route(`${httpsOrigin}/**`, async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.isNavigationRequest()) navigation.push(request.method() + ' ' + url.pathname);
        if (!url.pathname.startsWith('/api/')) return route.fulfill(staticResponse(url));
        const headers = await request.allHeaders();
        // Route interception occurs before Chromium adds Fetch Metadata. Native test above checks the actual headers.
        if (url.pathname.endsWith('/launch') && request.isNavigationRequest() && request.method() === 'POST') {
          headers['sec-fetch-site'] = 'same-origin'; headers['sec-fetch-mode'] = 'navigate'; headers['sec-fetch-dest'] = 'document';
        }
        const result = await dispatch(runtime, url.href, request.method(), headers, request.postDataBuffer());
        await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
      });
      const page = await context.newPage(); await page.goto(stOrigin);
      const scriptFrame = page.frame({ name: 'tavern-script' }); await scriptFrame.waitForFunction(() => window.mounted);
      await scriptFrame.evaluate(() => { window.seen = []; addEventListener('message', e => window.seen.push(e.data)); });
      await page.frameLocator('iframe[title="角色档案编辑器"]').getByRole('button', { name: '连接 ImgBed', exact: true }).click();
      const opened = context.waitForEvent('page');
      const launchButton = page.frameLocator('iframe[title="角色档案编辑器"]').frameLocator('iframe[title="连接 ImgBed"]').getByRole('button', { name: '连接 ImgBed' });
      await launchButton.waitFor();
      const launcherFrame = page.frames().find(frame => new URL(frame.url()).pathname === '/charinfo-upload/launcher');
      await launcherFrame.waitForFunction(() => !document.querySelector('#launchButton').disabled);
      await launchButton.press('Enter');
      const popup = await opened;
      await popup.getByRole('button', { name: '允许连接' }).waitFor();
      await popup.waitForFunction(() => !document.querySelector('#approveConnection').disabled);
      assert.equal(await popup.evaluate(() => window.opener), null);
      assert.equal(await scriptFrame.evaluate(() => window.upload.getState().status), 'connecting');
      await popup.getByRole('button', { name: '允许连接' }).click();
      await scriptFrame.waitForFunction(() => window.upload.getState().status === 'connected');
      const result = await scriptFrame.evaluate(async bytes => {
        const file = new File([new Uint8Array(bytes)], 'portrait.png', { type: 'image/png' });
        window.input = { requestId: 'browser_save', albumId: null, characterName: '测试角色', files: [{ id: 'one', title: '主立绘', file, nsfw: true }], order: [{ uploadId: 'one' }] };
        return window.upload.save(window.input);
      }, [...png]);
      assert.equal(result.items.length, 1);
      assert.equal(result.remoteGalleryUrl, `${httpsOrigin}/api/public/album-gallery/${result.albumId}`);
      assert.deepEqual(await scriptFrame.evaluate(() => window.upload.save(window.input)), result);
      const reordered = await scriptFrame.evaluate(async album => window.upload.save({ requestId: 'reorder', albumId: album.albumId,
        characterName: '测试角色', files: [], order: [{ itemId: album.items[0].id }] }), result);
      assert.equal(reordered.albumId, result.albumId);
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM files').first()).count, 1);
      assert.equal((await db.prepare("SELECT json_type(metadata, '$.NSFW') AS nsfw FROM files").first()).nsfw, 'true');
      assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM albums').first()).count, 1);
      const pack = await (await runtime.dispatchFetch(result.remoteGalleryUrl)).json();
      assert.equal(pack.packId, result.albumId); assert.equal(pack.profileId, result.albumId);
      messages.push(...await scriptFrame.evaluate(() => window.seen));
      assert.equal(messages.some(value => ['proof', 'resumeProof', 'token', 'cookie'].some(key => Object.hasOwn(value, key))), false);
      await scriptFrame.evaluate(() => window.upload.disconnect());
      assert.equal(await scriptFrame.evaluate(() => window.upload.getState().status), 'required');
      if (stOrigin === 'http://localhost:8000') {
        async function reconnect() {
          await page.frameLocator('iframe[title="角色档案编辑器"]').getByRole('button', { name: '连接 ImgBed', exact: true }).click();
          const launch = page.frameLocator('iframe[title="角色档案编辑器"]').frameLocator('iframe[title="连接 ImgBed"]');
          await launch.getByRole('button', { name: '连接 ImgBed' }).waitFor();
          const opening = context.waitForEvent('page');
          await launch.getByRole('button', { name: '连接 ImgBed' }).press('Enter');
          let consent;
          try { consent = await opening; }
          catch (error) { throw new Error('Reconnect popup missing: ' + JSON.stringify({
            state: await scriptFrame.evaluate(() => window.upload.getState()), navigation,
            frames: await Promise.all(page.frames().map(frame => frame.evaluate(() => ({
              url: location.pathname, text: document.body.innerText,
              form: document.querySelector('form')?.getAttribute('target'),
              inputs: Array.from(document.querySelectorAll('input')).map(input => input.name),
            })))), pages: context.pages().map(page => new URL(page.url()).pathname),
          }) + '\n' + error.message); }
          await consent.getByRole('button', { name: '允许连接' }).waitFor();
          await consent.waitForFunction(() => !document.querySelector('#approveConnection').disabled);
          return consent;
        }
        const denied = await reconnect();
        await denied.getByRole('button', { name: '取消', exact: true }).click();
        await scriptFrame.waitForFunction(() => window.upload.getState().status === 'error');
        assert.match(await scriptFrame.evaluate(() => window.upload.getState().message), /已拒绝/);
        const cancelled = await reconnect();
        await scriptFrame.evaluate(() => window.upload.cancel());
        await scriptFrame.waitForFunction(() => window.upload.getState().status === 'required');
        await cancelled.getByRole('button', { name: '允许连接' }).click();
        await cancelled.waitForFunction(() => document.querySelector('#connectionStatus').textContent.includes('授权未完成'));
        assert.equal(await scriptFrame.evaluate(() => window.upload.getState().status), 'required');
        const fresh = await reconnect();
        await fresh.getByRole('button', { name: '允许连接' }).click();
        await scriptFrame.waitForFunction(() => window.upload.getState().status === 'connected');
        await scriptFrame.evaluate(() => window.upload.disconnect());
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleProblems, []);
    } finally { await browser.close(); await runtime.dispose(); }
  });
}
