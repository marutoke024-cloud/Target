// IndexedDB ラッパー: 議事録と録音データを端末内に保存する(サーバー送信なし)
const DB_NAME = 'meeting-minutes';
const DB_VER = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('minutes')) {
        const s = db.createObjectStore('minutes', { keyPath: 'id' });
        s.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('audio')) {
        db.createObjectStore('audio', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let value;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { value = req.result; };
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// 議事録1件の初期値
export function newMinute(overrides = {}) {
  const now = Date.now();
  return {
    id: null,
    title: '',
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    durationMs: 0,
    participants: '',
    kind: 'meeting',     // meeting | lecture
    segments: [],        // [{ t: 経過ms, text: 認識結果 }]
    body: '',            // 整形済みの本文(編集可能・書き出しの対象)
    bodyEdited: false,   // 手で編集したか(自動整形で上書きする前に確認する)
    memo: '',
    hasAudio: false,
    audioMime: '',
    ...overrides
  };
}

export function listMinutes() {
  return run('minutes', 'readonly', (s) => s.getAll())
    .then((rows) => (rows || []).sort((a, b) => b.startedAt - a.startedAt));
}

export function getMinute(id) {
  return run('minutes', 'readonly', (s) => s.get(id));
}

export function putMinute(minute) {
  const record = { ...minute, updatedAt: Date.now() };
  return run('minutes', 'readwrite', (s) => s.put(record)).then(() => record);
}

export async function deleteMinute(id) {
  await run('minutes', 'readwrite', (s) => s.delete(id));
  await run('audio', 'readwrite', (s) => s.delete(id));
}

export function putAudio(id, blob) {
  return run('audio', 'readwrite', (s) => s.put({ id, blob, type: blob.type, size: blob.size }));
}

export function getAudio(id) {
  return run('audio', 'readonly', (s) => s.get(id));
}

export function deleteAudio(id) {
  return run('audio', 'readwrite', (s) => s.delete(id));
}

// 設定は件数も少なく同期的に読みたいので localStorage に置く
const SETTINGS_KEY = 'minutes.settings';
const DEFAULT_SETTINGS = {
  lineLen: 22,        // 1行の目安文字数(スマホの1行に収まる長さ)
  timestamps: false,  // 本文にタイムスタンプを入れる
  // 音声の同時録音。多くの Android 端末はマイクを1つの用途にしか渡せず、
  // 録音しながらだと文字起こしが動かないため、既定はオフ
  saveAudio: false,
  audioBlocked: false, // この端末では録音と文字起こしを同時にできないと判明した
  keepAwake: true,    // 録音中は画面を消さない
  micMode: 'near',    // マイクの前処理: near(近くの声) / far(遠くの声)
  fillers: true,      // 「えー」「あのー」などのフィラーを取り除く
  markUncertain: true, // 認識の自信が低い発言に印をつける
  terms: []           // 用語辞書 [{ right: '正しい表記', wrong: ['聞き間違い', ...] }]
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const s = { ...DEFAULT_SETTINGS, ...saved };
    s.terms = Array.isArray(s.terms) ? s.terms : [];
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動作は継続 */ }
  return next;
}

// 端末の空き容量の目安(設定画面で表示)
export async function storageEstimate() {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est) return null;
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch {
    return null;
  }
}
