const DATABASE = 'charinfo-creator-editor';

export async function readLegacyDraft(database) {
  const db = await new Promise((resolve, reject) => {
    let missing = false;
    let blocked = false;
    const request = database.open(DATABASE);
    request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onerror = () => missing ? resolve(null) : reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('请关闭其他使用本站的标签页后重试。')); };
  });
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains('workspace')) return null;
    return await new Promise((resolve, reject) => {
      const request = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export function mountDraftExport() {
  const button = document.querySelector('#downloadLegacyDraft');
  const status = document.querySelector('#draftStatus');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status.textContent = '正在读取此浏览器的旧草稿…';
    try {
      const draft = await readLegacyDraft(indexedDB);
      if (!draft) { status.textContent = '此浏览器在当前站点没有找到旧草稿。请使用最初编辑时的浏览器和域名。'; return; }
      const blob = new Blob([JSON.stringify({ format: 'charinfo-creator-browser-backup', version: 1, workspace: draft }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'charinfo-browser-draft-backup.json';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '已生成备份下载，旧草稿仍保留在此浏览器中。请妥善保存文件，其中可能包含未公开的角色资料。';
    } catch (error) {
      status.textContent = error.message === '请关闭其他使用本站的标签页后重试。' ? error.message : '无法读取旧草稿。请保留此浏览器的数据，并检查浏览器是否允许本站访问本地存储后重试。';
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
}
