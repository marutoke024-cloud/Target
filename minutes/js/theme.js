// 配色(ダーク / ライト / 端末に合わせる)の切り替え。
// 初期表示のちらつきを防ぐため、index.html でも同じキーを見て先に属性を当てている。

export const THEME_KEY = 'minutes.theme';
export const THEMES = [
  { value: 'dark', label: 'ダーク' },
  { value: 'light', label: 'ライト' },
  { value: 'system', label: '端末に合わせる' }
];

// 既定はダーク
export function loadTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.value === v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

// 実際に描画される配色(system を解決したもの)
export function resolvedTheme(theme = loadTheme()) {
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const META_COLOR = { dark: '#15161c', light: '#f3f4f7' };

export function applyTheme(theme = loadTheme()) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const resolved = resolvedTheme(theme);
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', META_COLOR[resolved]);
  return resolved;
}

export function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* 保存できなくても表示は切り替わる */ }
  return applyTheme(theme);
}

// 「端末に合わせる」ときは OS 側の切り替えに追従する
export function watchSystemTheme() {
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  mq?.addEventListener?.('change', () => {
    if (loadTheme() === 'system') applyTheme('system');
  });
}
