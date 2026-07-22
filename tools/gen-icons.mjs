// PWAアイコン生成: 依存ライブラリなしで PNG を書き出す (node tools/gen-icons.mjs)
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

// --- 最小限のPNGエンコーダ ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- ドット絵描画 ---
function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
}

const CHEST = {
  colors: {
    D: hex('#3a2317'), B: hex('#a05a2c'), L: hex('#c98a4b'),
    G: hex('#ffcd75'), g: hex('#e8a33d'), K: hex('#1a1c2c')
  },
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
};

const STAR = {
  colors: { D: hex('#8a5a00'), Y: hex('#ffcd75'), W: hex('#fff3c4') },
  grid: [
    '...Y...',
    '..YWY..',
    'YYYWYYY',
    '.YWWWY.',
    '..YYY..',
    '.YY.YY.',
    'Y.....Y'
  ]
};

function makeIcon(size, { padRatio = 0.16, bg = '#1a1c2c', border = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const [br, bgc, bb] = hex(bg);

  // 背景
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = br; px[i * 4 + 1] = bgc; px[i * 4 + 2] = bb; px[i * 4 + 3] = 255;
  }

  // ふち(金)
  if (border) {
    const bw = Math.max(4, Math.round(size * 0.03));
    const [gr, gg, gb] = hex('#e8a33d');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x < bw || y < bw || x >= size - bw || y >= size - bw) {
          const i = (y * size + x) * 4;
          px[i] = gr; px[i + 1] = gg; px[i + 2] = gb;
        }
      }
    }
  }

  function drawGrid(def, scale, ox, oy) {
    def.grid.forEach((row, gy) => {
      [...row].forEach((ch, gx) => {
        const c = def.colors[ch];
        if (!c) return;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = ox + gx * scale + dx;
            const y = oy + gy * scale + dy;
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const i = (y * size + x) * 4;
            px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
          }
        }
      });
    });
  }

  // 宝箱を中央に
  const gw = CHEST.grid[0].length;
  const gh = CHEST.grid.length;
  const avail = size * (1 - padRatio * 2);
  const scale = Math.max(1, Math.floor(avail / gw));
  const ox = Math.round((size - gw * scale) / 2);
  const oy = Math.round((size - gh * scale) / 2 + size * 0.06);
  drawGrid(CHEST, scale, ox, oy);

  // 星を右上に
  const sScale = Math.max(1, Math.floor(scale * 0.55));
  drawGrid(STAR, sScale, ox + gw * scale - 3 * sScale, oy - 6 * sScale);

  return encodePNG(size, size, px);
}

mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-192.png', makeIcon(192));
writeFileSync('icons/icon-512.png', makeIcon(512));
writeFileSync('icons/maskable-512.png', makeIcon(512, { padRatio: 0.26, border: false }));
writeFileSync('icons/apple-touch-icon.png', makeIcon(180, { border: false }));
console.log('icons generated');
