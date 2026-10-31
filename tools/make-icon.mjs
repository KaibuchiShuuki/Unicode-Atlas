/**
 * 生成启动器图标：app.ico。
 *
 * 图案是 Unicode 风格的「蓝色圆角方块 + 白色 U」，和网页 favicon 同一套造型。
 * 全部手写：每个尺寸独立光栅化（SDF + 抗锯齿），PNG 用 node:zlib 压 IDAT，
 * ICO 用 PNG 内嵌格式（Vista 起支持）。多尺寸打包，任务栏、桌面、资源管理器
 * 各自都能拿到原生大小，不会糊。
 *
 * 用法：node tools\make-icon.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const BG = [0x2f, 0x6c, 0xb8];
const W = [255, 255, 255];

/** 圆角矩形有符号距离场：<0 在内部 */
function sdRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2 - r;
  const hh = (y1 - y0) / 2 - r;
  const qx = Math.abs(x - cx) - hw;
  const qy = Math.abs(y - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 渲染一个尺寸的 RGBA 缓冲 */
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const k = size / 256; // 设计稿按 256 画，其他尺寸按比例缩

  const px = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    buf[i] = Math.round(r * a + buf[i] * (1 - a));
    buf[i + 1] = Math.round(g * a + buf[i + 1] * (1 - a));
    buf[i + 2] = Math.round(b * a + buf[i + 2] * (1 - a));
    buf[i + 3] = Math.max(buf[i + 3], Math.round(255 * a));
  };

  // 方块底：8..248，圆角 56
  // 白色 U：两竖条 68..98 / 158..188，顶端 58，半环圆心 y=152 外半径 60、内半径 30
  const box = [8 * k, 8 * k, 248 * k, 248 * k, 56 * k];
  const barW = 30 * k;
  const leftX0 = 68 * k;
  const leftX1 = leftX0 + barW;
  const rightX1 = 188 * k;
  const rightX0 = rightX1 - barW;
  const top = 58 * k;
  const mid = 152 * k;
  const midX = 128 * k;
  const outerR = 60 * k;
  const innerR = 30 * k;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x + 0.5;
      const fy = y + 0.5;

      // 底
      const d = sdRoundRect(fx, fy, box[0], box[1], box[2], box[3], box[4]);
      const bgA = clamp01(0.5 - d);
      if (bgA > 0) px(x, y, BG[0], BG[1], BG[2], bgA);

      // U = 外轮廓（两竖条 ∪ 下半圆盘）减内轮廓（内竖条 ∪ 内圆）
      // 用「外形减内形」而不是「拼环形」，接缝天然无缝，小尺寸也不会出尖角
      const r = Math.hypot(fx - midX, fy - mid);
      const outer = Math.max(
        clamp01(0.5 - sdRoundRect(fx, fy, leftX0, top, leftX1, mid + 1 * k, 0)),
        clamp01(0.5 - sdRoundRect(fx, fy, rightX0, top, rightX1, mid + 1 * k, 0)),
        fy >= mid ? clamp01(0.5 - (r - outerR)) : 0,
      );
      const hole = Math.max(
        fy <= mid + 1 * k
          ? clamp01(0.5 - sdRoundRect(fx, fy, midX - innerR, top - 2 * k, midX + innerR, mid + 1 * k, 0))
          : 0,
        fy >= mid - 1 * k ? clamp01(0.5 - (r - innerR)) : 0,
      );
      const a = clamp01(outer - hole);
      if (a > 0) px(x, y, W[0], W[1], W[2], a);
    }
  }
  return buf;
}

/* ── PNG 编码 ─────────────────────────────────────── */

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pngEncode(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── BMP 编码（ICO 里的经典条目）───────────────────── */
/* 256 用 PNG（Vista+ 只认 256 的 PNG），更小的尺寸一律写 32bpp BMP：
   资源管理器和旧式 Shell 图标接口对 PNG 压缩的小图标支持不稳，会出现空白图标。 */

function bmpEncode(rgba, size) {
  const head = Buffer.alloc(40);
  const rowSize = size * 4;
  const maskRow = Math.ceil(size / 32) * 4;
  const maskSize = maskRow * size;
  head.writeUInt32LE(40, 0);              // biSize
  head.writeInt32LE(size, 4);             // biWidth
  head.writeInt32LE(size * 2, 8);         // biHeight（含 AND 掩码，故为 2 倍）
  head.writeUInt16LE(1, 12);              // biPlanes
  head.writeUInt16LE(32, 14);             // biBitCount
  head.writeUInt32LE(0, 16);              // biCompression = BI_RGB
  head.writeUInt32LE(rowSize * size + maskSize, 20); // biSizeImage

  const px = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4; // BMP 自下而上
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = y * rowSize + x * 4;
      px[d] = rgba[s + 2];      // B
      px[d + 1] = rgba[s + 1];  // G
      px[d + 2] = rgba[s];      // R
      px[d + 3] = rgba[s + 3];  // A
    }
  }
  return Buffer.concat([head, px, Buffer.alloc(maskSize)]); // 掩码全 0，靠 alpha
}

/* ── ICO 封装（小尺寸 BMP + 256 PNG）───────────────── */

const images = SIZES.map((size) => ({
  size,
  data: size >= 256 ? pngEncode(render(size), size) : bmpEncode(render(size), size),
  png: size >= 256,
}));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + 16 * images.length;
const entries = [];
for (const img of images) {
  const e = Buffer.alloc(16);
  e[0] = img.size >= 256 ? 0 : img.size;
  e[1] = img.size >= 256 ? 0 : img.size;
  e[2] = 0;                    // 无调色板
  e[3] = 0;
  e.writeUInt16LE(1, 4);       // planes
  e.writeUInt16LE(32, 6);      // bpp
  e.writeUInt32LE(img.data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += img.data.length;
}

const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
const out = path.join(ROOT, 'app.ico');
fs.writeFileSync(out, ico);
console.log(`wrote ${out} (${ico.length} bytes, ${images.length} sizes: ${SIZES.join('/')})`);

// 顺手导出几张 PNG 预览，方便肉眼检查
for (const img of images) {
  if (![32, 48, 256].includes(img.size)) continue;
  const preview = img.png ? img.data : pngEncode(render(img.size), img.size);
  fs.writeFileSync(path.join(ROOT, 'tools', `icon-${img.size}.png`), preview);
}
