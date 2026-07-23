// 汎用ユーティリティ
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtDateTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// element builder: el('div', {class:'x', onclick:fn}, child...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function haptic(pattern = 12) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

let toastTimer = null;
export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div', { id: 'toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ドット風の確認ダイアログ
export function confirmDialog(message, { okText = 'はい', cancelText = 'やめる', danger = false } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('overlay-root');
    const close = (v) => { wrap.remove(); resolve(v); };
    const wrap = el('div', { class: 'dialog-backdrop', onclick: (e) => { if (e.target === wrap) close(false); } },
      el('div', { class: 'dialog pixel-panel' },
        el('p', { class: 'dialog-msg' }, message),
        el('div', { class: 'dialog-btns' },
          el('button', { class: 'btn btn-ghost', onclick: () => close(false) }, cancelText),
          el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, okText)
        )
      )
    );
    root.append(wrap);
  });
}

// ドット風の入力ダイアログ
export function promptDialog(message, { placeholder = '', value = '', okText = 'OK', maxlength = 60 } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('overlay-root');
    const input = el('input', { type: 'text', placeholder, value, maxlength });
    const close = (v) => { wrap.remove(); resolve(v); };
    const ok = () => { const v = input.value.trim(); if (v) close(v); else input.focus(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const wrap = el('div', { class: 'dialog-backdrop', onclick: (e) => { if (e.target === wrap) close(null); } },
      el('div', { class: 'dialog pixel-panel' },
        el('p', { class: 'dialog-msg' }, message),
        el('div', { class: 'dialog-input' }, input),
        el('div', { class: 'dialog-btns' },
          el('button', { class: 'btn btn-ghost', onclick: () => close(null) }, 'やめる'),
          el('button', { class: 'btn btn-primary', onclick: ok }, okText)
        )
      )
    );
    root.append(wrap);
    setTimeout(() => input.focus(), 60);
  });
}

// ボトムシート(共通)
let sheetEl = null;
export function openSheet(children) {
  closeSheet();
  const root = document.getElementById('overlay-root');
  sheetEl = el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === sheetEl) closeSheet(); } },
    el('div', { class: 'sheet' }, el('div', { class: 'sheet-grip' }), children)
  );
  root.append(sheetEl);
}
export function closeSheet() {
  if (sheetEl) { sheetEl.remove(); sheetEl = null; }
}

// 紙吹雪(全画面)
export function rainConfetti(colors, count = 60) {
  for (let i = 0; i < count; i++) {
    const c = el('div', { class: 'confetti' });
    c.style.left = `${Math.random() * 100}vw`;
    c.style.width = '8px';
    c.style.height = `${6 + Math.random() * 8}px`;
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = `${1.3 + Math.random() * 1.4}s`;
    c.style.animationDelay = `${Math.random() * 0.7}s`;
    document.body.append(c);
    setTimeout(() => c.remove(), 3600);
  }
}

// 全画面バナー演出(アイコン+メイン文+サブ文)
export function showBanner({ iconHtml = '', text = '', sub = '', purple = false, duration = 2100 }) {
  const banner = el('div', { class: `clear-banner ${purple ? 'purple' : ''}` },
    iconHtml ? el('div', { class: 'banner-star', html: iconHtml }) : null,
    el('div', { class: 'banner-text' }, text),
    sub ? el('div', { class: 'banner-sub' }, sub) : null
  );
  document.body.append(banner);
  setTimeout(() => {
    banner.style.transition = 'opacity .5s';
    banner.style.opacity = '0';
    setTimeout(() => banner.remove(), 550);
  }, duration);
}

// 画像ファイルを縮小してBlob化(容量節約)
export function resizeImage(file, maxSize = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const r = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画像の変換に失敗しました')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src = url;
  });
}

export function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
