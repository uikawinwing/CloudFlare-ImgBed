import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { File } from 'node:buffer';
import { parseConnectionQuery, parseUploadMessage, canonicalOrigin, PROTOCOL, INTERNAL_PROTOCOL, OPERATION_LIMIT } from '../frontend-dist/charinfo-upload/protocol.js';
import { createUploadReceiver } from '../frontend-dist/charinfo-upload/bridge.js';
import { pairWithDirectFrame, mountConnectPage } from '../frontend-dist/charinfo-upload/connect.js';

const connectionId = 'a'.repeat(48);
const albumId = '12345678-1234-4234-8234-123456789abc';
const ownOrigin = 'https://imgbed-staging.uika.cc.cd';
const parentOrigin = 'http://192.168.1.41:8000';
const entry = `${ownOrigin}/charinfo-upload/?${new URLSearchParams({ connection_id: connectionId, parent_origin: parentOrigin })}`;
const account = { connected: true, sessionId: 'session_1', accountId: 'public_account', accountName: '测试账号', expiresAt: Date.now() + OPERATION_LIMIT, grantExpiresAt: Date.now() + 86400000, resumeProof: 'private_resume_proof' };
const envelope = (type, fields = {}) => ({ protocol: PROTOCOL, version: 1, connectionId, type, ...fields });
const file = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'portrait.png', { type: 'image/png' });
const saveMessage = () => envelope('gallery.save', { requestId: 'save_1', sessionId: 'session_1', albumId: null, characterName: '角色', files: [{ id: 'upload_1', title: '立绘', file: file() }], order: [{ uploadId: 'upload_1' }] });
const tick = () => new Promise(resolve => setImmediate(resolve));

function browserWindow(url) {
  const listeners = new Map(), timers = new Map();
  let nextTimer = 0;
  const value = { location: new URL(url), crypto: { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }, File, closed: false,
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), close() { value.closed = true; }, listeners, timers,
  };
  return value;
}

function receiver({ connected = false, storage = true, override } = {}) {
  const frame = browserWindow(entry), replies = [], calls = [], savedGrants = new Map();
  frame.parent = { postMessage: (data, origin) => replies.push({ data, origin }) };
  const server = { connected };
  const result = { albumId, characterName: '角色', remoteGalleryUrl: `${ownOrigin}/api/public/album-gallery/${albumId}`, items: [{ id: 'member_1', title: '立绘', url: `${ownOrigin}/file/users/account/portrait.png`, kind: 'image' }] };
  const request = async (url, options) => {
    calls.push({ url, ...options });
    const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    const special = await override?.(url, options, body, result);
    if (special) return special;
    if (url === '/api/charinfo-upload/pair') return Response.json({ expiresAt: Date.now() + OPERATION_LIMIT });
    if (url === '/api/charinfo-upload/auth') return Response.json(body.action === 'disconnect' ? { connected: false } : server.connected ? account : { connected: false });
    if (url.startsWith('/api/charinfo-upload/file?')) return Response.json({ staged: true });
    if (body.action === 'prepare' || body.action === 'cancel') return Response.json({ pending: true });
    if (body.action === 'read') return Response.json({ albumId, characterName: '角色', items: result.items });
    return Response.json(result);
  };
  const grants = { get: async origin => { if (!storage) throw new Error('Blocked'); return savedGrants.get(origin); }, set: async (origin, value) => savedGrants.set(origin, value), remove: async origin => savedGrants.delete(origin), close: async () => {} };
  const bridge = createUploadReceiver({ window: frame, request, grants });
  bridge.start();
  async function send(data, source = frame.parent, origin = parentOrigin) { await frame.listeners.get('message')?.({ data, source, origin }); await tick(); }
  async function connect() { await send(envelope('bridge.hello')); server.connected = true; await send(envelope('auth.status', { requestId: 'status_1' })); }
  return { frame, replies, calls, result, server, savedGrants, send, connect, bridge };
}

describe('ImgBed editor upload message contract', () => {
  it('accepts exact HTTP LAN, Tailscale and HTTPS origins, rejecting opaque or non-canonical origins', () => {
    for (const origin of ['http://localhost:8000', 'http://127.0.0.1:8000', parentOrigin, 'http://100.75.12.3:8000', 'https://st.example.org']) assert.equal(canonicalOrigin(origin), true);
    for (const origin of ['null', 'file://', 'data:text/plain,a', 'javascript:alert(1)', `${parentOrigin}/`, `${parentOrigin}?x=1`, 'http://user:pass@example.org', 'HTTP://EXAMPLE.ORG', 'http://127.1:80']) assert.equal(canonicalOrigin(origin), false);
    assert.deepEqual(parseConnectionQuery(entry), { connectionId, parentOrigin });
    assert.equal(parseConnectionQuery(`${entry}&connection_id=${connectionId}`), null);
    assert.equal(parseConnectionQuery(entry.replace(connectionId, 'short')), null);
  });

  it('validates exact field sets and keeps real File objects without encoding', () => {
    const message = saveMessage();
    assert.equal(parseUploadMessage(message, connectionId, File), message);
    assert.equal(parseUploadMessage(envelope('auth.status', { requestId: 'status', sessionId: 'existing' }), connectionId, File).sessionId, 'existing');
    for (const changed of [{ ...message, version: '1' }, { ...message, connectionId: 'b'.repeat(48) }, { ...message, unknown: true }, [message], { ...message, files: [{ id: 'upload_1', title: 'a', file: { name: 'portrait.png', size: 4, type: 'image/png' } }] }, { ...message, order: [] }, { ...message, order: [{ uploadId: 'upload_1' }, { uploadId: 'upload_1' }] }, { ...message, order: [{ itemId: 'not_existing' }] }]) assert.equal(parseUploadMessage(changed, connectionId, File), null);
  });

  it('binds only the actual parent window and exact origin; hello does not grant authorization', async () => {
    const app = receiver();
    await app.send(envelope('bridge.hello'), {}, parentOrigin);
    await app.send(envelope('bridge.hello'), app.frame.parent, 'https://evil.example');
    await app.send({ ...envelope('bridge.hello'), extra: true });
    assert.equal(app.replies.length, 0); assert.equal(app.calls.length, 0);
    await app.send(envelope('bridge.hello'));
    assert.equal(app.replies[0].data.type, 'bridge.ready'); assert.equal(app.replies[0].origin, parentOrigin);
    await app.send(envelope('auth.status', { requestId: 'status_1' }));
    assert.equal(app.replies.at(-1).data.type, 'auth.required');
    await app.send(saveMessage());
    assert.equal(app.replies.at(-1).data.code, 'AUTH_REQUIRED');
    assert.equal(app.calls.some(call => call.url.includes('/gallery')), false);
    app.bridge.dispose();
  });

  it('sends private pairing proof only to the same-origin popup opened by this parent', async () => {
    const app = receiver(); const pairing = [];
    const popup = { opener: app.frame.parent, closed: false, postMessage: (data, origin) => pairing.push({ data, origin }) };
    const challenge = { protocol: INTERNAL_PROTOCOL, version: 1, type: 'pair.challenge', connectionId, challenge: 'b'.repeat(48) };
    await app.send(challenge, popup, ownOrigin); assert.equal(pairing.length, 0);
    await app.send(envelope('bridge.hello'));
    await app.send(challenge, { ...popup, opener: {} }, ownOrigin); assert.equal(pairing.length, 0);
    await app.send(challenge, popup, parentOrigin); assert.equal(pairing.length, 0);
    await app.send(challenge, popup, ownOrigin);
    assert.equal(pairing.length, 1); assert.equal(pairing[0].origin, ownOrigin); assert.match(pairing[0].data.proof, /^[0-9a-f]{64}$/);
    assert.equal(app.replies.some(reply => Object.hasOwn(reply.data, 'proof')), false);
    app.bridge.dispose();
  });

  it('waits for server-confirmed authorization and never sends resume proof or expiry credentials to ST', async () => {
    const app = receiver();
    await app.send(envelope('bridge.hello'));
    await app.send(envelope('auth.connect', { requestId: 'connect_1' }));
    assert.equal(app.replies.some(reply => reply.data.type === 'auth.connected'), false);
    const deadline = [...app.frame.timers.values()].find(timer => timer.delay === OPERATION_LIMIT);
    app.server.connected = true;
    await app.send(envelope('auth.resume', { requestId: 'connect_1' }));
    const connected = app.replies.at(-1).data;
    assert.deepEqual(Object.keys(connected).sort(), ['protocol', 'version', 'connectionId', 'type', 'requestId', 'sessionId', 'accountId', 'accountName'].sort());
    assert.equal(connected.type, 'auth.connected'); assert.equal(connected.requestId, 'connect_1');
    assert.equal(app.savedGrants.get(parentOrigin).resumeProof, account.resumeProof);
    assert.ok(deadline); assert.equal(app.frame.timers.size, 0);
    app.bridge.dispose();
  });

  it('returns auth.required when private browser storage is unavailable', async () => {
    const app = receiver({ connected: true, storage: false });
    await app.send(envelope('bridge.hello'));
    await app.send(envelope('auth.connect', { requestId: 'connect_1' }));
    assert.equal(app.replies.at(-1).data.type, 'auth.required');
    assert.equal(app.replies.some(reply => reply.data.type === 'auth.connected'), false);
    app.bridge.dispose();
  });

  it('stages the original File sequentially before committing and exposes only the strict saved result', async () => {
    const app = receiver(); await app.connect();
    const message = saveMessage(); await app.send(message);
    const stage = app.calls.find(call => call.url.startsWith('/api/charinfo-upload/file?'));
    assert.equal(stage.body, message.files[0].file); assert.ok(stage.body instanceof File);
    assert.equal(app.calls.every(call => call.credentials === 'omit'), true);
    const actions = app.calls.filter(call => call.url === '/api/charinfo-upload/gallery').map(call => JSON.parse(call.body).action);
    assert.deepEqual(actions, ['prepare', 'commit']);
    const prepared = JSON.parse(app.calls.find(call => call.url === '/api/charinfo-upload/gallery').body);
    assert.deepEqual(prepared.files, [{ id: 'upload_1', title: '立绘', name: 'portrait.png', type: 'image/png', size: 4 }]);
    const saved = app.replies.at(-1).data;
    assert.equal(saved.type, 'gallery.saved'); assert.equal(saved.remoteGalleryUrl, app.result.remoteGalleryUrl);
    assert.deepEqual(Object.keys(saved).sort(), ['protocol', 'version', 'connectionId', 'type', 'requestId', 'sessionId', 'albumId', 'characterName', 'remoteGalleryUrl', 'items'].sort());
    app.bridge.dispose();
  });

  it('rejects changed accounts and spoofed public result URLs', async () => {
    let changed = false;
    const app = receiver({ override: (url, options, body) => url.endsWith('/auth') && body.action === 'status' && changed ? Response.json({ ...account, accountId: 'another_account' }) : null });
    await app.connect(); changed = true; await app.send(saveMessage());
    assert.equal(app.replies.at(-1).data.code, 'AUTH_REQUIRED');
    assert.equal(app.calls.some(call => call.url.includes('/file?')), false); app.bridge.dispose();
    const spoofed = receiver({ override: (url, options, body, result) => body.action === 'commit' ? Response.json({ ...result, remoteGalleryUrl: `https://evil.example/api/public/album-gallery/${albumId}` }) : null });
    await spoofed.connect(); await spoofed.send(saveMessage());
    assert.equal(spoofed.replies.at(-1).data.code, 'INVALID_RESULT');
    assert.equal(spoofed.replies.some(reply => reply.data.type === 'gallery.saved'), false); spoofed.bridge.dispose();
  });

  it('cancels only the matching request and never commits or deletes after an in-flight stage is cancelled', async () => {
    let resolveStage;
    const app = receiver({ override: url => url.includes('/file?') ? new Promise(resolve => { resolveStage = resolve; }) : null });
    await app.connect(); await app.send(saveMessage());
    await app.send(envelope('bridge.cancel', { requestId: 'unrelated' }));
    const stage = app.calls.find(call => call.url.includes('/file?')); assert.equal(stage.signal.aborted, false);
    await app.send(envelope('bridge.cancel', { requestId: 'save_1' })); assert.equal(stage.signal.aborted, true);
    resolveStage(Response.json({ staged: true })); await tick();
    assert.equal(app.calls.some(call => call.url.endsWith('/gallery') && JSON.parse(call.body).action === 'commit'), false);
    assert.equal(app.calls.some(call => call.method === 'DELETE'), false);
    assert.equal(app.replies.some(reply => reply.data.type === 'gallery.saved'), false); app.bridge.dispose();
  });

  it('does not claim disconnect succeeded when server revocation fails', async () => {
    const app = receiver({ override: (url, options, body) => body.action === 'disconnect' ? Response.json({ code: 'AUTH_FAILED' }, { status: 503 }) : null });
    await app.connect(); await app.send(envelope('auth.disconnect', { requestId: 'disconnect_1', sessionId: 'session_1' }));
    assert.equal(app.replies.at(-1).data.type, 'auth.failed'); assert.equal(app.savedGrants.has(parentOrigin), true);
    app.bridge.dispose();
  });

  it('reuses its private proof after a lost pairing response and retries only on a later explicit request', async () => {
    let pairAttempts = 0;
    const app = receiver({ override: url => { if (url.endsWith('/pair') && ++pairAttempts === 1) throw new Error('Response lost'); return null; } });
    await app.send(envelope('bridge.hello'));
    assert.equal(pairAttempts, 1);
    await tick(); assert.equal(pairAttempts, 1);
    await app.send(envelope('auth.status', { requestId: 'later_status' }));
    const pairs = app.calls.filter(call => call.url.endsWith('/pair'));
    assert.equal(pairs.length, 2);
    assert.equal(JSON.parse(pairs[0].body).proof, JSON.parse(pairs[1].body).proof);
    assert.equal(app.replies.at(-1).data.type, 'auth.required'); app.bridge.dispose();
  });

  it('keeps a fixed 12-minute deadline and ignores unrelated auth resumes or concurrent operations', async () => {
    const app = receiver();
    await app.send(envelope('bridge.hello'));
    await app.send(envelope('auth.connect', { requestId: 'connect_1' }));
    const [timerId, deadline] = [...app.frame.timers].find(([, timer]) => timer.delay === OPERATION_LIMIT);
    await app.send(envelope('auth.resume', { requestId: 'another' }));
    await app.send(envelope('auth.status', { requestId: 'status_2' }));
    assert.equal(app.replies.at(-1).data.code, 'BUSY');
    assert.equal(app.frame.timers.get(timerId), deadline);
    deadline.callback();
    assert.equal(app.replies.at(-1).data.code, 'TIMEOUT');
    assert.equal(app.frame.timers.size, 0);
    app.server.connected = true;
    await app.send(envelope('auth.resume', { requestId: 'connect_1' }));
    assert.equal(app.replies.at(-1).data.code, 'TIMEOUT'); app.bridge.dispose();
  });

  it('validates progress IDs/counts and never accepts malformed pending results', async () => {
    const app = receiver({ override: (url, options, body) => body.action === 'commit' ? Response.json({ pending: true, completed: 2, total: 1, phase: 'uploading', fileId: 'another_file' }) : null });
    await app.connect(); await app.send(saveMessage());
    assert.equal(app.replies.at(-1).data.code, 'INVALID_RESULT');
    assert.equal(app.replies.some(reply => reply.data.type === 'gallery.progress'), false); app.bridge.dispose();
  });
});

describe('ImgBed top-level upload consent pairing', () => {
  function popupFixture() {
    const popup = browserWindow(`${ownOrigin}/charinfo-upload/connect?${new URLSearchParams({ parent_origin: parentOrigin, connection_id: connectionId })}`);
    const challenges = [];
    const child = { postMessage: (data, origin) => challenges.push({ data, origin }) };
    popup.opener = { closed: false, frames: [child] };
    return { popup, challenges, child };
  }
  it('accepts private proof only from a direct opener frame and the exact internal challenge', () => {
    const { popup, challenges, child } = popupFixture(); const proofs = [];
    pairWithDirectFrame({ window: popup, session: { connectionId, parentOrigin }, onProof: proof => proofs.push(proof), onFailure: assert.fail });
    const answer = { ...challenges[0].data, type: 'pair.proof', proof: 'c'.repeat(64) };
    const receive = popup.listeners.get('message');
    receive({ source: {}, origin: ownOrigin, data: answer });
    receive({ source: child, origin: parentOrigin, data: answer });
    receive({ source: child, origin: ownOrigin, data: { ...answer, challenge: 'd'.repeat(48) } });
    assert.equal(proofs.length, 0);
    receive({ source: child, origin: ownOrigin, data: answer });
    assert.deepEqual(proofs, ['c'.repeat(64)]); assert.equal(challenges[0].origin, ownOrigin);
    assert.equal(popup.listeners.has('message'), false); assert.equal(popup.timers.size, 0);
  });

  it('fails closed when OAuth/browser isolation has removed the opener', () => {
    const { popup } = popupFixture(); popup.opener = null; const failures = [];
    pairWithDirectFrame({ window: popup, session: { connectionId, parentOrigin }, onProof: assert.fail, onFailure: value => failures.push(value) });
    assert.equal(failures.length, 1); assert.match(failures[0], /无法保留 ST 窗口连接/); assert.equal(popup.listeners.has('message'), false);
  });

  it('shows only the server-confirmed origin/account and waits for an explicit approval click', async () => {
    const { popup, child, challenges } = popupFixture(); const calls = [];
    const nodes = new Map(['connectionStatus', 'connectionOrigin', 'connectionAccount', 'connectionDetails', 'approveConnection', 'discordLogin', 'cancelConnection', 'authorizationExpiry'].map(id => [id, { hidden: true, disabled: id === 'approveConnection', textContent: '', events: {}, addEventListener(type, callback) { this.events[type] = callback; }, setAttribute() {}, removeAttribute() {} }]));
    const page = { querySelector: selector => nodes.get(selector.slice(1)) };
    mountConnectPage({ window: popup, document: page, request: async (url, options) => { const body = JSON.parse(options.body); calls.push({ body, headers: options.headers, credentials: options.credentials }); return Response.json(body.action === 'inspect' ? { parentOrigin, accountName: '真实登录账号' } : { connected: true, grantExpiresAt: account.grantExpiresAt }); } });
    popup.listeners.get('message')({ source: child, origin: ownOrigin, data: { ...challenges[0].data, type: 'pair.proof', proof: 'e'.repeat(64) } });
    await tick();
    assert.deepEqual(calls.map(call => call.body.action), ['inspect']);
    assert.equal(nodes.get('connectionOrigin').textContent, parentOrigin); assert.equal(nodes.get('connectionAccount').textContent, '真实登录账号');
    assert.equal(nodes.get('approveConnection').disabled, false);
    await nodes.get('approveConnection').events.click();
    assert.deepEqual(calls.map(call => call.body.action), ['inspect', 'approve']);
    assert.equal(calls[1].headers['X-CharInfo-Pair-Proof'], 'e'.repeat(64));
    assert.equal(calls.every(call => call.credentials === 'same-origin'), true);
    assert.match(nodes.get('authorizationExpiry').textContent, /授权截止：.*不会随使用自动延长/);
    assert.equal(popup.location.search.includes('proof'), false);
  });
});
