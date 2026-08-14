const entry = document.querySelector('#accountEntry');

fetch('/api/user/me', { credentials: 'same-origin' }).then(async response => {
  if (!response.ok) return;
  const data = await response.json();
  if (!data.authenticated) return;
  entry.href = '/my-files';
  entry.textContent = '我的文件';
}).catch(() => {});
