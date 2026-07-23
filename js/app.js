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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* file:// 直開きなどでは登録できないが、アプリ自体は動く */
    });
  });
}
