// ルーター + Service Worker 登録
import { renderList } from './views/list.js';
import { renderRecord } from './views/record.js';
import { renderDetail } from './views/detail.js';
import { closeSheet, el, toast } from './util.js';
import { applyTheme, watchSystemTheme } from './theme.js';

applyTheme();
watchSystemTheme();

const app = document.getElementById('app');
let cleanup = null;

function parseHash() {
  const raw = (location.hash || '#/').replace(/^#/, '');
  const [path, ...rest] = raw.split('/').filter(Boolean);
  return { path: path || 'list', id: rest[0] || null };
}

async function render() {
  const { path, id } = parseHash();
  closeSheet();
  if (typeof cleanup === 'function') {
    try { await cleanup(); } catch { /* 破棄時のエラーは無視 */ }
    cleanup = null;
  }
  app.replaceChildren();
  document.body.dataset.view = path;
  const view = { rec: renderRecord, m: renderDetail, list: renderList }[path] || renderList;
  try {
    cleanup = await view(app, id);
  } catch (err) {
    console.error(err);
    app.replaceChildren(el('div', { class: 'error-view' },
      el('p', {}, '画面の表示に失敗しました'),
      el('p', { class: 'error-detail' }, String(err?.message || err)),
      el('a', { class: 'btn btn-primary', href: '#/' }, '一覧にもどる')
    ));
  }
  window.scrollTo(0, 0);
}

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', render);
render();

// Service Worker(オフライン動作と更新通知)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('新しいバージョンがあります。次回起動時に反映されます');
            sw.postMessage('skip-waiting');
          }
        });
      });
    }).catch(() => { /* オフライン機能なしでも動作する */ });
  });
}
