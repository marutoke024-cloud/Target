// 伝説の武具: マインクラフト風ドット絵の装備スプライトと抽選ロジック
import { gridSVG } from './sprites.js';

// --- 形状グリッド(色はアイテムごとに差し替え) ---
// B=本体, W=ハイライト, D=輪郭, H=柄(木), G=つば/飾り
const SWORD = [
  '...........DD.',
  '..........DWBD',
  '.........DWBBD',
  '........DWBBD.',
  '.......DWBBD..',
  '......DWBBD...',
  '.DD..DWBBD....',
  '.DGD.DWBD.....',
  '..DGDWBD......',
  '...DGBD.......',
  '..DHDGD.......',
  '.DHD.DD.......',
  'DHD...........',
  'DD............'
];
const AXE = [
  '....DDDD...',
  '...DBBBBD..',
  '...DBWBBBD.',
  '...DBBBBBD.',
  '...DDDBBD..',
  '....DHDD...',
  '...DHD.....',
  '..DHD......',
  '.DHD.......',
  'DHD........',
  'DD.........'
];
const HELM = [
  '..DDDDDD..',
  '.DBWWBBBD.',
  'DBWBBBBBBD',
  'DBBBBBBBBD',
  'DBBDDDDBBD',
  'DBBD..DBBD',
  'DDDD..DDDD'
];
const CHESTPLATE = [
  '.DDD....DDD.',
  'DBWBD..DBWBD',
  'DBBBBDDBBBBD',
  'DBBBBBBBBBBD',
  '.DBBGBBGBBD.',
  '.DBBBBBBBBD.',
  '.DBBBWWBBBD.',
  '.DBBBBBBBBD.',
  '..DDDDDDDD..'
];
const SHIELD = [
  'DDDDDDDDD',
  'DBBBGBBBD',
  'DBBGWGBBD',
  'DBGWGGGBD',
  'DBBGGGBBD',
  '.DBBGBBD.',
  '..DBBBD..',
  '...DBD...',
  '....D....'
];
const BOW = [
  '...DDDD..',
  '..DHHBD..',
  '.DHHD.W..',
  'DHHD..W..',
  'DHD...W..',
  'DHD...W..',
  'DHHD..W..',
  '.DHHD.W..',
  '..DHHBD..',
  '...DDDD..'
];
const TRIDENT = [
  '.B..B..B.',
  '.B..B..B.',
  '.BW.BW.BW',
  '.BBBBBBB.',
  '....H....',
  '....H....',
  '....H....',
  '....H....',
  '....H....'
];
const CROWN = [
  'G...G...G',
  'GG.GGG.GG',
  'GGGGGGGGG',
  'GRGGCGGRG',
  'GGGGGGGGG',
  'DDDDDDDDD'
];

// --- 素材パレット ---
const IRON = { D: '#2b3140', B: '#aab4c0', W: '#e8edf2', H: '#7a4a1f', G: '#e8a33d' };
const GOLD = { D: '#4a2d00', B: '#ffcd75', W: '#fff3c4', H: '#7a4a1f', G: '#e8a33d' };
const DIAMOND = { D: '#0f4a52', B: '#41c6d9', W: '#b8fdff', H: '#7a4a1f', G: '#ffcd75' };
const NETHER = { D: '#1a0a14', B: '#6e2440', W: '#ff5d8f', H: '#3a2317', G: '#b06ad4' };
const WOODIRON = { D: '#2b3140', B: '#aab4c0', W: '#e8edf2', H: '#7a4a1f', G: '#3b5dc9' };
const SEA = { D: '#0f3a44', B: '#2fa5a0', W: '#a8f0e0', H: '#7a4a1f', G: '#ffcd75' };
const ROYAL = { D: '#4a2d00', G: '#ffcd75', R: '#b13e53', C: '#41c6d9' };
const WOODBOW = { D: '#2b3140', B: '#a05a2c', W: '#c98a4b', H: '#7a4a1f', G: '#e8edf2' };

// --- 武具カタログ ---
// slot: 装備部位(weapon/head/body/shield), family: アバター描画の形状, mat: 素材色
export const GEAR = {
  // 通常の宝箱(ゴール)から出る装備
  iron_sword: { name: '鉄の剣', grid: SWORD, colors: IRON, tier: 'normal', slot: 'weapon', family: 'sword', mat: IRON },
  iron_axe: { name: '鉄の戦斧', grid: AXE, colors: IRON, tier: 'normal', slot: 'weapon', family: 'axe', mat: IRON },
  iron_helm: { name: '鉄のかぶと', grid: HELM, colors: IRON, tier: 'normal', slot: 'head', family: 'helm', mat: IRON },
  iron_chest: { name: '鉄のよろい', grid: CHESTPLATE, colors: IRON, tier: 'normal', slot: 'body', family: 'plate', mat: IRON },
  knight_shield: { name: '騎士の盾', grid: SHIELD, colors: WOODIRON, tier: 'normal', slot: 'shield', family: 'shield', mat: WOODIRON },
  hunter_bow: { name: '狩人の弓', grid: BOW, colors: WOODBOW, tier: 'normal', slot: 'weapon', family: 'bow', mat: WOODBOW },
  // 豪華な宝箱(裏ゴール)から出る、さらに強そうな装備
  diamond_sword: { name: 'ダイヤの剣', grid: SWORD, colors: DIAMOND, tier: 'luxe', slot: 'weapon', family: 'sword', mat: DIAMOND },
  nether_blade: { name: '冥府の大剣', grid: SWORD, colors: NETHER, tier: 'luxe', slot: 'weapon', family: 'sword', mat: NETHER },
  gold_helm: { name: '黄金のかぶと', grid: HELM, colors: GOLD, tier: 'luxe', slot: 'head', family: 'helm', mat: GOLD },
  diamond_chest: { name: 'ダイヤのよろい', grid: CHESTPLATE, colors: DIAMOND, tier: 'luxe', slot: 'body', family: 'plate', mat: DIAMOND },
  sea_trident: { name: '海神の三叉槍', grid: TRIDENT, colors: SEA, tier: 'luxe', slot: 'weapon', family: 'trident', mat: SEA },
  kings_crown: { name: '覇王の王冠', grid: CROWN, colors: ROYAL, tier: 'luxe', slot: 'head', family: 'crown', mat: { D: '#4a2d00', B: '#ffcd75', W: '#fff3c4', G: '#ff5d8f' } }
};

export const SLOTS = [
  { key: 'weapon', label: '武器' },
  { key: 'head', label: '頭' },
  { key: 'body', label: '体' },
  { key: 'shield', label: '盾' }
];

export function gearSlot(id) { return GEAR[id]?.slot || null; }

export function gearSVG(id, size) {
  const g = GEAR[id];
  if (!g) return '';
  return gridSVG({ colors: g.colors, grid: g.grid }, { size });
}

export function gearName(id) {
  return GEAR[id]?.name || '???';
}

export function gearTier(id) {
  return GEAR[id]?.tier || 'normal';
}

// 宝箱の中身を抽選する。持っていない装備を優先して出す
export function rollLoot(tier, ownedIds = []) {
  const pool = Object.keys(GEAR).filter((id) => GEAR[id].tier === tier);
  const fresh = pool.filter((id) => !ownedIds.includes(id));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
}
