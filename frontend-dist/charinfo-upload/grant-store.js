export function createGrantStore(database) {
  let opening;
  function open() {
    opening ||= new Promise((resolve, reject) => {
      const request = database.open('charinfo-upload-grants', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('parents');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Storage blocked'));
    });
    return opening;
  }
  async function request(parentOrigin, value, remove = false) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('parents', value === undefined && !remove ? 'readonly' : 'readwrite');
      const store = tx.objectStore('parents');
      const operation = remove ? store.delete(parentOrigin) : value === undefined ? store.get(parentOrigin) : store.put(value, parentOrigin);
      let result;
      operation.onsuccess = () => { result = operation.result; };
      tx.oncomplete = () => resolve(result || null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return { get: origin => request(origin), set: (origin, value) => request(origin, value), remove: origin => request(origin, undefined, true), close: async () => { if (opening) (await opening).close(); } };
}
