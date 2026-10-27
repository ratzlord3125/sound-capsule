// Tiny IndexedDB key-value store shared by the history importer and the tempo cache.

const DB_NAME = "sound-capsule";
const STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const idbGet = (key) => withStore("readonly", (s) => s.get(key));
export const idbSet = (key, value) => withStore("readwrite", (s) => s.put(value, key));
export const idbDel = (key) => withStore("readwrite", (s) => s.delete(key));
