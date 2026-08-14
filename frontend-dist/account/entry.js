const entry = document.querySelector('#accountEntry');
const root = document.documentElement;
const loginPath = window.location.pathname === '/login';
const legacyAdminLoginPath = window.location.pathname === '/adminLogin';
let loginObserver;

root.classList.add('discord-auth-pending');
entry.hidden = true;

function showAuthenticatedApp() {
  root.classList.remove('discord-auth-pending', 'discord-login-only');
  loginObserver?.disconnect();
  entry.hidden = false;
  entry.href = '/my-files';
  entry.textContent = '我的文件';
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
  title.textContent = '登录后开始上传';

  const note = document.createElement('p');
  note.textContent = '使用 Discord 验证身份，登录后即可进入上传页面。';

  const login = document.createElement('a');
  login.className = 'discord-login-button';
  login.href = '/api/auth/discord';
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
  if (loginPath) {
    showDiscordLogin();
    return;
  }
  window.location.replace('/login');
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
      window.location.replace('/');
      return;
    }
    showAuthenticatedApp();
    return;
  }
  handleSignedOut();
}).catch(handleSignedOut);
