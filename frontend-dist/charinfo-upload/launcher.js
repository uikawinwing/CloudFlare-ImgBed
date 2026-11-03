import { PROTOCOL, INTERNAL_PROTOCOL, OPERATION_LIMIT, parseConnectionQuery, parseUploadMessage, exactFields, randomHex } from './protocol.js';

export function mountLauncher({ window: frame = window, document: page = frame.document } = {}) {
  const session = parseConnectionQuery(frame.location.href);
  const button = page.querySelector('#launchButton');
  const status = page.querySelector('#launchStatus');
  const form = page.querySelector('#launchConnection');
  const expected = new Set();
  const challenge = randomHex(frame.crypto);
  let parentOrigin, stopped = false, matched = false, repeat, deadline;
  function dispose() {
    stopped = true; frame.clearTimeout(repeat); frame.clearTimeout(deadline);
    frame.removeEventListener('message', receive); frame.removeEventListener('pagehide', dispose);
    for (const field of form.querySelectorAll('input')) field.remove();
    button.disabled = true;
  }
  function discover() {
    if (stopped || matched || !parentOrigin) return;
    let visited = 0;
    function visit(target, depth) {
      if (++visited > 128 || depth > 4) return;
      try {
        try {
          if (target !== frame && target.location.origin === frame.location.origin) {
            expected.add(target);
            target.postMessage({ protocol: INTERNAL_PROTOCOL, version: 1, type: 'launch.request', connectionId: session.connectionId, challenge, parentOrigin }, frame.location.origin);
          }
        } catch { /* Cross-origin ancestors still need to be traversed to reach the upload frame. */ }
        for (let index = 0; index < target.frames.length && visited < 128; index++) visit(target.frames[index], depth + 1);
      } catch {}
    }
    visit(frame.top, 0);
    repeat = frame.setTimeout(discover, 500);
  }
  function receive(event) {
    if (stopped || !session) return;
    if (!parentOrigin && event.source === frame.parent && event.origin === session.parentOrigin) {
      const message = parseUploadMessage(event.data, session.connectionId, frame.File);
      if (message?.type !== 'bridge.hello') return;
      parentOrigin = event.origin;
      frame.parent.postMessage({ protocol: PROTOCOL, version: 1, connectionId: session.connectionId, type: 'launcher.ready' }, parentOrigin);
      discover(); return;
    }
    const data = event.data;
    if (matched || !parentOrigin || event.origin !== frame.location.origin || !expected.has(event.source)
        || !exactFields(data, ['protocol', 'version', 'type', 'connectionId', 'challenge', 'parentOrigin', 'proof'])
        || data.protocol !== INTERNAL_PROTOCOL || data.version !== 1 || data.type !== 'launch.proof'
        || data.connectionId !== session.connectionId || data.challenge !== challenge || data.parentOrigin !== parentOrigin
        || typeof data.proof !== 'string' || !/^[0-9a-f]{64}$/.test(data.proof)) return;
    try { if (event.source.top !== frame.top) return; } catch { return; }
    matched = true; frame.clearTimeout(repeat); frame.clearTimeout(deadline); expected.clear();
    for (const [name, value] of Object.entries({ connectionId: session.connectionId, proof: data.proof })) {
      const input = page.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.appendChild(input);
    }
    button.disabled = false; status.textContent = '点击后，在新窗口登录并核对授权。';
  }
  form.addEventListener('submit', event => {
    if (!matched || stopped) { event.preventDefault(); return; }
    status.textContent = '请在授权窗口中确认；若窗口未打开，可再次点击。';
  });
  if (!session || frame.parent === frame) { status.textContent = '请从 ST 编辑器重新连接。'; return dispose; }
  frame.addEventListener('message', receive); frame.addEventListener('pagehide', dispose);
  deadline = frame.setTimeout(() => { dispose(); status.textContent = '连接等待超时，请回到编辑器重新连接。'; }, OPERATION_LIMIT);
  return dispose;
}
