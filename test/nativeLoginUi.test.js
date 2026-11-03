import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Charatopia native Discord login', () => {
  const redirects = read('../frontend-dist/_redirects');
  const page = read('../frontend-dist/login/index.html');
  const script = read('../frontend-dist/login/login.js');

  it('replaces only the legacy login route with a native branded page', () => {
    assert.match(redirects, /^\/login \/login\/index\.html 200$/m);
    assert.match(redirects, /^\/login\/ \/login 302$/m);
    assert.match(redirects, /^\/adminLogin \/login 302$/m);
    assert.match(page, /data-site-name/);
    assert.match(page, /\/site\.js/);
    assert.match(page, /\/theme\.css/);
    assert.match(page, /Charatopia/);
    assert.doesNotMatch(page, /Sanyue|ImgHub/i);
  });

  it('keeps Discord OAuth and a validated local return destination', () => {
    assert.match(page, /id="discordLogin"/);
    assert.match(script, /\/api\/auth\/discord\?returnTo=/);
    assert.match(script, /startsWith\('\/\'\)/);
    assert.match(script, /startsWith\('\/\/\'\)/);
    assert.match(script, /value\.length > 500/);
    assert.match(script, /credentials: 'same-origin'/);
    assert.match(script, /location\.replace\(returnTo\)/);
    assert.doesNotMatch(script, /Sanyue|ImgHub/i);
  });
});