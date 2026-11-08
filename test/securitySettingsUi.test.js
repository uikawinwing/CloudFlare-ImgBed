import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../frontend-dist/account/storage-settings.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../frontend-dist/account/legacy-tools.js', import.meta.url), 'utf8');

function editor() {
  const app = runInNewContext(`${source.replace(/^import .*;\r?\n/gm, '')}\n({ state, securityMarkup, validateSecuritySettings })`, {
    location: new URL('https://example.test/account/?view=files'), URL,
    document: { querySelector: () => null }, window: { addEventListener() {} },
  });
  app.state.activeKey = 'system-security';
  app.state.security = {
    auth: { user: { authCode: 'hidden-old-code' }, admin: { adminPassword: 'hidden-old-password' } },
    upload: { moderate: { enabled: false, channel: 'moderatecontent.com', moderateContentApiKey: '', nsfwApiPath: 'old-unused-url' }, ipQuery: { enabled: false, customApi: { url: '', params: [], responseFields: [] } } },
    access: { allowedDomains: '', whiteListMode: false, imageTransformEnabled: false, imageTransformAllowedSizes: '', userSessionMaxAge: 99 },
  };
  return app;
}

describe('native security settings', () => {
  it('uses the native settings route and removes obsolete authentication and session controls', () => {
    assert.match(routes, /'system-security': \{ key: 'system-security', native: 'storage-settings'/);
    const markup = editor().securityMarkup();
    assert.doesNotMatch(markup, /hidden-old|authCode|adminPassword|adminUsername|SessionMaxAge|sessionSecure|上传密码|管理端认证/);
    for (const label of ['图像审查', '上传地点记录', '文件访问', '管理 API Token']) assert.ok(markup.includes(label));
    assert.match(markup, /尚未创建管理令牌/);
    assert.match(markup, /data-save-settings disabled/);
  });

  it('only shows credentials for the selected review service and escapes untrusted values', () => {
    const app = editor();
    app.state.security.upload.moderate.moderateContentApiKey = '\"><img src=x onerror=alert(1)>';
    let markup = app.securityMarkup();
    assert.match(markup, /data-security-field="upload.moderate.moderateContentApiKey"/);
    assert.doesNotMatch(markup, /data-security-field="upload.moderate.nsfwApiPath"|<img src=x/);
    assert.match(markup, /&lt;img/);
    app.state.securityChanges['upload.moderate.channel'] = 'nsfwjs';
    markup = app.securityMarkup();
    assert.match(markup, /data-security-field="upload.moderate.nsfwApiPath"/);
    assert.doesNotMatch(markup, /data-security-field="upload.moderate.moderateContentApiKey"/);
  });

  it('validates active services without blocking an unrelated edit on an unused legacy URL', () => {
    const app = editor();
    app.state.securityChanges['access.allowedDomains'] = 'example.test';
    assert.equal(app.validateSecuritySettings(), null);
    app.state.securityChanges['upload.moderate.enabled'] = true;
    assert.equal(app.validateSecuritySettings().id, 'upload.moderate.moderateContentApiKey');
    app.state.securityChanges['upload.moderate.moderateContentApiKey'] = 'test-only-key';
    assert.equal(app.validateSecuritySettings(), null);
    app.state.securityChanges['upload.moderate.channel'] = 'nsfwjs';
    assert.equal(app.validateSecuritySettings().id, 'upload.moderate.nsfwApiPath');
    app.state.securityChanges['upload.moderate.nsfwApiPath'] = 'https://review.example.test/';
    assert.equal(app.validateSecuritySettings(), null);
    app.state.securityChanges['upload.ipQuery.enabled'] = true;
    assert.equal(app.validateSecuritySettings().id, 'upload.ipQuery.customApi.url');
  });
});
