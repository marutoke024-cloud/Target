// 共通ユーティリティ(DOM生成・整形・トースト・ダイアログ)

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// el('div', {class:'x', onclick:fn}, child, ...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

const pad2 = (n) => String(n).padStart(2, '0');

// 経過時間 12:34 / 1:02:03
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

// 所要時間 1時間02分 / 12分34秒
export function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}時間${pad2(m)}分`;
  if (m > 0) return `${m}分${pad2(s)}秒`;
  return `${s}秒`;
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}(${WEEK[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

// 一覧用: 今日 14:30 / 昨日 / 8/19(火)
export function fmtRelative(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (diffDays === 0) return `今日 ${time}`;
  if (diffDays === 1) return `昨日 ${time}`;
  if (diffDays < 7) return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) ${time}`;
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${time}`;
}

export function debounce(fn, ms = 500) {
  let t = null;
  let lastArgs = [];
  const wrapped = (...args) => {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  // 保留中の呼び出しを即座に実行する(引数を省くと最後の呼び出しの引数を使う)
  wrapped.flush = (...args) => {
    if (!t) return;
    clearTimeout(t);
    t = null;
    fn(...(args.length ? args : lastArgs));
  };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  return wrapped;
}

export function haptic(pattern = 10) {
  try { navigator.vibrate?.(pattern); } catch { /* 未対応端末は無視 */ }
}

let toastTimer = null;
export function toast(msg, { error = false } = {}) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div', { id: 'toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.toggle('is-error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function confirmDialog(message, { okText = 'OK', cancelText = 'キャンセル', danger = false, detail = '' } = {}) {
  return new Promise((resolve) => {
    const close = (v) => { wrap.remove(); resolve(v); };
    const wrap = el('div', { class: 'backdrop', onclick: (e) => { if (e.target === wrap) close(false); } },
      el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        el('p', { class: 'dialog-msg' }, message),
        detail ? el('p', { class: 'dialog-detail' }, detail) : null,
        el('div', { class: 'dialog-btns' },
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(false) }, cancelText),
          el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => close(true) }, okText)
        )
      )
    );
    document.getElementById('overlay-root').append(wrap);
  });
}

let sheetEl = null;
export function openSheet(title, ...children) {
  closeSheet();
  sheetEl = el('div', { class: 'backdrop sheet-backdrop', onclick: (e) => { if (e.target === sheetEl) closeSheet(); } },
    el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'sheet-grip' }),
      title ? el('h2', { class: 'sheet-title' }, title) : null,
      ...children
    )
  );
  document.getElementById('overlay-root').append(sheetEl);
  return sheetEl;
}

export function closeSheet() {
  if (sheetEl) { sheetEl.remove(); sheetEl = null; }
}

// クリップボードへコピー(Clipboard API 不可の環境ではフォールバック)
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* フォールバックへ */ }
  try {
    const ta = el('textarea', { style: 'position:fixed;top:-1000px;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadFile(filename, text, mime = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ファイル名に使えない文字を落とす
export function safeFileName(name, fallback = 'minutes') {
  const s = String(name || '').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim().slice(0, 60);
  return s || fallback;
}

// textarea を内容の高さに合わせる
export function autoGrow(ta) {
  const fit = () => {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}
