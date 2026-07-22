/* クエストダンジョン Service Worker: アプリシェルをキャッシュしてオフライン動作させる */
const VERSION = 'qd-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './fonts/dotgothic16.css',
  './js/app.js',
  './js/db.js',
  './js/util.js',
  './js/sprites.js',
  './js/views/home.js',
  './js/views/wizard.js',
  './js/views/map.js',
  './js/views/records.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // ナビゲーションは常にアプリシェルへ(SPA)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then((r) => r || fetch(e.request))
    );
    return;
  }

  // フォントのサブセット等はキャッシュ優先 + 取得時にキャッシュへ追加
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
