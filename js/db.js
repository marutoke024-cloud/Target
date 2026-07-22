// IndexedDB ラッパー: マップ・記録・画像を永続化する
const DB_NAME = 'quest-dungeon';
const DB_VER = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('maps')) {
        db.createObjectStore('maps', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: 'id' });
        s.createIndex('mapId', 'mapId');
      }
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : undefined);
    t.onerror = () => reject(t.error);
  }));
}

function reqValue(req) {
  const holder = {};
  req.onsuccess = () => { holder.__value = req.result; };
  return holder;
}

// --- maps ---
export function getAllMaps() {
  return tx('maps', 'readonly', (s) => reqValue(s.getAll()))
    .then((maps) => maps.sort((a, b) => b.createdAt - a.createdAt));
}

export function getMap(id) {
  return tx('maps', 'readonly', (s) => reqValue(s.get(id)));
}

export function putMap(map) {
  map.updatedAt = Date.now();
  return tx('maps', 'readwrite', (s) => { s.put(map); });
}

export async function deleteMap(id) {
  // 付随する記録と画像もまとめて削除
  const map = await getMap(id);
  const records = await getRecords(id);
  const imageIds = new Set();
  if (map) {
    for (const step of map.steps) if (step.imageId) imageIds.add(step.imageId);
    if (map.goal?.imageId) imageIds.add(map.goal.imageId);
    if (map.secretGoal?.imageId) imageIds.add(map.secretGoal.imageId);
  }
  for (const r of records) for (const iid of r.imageIds || []) imageIds.add(iid);
  await tx('records', 'readwrite', (s) => { for (const r of records) s.delete(r.id); });
  await tx('images', 'readwrite', (s) => { for (const iid of imageIds) s.delete(iid); });
  await tx('maps', 'readwrite', (s) => { s.delete(id); });
}

// --- records ---
export function getRecords(mapId) {
  return tx('records', 'readonly', (s) => reqValue(s.index('mapId').getAll(mapId)))
    .then((rs) => rs.sort((a, b) => b.createdAt - a.createdAt));
}

export function putRecord(record) {
  return tx('records', 'readwrite', (s) => { s.put(record); });
}

export async function deleteRecord(record) {
  for (const iid of record.imageIds || []) {
    await tx('images', 'readwrite', (s) => { s.delete(iid); });
  }
  return tx('records', 'readwrite', (s) => { s.delete(record.id); });
}

// --- images ---
const urlCache = new Map();

export async function putImage(id, blob) {
  await tx('images', 'readwrite', (s) => { s.put({ id, blob }); });
  return id;
}

export async function getImageURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await tx('images', 'readonly', (s) => reqValue(s.get(id)));
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

export function deleteImage(id) {
  if (urlCache.has(id)) {
    URL.revokeObjectURL(urlCache.get(id));
    urlCache.delete(id);
  }
  return tx('images', 'readwrite', (s) => { s.delete(id); });
}
