import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { FONTS_DIR } from './paths.js';
import { FONT_LIST } from './fonts-data.js';

/**
 * 本机字体扫描：读 ttf/otf/ttc 的 cmap 表，判断某个字体是否真的含有某个码点的字形。
 * 浏览器那边没法可靠地问「系统字体支持不支持这个字符」，所以只能自己读字体文件。
 */

const SYSTEM_FONT_DIRS = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
  /* 自己装的字体（右键「为所有用户安装」以外的方式）会落在这里 */
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts'),
];
const MAX_TABLE = 16 * 1024 * 1024;

/* woff2 表目录里 6 位 tag 索引对应的标签（规范附录） */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

/* Noto 字体在下拉框里的先后顺序，和字体栈保持一致 */
const NOTO_ORDER = ['NotoSansSymbols2', 'NotoSansSymbols', 'NotoSansMath', 'NotoMusic', 'NotoEmoji', 'NotoSans', 'NotoSansCJKsc'];

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

async function readAt(fh, offset, length) {
  const buf = Buffer.alloc(length);
  await fh.read(buf, 0, length, offset);
  return buf;
}

/**
 * name 表里取家族名（nameID 1，没有就退到 4）。
 * 同一个字体往往同时带英文名和本地化名（simkai.ttf：KaiTi / 楷体），
 * 所以把两种都收下来：界面显示中文名，CSS 用英文名。
 */
function parseFamily(buf) {
  if (!buf || buf.length < 6) return { zh: '', en: '' };
  const count = u16(buf, 2);
  const strOff = u16(buf, 4);
  let zh = '';
  let en = '';
  let fallback = '';
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12;
    if (p + 12 > buf.length) break;
    const platform = u16(buf, p);
    const lang = u16(buf, p + 4);
    const nameId = u16(buf, p + 6);
    const len = u16(buf, p + 8);
    const off = u16(buf, p + 10);
    if (nameId !== 1 && nameId !== 4) continue;
    const start = strOff + off;
    if (start + len > buf.length || !len) continue;
    let s;
    if (platform === 3 || platform === 0) {
      let out = '';
      for (let k = 0; k + 1 < len; k += 2) out += String.fromCharCode((buf[start + k] << 8) | buf[start + k + 1]);
      s = out;
    } else {
      s = buf.toString('latin1', start, start + len);
    }
    s = s.replace(/\u0000/g, '').trim();
    if (!s) continue;
    if (nameId === 1) {
      if (lang === 0x804 || lang === 0x404 || lang === 0xc04 || lang === 0x1004) zh = zh || s;
      else if (lang === 0x409 || platform === 1) en = en || s;
      else if (!fallback) fallback = s;
    } else if (!fallback) {
      fallback = s;
    }
  }
  if (!en) en = zh || fallback;
  return { zh: zh || en, en };
}

/** cmap → BMP 位图 + 超 BMP 区间（只保留 glyph id 非 0 的码点） */
function parseCmap(buf) {
  if (!buf || buf.length < 4) return null;
  const numTables = u16(buf, 2);
  let pick = null;
  for (let i = 0; i < numTables; i++) {
    const p = 4 + i * 8;
    if (p + 8 > buf.length) break;
    const platform = u16(buf, p);
    const offset = u32(buf, p + 4);
    if (offset + 2 > buf.length) continue;
    const format = u16(buf, offset);
    if (format === 12) {
      pick = { format, offset };
      if (platform === 3) break;
    } else if (format === 4 && !pick) {
      pick = { format, offset };
    }
  }
  if (!pick) return null;

  const bmp = new Uint8Array(65536);
  const groups = [];

  if (pick.format === 12) {
    const nGroups = u32(buf, pick.offset + 12);
    if (pick.offset + 16 + nGroups * 12 > buf.length) return null;
    for (let i = 0; i < nGroups; i++) {
      const p = pick.offset + 16 + i * 12;
      const start = u32(buf, p);
      const end = Math.min(u32(buf, p + 4), 0x10ffff);
      const gid = u32(buf, p + 8);
      if (start > end || gid === 0) continue;
      if (start <= 0xffff) {
        for (let c = start; c <= Math.min(end, 0xffff); c++) bmp[c] = 1;
      }
      if (end > 0xffff) groups.push([Math.max(start, 0x10000), end]);
    }
  } else {
    const segCount = u16(buf, pick.offset + 6) / 2;
    const endBase = pick.offset + 14;
    const startBase = endBase + segCount * 2 + 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;
    if (rangeBase + segCount * 2 > buf.length) return null;
    for (let i = 0; i < segCount; i++) {
      const end = u16(buf, endBase + i * 2);
      const start = u16(buf, startBase + i * 2);
      const delta = u16(buf, deltaBase + i * 2);
      const ro = u16(buf, rangeBase + i * 2);
      if (start > end) continue;
      for (let c = start; c <= end; c++) {
        let gid;
        if (ro === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const idx = rangeBase + i * 2 + ro + (c - start) * 2;
          if (idx + 1 >= buf.length) continue;
          gid = u16(buf, idx);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) bmp[c] = 1;
      }
    }
  }

  groups.sort((a, b) => a[0] - b[0]);
  return { bmp, groups };
}

function supports(face, cp) {
  if (cp <= 0xffff) return face.bmp[cp] === 1;
  for (const [s, e] of face.groups) {
    if (cp < s) return false;
    if (cp <= e) return true;
  }
  return false;
}

async function readFace(fh, sfntOffset, family) {
  const head = await readAt(fh, sfntOffset, 12);
  if (head.length < 12) return null;
  const numTables = u16(head, 4);
  const dir = await readAt(fh, sfntOffset + 12, numTables * 16);
  let cmap = null;
  let name = null;
  for (let i = 0; i < numTables; i++) {
    const p = i * 16;
    if (p + 16 > dir.length) break;
    const tag = dir.toString('latin1', p, p + 4);
    const off = u32(dir, p + 8);
    const len = u32(dir, p + 12);
    if (tag === 'cmap') cmap = { off, len };
    else if (tag === 'name') name = { off, len };
  }
  if (!cmap || !cmap.len || cmap.off + cmap.len > 0x7fffffff) return null;
  const cmapLen = Math.min(cmap.len, MAX_TABLE);
  const cmapBuf = await readAt(fh, cmap.off, cmapLen);
  const parsed = parseCmap(cmapBuf);
  if (!parsed) return null;
  let fam = family ? { zh: family, en: family } : { zh: '', en: '' };
  if (!fam.en && name && name.len) {
    const nameBuf = await readAt(fh, name.off, Math.min(name.len, 256 * 1024));
    fam = parseFamily(nameBuf);
  }
  if (!fam.en) return null;
  return { zh: fam.zh, en: fam.en, bmp: parsed.bmp, groups: parsed.groups };
}

/** woff2：brotli 压缩的整块表数据，目录是变长的 —— 只取 cmap / name 两张表 */
async function readWoff2(fh, family) {
  const size = (await fh.stat()).size;
  if (size > 32 * 1024 * 1024) return [];
  const buf = await readAt(fh, 0, size);
  if (buf.toString('latin1', 0, 4) !== 'wOF2') return [];
  const numTables = u16(buf, 12);
  const compressedSize = u32(buf, 20);
  let pos = 48;
  const tables = [];
  const readBase128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[pos++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v >>> 0;
  };
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    const tagIndex = flags & 0x3f;
    const transform = (flags >> 6) & 3;
    let tag;
    if (tagIndex === 63) {
      tag = buf.toString('latin1', pos, pos + 4);
      pos += 4;
    } else {
      tag = WOFF2_TAGS[tagIndex];
    }
    const origLength = readBase128();
    let transformLength = null;
    if ((tag === 'glyf' || tag === 'loca') && transform === 0) transformLength = readBase128();
    tables.push({ tag, origLength, transformLength });
  }
  const compressed = buf.subarray(pos, pos + compressedSize);
  const plain = zlib.brotliDecompressSync(compressed);
  let offset = 0;
  let cmap = null;
  let name = null;
  for (const t of tables) {
    const len = t.transformLength ?? t.origLength;
    if (t.tag === 'cmap') cmap = plain.subarray(offset, offset + t.origLength);
    else if (t.tag === 'name') name = plain.subarray(offset, offset + t.origLength);
    offset += len;
    if (offset > plain.length) break;
  }
  if (!cmap) return [];
  const parsed = parseCmap(cmap);
  if (!parsed) return [];
  const fam = family ? { zh: family, en: family } : { zh: '', en: '' };
  const resolved = fam.en ? fam : (name ? parseFamily(name) : { zh: '', en: '' });
  if (!resolved.en) return [];
  return [{ zh: resolved.zh, en: resolved.en, bmp: parsed.bmp, groups: parsed.groups }];
}

async function readFontFile(file, family) {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const head = await readAt(fh, 0, 16);
    if (head.length < 12) return [];
    const tag = head.toString('latin1', 0, 4);
    if (tag === 'wOF2') return await readWoff2(fh, family);
    const offsets = [];
    if (tag === 'ttcf') {
      const n = u32(head, 8);
      if (n <= 0 || n > 64) return [];
      const table = await readAt(fh, 12, Math.min(n * 4, 256));
      for (let i = 0; i < Math.min(n, 64); i++) offsets.push(u32(table, i * 4));
    } else {
      offsets.push(0);
    }
    const faces = [];
    for (const off of offsets) {
      try {
        const face = await readFace(fh, off, family);
        if (face) faces.push(face);
      } catch { /* 单个 face 坏了不影响别的 */ }
    }
    return faces;
  } catch {
    return [];
  } finally {
    await fh?.close().catch(() => {});
  }
}

let cache = null;
let building = null;

/** 扫描全部候选字体，返回 { faces, at }；第一次调用慢一点，之后走缓存 */
export async function buildFontIndex() {
  if (cache) return cache;
  if (building) return building;
  building = (async () => {
    const faces = [];
    const seen = new Set();

    const notoFiles = new Set();
    try {
      (await fs.readdir(FONTS_DIR)).forEach((n) => { if (/\.(ttf|otf|woff2?)$/i.test(n)) notoFiles.add(n); });
    } catch { /* 没有字体目录 */ }

    const notoOrder = new Map(FONT_LIST.map((f, i) => [f.file, i]));
    const noto = FONT_LIST.filter((f) => notoFiles.has(f.file));
    for (const f of noto) {
      const file = path.join(FONTS_DIR, f.file);
      const list = await readFontFile(file, f.family);
      for (const face of list) {
        const key = 'noto:' + f.family;
        if (seen.has(key)) continue;
        seen.add(key);
        faces.push({
          name: f.family,
          en: f.family,
          css: `NA-${f.family}`,
          source: 'noto',
          rank: notoOrder.get(f.file) ?? 9999,
          bmp: face.bmp,
          groups: face.groups,
        });
      }
    }

    for (const dir of SYSTEM_FONT_DIRS) {
      let sysFiles = [];
      try {
        sysFiles = (await fs.readdir(dir))
          .filter((n) => /\.(ttf|otf|ttc)$/i.test(n))
          .sort((a, b) => a.localeCompare(b, 'en'));
      } catch { /* 目录不存在就跳过 */ }

      for (const n of sysFiles) {
        const list = await readFontFile(path.join(dir, n), '');
        for (const face of list) {
          const key = 'sys:' + face.en;
          if (seen.has(key)) continue;
          seen.add(key);
          faces.push({
            name: face.zh || face.en,
            en: face.en,
            css: face.en,
            source: 'system',
            rank: 10000,
            bmp: face.bmp,
            groups: face.groups,
          });
        }
      }
    }

    cache = { faces, at: Date.now() };
    building = null;
    return cache;
  })();
  try {
    return await building;
  } finally {
    building = null;
  }
}

const rankNoto = (face) => {
  const i = NOTO_ORDER.indexOf(face.name);
  return i >= 0 ? i : 100;
};

/** 列出支持该码点的字体，按 Noto → Times New Roman → 宋体 → 其余 排好 */
export async function fontsForCp(cp) {
  const { faces } = await buildFontIndex();
  const hits = faces.filter((f) => supports(f, cp));
  const group = (f) => {
    if (f.source === 'noto') return 0;
    if (/^times new roman$/i.test(f.en || f.name)) return 1;
    if (/simsun/i.test(f.en || '') || /宋体/.test(f.name)) return 2;
    return 3;
  };
  hits.sort((a, b) => {
    const ga = group(a), gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      const ra = rankNoto(a), rb = rankNoto(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, 'en');
    }
    if (ga === 3) return a.name.localeCompare(b.name, 'zh');
    return 0;
  });
  return hits.map((f) => ({ name: f.name, css: f.css }));
}
