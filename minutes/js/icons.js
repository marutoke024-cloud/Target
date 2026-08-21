// 画面で使うアイコン(外部アセットなしのインラインSVG)
const PATHS = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8.5 21h7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
  play: '<path d="M8 5.5v13l11-6.5-11-6.5Z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  more: '<circle cx="12" cy="5.5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18.5" r="1.5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L18.5 7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15"/>',
  download: '<path d="M12 4v11"/><path d="M8 11.5l4 4 4-4"/><path d="M5 19.5h14"/>',
  share: '<path d="M12 4v11"/><path d="M8.5 7.5L12 4l3.5 3.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z"/><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
  edit: '<path d="M4 20h4.5L19 9.5a2.1 2.1 0 0 0-3-3L5.5 17V20Z"/><path d="M14.5 7.5l2 2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  text: '<path d="M5 6h14"/><path d="M5 11h14"/><path d="M5 16h9"/>',
  reformat: '<path d="M4 6h16"/><path d="M4 11h10"/><path d="M4 16h13"/><path d="M17.5 9.5l3 3-3 3"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3.2 3.2 0 0 1 0 6"/><path d="M17 14.6a5.5 5.5 0 0 1 3.5 4.9"/>',
  wave: '<path d="M4 12h1.5"/><path d="M8 8v8"/><path d="M12 5v14"/><path d="M16 9v6"/><path d="M20 11v2"/>'
};

export function icon(name, { size = 22, cls = '' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = PATHS[name] || '';
  // 塗りつぶしで表現するアイコン
  if (name === 'play' || name === 'stop' || name === 'sparkle') {
    svg.querySelectorAll('path, rect').forEach((n) => n.setAttribute('fill', 'currentColor'));
  }
  return svg;
}
