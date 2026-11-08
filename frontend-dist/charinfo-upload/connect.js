import { canonicalOrigin, parseConnectionQuery } from './protocol.js';

export function mountConnectPage({ window: popup = window, request = popup.fetch.bind(popup), document: page = popup.document } = {}) {
  const session = parseConnectionQuery(popup.location.href);
  const status = page.querySelector('#connectionStatus');
  const origin = page.querySelector('#connectionOrigin');
  const account = page.querySelector('#connectionAccount');
  const approve = page.querySelector('#approveConnection');
  const login = page.querySelector('#discordLogin');
  const cancel = page.querySelector('#cancelConnection');
  const expiry = page.querySelector('#authorizationExpiry');
  let disposed = false, busy = false, inspected = false, approved = false, inspectedAccountId;
  function explain(message) { status.textContent = message; }
  async function auth(action) {
    const response = await request('/api/charinfo-upload/auth', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, connectionId: session.connectionId,
        ...(action === 'approve' ? { accountId: inspectedAccountId } : {}) }) });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw Object.assign(new Error('Authorization failed'), { code: data.code });
    return data;
  }
  async function inspect() {
    inspected = false; approve.disabled = true;
    try {
      const data = await auth('inspect');
      if (disposed) return;
      if (!canonicalOrigin(data.parentOrigin) || data.parentOrigin !== session.parentOrigin || typeof data.accountName !== 'string'
          || typeof data.accountId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.accountId)) throw new Error('Wrong connection');
      inspectedAccountId = data.accountId;
      origin.textContent = data.parentOrigin;
      account.textContent = data.accountName;
      page.querySelector('#connectionDetails').hidden = false;
      inspected = true; approve.disabled = false;
      explain('请核对来源和账号。只有点击“允许连接”后，ST 才能上传并整理您的角色图库。');
    } catch (error) {
      if (disposed) return;
      if (error.code === 'SIGN_IN_REQUIRED') {
        const returnUrl = new URL(popup.location.href);
        returnUrl.searchParams.set('login_attempted', '1');
        login.href = `/api/auth/discord?${new URLSearchParams({ returnTo: `${returnUrl.pathname}${returnUrl.search}` })}`;
        login.hidden = false;
        explain('请先登录 Discord，再核对并允许此 ST 来源连接。');
        if (new URL(popup.location.href).searchParams.get('login_attempted') !== '1') {
          explain('正在前往 Discord 登录…');
          popup.location.replace(login.href);
        }
      } else explain('无法核对这个上传连接，或连接已经结束。请从 ST 重新发起；当前没有授予上传权限。');
    }
  }
  approve.addEventListener('click', async () => {
    if (disposed || busy || !inspected || approve.disabled) return;
    busy = true; approve.disabled = true; cancel.disabled = true; approve.setAttribute('aria-busy', 'true');
    try {
      const granted = await auth('approve');
      if (!disposed) {
        approved = true;
        if (Number.isFinite(granted.grantExpiresAt)) expiry.textContent = `授权截止：${new Date(granted.grantExpiresAt).toLocaleString('zh-CN')}。此期限不会随使用自动延长。`;
        explain('已允许连接。请返回 ST 继续保存；可在编辑器中主动断开连接。'); cancel.textContent = '关闭窗口';
      }
    } catch (error) {
      if (!disposed && error.code === 'ACCOUNT_CHANGED') {
        await inspect();
        if (inspected) explain('登录账号已更换。请重新核对上方账号，再决定是否允许连接。');
      } else if (!disposed) { inspected = false; explain('授权未完成，或连接已经结束。请回到 ST 重新连接，草稿和所选文件会保留。'); }
    } finally { busy = false; cancel.disabled = false; approve.removeAttribute('aria-busy'); }
  });
  cancel.addEventListener('click', async () => {
    if (disposed || busy) return;
    busy = true; approve.disabled = true; cancel.disabled = true;
    try {
      if (!approved && session) await auth('deny');
      disposed = true; inspected = false;
      explain('已结束此授权页面。请回到 ST 继续操作。'); popup.close();
    } catch { explain('取消尚未确认。请重试，或回到 ST 点击“取消当前操作”。'); }
    finally { busy = false; cancel.disabled = false; }
  });
  popup.addEventListener('pagehide', () => { disposed = true; inspected = false; approve.disabled = true; });
  if (!session) { explain('连接参数无效。请从 ST 的 CharInfo Manager 重新发起连接。'); return; }
  void inspect();
}
