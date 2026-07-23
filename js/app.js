// エントリポイント: ハッシュルーターと Service Worker 登録
import { renderHome } from './views/home.js';
import { renderWizard } from './views/wizard.js';
import { renderMap } from './views/map.js';
import { renderTraining } from './views/training.js';

const app = document.getElementById('app');

async function route() {
  const hash = location.hash;
  document.getElementById('overlay-root').innerHTML = '';
  app.classList.remove('fade-in');

  if (hash.startsWith('#map/')) {
    await renderMap(app, hash.slice(5));
  } else if (hash === '#new') {
    renderWizard(app);
  } else if (hash === '#training') {
    await renderTraining(app);
  } else {
    await renderHome(app);
  }
  requestAnimationFrame(() => app.classList.add('fade-in'));
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) {
  // 新しいSWが制御を握ったら一度だけリロードして最新版を反映する
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // 起動のたびに更新をチェック
      reg.update();
      // 待機中の新SWがあればすぐ有効化させる
      if (reg.waiting) reg.waiting.postMessage('skip-waiting');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage('skip-waiting');
          }
        });
      });
    }).catch(() => {
      /* file:// 直開きなどでは登録できないが、アプリ自体は動く */
    });
  });
}
