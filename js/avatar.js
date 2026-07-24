// アバター合成: 勇者のドット絵に装備(武器/頭/体/盾)を重ねてSVG化する
import { GEAR } from './gear.js';

// 勇者ベース(8x12) — sprites.js の hero と同じ形
const HERO = {
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
};

// 頭装備オーバーレイ(ヒーロー座標: 頭は行0-2)
const HELM_OVL = ['..CCCC..', '.CWCCWC.', '.CCCCCC.'];
const CROWN_OVL = ['.G.GG.G.', '.GGGGGG.'];
// 体装備オーバーレイ(行6-8)
const PLATE_OVL = ['.CCCCCC.', 'CCWCCWCC', '.CCCCCC.'];

// 武器(右手側に構える。5幅x10高)
const WEAPONS = {
  sword: ['...B.', '..WB.', '..WB.', '..WB.', '..WB.', '..WB.', '.GGGG', '..HH.', '..HH.', '.....'],
  axe: ['.CCC.', 'CCCCH', 'CCCCH', '.CCH.', '..H..', '..H..', '..H..', '..H..', '..H..', '.....'],
  bow: ['.CC..', 'C..C.', 'C..W.', 'C..W.', 'C..W.', 'C..W.', 'C..W.', 'C..C.', '.CC..', '.....'],
  trident: ['C.C.C', 'C.C.C', 'CCCCC', '..H..', '..H..', '..H..', '..H..', '..H..', '..H..', '.....']
};
// 盾(左手側。6幅x7高)
const SHIELD_OVL = ['DCCCCD', 'CWWWWC', 'CWGGWC', 'CWGGWC', 'DCCCCD', '.DCCD.', '..DD..'];

function rectsFor(grid, colorMap, ox, oy) {
  let out = '';
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const color = colorMap[ch];
      if (!color || ch === '.') { x++; continue; }
      let x2 = x + 1;
      while (x2 < row.length && row[x2] === ch) x2++;
      out += `<rect x="${ox + x}" y="${oy + y}" width="${x2 - x}" height="1" fill="${color}"/>`;
      x = x2;
    }
  }
  return out;
}

// equip = { weapon, head, body, shield } (gear id または null)
export function avatarSVG(equip = {}, sizePx = 48) {
  const HERO_OX = 4, HERO_OY = 1;
  const vbW = 15, vbH = 14;
  let layers = '';

  // 盾(ヒーローの後ろ・左手)
  if (equip.shield && GEAR[equip.shield]) {
    const m = GEAR[equip.shield].mat;
    layers += rectsFor(SHIELD_OVL, { D: m.D, C: m.B, W: m.W, G: m.G }, 0, 6);
  }

  // ベース勇者
  layers += rectsFor(HERO.grid, HERO.colors, HERO_OX, HERO_OY);

  // 体装備
  if (equip.body && GEAR[equip.body]) {
    const m = GEAR[equip.body].mat;
    layers += rectsFor(PLATE_OVL, { C: m.B, W: m.W }, HERO_OX, HERO_OY + 6);
  }

  // 頭装備
  if (equip.head && GEAR[equip.head]) {
    const g = GEAR[equip.head]; const m = g.mat;
    if (g.family === 'crown') {
      layers += rectsFor(CROWN_OVL, { G: m.B || '#ffcd75' }, HERO_OX, HERO_OY);
    } else {
      layers += rectsFor(HELM_OVL, { C: m.B, W: m.W }, HERO_OX, HERO_OY);
    }
  }

  // 武器(右手)
  if (equip.weapon && GEAR[equip.weapon]) {
    const g = GEAR[equip.weapon]; const m = g.mat;
    const grid = WEAPONS[g.family] || WEAPONS.sword;
    layers += rectsFor(grid, { B: m.W, C: m.B, W: m.B, G: m.G, H: m.H || '#7a4a1f' }, 10, 2);
  }

  const h = Math.round(sizePx * vbH / vbW);
  return `<svg viewBox="0 0 ${vbW} ${vbH}" width="${sizePx}" height="${h}" shape-rendering="crispEdges" aria-hidden="true">${layers}</svg>`;
}
