import { INTERNAL_PROTOCOL, OPERATION_LIMIT, canonicalOrigin, parseConnectionQuery, exactFields, randomHex } from './protocol.js';

export function pairWithDirectFrame({ window: popup, session, onProof, onFailure }) {
  const origin = popup.location.origin;
  const expected = new Set();
  const challenge = randomHex(popup.crypto);
  let stopped = false, repeat, deadline;
  function dispose() { stopped = true; popup.clearTimeout(repeat); popup.clearTimeout(deadline); popup.removeEventListener('message', receive); popup.removeEventListener('pagehide', dispose); }
  function receive(event) {
    const data = event.data;
    if (stopped || event.origin !== origin || !expected.has(event.source)
        || !exactFields(data, ['protocol', 'version', 'type', 'connectionId', 'challenge', 'proof'])
        || data.protocol !== INTERNAL_PROTOCOL || data.version !== 1 || data.type !== 'pair.proof' || data.connectionId !== session.connectionId
        || data.challenge !== challenge || typeof data.proof !== 'string' || !/^[0-9a-f]{64}$/.test(data.proof)) return;
    dispose(); onProof(data.proof);
  }
  function sendChallenge() {
    if (stopped) return;
    try {
      const opener = popup.opener;
      if (!opener || opener.closed) throw new Error('No opener');
      for (let index = 0; index < opener.frames.length; index++) {
        const frame = opener.frames[index];
        expected.add(frame);
        frame.postMessage({ protocol: INTERNAL_PROTOCOL, version: 1, type: 'pair.challenge', connectionId: session.connectionId, challenge }, origin);
      }
      repeat = popup.setTimeout(sendChallenge, 500);
    } catch { dispose(); onFailure('无法保留 ST 窗口连接。请回到 ST 重新发起连接；不会仅凭连接编号授权。'); }
  }
  popup.addEventListener('message', receive);
  popup.addEventListener('pagehide', dispose);
  deadline = popup.setTimeout(() => { dispose(); onFailure('等待 ST 上传连接超时。请回到编辑器重新连接，草稿和所选文件仍由 ST 保留。'); }, OPERATION_LIMIT);
  sendChallenge();
  return dispose;
}

export function mountConnectPage({ window: popup = window, request = popup.fetch.bind(popup), document: page = popup.document } = {}) {
  const session = parseConnectionQuery(popup.location.href);
  const status = page.querySelector('#connectionStatus');
  const origin = page.querySelector('#connectionOrigin');
  const account = page.querySelector('#connectionAccount');
  const approve = page.querySelector('#approveConnection');
  const login = page.querySelector('#discordLogin');
  const cancel = page.querySelector('#cancelConnection');
  const expiry = page.querySelector('#authorizationExpiry');
  let proof, disposed = false, busy = false, stopPairing;
  function explain(message) { status.textContent = message; }
  async function auth(action) {
    const response = await request('/api/charinfo-upload/auth', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CharInfo-Pair-Proof': proof }, body: JSON.stringify({ action, connectionId: session.connectionId }) });
    if (response.status === 401) throw Object.assign(new Error('Sign in required'), { status: 401 });
    if (!response.ok) throw new Error('Authorization failed');
    return response.json();
  }
  async function inspect(value) {
    proof = value;
    try {
      const data = await auth('inspect');
      if (disposed) return;
      if (!canonicalOrigin(data.parentOrigin) || data.parentOrigin !== session.parentOrigin || typeof data.accountName !== 'string') throw new Error('Wrong connection');
      origin.textContent = data.parentOrigin;
      account.textContent = data.accountName;
      page.querySelector('#connectionDetails').hidden = false;
      approve.disabled = false;
      explain('请核对来源和账号。只有点击“允许连接”后，ST 才能上传并整理您的角色图库。');
    } catch (error) {
      if (disposed) return;
      if (error.status === 401) {
        login.href = `/api/auth/discord?${new URLSearchParams({ returnTo: `${popup.location.pathname}${popup.location.search}` })}`;
        login.hidden = false;
        explain('已确认上传窗口。请先登录 Discord，再核对并允许此 ST 来源连接。');
      } else explain('无法核对这个上传连接。请从 ST 重新发起；当前没有授予上传权限。');
    }
  }
  approve.addEventListener('click', async () => {
    if (disposed || busy || !proof || approve.disabled) return;
    busy = true; approve.disabled = true; cancel.disabled = true; approve.setAttribute('aria-busy', 'true');
    try {
      const granted = await auth('approve');
      if (!disposed) {
        if (Number.isFinite(granted.grantExpiresAt)) expiry.textContent = `授权截止：${new Date(granted.grantExpiresAt).toLocaleString('zh-CN')}。此期限不会随使用自动延长。`;
        explain('已允许连接。请返回 ST 继续保存；可在编辑器中主动断开连接。'); cancel.textContent = '关闭窗口';
      }
    } catch { if (!disposed) { explain('授权未完成。请检查登录状态后重试；不会自动改用其他上传方式。'); approve.disabled = false; } }
    finally { busy = false; cancel.disabled = false; approve.removeAttribute('aria-busy'); }
  });
  cancel.addEventListener('click', () => { disposed = true; stopPairing?.(); approve.disabled = true; explain('已结束此授权页面。请回到 ST 取消等待或重新发起连接。'); popup.close(); });
  popup.addEventListener('pagehide', () => { disposed = true; proof = undefined; stopPairing?.(); approve.disabled = true; });
  if (!session) { explain('连接参数无效。请从 ST 的 CharInfo Manager 重新发起连接。'); return; }
  stopPairing = pairWithDirectFrame({ window: popup, session, onProof: proof => { void inspect(proof); }, onFailure: explain });
}
