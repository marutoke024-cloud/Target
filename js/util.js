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
