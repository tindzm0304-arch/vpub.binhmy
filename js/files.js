/* Lưu trong IndexedDB — localStorage không chứa được tệp lớn:
   - kho `blobs`: nội dung tệp đính kèm;
   - kho `snapshots`: bản sao lưu tự động hằng ngày (chỉ dữ liệu nghiệp vụ, không kèm tệp). */

const DB_NAME = 'quan-ly-noi-bo-files';
const DB_VERSION = 3;
const STORE = 'blobs';
const SNAPSHOTS = 'snapshots';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function run(name, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = action(tx.objectStore(name));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const saveBlob = (id, blob) => run(STORE, 'readwrite', (store) => store.put(blob, id));
export const getBlob = (id) => run(STORE, 'readonly', (store) => store.get(id));
export const deleteBlobs = (ids) => run(STORE, 'readwrite', (store) => {
  ids.forEach((id) => store.delete(id));
  return null;
});

/* ---------- Bản sao lưu tự động ---------- */
export const saveSnapshot = (entry) => run(SNAPSHOTS, 'readwrite', (store) => store.put(entry));
export const deleteSnapshot = (id) => run(SNAPSHOTS, 'readwrite', (store) => store.delete(id));
export const getSnapshot = (id) => run(SNAPSHOTS, 'readonly', (store) => store.get(id));
/** Danh sách bản sao lưu tự động, mới nhất trước (không kèm nội dung JSON để nhẹ). */
export async function listSnapshots() {
  const all = await run(SNAPSHOTS, 'readonly', (store) => store.getAll());
  return (all ?? [])
    .map(({ id, at, counts }) => ({ id, at, counts }))
    .sort((a, b) => b.id.localeCompare(a.id));
}
