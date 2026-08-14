const entry = document.querySelector('#accountEntry');
const root = document.documentElement;
let gateObserver;

root.classList.add('discord-auth-pending');

function removeUploadGate() {
  root.classList.remove('discord-auth-pending', 'discord-auth-required');
  gateObserver?.disconnect();
  document.querySelector('.discord-auth-gate')?.remove();
}

function renderUploadGate() {
  const card = document.querySelector('.upload-card');
  const upload = card?.querySelector('.el-upload[role="button"]');
  if (!card || !upload) return;

  upload.setAttribute('aria-disabled', 'true');
  upload.setAttribute('tabindex', '-1');
  if (card.querySelector('.discord-auth-gate')) return;

  const gate = document.createElement('div');
  gate.className = 'discord-auth-gate';
  gate.setAttribute('role', 'region');
  gate.setAttribute('aria-labelledby', 'discord-auth-gate-title');
  gate.setAttribute('aria-describedby', 'discord-auth-gate-note');
  gate.setAttribute('aria-live', 'polite');

  const title = document.createElement('strong');
  title.id = 'discord-auth-gate-title';
  title.textContent = '登录 Discord 后上传';

  const note = document.createElement('span');
  note.id = 'discord-auth-gate-note';
  note.textContent = '管理员密码仅用于系统设置；上传文件需要绑定 Discord 账号。';

  const login = document.createElement('a');
  login.href = '/api/auth/discord';
  login.textContent = '使用 Discord 登录';

  gate.append(title, note, login);
  card.append(gate);
}

function requireDiscordLogin() {
  root.classList.remove('discord-auth-pending');
  root.classList.add('discord-auth-required');
  renderUploadGate();
  gateObserver = new MutationObserver(renderUploadGate);
  gateObserver.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
}

function blockAnonymousFileTransfer(event) {
  if (!root.classList.contains('discord-auth-pending') && !root.classList.contains('discord-auth-required')) return;
  const transfer = event.clipboardData || event.dataTransfer;
  const containsFile = [...(transfer?.items || [])].some(item => item.kind === 'file') || [...(transfer?.files || [])].length > 0;
  if (!containsFile) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

document.addEventListener('paste', blockAnonymousFileTransfer, true);
document.addEventListener('drop', blockAnonymousFileTransfer, true);

fetch('/api/user/me', { credentials: 'same-origin' }).then(async response => {
  const data = await response.json().catch(() => ({}));
  if (data.authenticated) {
    removeUploadGate();
    entry.href = '/my-files';
    entry.textContent = '我的文件';
    return;
  }
  if (data.discordAuthConfigured === false) {
    removeUploadGate();
    return;
  }
  requireDiscordLogin();
}).catch(requireDiscordLogin);
