import { PROTOCOL, INTERNAL_PROTOCOL, OPERATION_LIMIT, canonicalOrigin, parseConnectionQuery, parseUploadMessage, exactFields, validId, validAlbumId, validItems, randomHex } from './protocol.js';
import { createGrantStore } from './grant-store.js';

const INTERNAL_BASE = ['protocol', 'version', 'type', 'connectionId', 'challenge'];
const safeCode = value => typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value) ? value : 'SERVER_ERROR';

export function createUploadReceiver({ window: frame, request = frame.fetch.bind(frame), grants = createGrantStore(frame.indexedDB) }) {
  const session = parseConnectionQuery(frame.location.href);
  const ownOrigin = frame.location.origin;
  let parentOrigin = null, proof, pairing, current = null, authorized = null, stopped = false, resumeAttempted = false;

  function send(type, fields = {}) {
    if (stopped || !parentOrigin) return;
    try { frame.parent.postMessage({ protocol: PROTOCOL, version: 1, connectionId: session.connectionId, type, ...fields }, parentOrigin); }
    catch { dispose(); }
  }
  async function json(path, body, signal) {
    const response = await request(path, { method: 'POST', credentials: 'omit', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', ...(proof ? { 'X-CharInfo-Pair-Proof': proof } : {}) }, body: JSON.stringify(body) });
    let data;
    try { data = await response.json(); } catch { throw Object.assign(new Error('Invalid response'), { code: 'SERVER_ERROR' }); }
    if (!response.ok) throw Object.assign(new Error('Request failed'), { code: response.status === 401 ? 'AUTH_REQUIRED' : safeCode(data.code) });
    return data;
  }
  function ensurePair() {
    if (!parentOrigin || stopped) return Promise.reject(new Error('No parent'));
    pairing ||= (async () => {
      proof ||= randomHex(frame.crypto, 32);
      await json('/api/charinfo-upload/pair', { connectionId: session.connectionId, parentOrigin, proof });
    })().catch(error => { pairing = null; throw error; });
    return pairing;
  }
  function auth(action, fields = {}, signal) { return json('/api/charinfo-upload/auth', { action, connectionId: session.connectionId, ...fields }, signal); }
  function gallery(action, message, fields = {}, signal) {
    return json('/api/charinfo-upload/gallery', { action, connectionId: session.connectionId, sessionId: message.sessionId, requestId: message.requestId, ...fields }, signal);
  }
  function active(operation) { return !stopped && current === operation && !operation.controller.signal.aborted; }
  function finish(operation) {
    if (current !== operation) return;
    frame.clearTimeout(operation.timer);
    frame.clearTimeout(operation.pollTimer);
    current = null;
  }
  function fail(operation, code) {
    if (!active(operation)) return;
    if (code === 'AUTH_REQUIRED') authorized = null;
    send(operation.message.type.startsWith('gallery.') ? 'gallery.error' : 'auth.failed', {
      requestId: operation.message.requestId,
      ...(operation.message.type.startsWith('gallery.') ? { sessionId: operation.message.sessionId } : {}), code: safeCode(code),
    });
    finish(operation);
  }
  function cancel(operation, notify = false) {
    if (!operation || current !== operation) return;
    if (notify) fail(operation, 'TIMEOUT'); else finish(operation);
    operation.controller.abort();
    if (operation.message.type.startsWith('gallery.')) void gallery('cancel', operation.message).catch(() => {});
  }
  function begin(message) {
    if (current) {
      if (current.message.requestId === message.requestId) return null;
      send(message.type.startsWith('gallery.') ? 'gallery.error' : 'auth.failed', { requestId: message.requestId,
        ...(message.type.startsWith('gallery.') ? { sessionId: message.sessionId } : {}), code: 'BUSY' });
      return null;
    }
    const operation = { message, controller: new AbortController(), timer: null, pollTimer: null, polling: false };
    current = operation;
    operation.timer = frame.setTimeout(() => cancel(operation, true), OPERATION_LIMIT);
    return operation;
  }
  async function checkAuth(operation) {
    await ensurePair();
    let saved;
    try { saved = await grants.get(parentOrigin); }
    catch { authorized = null; throw Object.assign(new Error('Storage unavailable'), { code: 'STORAGE_UNAVAILABLE' }); }
    let data = await auth(authorized && authorized.expiresAt <= Date.now() + 30000 ? 'renew' : 'status', authorized ? { sessionId: authorized.sessionId } : {}, operation.controller.signal);
    if (!data.connected && !resumeAttempted && saved?.grantExpiresAt > Date.now() && typeof saved.resumeProof === 'string') {
      resumeAttempted = true;
      try { data = await auth('resume', { resumeProof: saved.resumeProof }, operation.controller.signal); }
      catch (error) { if (error.code !== 'AUTH_REQUIRED') throw error; await grants.remove(parentOrigin); }
    }
    if (!active(operation)) return null;
    if (!data.connected) { authorized = null; return null; }
    if (!validId(data.sessionId) || !validId(data.accountId) || typeof data.accountName !== 'string' || data.accountName.length > 100
        || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) throw Object.assign(new Error('Invalid authorization'), { code: 'AUTH_REQUIRED' });
    if (typeof data.resumeProof === 'string' && data.resumeProof.length <= 512 && Number.isFinite(data.grantExpiresAt)) {
      try { await grants.set(parentOrigin, { resumeProof: data.resumeProof, grantExpiresAt: data.grantExpiresAt }); }
      catch { authorized = null; throw Object.assign(new Error('Storage unavailable'), { code: 'STORAGE_UNAVAILABLE' }); }
    }
    if (!active(operation)) return null;
    authorized = { sessionId: data.sessionId, accountId: data.accountId, accountName: data.accountName, expiresAt: data.expiresAt };
    return authorized;
  }
  async function pollAuth(operation) {
    if (!active(operation) || operation.polling) return;
    operation.polling = true;
    frame.clearTimeout(operation.pollTimer);
    try {
      const account = await checkAuth(operation);
      if (!active(operation)) return;
      if (account) {
        send('auth.connected', { requestId: operation.message.requestId, sessionId: account.sessionId, accountId: account.accountId, accountName: account.accountName });
        finish(operation);
      } else if (operation.message.type === 'auth.status') {
        send('auth.required', { requestId: operation.message.requestId }); finish(operation);
      } else operation.pollTimer = frame.setTimeout(() => void pollAuth(operation), 1000);
    } catch (error) {
      if (active(operation) && error.code === 'STORAGE_UNAVAILABLE') { send('auth.required', { requestId: operation.message.requestId }); finish(operation); }
      else fail(operation, error.code || 'AUTH_FAILED');
    }
    finally { operation.polling = false; }
  }
  function resultValid(data, message, saved) {
    return validAlbumId(data.albumId) && (!message.albumId || data.albumId === message.albumId)
      && data.characterName === message.characterName.trim() && validItems(data.items)
      && (!saved || (data.items.length === message.order.length && data.remoteGalleryUrl === `${ownOrigin}/api/public/album-gallery/${data.albumId}`));
  }
  function saved(operation, data) {
    if (!active(operation)) return;
    if (!resultValid(data, operation.message, true)) throw Object.assign(new Error('Invalid gallery'), { code: 'INVALID_RESULT' });
    send('gallery.saved', { requestId: operation.message.requestId, sessionId: operation.message.sessionId,
      albumId: data.albumId, characterName: data.characterName, remoteGalleryUrl: data.remoteGalleryUrl, items: data.items });
    finish(operation);
  }
  async function runGallery(operation) {
    const message = operation.message;
    try {
      if (!authorized || authorized.sessionId !== message.sessionId || authorized.expiresAt <= Date.now()) { fail(operation, 'AUTH_REQUIRED'); return; }
      const sessionStatus = await auth('status', { sessionId: message.sessionId }, operation.controller.signal);
      if (!active(operation)) return;
      if (!sessionStatus.connected || sessionStatus.sessionId !== message.sessionId || sessionStatus.accountId !== authorized.accountId) { fail(operation, 'AUTH_REQUIRED'); return; }
      if (message.type === 'gallery.read') {
        const data = await gallery('read', message, { albumId: message.albumId, characterName: message.characterName.trim() }, operation.controller.signal);
        if (!active(operation)) return;
        if (!resultValid(data, message, false)) throw Object.assign(new Error('Invalid gallery'), { code: 'INVALID_RESULT' });
        send('gallery.loaded', { requestId: message.requestId, sessionId: message.sessionId, albumId: data.albumId, characterName: data.characterName, items: data.items });
        finish(operation); return;
      }
      const prepared = await gallery('prepare', message, { albumId: message.albumId, characterName: message.characterName.trim(),
        files: message.files.map(item => ({ id: item.id, title: item.title, name: item.file.name, type: item.file.type, size: item.file.size })), order: message.order }, operation.controller.signal);
      if (!active(operation)) return;
      if (prepared.remoteGalleryUrl && prepared.items) { saved(operation, prepared); return; }
      for (const item of message.files) {
        if (!active(operation)) return;
        const params = new URLSearchParams({ connection_id: session.connectionId, request_id: message.requestId, upload_id: item.id });
        const response = await request(`/api/charinfo-upload/file?${params}`, { method: 'POST', credentials: 'omit', cache: 'no-store', signal: operation.controller.signal,
          headers: { 'Content-Type': item.file.type, 'X-CharInfo-Pair-Proof': proof, 'X-CharInfo-Session': message.sessionId }, body: item.file });
        if (!response.ok) { let error = {}; try { error = await response.json(); } catch {} throw Object.assign(new Error('Staging failed'), { code: response.status === 401 ? 'AUTH_REQUIRED' : safeCode(error.code) }); }
      }
      async function commit() {
        if (!active(operation)) return;
        try {
          const data = await gallery('commit', message, {}, operation.controller.signal);
          if (!active(operation)) return;
          if (!data.pending) { saved(operation, data); return; }
          if (!Number.isInteger(data.completed) || data.completed < 0 || data.completed > message.files.length || data.total !== message.files.length
              || !['uploading', 'saving'].includes(data.phase) || (data.fileId !== undefined && !message.files.some(item => item.id === data.fileId))) throw Object.assign(new Error('Invalid progress'), { code: 'INVALID_RESULT' });
          send('gallery.progress', { requestId: message.requestId, sessionId: message.sessionId, completed: data.completed, total: data.total,
            phase: data.phase, ...(data.fileId !== undefined ? { fileId: data.fileId } : {}) });
          operation.pollTimer = frame.setTimeout(() => void commit(), 500);
        } catch (error) { fail(operation, error.code || 'SERVER_ERROR'); }
      }
      await commit();
    } catch (error) { fail(operation, error.code || 'SERVER_ERROR'); }
  }
  async function receive(event) {
    if (stopped || !session || frame.parent === frame) return;
    const data = event.data;
    if (event.origin === ownOrigin && exactFields(data, INTERNAL_BASE) && data.protocol === INTERNAL_PROTOCOL && data.version === 1
        && data.type === 'pair.challenge' && data.connectionId === session.connectionId && /^[0-9a-f]{48}$/.test(data.challenge || '') && parentOrigin) {
      try {
        if (!event.source || event.source === frame || event.source.opener !== frame.parent || event.source.closed) return;
        await ensurePair();
        if (!stopped && event.source.opener === frame.parent && !event.source.closed) event.source.postMessage({ ...data, type: 'pair.proof', proof }, ownOrigin);
      } catch {}
      return;
    }
    if (event.source !== frame.parent || !canonicalOrigin(event.origin) || event.origin !== session.parentOrigin) return;
    const message = parseUploadMessage(data, session.connectionId, frame.File);
    if (!message) return;
    if (message.type === 'bridge.hello') {
      parentOrigin = event.origin;
      send('bridge.ready');
      void ensurePair().catch(() => {});
      return;
    }
    if (!parentOrigin) return;
    if (message.type === 'bridge.cancel') { if (current?.message.requestId === message.requestId) cancel(current); return; }
    if (message.type === 'auth.resume') { if (current?.message.type === 'auth.connect' && current.message.requestId === message.requestId) void pollAuth(current); return; }
    const operation = begin(message);
    if (!operation) return;
    if (message.type === 'auth.disconnect') {
      try {
        await ensurePair();
        await auth('disconnect', { ...(message.sessionId ? { sessionId: message.sessionId } : {}) }, operation.controller.signal);
        if (!active(operation)) return;
        authorized = null;
        await grants.remove(parentOrigin);
        if (active(operation)) { send('auth.required', { requestId: message.requestId }); finish(operation); }
      } catch (error) { fail(operation, error.code || 'AUTH_FAILED'); }
    } else if (message.type.startsWith('auth.')) void pollAuth(operation);
    else void runGallery(operation);
  }
  function dispose() {
    if (stopped) return;
    if (current) cancel(current);
    stopped = true;
    frame.removeEventListener('message', receive);
    frame.removeEventListener('pagehide', dispose);
    void grants.close().catch(() => {});
  }
  return { start() { if (!session || stopped) return; frame.addEventListener('message', receive); frame.addEventListener('pagehide', dispose); }, dispose };
}
