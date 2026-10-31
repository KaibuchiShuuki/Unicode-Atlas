import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FONTS_DIR, FONT_BACKUP_DIR } from './paths.js';
import { FONT_LIST } from './fonts-data.js';

export { FONT_LIST };

/**
 * 字体栈顺序：决定「同一个字符有多个字体都能显示时用哪个」。
 * 符号类在最前（Symbols2 的符号字形比 NotoSans 里的更全更规范），
 * 然后是 emoji，接着各文字系统专用字体，再是拉丁基础字体，
 * 中文/汉字放后面（CJK 字体也含拉丁，但风格是中日韩的，不该抢拉丁的字），
 * 最后是系统字体兜底。
 */
const PRIORITY = [
  'NotoSansSymbols2',
  'NotoSansSymbols',
  'NotoSansMath',
  'NotoMusic',
  'NotoEmoji',
  'NotoSans',
  'NotoSansCJKsc',
];

const SYSTEM_STACK = [
  '"Segoe UI Symbol"',
  '"Segoe UI Historic"',
  '"Segoe UI Emoji"',
  '"Apple Symbols"',
  '"Apple Color Emoji"',
  '"Noto Sans Symbols 2"',
  '"Noto Sans Symbols"',
  '"Noto Color Emoji"',
  '"Noto Sans CJK SC"',
  '"Source Han Sans SC"',
  '"SimSun-ExtB"',
  '"SimSun"',
  '"Microsoft YaHei"',
  '"MS Gothic"',
  '"Malgun Gothic"',
  'sans-serif',
];

const famName = (family) => `NA-${family}`;

/** 已下载到本地的字体（按文件名去重） */
export async function listInstalledFonts() {
  let names;
  try {
    names = await fs.readdir(FONTS_DIR);
  } catch {
    return [];
  }
  const have = new Set(names.filter((n) => /\.(ttf|otf|woff2?)$/i.test(n)));
  return FONT_LIST.filter((f) => have.has(f.file));
}

export async function fontsStatus() {
  const installed = await listInstalledFonts();
  const backup = await listBackupFonts();
  const files = new Set(installed.map((f) => f.file));
  return {
    installed: installed.length,
    total: FONT_LIST.length,
    installedBytes: installed.reduce((s, f) => s + f.bytes, 0),
    totalBytes: FONT_LIST.reduce((s, f) => s + f.bytes, 0),
    backup: backup.length,
    backupDir: FONT_BACKUP_DIR,
    missing: FONT_LIST.filter((f) => !files.has(f.file)).map((f) => f.family),
    job: { ...fontJob },
  };
}

export const fontJob = {
  running: false,
  done: 0,
  total: FONT_LIST.length,
  current: '',
  received: 0,
  expected: 0,
  error: null,
  log: [],
  startedAt: null,
  finishedAt: null,
};

/** vendor/fonts 里随程序分发的字体文件 */
export async function listBackupFonts() {
  let names;
  try {
    names = await fs.readdir(FONT_BACKUP_DIR);
  } catch {
    return [];
  }
  const have = new Set(names.filter((n) => /\.(ttf|otf|woff2?)$/i.test(n)));
  return FONT_LIST.filter((f) => have.has(f.file));
}

/** 从本地备份复制一个字体；没有备份就返回 0，交给网络下载 */
async function copyFromBackup(font) {
  const src = path.join(FONT_BACKUP_DIR, font.file);
  let st;
  try { st = await fs.stat(src); } catch { return 0; }
  if (!st.isFile() || st.size < 1024) return 0;
  const dest = path.join(FONTS_DIR, font.file);
  const part = `${dest}.part`;
  await fs.copyFile(src, part);
  await fs.rename(part, dest);
  fontJob.received = st.size;
  fontJob.expected = st.size;
  return st.size;
}

async function downloadOne(font, signal) {
  await fs.mkdir(FONTS_DIR, { recursive: true });
  const fromBackup = await copyFromBackup(font);
  if (fromBackup) return fromBackup;
  const dest = path.join(FONTS_DIR, font.file);
  const part = `${dest}.part`;
  const res = await fetch(font.url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${font.family}`);
  const total = Number(res.headers.get('content-length') ?? 0) || font.bytes;
  let got = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    got += chunk.length;
    fontJob.received = got;
    fontJob.expected = total;
  });
  await pipeline(body, createWriteStream(part));
  await fs.rename(part, dest);
  return got;
}

/** 一键下载全部 Noto 字体；已存在则跳过（除非 force） */
export async function installFonts({ force = false, only = null } = {}) {
  if (fontJob.running) return fontJob;
  Object.assign(fontJob, {
    running: true, done: 0, current: '', received: 0, expected: 0,
    error: null, log: [], startedAt: Date.now(), finishedAt: null,
  });

  const installed = new Set((await listInstalledFonts()).map((f) => f.file));
  const queue = FONT_LIST.filter((f) => (!only || only.includes(f.family)) && (force || !installed.has(f.file)));
  fontJob.total = queue.length;

  try {
    for (const font of queue) {
      fontJob.current = font.file;
      fontJob.received = 0;
      fontJob.expected = font.bytes;
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          const n = await downloadOne(font, AbortSignal.timeout(180_000));
          fontJob.log.push(`${font.family} · ${(n / 1048576).toFixed(2)} MB`);
          ok = true;
        } catch (e) {
          if (attempt === 3) {
            fontJob.log.push(`失败 ${font.family}：${e.message}`);
            await fs.rm(path.join(FONTS_DIR, `${font.file}.part`), { force: true }).catch(() => {});
          } else {
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }
      }
      fontJob.done++;
    }
    await syncBackup();
    fontJob.running = false;
    fontJob.finishedAt = Date.now();
    fontJob.current = '';
    return fontJob;
  } catch (e) {
    fontJob.running = false;
    fontJob.error = e.message;
    fontJob.finishedAt = Date.now();
    return fontJob;
  }
}

/** 把 data/fonts 里已就位的字体同步进程序目录的备份（断网也能重装） */
export async function syncBackup() {
  await fs.mkdir(FONT_BACKUP_DIR, { recursive: true });
  let n = 0;
  for (const font of FONT_LIST) {
    const src = path.join(FONTS_DIR, font.file);
    const dst = path.join(FONT_BACKUP_DIR, font.file);
    try {
      const st = await fs.stat(src);
      if (st.size < 1024) continue;
      const cur = await fs.stat(dst).catch(() => null);
      if (cur && cur.size === st.size) continue;
      await fs.copyFile(src, `${dst}.part`);
      await fs.rename(`${dst}.part`, dst);
      n++;
    } catch {}
  }
  return n;
}

/**
 * 生成 @font-face 规则 + --glyph-font 字体栈。
 * 只有已下载的字体才会被写进 CSS（否则浏览器会去请求不存在的文件）。
 */
export async function fontCss() {
  const installed = await listInstalledFonts();
  const have = new Set(installed.map((f) => f.family));

  const ordered = [
    ...PRIORITY.filter((f) => have.has(f) && f !== 'NotoEmoji'),
    ...installed.filter((f) => !PRIORITY.includes(f.family)).map((f) => f.family).sort((a, b) => a.localeCompare(b)),
  ];

  const faces = installed
    .map((f) => {
      const fmt = f.file.endsWith('.woff2') ? 'woff2' : f.file.endsWith('.otf') ? 'opentype' : 'truetype';
      return `@font-face{font-family:"${famName(f.family)}";src:url("/fonts/${encodeURIComponent(f.file)}") format("${fmt}");font-weight:400;font-display:swap;}`;
    })
    .join('\n');

  const stack = [...ordered.map((f) => `"${famName(f)}"`), ...SYSTEM_STACK].join(',');
  /* Emoji 默认走系统彩色字体；NotoEmoji 是单色线条版，作为设置里的另一个选项 */
  const colorEmoji = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji"';
  const notoEmoji = have.has('NotoEmoji') ? `"${famName('NotoEmoji')}",${colorEmoji}` : colorEmoji;
  return `${faces}
:root{--glyph-font:${stack};--emoji-font:${colorEmoji};}
body.emoji-noto{--emoji-font:${notoEmoji};}
`;
}
