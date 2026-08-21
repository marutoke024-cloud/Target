// PWAアイコン生成: 依存ライブラリなしで PNG を書き出す (node minutes/tools/gen-icons.mjs)
// 青紫のグラデーションに、白いマイクを重ねたアイコン
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// --- 図形(座標は 0〜1 の相対値) ---
const inRoundRect = (x, y, cx, cy, w, h, r) => {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  if (dx <= 0 && dy <= 0) return true;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return ox * ox + oy * oy <= r * r;
};

// マイク(カプセル + 受け皿の弧 + 支柱 + 台座)
function inMic(x, y) {
  if (inRoundRect(x, y, 0.5, 0.385, 0.23, 0.36, 0.115)) return true;

  const dx = x - 0.5;
  const dy = y - 0.4;
  const dist = Math.hypot(dx, dy);
  if (y >= 0.4 && dist >= 0.2 && dist <= 0.248) return true;      // 下向きの弧
  if (inRoundRect(x, y, 0.5, 0.695, 0.046, 0.12, 0.023)) return true; // 支柱
  if (inRoundRect(x, y, 0.5, 0.775, 0.26, 0.05, 0.025)) return true;  // 台座
  return false;
}

const SS = 4; // スーパーサンプリング(縁をなめらかにする)

function makeIcon(size, { bleed = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const top = hex('#7466f5');
  const bottom = hex('#4a3fc7');
  const white = [255, 255, 255];
  const pad = bleed ? 0.16 : 0;              // maskable は内側に余白を取る
  const radius = bleed ? 0.5 : 0.235;        // 通常アイコンは角丸の四角

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      let micHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (!inRoundRect(u, v, 0.5, 0.5, 1, 1, radius)) continue;
          bgHits++;
          // マイクは中央に配置(maskable では少し縮める)
          const mu = 0.5 + (u - 0.5) / (1 - pad * 2);
          const mv = 0.5 + (v - 0.5) / (1 - pad * 2);
          if (inMic(mu, mv)) micHits++;
        }
      }
      const total = SS * SS;
      const i = (y * size + x) * 4;
      if (!bgHits) { px[i + 3] = 0; continue; }
      const bg = mix(top, bottom, (x + y) / (size * 2));
      const micA = micHits / total;
      const bgA = bgHits / total;
      const color = mix(bg, white, bgA > 0 ? micA / bgA : 0);
      px[i] = Math.round(color[0]);
      px[i + 1] = Math.round(color[1]);
      px[i + 2] = Math.round(color[2]);
      px[i + 3] = Math.round(bgA * 255);
    }
  }
  return encodePNG(size, px);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon-192.png'), makeIcon(192));
writeFileSync(join(outDir, 'icon-512.png'), makeIcon(512));
writeFileSync(join(outDir, 'maskable-512.png'), makeIcon(512, { bleed: true }));
writeFileSync(join(outDir, 'apple-touch-icon.png'), makeIcon(180));
console.log('icons generated ->', outDir);
