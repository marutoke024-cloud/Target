// ドット絵スプライト: 文字グリッド → SVG に変換して描画する
// パレット (Sweetie-16 ベース)
export const PAL = {
  night: '#1a1c2c', purple: '#5d275d', red: '#b13e53', orange: '#ef7d57',
  yellow: '#ffcd75', lime: '#a7f070', green: '#38b764', teal: '#257179',
  navy: '#29366f', blue: '#3b5dc9', sky: '#41a6f6', cyan: '#73eff7',
  white: '#f4f4f4', grey: '#94b0c2', slate: '#566c86', dark: '#333c57'
};

const GRIDS = {
  // 通常の宝箱(閉) 茶+金
  chestClosed: {
    colors: { D: '#3a2317', B: '#a05a2c', L: '#c98a4b', G: '#ffcd75', g: '#e8a33d', K: '#1a1c2c' },
    grid: [
      '..DDDDDDDDDD..',
      '.DLLLLLLLLLLD.',
      'DLLBBBBBBBBLLD',
      'DBBBBBBBBBBBBD',
      'DGggggggggggGD',
      'DDDDDDDDDDDDDD',
      'DBBBBBGGBBBBBD',
      'DBBBBGggGBBBBD',
      'DBBBBGgKGBBBBD',
      'DBBBBBGGBBBBBD',
      'DBBBBBBBBBBBBD',
      'DDDDDDDDDDDDDD'
    ]
  },
  // 通常の宝箱(開) 中から金の輝き
  chestOpen: {
    colors: { D: '#3a2317', B: '#a05a2c', L: '#c98a4b', G: '#ffcd75', g: '#e8a33d', W: '#fff7d6', Y: '#ffe08a' },
    grid: [
      '.DDDDDDDDDDDD.',
      'DLLLLLLLLLLLLD',
      'DDDDDDDDDDDDDD',
      '.DWYGYWGYGYWD.',
      '.DYGWYGYWYGYD.',
      'DDDDDDDDDDDDDD',
      'DBBBBBBBBBBBBD',
      'DBBBBBGGBBBBBD',
      'DBBBBGggGBBBBD',
      'DBBBBBGGBBBBBD',
      'DBBBBBBBBBBBBD',
      'DDDDDDDDDDDDDD'
    ]
  },
  // 裏ゴールの豪華な宝箱(閉) 紫+金+宝石
  luxeClosed: {
    colors: { D: '#2b1a3a', P: '#5d275d', p: '#7d3f8d', G: '#ffcd75', g: '#e8a33d', R: '#ff5d8f', C: '#73eff7', K: '#1a1c2c', W: '#f4f4f4' },
    grid: [
      '..G..DDDDDD..G..',
      '.GWG.DppppD.GWG.',
      '..G.DppppppD.G..',
      '.DDDpPPPPPPpDDD.',
      'DppppPPPPPPppppD',
      'DGggggggggggggGD',
      'DDDDDDDDDDDDDDDD',
      'DPPPGPPCCPPGPPPD',
      'DPPPGPCCCCPGPPPD',
      'DPPPGPCKCCPGPPPD',
      'DPPPGPPCCPPGPPPD',
      'DPPPGPPPPPPGPPPD',
      'DGGGGGGGGGGGGGGD',
      'DDDDDDDDDDDDDDDD'
    ]
  },
  // 裏ゴールの豪華な宝箱(開)
  luxeOpen: {
    colors: { D: '#2b1a3a', P: '#5d275d', p: '#7d3f8d', G: '#ffcd75', g: '#e8a33d', R: '#ff5d8f', C: '#73eff7', W: '#ffffff', Y: '#ffe08a' },
    grid: [
      '.G....W....G.W..',
      'GWG..WYW..GWG...',
      '.G.DDDDDDDD.G...',
      '.DDpppppppppDD..',
      'DDDDDDDDDDDDDDDD',
      '.DWCYRWYCWRYWD..',
      '.DYRWCYRWCYRYD..',
      'DDDDDDDDDDDDDDDD',
      'DPPPGPPPPPPGPPPD',
      'DPPPGPRCCRPGPPPD',
      'DPPPGPCRRCPGPPPD',
      'DPPPGPPPPPPGPPPD',
      'DGGGGGGGGGGGGGGD',
      'DDDDDDDDDDDDDDDD'
    ]
  },
  // 金の星(実績)
  starGold: {
    colors: { D: '#8a5a00', Y: '#ffcd75', W: '#fff3c4', O: '#e8a33d' },
    grid: [
      '.....DD.....',
      '....DYYD....',
      '....DYYD....',
      '...DYWWYD...',
      'DDDDYWWYDDDD',
      'DYYYYWWYYYYD',
      '.DYYYWWYYYD.',
      '..DYYYYYYD..',
      '..DYYOOYYD..',
      '.DYYODDOYYD.',
      '.DYOD..DOYD.',
      '.DDD....DDD.'
    ]
  },
  // 紫の星(裏実績)
  starPurple: {
    colors: { D: '#3a1a4a', Y: '#b06ad4', W: '#e8c8f7', O: '#7d3f8d' },
    grid: [
      '.....DD.....',
      '....DYYD....',
      '....DYYD....',
      '...DYWWYD...',
      'DDDDYWWYDDDD',
      'DYYYYWWYYYYD',
      '.DYYYWWYYYD.',
      '..DYYYYYYD..',
      '..DYYOOYYD..',
      '.DYYODDOYYD.',
      '.DYOD..DOYD.',
      '.DDD....DDD.'
    ]
  },
  // 勇者(プレイヤー)
  hero: {
    colors: { D: '#333c57', H: '#94b0c2', h: '#c7d6e0', S: '#f0c8a0', K: '#1a1c2c', B: '#3b5dc9', b: '#29366f', R: '#b13e53', G: '#ffcd75' },
    grid: [
      '..DDDD..',
      '.DhHHhD.',
      '.DHHHHD.',
      '.DSSSSD.',
      '.DSKSKD.',
      '.DSSSSD.',
      '.DBBBBD.',
      'DBGBBGBD',
      'DSDBBDSD',
      '.DbDDbD.',
      '.Db..bD.',
      '.DD..DD.'
    ]
  },
  // スタート地点の旗
  flag: {
    colors: { D: '#333c57', R: '#b13e53', r: '#d95763', W: '#f4f4f4', P: '#8a6f4b' },
    grid: [
      '.DP.......',
      '.DPRRRR...',
      '.DPRrrRR..',
      '.DPRRRRr..',
      '.DPRrrRR..',
      '.DPRRRR...',
      '.DP.......',
      '.DP.......',
      '.DP.......',
      'DDPDD.....'
    ]
  },
  // 記録帳(本)
  book: {
    colors: { D: '#3a2317', R: '#b13e53', r: '#d95763', W: '#f4f4f4', G: '#ffcd75' },
    grid: [
      'DDDDDDDDDD.',
      'DRRRRRGRRDD',
      'DRrrrrGrrDW',
      'DRrrrrGrrDW',
      'DRrrrrGrrDW',
      'DRrrrrGrrDW',
      'DRrrrrGrrDW',
      'DRRRRRGRRDW',
      'DDDDDDDDDDW',
      '.DWWWWWWWW.'
    ]
  },
  // 岩(未クリアのステップ)
  rock: {
    colors: { D: '#3f4866', G: '#94b0c2', g: '#7a8fa5', L: '#c7d6e0' },
    grid: [
      '...DDDDDD...',
      '..DGGLLGGD..',
      '.DGLLGGGGGD.',
      'DGGLGGGGggGD',
      'DGLGGGGGgggD',
      'DGGGGGGggggD',
      'DGGGGGggggGD',
      '.DGGgggggGD.',
      '..DDDDDDDD..'
    ]
  },
  // 宝石(クリア済みステップ) ※色は動的に差し替え
  gem: {
    colors: { D: '#00000000', A: '#38b764', B: '#a7f070', W: '#f4f4f4', E: '#257179' },
    grid: [
      '..DAAAAAAD..',
      '.DABWWBAAAD.',
      'DABWWBAAAAAD',
      'DABWBAAAAAED',
      'DABAAAAAAEED',
      'DAAAAAAAEEED',
      '.DAAAAAEEED.',
      '..DAAAEEED..',
      '...DAEEED...',
      '....DDDD....'
    ]
  },
  // ご褒美マスのペロペロキャンディー(渦巻き+棒)
  candy: {
    colors: { D: '#5d1a35', P: '#ff5d8f', p: '#ff8fb0', W: '#fff4f8', H: '#f4f4f4', S: '#c9ced6' },
    grid: [
      '...DDDDD...',
      '..DPPpPPD..',
      '.DPWWWWWPD.',
      'DPpWPPPWpPD',
      'DPWPPpPPWPD',
      'DPWPpWpPWPD',
      'DPWPPpPPWPD',
      'DPpWPPPWpPD',
      '.DPWWWWWPD.',
      '..DPPpPPD..',
      '...DDDDD...',
      '....DHS....',
      '....DHS....',
      '....DHS....',
      '....DDD....'
    ]
  },
  // 特訓の敵スライム(HPを削って討伐する)
  slime: {
    colors: { D: '#0f3a1e', B: '#38b764', L: '#7bed9f', W: '#f4f4f4', K: '#0a1a10' },
    grid: [
      '...BBBB...',
      '..BLLLBB..',
      '.BLLBBBBB.',
      'BBBBBBBBBB',
      'BWKBBBBWKB',
      'BBBBBBBBBB',
      'BBKKBBKKBB',
      '.DBBBBBBD.'
    ]
  },
  // スタンプ(習慣達成の判子)赤いハンコ風
  stamp: {
    colors: { R: '#d1324a', r: '#ff5566', W: '#fff0f0', D: '#6e1622' },
    grid: [
      '.RRRRRR.',
      'RRrrrrRR',
      'RrrrrWrR',
      'RrrrWWrR',
      'RrWWWrrR',
      'RrWWrrrR',
      'RRrrrrRR',
      '.RRRRRR.'
    ]
  },
  // カギ(まだ開かないゴール)
  lock: {
    colors: { D: '#8a5a00', G: '#ffcd75', g: '#e8a33d', K: '#1a1c2c' },
    grid: [
      '..DDDD..',
      '.DGggGD.',
      '.DG..GD.',
      'DDDDDDDD',
      'DGGGGGGD',
      'DGGKKGGD',
      'DGGKKGGD',
      'DGGGGGGD',
      'DDDDDDDD'
    ]
  }
};

// グリッドをSVG文字列へ
export function spriteSVG(name, opts = {}) {
  const def = GRIDS[name];
  if (!def) return '';
  return gridSVG(def, opts);
}

// 任意のグリッド定義をSVG化(武具スプライトなど外部定義用)
export function gridSVG(def, opts = {}) {
  const grid = def.grid;
  const colors = Object.assign({}, def.colors, opts.colors || {});
  const h = grid.length;
  const w = Math.max(...grid.map((r) => r.length));
  let rects = '';
  for (let y = 0; y < h; y++) {
    const row = grid[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const color = colors[ch];
      if (!color || ch === '.') { x++; continue; }
      // 同色の連続をまとめて1つのrectに
      let x2 = x + 1;
      while (x2 < row.length && row[x2] === ch) x2++;
      rects += `<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${color}"/>`;
      x = x2;
    }
  }
  const cls = opts.cls ? ` class="${opts.cls}"` : '';
  return `<svg${cls} viewBox="0 0 ${w} ${h}" width="${opts.size || w * 4}" height="${(opts.size || w * 4) * h / w}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// クリア済みステップ用の宝石: インデックスごとに色を変える
const GEM_THEMES = [
  { A: '#38b764', B: '#a7f070', E: '#257179' }, // 緑
  { A: '#3b5dc9', B: '#73eff7', E: '#29366f' }, // 青
  { A: '#b13e53', B: '#ff9aa8', E: '#7a2436' }, // 赤
  { A: '#e8a33d', B: '#ffe08a', E: '#a86a1a' }, // 橙
  { A: '#7d3f8d', B: '#d9a0f0', E: '#4a1f5d' }  // 紫
];
export function gemSVG(index, size) {
  const t = GEM_THEMES[index % GEM_THEMES.length];
  return spriteSVG('gem', { colors: { A: t.A, B: t.B, E: t.E, W: '#ffffff' }, size });
}
