// Keep authentication and the return URL on the existing Discord OAuth endpoint.
function safeLocalReturnTo(value) {
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/account/?view=files';
  return value;
}
const returnTo = safeLocalReturnTo(new URLSearchParams(location.search).get('returnTo'));
const login = document.querySelector('#discordLogin');
const status = document.querySelector('#loginStatus');
login.href = `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`;
try {
  const response = await fetch('/api/user/me', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('session check failed');
  const identity = await response.json();
  if (identity.authenticated) location.replace(returnTo);
  else if (identity.discordAuthConfigured === false) status.textContent = '本站尚未启用 Discord 登录，请联系站点管理员。';
  else status.textContent = '登录完成后会自动返回原页面。';
} catch {
  status.textContent = '暂时无法检查登录状态；仍可点击 Discord 登录重试。';
}