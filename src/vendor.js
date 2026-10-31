import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR, VERSIONS_DIR, STATE_FILE, CACHE_DIR, versionPaths } from './paths.js';
import { readZipEntries } from './zip.js';
import {
  BASE, LATEST, normalizeVersion, cmpVersion, resolveVersion, downloadFile,
  detectLatest, listReleaseDirs, listDir, FILE_SPECS,
} from './source.js';
import { buildIndex } from './build.js';

const CLDR_BASE = 'https://cdn.jsdelivr.net/npm/cldr-annotations-full';

/** 全局任务状态（一次只允许一个安装任务） */
export const job = {
  running: false,
  version: null,
  phase: 'idle',
  step: '',
  pct: 0,
  received: 0,
  total: 0,
  log: [],
  error: null,
  startedAt: null,
  finishedAt: null,
};

function pushLog(msg) {
  job.log.push({ t: Date.now(), msg });
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
}

function setPhase(phase, step, pct) {
  job.phase = phase;
  if (step !== undefined) job.step = step;
  if (pct !== undefined) job.pct = pct;
}

export async function ensureDirs() {
  await fsp.mkdir(VERSIONS_DIR, { recursive: true });
  await fsp.mkdir(CACHE_DIR, { recursive: true });
}

export async function readState() {
  try {
    return JSON.parse(await fsp.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { defaultVersion: null, lastCheck: null };
  }
}

export async function writeState(state) {
  await ensureDirs();
  await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/* ───────────────────── 已安装版本 ───────────────────── */

export async function listInstalled() {
  const out = [];
  let dirs = [];
  try {
    dirs = await fsp.readdir(VERSIONS_DIR, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const m = JSON.parse(await fsp.readFile(path.join(VERSIONS_DIR, d.name, 'manifest.json'), 'utf8'));
      out.push(m);
    } catch {
      // 半成品目录：忽略
    }
  }
  return out.sort((a, b) => cmpVersion(b.version, a.version));
}

export async function removeVersion(version) {
  const vp = versionPaths(normalizeVersion(version));
  await fsp.rm(vp.base, { recursive: true, force: true });
  const state = await readState();
  if (state.defaultVersion === normalizeVersion(version)) {
    const rest = await listInstalled();
    state.defaultVersion = rest[0]?.version ?? null;
    await writeState(state);
  }
}

export async function setDefault(version) {
  const state = await readState();
  state.defaultVersion = normalizeVersion(version);
  await writeState(state);
}

/* ───────────────────── CLDR 中文注释（全局共用） ───────────────────── */

async function resolveCldrTag() {
  try {
    const res = await fetch('https://registry.npmjs.org/cldr-annotations-full/latest', {
      headers: { 'user-agent': 'unicode-atlas/0.1' },
    });
    if (res.ok) {
      const j = await res.json();
      if (j.version) return j.version;
    }
  } catch { /* 离线或网络受限时忽略 */ }
  return '48';
}

async function ensureCldr(onProgress) {
  const dir = path.join(DATA_DIR, 'cldr');
  const zhPath = path.join(dir, 'zh.json');
  const enPath = path.join(dir, 'en.json');
  if (fs.existsSync(zhPath)) {
    return { zh: JSON.parse(await fsp.readFile(zhPath, 'utf8')), en: fs.existsSync(enPath) ? JSON.parse(await fsp.readFile(enPath, 'utf8')) : null };
  }
  await fsp.mkdir(dir, { recursive: true });
  const tag = await resolveCldrTag();
  const result = { zh: null, en: null };
  for (const loc of ['zh', 'en']) {
    const url = `${CLDR_BASE}@${tag}/annotations/${loc}/annotations.json`;
    try {
      onProgress?.(`下载 CLDR ${loc} 注释 (${tag})`);
      await downloadFile(url, path.join(dir, `${loc}.json`));
      result[loc] = JSON.parse(await fsp.readFile(path.join(dir, `${loc}.json`), 'utf8'));
    } catch (e) {
      pushLog(`CLDR ${loc} 下载失败（不影响主数据）：${e.message}`);
    }
  }
  return result;
}

/* ───────────────────── 安装 ───────────────────── */

/** 把 zip 里的条目映射到 FILE_SPECS 的 key */
function mapZipEntries(entries) {
  const raw = {};
  const used = new Set();
  for (const e of entries) {
    const base = path.posix.basename(e.name);
    for (const spec of FILE_SPECS) {
      if (used.has(spec.key)) continue;
      if (spec.zip) continue;
      if (!spec.re.test(base)) continue;
      raw[spec.key] = e.data.toString('utf8');
      used.add(spec.key);
      break;
    }
  }
  return raw;
}

async function unihanFromZip(zipPath) {
  const buf = await fsp.readFile(zipPath);
  return readZipEntries(buf).filter((e) => /\.txt$/i.test(e.name));
}

/**
 * 安装一个版本。串行：全局 job 状态即锁。
 * @param {string} version
 * @param {{includeUnihan?: boolean, includeCldr?: boolean}} opts
 */
export async function install(version, opts = {}) {
  if (job.running) throw Object.assign(new Error('已有安装任务在运行'), { code: 'BUSY' });
  const ver = normalizeVersion(version);
  Object.assign(job, {
    running: true, version: ver, phase: 'resolve', step: '定位版本目录', pct: 0,
    received: 0, total: 0, log: [], error: null, startedAt: Date.now(), finishedAt: null,
  });
  pushLog(`开始安装 Unicode ${ver}`);

  try {
    const resolved = await resolveVersion(ver, { onLog: pushLog });
    const vp = versionPaths(ver);
    await fsp.mkdir(vp.raw, { recursive: true });

    let raw = {};
    let usedUcdZip = false;

    // 首选 UCD.zip 单包
    const ucdZipEntry = await findUcdZip(resolved.rootUrl);
    if (ucdZipEntry) {
      const zipPath = path.join(vp.raw, '_UCD.zip');
      setPhase('download', '下载 UCD.zip (含 UnicodeData / NamesList / DerivedName)', 2);
      await downloadFile(ucdZipEntry.url, zipPath, {
        onProgress: ({ received, total }) => {
          job.received = received;
          job.total = total;
          job.pct = total ? Math.min(45, Math.round((received / total) * 45)) : 45;
        },
      });
      setPhase('extract', '解压 UCD.zip', 46);
      const entries = readZipEntries(await fsp.readFile(zipPath));
      raw = mapZipEntries(entries);
      usedUcdZip = true;
      pushLog(`UCD.zip 解出 ${entries.length} 个条目，匹配到 ${Object.keys(raw).length} 个数据文件`);
      await fsp.rm(zipPath, { force: true }); // 保留解出的文本即可
    }

    // 没有 UCD.zip（老版本）→ 逐文件下载
    if (!usedUcdZip) {
      const files = Object.entries(resolved.files);
      let done = 0;
      for (const [key, info] of files) {
        const spec = FILE_SPECS.find((s) => s.key === key);
        if (!spec) continue;
        if (spec.key === 'Unihan') continue;
        setPhase('download', `下载 ${info.name}`, 2 + Math.round((done / files.length) * 40));
        const buf = await (await fetch(info.url, { headers: { 'user-agent': 'unicode-atlas/0.1' } })).arrayBuffer();
        raw[key] = Buffer.from(buf).toString('utf8');
        done++;
      }
      pushLog(`逐文件下载完成，共 ${Object.keys(raw).length} 个文件`);
    }

    if (!raw.UnicodeData) throw new Error('缺少 UnicodeData.txt，无法构建索引');

    // Unihan（可选）
    let unihanEntries = null;
    if (opts.includeUnihan !== false && resolved.files.Unihan) {
      const zipPath = path.join(vp.raw, 'Unihan.zip');
      setPhase('download', '下载 Unihan.zip（汉字数据库，约 8 MB）', 50);
      await downloadFile(resolved.files.Unihan.url, zipPath, {
        onProgress: ({ received, total }) => {
          job.received = received;
          job.total = total;
          job.pct = total ? 50 + Math.min(15, Math.round((received / total) * 15)) : 65;
        },
      });
      setPhase('extract', '读取 Unihan 数据', 66);
      unihanEntries = await unihanFromZip(zipPath);
      pushLog(`Unihan.zip 内含 ${unihanEntries.length} 个数据文件`);
    }

    // CLDR（可选，全局缓存）
    let cldr = null;
    let cldrEn = null;
    if (opts.includeCldr !== false) {
      try {
        const c = await ensureCldr((m) => setPhase('download', m, 68));
        cldr = c.zh;
        cldrEn = c.en;
      } catch (e) {
        pushLog(`CLDR 处理失败：${e.message}`);
      }
    }

    // 持久化原始数据
    setPhase('build', '写入原始数据快照', 70);
    for (const [key, text] of Object.entries(raw)) {
      await fsp.writeFile(path.join(vp.raw, `${key}.txt`), text, 'utf8');
    }

    setPhase('build', '解析并构建索引（约 16 万字符）', 72);
    const index = buildIndex({
      version: ver,
      raw,
      unihanEntries,
      cldr,
      cldrEn,
      onProgress: (n) => {
        job.pct = 72 + Math.min(20, Math.round((n / 160000) * 20));
        job.step = `解析字符 ${n.toLocaleString('en-US')} / ~160,000`;
      },
    });

    setPhase('build', '压缩索引', 93);
    const json = JSON.stringify(index);
    const gz = zlib.gzipSync(json, { level: 6 });
    await fsp.writeFile(vp.index, gz);

    const manifest = {
      version: ver,
      dir: resolved.dir,
      installedAt: new Date().toISOString(),
      buildMs: index.buildMs,
      counts: index.counts,
      sources: index.sources,
      missing: resolved.missing.map((m) => m.label),
      bytes: { index: gz.length, raw: Object.values(raw).reduce((s, t) => s + Buffer.byteLength(t), 0) },
    };
    await fsp.writeFile(vp.manifest, JSON.stringify(manifest, null, 2), 'utf8');

    const state = await readState();
    if (!state.defaultVersion) state.defaultVersion = ver;
    await writeState(state);

    setPhase('done', '完成', 100);
    job.finishedAt = Date.now();
    pushLog(`安装完成：${index.counts.assigned.toLocaleString('en-US')} 个已分配字符，索引 ${(gz.length / 1048576).toFixed(2)} MB`);
    return manifest;
  } catch (err) {
    job.error = err.message;
    setPhase('error', err.message, job.pct);
    pushLog(`安装失败：${err.message}`);
    throw err;
  } finally {
    job.running = false;
    if (!job.finishedAt) job.finishedAt = Date.now();
  }
}

async function findUcdZip(rootUrl) {
  for (const sub of ['ucd', '']) {
    const entries = await listDir(`${rootUrl}${sub}/`);
    const hit = entries?.find((e) => !e.isDir && /^UCD\.zip$/i.test(e.name));
    if (hit) return hit;
  }
  return null;
}

/* ───────────────────── 更新检测 ───────────────────── */

export async function checkForUpdate() {
  const [latest, installed, state] = await Promise.all([detectLatest(), listInstalled(), readState()]);
  const current = state.defaultVersion ?? installed[0]?.version ?? null;
  const isNewer = !current || cmpVersion(latest.version, current) > 0;
  const info = {
    latest: latest.version,
    via: latest.via,
    checkedAt: new Date().toISOString(),
    current,
    isNewer,
    installedVersions: installed.map((m) => m.version),
  };
  state.lastCheck = info;
  await writeState(state);
  return info;
}

export async function availableReleaseDirs() {
  return listReleaseDirs();
}
