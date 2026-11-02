export const PROTOCOL = 'charinfo-imgbed-upload';
export const INTERNAL_PROTOCOL = 'charinfo-imgbed-upload-internal';
export const OPERATION_LIMIT = 12 * 60 * 1000;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const CONNECTION = /^[0-9a-f]{48}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']);
const BASE = ['protocol', 'version', 'connectionId', 'type'];

export function canonicalOrigin(value) {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value; }
  catch { return false; }
}

export function parseConnectionQuery(value) {
  try {
    const url = new URL(value);
    const parentOrigin = url.searchParams.get('parent_origin');
    const connectionId = url.searchParams.get('connection_id');
    if (!canonicalOrigin(parentOrigin) || !CONNECTION.test(connectionId || '')
        || url.searchParams.getAll('parent_origin').length !== 1 || url.searchParams.getAll('connection_id').length !== 1
        || `${url.pathname}${url.search}`.length > 500) return null;
    return { parentOrigin, connectionId };
  } catch { return null; }
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function exactFields(value, required, optional = []) {
  return record(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
export function validId(value) { return typeof value === 'string' && ID.test(value); }
export function validAlbumId(value) { return typeof value === 'string' && UUID.test(value); }
function characterName(value) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80 && !/[\x00-\x1f\x7f]/.test(value); }

export function saveEnvelope(value, connectionId) {
  return exactFields(value, [...BASE, 'requestId', 'sessionId', 'albumId', 'characterName', 'files', 'order'])
    && value.protocol === PROTOCOL && value.version === 1 && value.connectionId === connectionId
    && value.type === 'gallery.save' && validId(value.requestId) && validId(value.sessionId);
}

export function parseUploadMessage(value, connectionId, FileType = globalThis.File) {
  if (!record(value) || value.protocol !== PROTOCOL || value.version !== 1 || value.connectionId !== connectionId) return null;
  if (value.type === 'bridge.hello') return exactFields(value, BASE) ? value : null;
  if (!validId(value.requestId)) return null;
  if (['auth.status', 'auth.disconnect'].includes(value.type)) {
    return exactFields(value, [...BASE, 'requestId'], ['sessionId']) && (value.sessionId === undefined || validId(value.sessionId)) ? value : null;
  }
  if (['auth.connect', 'auth.resume', 'bridge.cancel'].includes(value.type)) return exactFields(value, [...BASE, 'requestId']) ? value : null;
  if (value.type === 'gallery.read') {
    return exactFields(value, [...BASE, 'requestId', 'sessionId', 'albumId', 'characterName']) && validId(value.sessionId)
      && validAlbumId(value.albumId) && characterName(value.characterName) ? value : null;
  }
  if (!saveEnvelope(value, connectionId) || (value.albumId !== null && !validAlbumId(value.albumId)) || !characterName(value.characterName)
      || !Array.isArray(value.files) || value.files.length > 100 || !Array.isArray(value.order) || value.order.length > 500) return null;
  const uploads = new Set();
  for (const item of value.files) {
    if (!exactFields(item, ['id', 'title', 'file']) || !validId(item.id) || uploads.has(item.id)
        || typeof item.title !== 'string' || item.title.length > 500 || typeof FileType !== 'function' || !(item.file instanceof FileType)
        || !MEDIA_TYPES.has(item.file.type) || item.file.size <= 0 || item.file.size > 95 * 1024 * 1024) return null;
    uploads.add(item.id);
  }
  const order = new Set(), referenced = new Set();
  for (const item of value.order) {
    if (exactFields(item, ['itemId']) && value.albumId && validId(item.itemId)) {
      if (order.has(`item:${item.itemId}`)) return null;
      order.add(`item:${item.itemId}`);
    } else if (exactFields(item, ['uploadId']) && uploads.has(item.uploadId)) {
      if (order.has(`upload:${item.uploadId}`)) return null;
      order.add(`upload:${item.uploadId}`); referenced.add(item.uploadId);
    } else return null;
  }
  return referenced.size === uploads.size ? value : null;
}

export function randomHex(crypto, bytes = 24) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validItems(items) {
  if (!Array.isArray(items) || items.length > 500) return false;
  const ids = new Set();
  return items.every(item => {
    if (!exactFields(item, ['id', 'title', 'url', 'kind']) || !validId(item.id) || ids.has(item.id)
        || typeof item.title !== 'string' || item.title.length > 500 || typeof item.url !== 'string' || !['image', 'video'].includes(item.kind)) return false;
    try { const url = new URL(item.url); if (url.protocol !== 'https:' || url.username || url.password) return false; }
    catch { return false; }
    ids.add(item.id); return true;
  });
}
