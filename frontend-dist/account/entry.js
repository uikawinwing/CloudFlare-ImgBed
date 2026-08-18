import { mountLegacyShell } from './shell.js';

const entry = document.querySelector('#accountEntry');
const root = document.documentElement;
const params = new URLSearchParams(window.location.search);
const embedded = params.get('embedded') === '1' || window.self !== window.top;
const loginPath = window.location.pathname === '/login' || window.location.pathname === '/login/';
const legacyAdminLoginPath = window.location.pathname === '/adminLogin';
let loginObserver;

function localReturnTo(fallback = '/account/?view=files') {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : fallback;
}

if (embedded) root.classList.add('legacy-embedded');
root.classList.add('discord-auth-pending');
entry.hidden = true;

function showAuthenticatedApp(identity) {
  root.classList.remove('discord-auth-pending', 'discord-login-only');
  loginObserver?.disconnect();
  entry.hidden = embedded;
  entry.href = '/account/?view=files';
  entry.textContent = '我的文件';
  if (!embedded && !loginPath && !legacyAdminLoginPath) mountLegacyShell(identity || {});
}

function showLegacyApp() {
  root.classList.remove('discord-auth-pending', 'discord-login-only');
  entry.hidden = true;
}

function renderDiscordLogin() {
  const container = document.querySelector('.login-container');
  if (!container || container.dataset.discordLoginReady === 'true') return;

  container.dataset.discordLoginReady = 'true';
  container.replaceChildren();

  const title = document.createElement('h1');
  title.textContent = '登录后继续';

  const note = document.createElement('p');
  note.textContent = '使用 Discord 验证身份，登录后会返回工作区。';

  const login = document.createElement('a');
  login.className = 'discord-login-button';
  login.href = `/api/auth/discord?returnTo=${encodeURIComponent(localReturnTo())}`;
  login.textContent = '使用 Discord 登录';

  const hint = document.createElement('small');
  hint.textContent = '登录完成后会自动返回本站。';

  container.append(title, note, login, hint);
}

function showDiscordLogin() {
  root.classList.remove('discord-auth-pending');
  root.classList.add('discord-login-only');
  entry.hidden = true;
  renderDiscordLogin();
  loginObserver = new MutationObserver(renderDiscordLogin);
  loginObserver.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
}

function handleSignedOut() {
  if (loginPath && !embedded) {
    showDiscordLogin();
    return;
  }
  const target = `/login?returnTo=${encodeURIComponent(localReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`))}`;
  if (embedded && window.top !== window.self) window.top.location.replace(target);
  else window.location.replace(target);
}

fetch('/api/user/me', { credentials: 'same-origin' }).then(async response => {
  const data = await response.json().catch(() => ({}));
  if (data.discordAuthConfigured === false) {
    showLegacyApp();
    return;
  }
  if (legacyAdminLoginPath) {
    window.location.replace('/login');
    return;
  }
  if (data.authenticated) {
    if (loginPath) {
      window.location.replace(localReturnTo());
      return;
    }
    showAuthenticatedApp(data.user || data.identity || data);
    return;
  }
  handleSignedOut();
}).catch(handleSignedOut);
