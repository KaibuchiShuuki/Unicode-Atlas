import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const BASE = 'https://www.unicode.org/Public';
export const LATEST = `${BASE}/UCD/latest/ucd`;
const UA = 'unicode-atlas/0.1 (+local offline Unicode encyclopedia)';

/** 版本号规范化：'18' / '18.0' / '18.0.0' → '18.0.0'；老版本 '3.2' → '3.2.0' */
export function normalizeVersion(v) {
  const s = String(v).trim();
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`无法识别的版本号: ${v}`);
  return `${m[1]}.${m[2] ?? '0'}.${m[3] ?? '0'}`;
}

export function shortVersion(v) {
  const [a, b] = normalizeVersion(v).split('.');
  return `${a}.${b}`;
}

/** 版本目录候选。4.1.0 之后是 /X.Y.Z/ucd/，更早是 /X.Y-Update[/u]cd/ 且文件名带版本后缀 */
export function dirCandidates(version) {
  const [a, b] = normalizeVersion(version).split('.').map(Number);
  if (a > 4 || (a === 4 && b >= 1)) return [normalizeVersion(version)];
  const short = `${a}.${b}`;
  const cands = [`${short}-Update`, `${short}-Update1`, `${short}-Update2`, `${short}-Update3`, `${short}-Update4`];
  return cands;
}

/**
 * UCD 文件规格。dirs 是相对版本根目录的候选子目录；
 * re 需要能匹配老版本的带版本后缀文件名（UnicodeData-3.2.0.txt）。
 */
export const FILE_SPECS = [
  { key: 'UnicodeData', label: 'UnicodeData.txt', dirs: ['ucd', ''], re: /^UnicodeData(-[0-9.]+)?\.txt$/i, required: true, core: true },
  { key: 'Blocks', label: 'Blocks.txt', dirs: ['ucd', ''], re: /^Blocks(-[0-9.]+)?\.txt$/i, core: true },
  { key: 'NamesList', label: 'NamesList.txt', dirs: ['ucd', ''], re: /^NamesList(-[0-9.]+)?\.txt$/i, core: true },
  { key: 'Scripts', label: 'Scripts.txt', dirs: ['ucd', ''], re: /^Scripts(-[0-9.]+)?\.txt$/i, core: true },
  { key: 'ScriptExtensions', label: 'ScriptExtensions.txt', dirs: ['ucd', ''], re: /^ScriptExtensions(-[0-9.]+)?\.txt$/i },
  { key: 'DerivedAge', label: 'DerivedAge.txt', dirs: ['ucd', ''], re: /^DerivedAge(-[0-9.]+)?\.txt$/i, core: true },
  { key: 'EastAsianWidth', label: 'EastAsianWidth.txt', dirs: ['ucd', ''], re: /^EastAsianWidth(-[0-9.]+)?\.txt$/i, core: true },
  { key: 'CaseFolding', label: 'CaseFolding.txt', dirs: ['ucd', ''], re: /^CaseFolding(-[0-9.]+)?\.txt$/i },
  { key: 'SpecialCasing', label: 'SpecialCasing.txt', dirs: ['ucd', ''], re: /^SpecialCasing(-[0-9.]+)?\.txt$/i },
  { key: 'NameAliases', label: 'NameAliases.txt', dirs: ['ucd', ''], re: /^NameAliases(-[0-9.]+)?\.txt$/i },
  { key: 'BidiMirroring', label: 'BidiMirroring.txt', dirs: ['ucd', ''], re: /^BidiMirroring(-[0-9.]+)?\.txt$/i },
  { key: 'StandardizedVariants', label: 'StandardizedVariants.txt', dirs: ['ucd', ''], re: /^StandardizedVariants(-[0-9.]+)?\.txt$/i },
  { key: 'PropList', label: 'PropList.txt', dirs: ['ucd', ''], re: /^PropList(-[0-9.]+)?\.txt$/i },
  { key: 'DerivedCoreProperties', label: 'DerivedCoreProperties.txt', dirs: ['ucd', ''], re: /^DerivedCoreProperties(-[0-9.]+)?\.txt$/i },
  { key: 'LineBreak', label: 'LineBreak.txt', dirs: ['ucd', ''], re: /^LineBreak(-[0-9.]+)?\.txt$/i },
  { key: 'HangulSyllableType', label: 'HangulSyllableType.txt', dirs: ['ucd', ''], re: /^HangulSyllableType(-[0-9.]+)?\.txt$/i },
  { key: 'EmojiVariationSequences', label: 'emoji/emoji-variation-sequences.txt', dirs: ['ucd/emoji', 'emoji'], re: /^emoji-variation-sequences\.txt$/i },
  { key: 'EmojiData', label: 'emoji/emoji-data.txt', dirs: ['ucd/emoji', 'emoji'], re: /^emoji-data\.txt$/i },
  { key: 'DerivedName', label: 'extracted/DerivedName.txt', dirs: ['ucd/extracted', 'extracted'], re: /^DerivedName\.txt$/i, core: true },
  { key: 'Unihan', label: 'Unihan.zip', dirs: ['ucd', 'ucd/Unihan', ''], re: /^Unihan\.zip$/i, zip: true, optional: true },
];

async function getText(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers || {}) } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
  return res.text();
}

/** 列 Apache 风格的目录索引，返回 { name, url, isDir }[]；不是索引则返回 null */
export async function listDir(url) {
  let html;
  try {
    html = await getText(url);
  } catch {
    return null;
  }
  if (!/<a href=/i.test(html)) return null;
  const out = [];
  for (const m of html.matchAll(/<a href="([^"?][^"]*)"/gi)) {
    const href = m[1];
    if (/^(https?:)?\/\//i.test(href)) continue;
    const isDir = href.endsWith('/');
    const name = decodeURIComponent((isDir ? href.slice(0, -1) : href).replace(/^\.?\//, ''));
    if (!name || name.includes('/')) continue;
    out.push({ name, url: new URL(href, url).href, isDir });
  }
  return out;
}

/**
 * 为一个版本找出所有可用 UCD 文件的真实 URL。
 * 先按「现代路径」直连探测，失败再走目录发现（老版本必备）。
 */
export async function resolveVersion(version, { onLog } = {}) {
  const ver = normalizeVersion(version);
  const tried = [];
  const dirs = dirCandidates(ver);

  for (const dir of dirs) {
    const rootUrl = `${BASE}/${dir}/`;
    const listings = new Map(); // relDir -> entries[]

    let rootEntries = null;
    try {
      rootEntries = await listDir(rootUrl);
    } catch (e) {
      tried.push(`${dir}: ${e.message}`);
      continue;
    }
    if (!rootEntries) {
      tried.push(`${dir}: no directory listing`);
      continue;
    }
    listings.set('', rootEntries);

    for (const sub of ['ucd', 'ucd/emoji', 'emoji', 'ucd/extracted', 'extracted']) {
      const entries = await listDir(`${rootUrl}${sub}/`);
      if (entries) listings.set(sub, entries);
    }

    const files = {};
    const missing = [];
    for (const spec of FILE_SPECS) {
      let found = null;
      for (const sub of spec.dirs) {
        const entries = listings.get(sub);
        if (!entries) continue;
        const hit = entries.find((e) => !e.isDir && spec.re.test(e.name));
        if (hit) { found = { ...hit, dir: sub, url: hit.url }; break; }
      }
      if (found) files[spec.key] = found;
      else missing.push({ key: spec.key, label: spec.label, required: !!spec.required });
    }

    if (!files.UnicodeData) {
      tried.push(`${dir}: UnicodeData.txt not found (root has: ${rootEntries.map((e) => e.name).slice(0, 12).join(', ')})`);
      continue;
    }

    // Unihan 也可能以目录形式发布（ucd/Unihan/Unihan.zip）
    if (!files.Unihan) {
      const alt = await listDir(`${rootUrl}ucd/Unihan/`);
      const z = alt?.find((e) => /^Unihan\.zip$/i.test(e.name));
      if (z) {
        files.Unihan = { ...z, dir: 'ucd/Unihan' };
        const i = missing.findIndex((m) => m.key === 'Unihan');
        if (i >= 0) missing.splice(i, 1);
      }
    }

    onLog?.(`版本 ${ver} 使用目录 /Public/${dir}/`);
    return {
      version: ver,
      dir,
      rootUrl,
      files,
      missing,
      tried,
    };
  }

  const err = new Error(`未能在 unicode.org 上定位版本 ${ver} 的 UCD 目录。\n${tried.join('\n')}`);
  err.code = 'VERSION_NOT_FOUND';
  throw err;
}

/** 下载单个文件到磁盘，带进度回调 */
export async function downloadFile(url, destPath, { onProgress, signal } = {}) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.part`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const total = Number(res.headers.get('content-length') || 0);
  let received = 0;
  const out = fs.createWriteStream(tmp);

  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    onProgress?.({ received, total });
  });

  await pipeline(body, out);
  await fsp.rename(tmp, destPath);
  return { bytes: received, total };
}

/** 读取文件头部字节，用于版本嗅探 */
async function headBytes(url, n = 400) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, Range: `bytes=0-${n - 1}` },
  });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('utf8');
}

/**
 * 检测 unicode.org 上的最新 UCD 版本。
 * 只拉 400 字节的 Blocks.txt 头部，解析 `# Blocks-18.0.0.txt`。
 */
export async function detectLatest({ timeoutMs = 15000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const attempts = [
    { url: `${LATEST}/Blocks.txt`, re: /Blocks-([0-9]+\.[0-9]+\.[0-9]+)\.txt/i, via: 'Blocks.txt 头部' },
    { url: `${LATEST}/EastAsianWidth.txt`, re: /EastAsianWidth-([0-9]+\.[0-9]+\.[0-9]+)\.txt/i, via: 'EastAsianWidth.txt 头部' },
    { url: `${LATEST}/DerivedAge.txt`, re: /DerivedAge-([0-9]+\.[0-9]+\.[0-9]+)\.txt/i, via: 'DerivedAge.txt 头部' },
  ];
  const errors = [];
  try {
    for (const a of attempts) {
      try {
        const head = await headBytes(a.url, 400);
        const m = a.re.exec(head);
        if (m) return { version: m[1], via: a.via, probedAt: Date.now() };
        errors.push(`${a.via}: 未匹配到版本号`);
      } catch (e) {
        errors.push(`${a.via}: ${e.message}`);
      }
    }
    // 退路：官方 latest 页面
    try {
      const html = await getText('https://www.unicode.org/versions/latest/', { signal: ac.signal });
      const m = /Unicode\s+([0-9]+\.[0-9]+\.[0-9]+)/i.exec(html);
      if (m) return { version: m[1], via: 'versions/latest 页面', probedAt: Date.now() };
      errors.push('versions/latest 页面: 未匹配到版本号');
    } catch (e) {
      errors.push(`versions/latest 页面: ${e.message}`);
    }
    const err = new Error(`检测最新版本失败：${errors.join('；')}`);
    err.code = 'DETECT_FAILED';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 列出 unicode.org 上所有历史版本目录（用于版本下拉框的候选） */
export async function listReleaseDirs() {
  const entries = await listDir(`${BASE}/`);
  if (!entries) return [];
  const out = [];
  for (const e of entries) {
    if (!e.isDir) continue;
    const m = /^(\d+)\.(\d+)(?:-Update(\d*))?$/.exec(e.name);
    if (!m) continue;
    if (e.name === 'latest') continue;
    const patch = m[3] ? '' : '0';
    out.push({
      dir: e.name,
      version: m[3] === undefined ? `${m[1]}.${m[2]}.${patch}` : `${m[1]}.${m[2]}.0`,
      legacy: !!m[3],
      update: m[3] || '',
    });
  }
  // 合并同一 X.Y 的多个 -UpdateN 目录，取最新
  const byShort = new Map();
  for (const e of out) {
    const key = `${e.version.split('.').slice(0, 2).join('.')}`;
    const prev = byShort.get(key);
    const rank = e.legacy ? Number(e.update || 0) : 999;
    if (!prev || rank > prev.rank) byShort.set(key, { ...e, rank });
  }
  return [...byShort.values()]
    .sort((a, b) => cmpVersion(b.version, a.version))
    .map(({ rank, ...e }) => e);
}

export function cmpVersion(a, b) {
  const pa = normalizeVersion(a).split('.').map(Number);
  const pb = normalizeVersion(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
