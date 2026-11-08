const PROTOCOL = 'charinfo-imgbed-bridge';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BRIDGE_PARAMS = ['bridge', 'bridge_version', 'bridge_nonce', 'opener_origin'];
const SESSION_LIFETIME = 15 * 60 * 1000;
const SESSION_KEY = 'charinfo-imgbed-bridge-session-v1';

export function isValidStOrigin(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

export function parseBridgeQuery(value) {
  const url = new URL(value);
  const params = url.searchParams;
  if (!BRIDGE_PARAMS.some(key => params.has(key))) return null;
  const nonce = params.get('bridge_nonce');
  const openerOrigin = params.get('opener_origin');
  const albumId = params.get('album');
  if (BRIDGE_PARAMS.some(key => params.getAll(key).length !== 1) || params.getAll('album').length > 1
      || params.get('bridge') !== 'charinfo' || params.get('bridge_version') !== '1'
      || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce || '') || !isValidStOrigin(openerOrigin)
      || (albumId !== null && !UUID.test(albumId)) || !/^\/account\/?$/.test(url.pathname)
      || `${url.pathname}${url.search}`.length > 500) {
    return { error: '连接参数无效，请从 ST 重新打开图库。' };
  }
  return { nonce, openerOrigin, albumId };
}

function bridgeError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createCharInfoBridge({ window: popup, session, api, onChange = () => {}, now = Date.now }) {
  const opener = popup.opener;
  const sessionKey = `${SESSION_KEY}:${session.nonce}`;
  let verifiedOrigin = null;
  let status = session.error ? 'invalid' : 'waiting';
  let reason = session.error || '正在连接 ST…';
  let storage;
  let record;
  if (!session.error) {
    try {
      storage = popup.sessionStorage;
      const saved = JSON.parse(storage.getItem(sessionKey) || 'null');
      if (saved) {
        record = saved;
        if (saved.nonce !== session.nonce || saved.openerOrigin !== session.openerOrigin || saved.consumed || !Number.isFinite(saved.createdAt) || saved.createdAt > now() || now() - saved.createdAt >= SESSION_LIFETIME) {
          status = 'expired';
          reason = '连接已使用或过期，请从 ST 重新打开图库。';
          record.consumed = true;
        }
      } else {
        record = { nonce: session.nonce, openerOrigin: session.openerOrigin, createdAt: now(), consumed: false };
      }
      storage.setItem(sessionKey, JSON.stringify(record));
    } catch {
      storage = null;
      status = 'manual';
      reason = '浏览器无法保存临时连接状态，请复制图库链接并粘贴到 ST 的“远程图库 URL”。';
    }
  }
  const expiresAt = (record?.createdAt ?? now()) + SESSION_LIFETIME;
  let userId = null;
  let started = false;
  let busy = false;
  let generation = 0;
  let handshakeTimer;
  let expiryTimer;
  const active = () => ['waiting', 'ready', 'manual'].includes(status);
  const envelope = type => ({ protocol: PROTOCOL, version: 1, type, nonce: session.nonce });
  function clean() {
    generation++;
    popup.removeEventListener('message', receive);
    popup.removeEventListener('pagehide', suspend);
    popup.removeEventListener('pageshow', restore);
    popup.clearTimeout(handshakeTimer);
    popup.clearTimeout(expiryTimer);
  }
  function update(next, message) {
    status = next;
    reason = message;
    onChange();
  }
  function finish(next, message) {
    consume();
    verifiedOrigin = null;
    clean();
    update(next, message);
  }
  function consume() {
    if (record) record.consumed = true;
    return persist();
  }
  function persist() {
    if (!storage || !record) return false;
    try {
      storage.setItem(sessionKey, JSON.stringify(record));
      return true;
    } catch {
      storage = null;
      return false;
    }
  }
  function available() {
    if (active() && now() >= expiresAt) finish('expired', '连接已过期，请从 ST 重新打开图库。');
    return active() && started && userId;
  }
  function manual(message) {
    verifiedOrigin = null;
    popup.removeEventListener('message', receive);
    popup.clearTimeout(handshakeTimer);
    update('manual', message);
  }
  function receive(event) {
    const data = event.data;
    if (!available() || status !== 'waiting' || popup.opener !== opener || !opener || opener.closed
        || event.source !== opener || event.origin !== session.openerOrigin || !isValidStOrigin(event.origin)
        || !data || typeof data !== 'object' || Array.isArray(data)
        || Object.keys(data).sort().join(',') !== 'nonce,protocol,type,version'
        || data.protocol !== PROTOCOL || data.version !== 1 || data.type !== 'bridge.hello' || data.nonce !== session.nonce) return;
    if (!persist()) {
      manual('浏览器无法保存临时连接状态，请复制图库链接并粘贴到 ST 的“远程图库 URL”。');
      return;
    }
    try {
      verifiedOrigin = event.origin;
      opener.postMessage(envelope('bridge.ready'), verifiedOrigin);
      popup.clearTimeout(handshakeTimer);
      popup.removeEventListener('message', receive);
      update('ready', '已连接 ST。选择图库后，点击“使用此图库 / 返回 ST”。');
    } catch {
      manual('无法连接 ST，请复制图库链接并粘贴到 ST 的“远程图库 URL”。');
    }
  }
  function suspend() {
    clean();
    verifiedOrigin = null;
    status = 'suspended';
    popup.addEventListener('pageshow', restore);
  }
  function restore() {
    popup.removeEventListener('pageshow', restore);
    try {
      const saved = JSON.parse(storage?.getItem(sessionKey) || 'null');
      if (storage && (!saved || saved.consumed || saved.openerOrigin !== session.openerOrigin || saved.userId !== userId)) {
        finish('expired', '连接已使用或身份改变，请从 ST 重新打开图库。');
        return;
      }
    } catch { storage = null; }
    status = 'waiting';
    started = false;
    controller.start(userId);
  }
  const controller = {
    get status() { return status; },
    get reason() { return reason; },
    start(id) {
      if (started || !active()) return;
      started = true;
      userId = id;
      popup.addEventListener('pagehide', suspend);
      expiryTimer = popup.setTimeout(() => finish('expired', '连接已过期，请从 ST 重新打开图库。'), Math.max(0, expiresAt - now()));
      if (!id || now() >= expiresAt) { finish('expired', '连接已过期，请从 ST 重新打开图库。'); return; }
      if (record?.userId && record.userId !== id) {
        finish('expired', '登录身份已改变，请从 ST 重新打开图库。');
        return;
      }
      if (record) record.userId = id;
      if (!persist()) {
        manual('浏览器无法保存临时连接状态，请复制图库链接并粘贴到 ST 的“远程图库 URL”。');
      } else if (!opener || opener.closed) {
        manual('无法找到 ST 窗口。请复制图库链接并粘贴到 ST 的“远程图库 URL”。');
      } else {
        popup.addEventListener('message', receive);
        handshakeTimer = popup.setTimeout(() => manual('连接 ST 超时。请复制图库链接并粘贴到 ST 的“远程图库 URL”。'), 30000);
        onChange();
      }
    },
    appendToUrl(value) {
      const url = new URL(value, popup.location.origin);
      if (url.origin !== popup.location.origin || !/^\/account\/?$/.test(url.pathname)) return url;
      BRIDGE_PARAMS.forEach(key => url.searchParams.delete(key));
      if (active()) {
        url.searchParams.set('bridge', 'charinfo');
        url.searchParams.set('bridge_version', '1');
        url.searchParams.set('bridge_nonce', session.nonce);
        url.searchParams.set('opener_origin', session.openerOrigin);
      }
      return url;
    },
    async select(albumId, { manual: copyOnly = false } = {}) {
      if (!available() || busy || !UUID.test(albumId) || (!copyOnly && status !== 'ready')) {
        throw bridgeError('session-unavailable', '连接尚未就绪或已结束，请重新连接，或复制图库链接。');
      }
      busy = true;
      const operation = generation;
      try {
        const options = { cache: 'no-store' };
        const current = await api('/api/user/me', options);
        if (current.user?.id !== userId) throw bridgeError('auth-changed', '登录身份已改变，请从 ST 重新打开图库。');
        const detail = await api(`/api/user/albums/${albumId}`, options);
        if (detail.album?.id !== albumId || detail.album.owner_id !== userId) {
          throw bridgeError('album-unavailable', '这个图库不可用或不属于当前账号，请选择其他图库。');
        }
        const name = typeof detail.album.charInfoCharacterName === 'string' ? detail.album.charInfoCharacterName.trim() : '';
        if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) {
          throw bridgeError('character-name-required', '请先在“编辑信息”中填写有效的关联角色全名。');
        }
        const path = `/api/public/album-gallery/${albumId}`;
        const pack = await api(path, options);
        if (pack?.format !== 'char-info-gallery-pack' || pack.version !== 1 || pack.packId !== albumId
            || pack.profileId !== albumId || pack.characterName !== name || !Array.isArray(pack.gallery)) {
          throw bridgeError('public-pack-unavailable', '远程图库暂时不可用，请检查图库配置后重试。');
        }
        const confirmed = await api('/api/user/me', options);
        if (confirmed.user?.id !== userId) throw bridgeError('auth-changed', '登录身份已改变，请从 ST 重新打开图库。');
        if (operation !== generation || !available()) throw bridgeError('session-unavailable', '连接已结束，请从 ST 重新打开图库。');
        const result = { albumId, remoteGalleryUrl: `${popup.location.origin}${path}`, sent: false };
        if (!copyOnly) {
          if (status !== 'ready' || !verifiedOrigin || popup.opener !== opener || !opener || opener.closed) {
            manual('无法连接 ST，请复制图库链接并粘贴到 ST 的“远程图库 URL”。');
            throw bridgeError('session-unavailable', reason);
          }
          if (!consume()) {
            manual('浏览器无法保存临时连接状态，请复制图库链接并粘贴到 ST 的“远程图库 URL”。');
            throw bridgeError('session-unavailable', reason);
          }
          try {
            opener.postMessage({ ...envelope('album.selected'), albumId, remoteGalleryUrl: result.remoteGalleryUrl }, verifiedOrigin);
          } catch {
            manual('无法连接 ST，请复制图库链接并粘贴到 ST 的“远程图库 URL”。');
            throw bridgeError('session-unavailable', reason);
          }
          result.sent = true;
          finish('completed', '图库已返回 ST。请在 ST 中预览，并保存角色资料。');
        }
        return result;
      } catch (error) {
        if (operation === generation && (error.code === 'auth-changed' || error.status === 401)) finish('expired', '登录已失效或身份改变，请从 ST 重新打开图库。');
        throw error;
      } finally {
        busy = false;
      }
    },
    cancel() {
      if (!active()) return;
      if (status === 'ready' && verifiedOrigin && popup.opener === opener && opener && !opener.closed) {
        try { opener.postMessage(envelope('bridge.cancelled'), verifiedOrigin); } catch {}
      }
      finish('cancelled', '已取消连接。你可以关闭此窗口。');
    },
    dispose: () => finish('cancelled', '连接已结束，请从 ST 重新打开图库。'),
  };
  return controller;
}
