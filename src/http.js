import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PUBLIC_DIR, FONTS_DIR, versionPaths } from './paths.js';
import { CharDB } from './db.js';
import * as vendor from './vendor.js';
import * as fonts from './fonts.js';
import { fontsForCp } from './font-cmap.js';
import { normalizeVersion, cmpVersion } from './source.js';
import { ring } from './logs.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export const runtime = {
  db: null,
  version: null,
  loading: false,
  lastHit: 0,
  lastPage: 0,
  pageHits: 0,
  lastAlive: 0,
  aliveConns: 0,
  boot: null,
};

/** 载入某个版本的索引到内存 */
export async function loadVersion(version) {
  const ver = normalizeVersion(version);
  const vp = versionPaths(ver);
  if (!fs.existsSync(vp.index)) throw new Error(`版本 ${ver} 未安装`);
  runtime.loading = true;
  try {
    const gz = await fsp.readFile(vp.index);
    const json = zlib.gunzipSync(gz).toString('utf8');
    const index = JSON.parse(json);
    runtime.db = new CharDB(index);
    runtime.version = ver;
    return runtime.db;
  } finally {
    runtime.loading = false;
  }
}

/** 启动时挑一个版本加载 */
export async function initRuntime() {
  const state = await vendor.readState();
  const installed = await vendor.listInstalled();
  if (!installed.length) return null;
  const wanted = installed.find((m) => m.version === state.defaultVersion) ?? installed[0];
  if (!wanted) return null;
  await loadVersion(wanted.version);
  // 已安装的最高版本若高于默认，不自动改默认（尊重用户选择）
  return runtime.db;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

function needDb(res) {
  if (!runtime.db) {
    json(res, 409, { error: '尚未安装任何 Unicode 版本数据', code: 'NO_DATA' });
    return null;
  }
  return runtime.db;
}

function parseCp(str) {
  const s = String(str).trim();
  const m = /^(?:u\+|0x)?([0-9a-f]{1,6})$/i.exec(s);
  if (!m) return null;
  const cp = parseInt(m[1], 16);
  return cp <= 0x10ffff ? cp : null;
}

export async function handleApi(req, res, url) {
  // 启动数据可能在后台加载，先等它落地再处理任何请求
  if (runtime.boot) {
    try { await runtime.boot; } catch { /* 失败由各端点自己报 */ }
    runtime.boot = null;
  }
  const { pathname, searchParams } = url;

  const method = req.method;

  /* ── 元信息 ── */
  if (pathname === '/api/meta' && method === 'GET') {
    const db = needDb(res);
    if (!db) return;
    return json(res, 200, { ...db.meta(), activeVersion: runtime.version });
  }

  /* ── 版本列表 ── */
  if (pathname === '/api/versions' && method === 'GET') {
    const [installed, state] = await Promise.all([vendor.listInstalled(), vendor.readState()]);
    return json(res, 200, {
      installed,
      active: runtime.version,
      defaultVersion: state.defaultVersion,
      lastCheck: state.lastCheck,
      hasData: !!runtime.db,
    });
  }

  /* ── 可用版本目录（安装对话框用） ── */
  if (pathname === '/api/releases' && method === 'GET') {
    try {
      const dirs = await vendor.availableReleaseDirs();
      return json(res, 200, { dirs });
    } catch (e) {
      return json(res, 502, { error: e.message });
    }
  }

  /* ── 更新检测 ── */
  if (pathname === '/api/check-update' && method === 'POST') {
    try {
      return json(res, 200, await vendor.checkForUpdate());
    } catch (e) {
      return json(res, 502, { error: e.message, code: e.code });
    }
  }

  /* ── 安装 ── */
  if (pathname === '/api/install' && method === 'POST') {
    const body = await readBody(req);
    if (vendor.job.running) return json(res, 409, { error: '已有安装任务在运行', code: 'BUSY' });
    if (!body.version) return json(res, 400, { error: '缺少 version' });
    let ver;
    try {
      ver = normalizeVersion(body.version);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
    vendor.install(ver, {
      includeUnihan: body.includeUnihan !== false,
      includeCldr: body.includeCldr !== false,
    }).then(async (manifest) => {
      // 装完自动设为默认并加载（若当前无数据或用户要求）
      const state = await vendor.readState();
      if (!state.defaultVersion || body.makeDefault !== false) {
        await vendor.setDefault(ver);
      }
      if (body.load !== false) {
        try { await loadVersion(ver); } catch { /* 失败时保留旧 db */ }
      }
    }).catch(() => { /* job.error 已记录 */ });
    return json(res, 202, { started: true, version: ver });
  }

  /* ── 安装进度 ── */
  if (pathname === '/api/install/status' && method === 'GET') {
    return json(res, 200, vendor.job);
  }

  /* ── 切换查看版本 ── */
  if (pathname === '/api/switch' && method === 'POST') {
    const body = await readBody(req);
    if (!body.version) return json(res, 400, { error: '缺少 version' });
    try {
      await loadVersion(body.version);
      if (body.makeDefault !== false) await vendor.setDefault(body.version);
      return json(res, 200, { active: runtime.version, counts: runtime.db.index.counts });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  /* ── 删除版本 ── */
  if (pathname === '/api/versions/remove' && method === 'POST') {
    const body = await readBody(req);
    if (!body.version) return json(res, 400, { error: '缺少 version' });
    const ver = normalizeVersion(body.version);
    await vendor.removeVersion(ver);
    if (runtime.version === ver) {
      runtime.db = null;
      runtime.version = null;
      await initRuntime();
    }
    return json(res, 200, { removed: ver, active: runtime.version });
  }

  /* ── 设为默认 ── */
  if (pathname === '/api/versions/default' && method === 'POST') {
    const body = await readBody(req);
    if (!body.version) return json(res, 400, { error: '缺少 version' });
    await vendor.setDefault(body.version);
    return json(res, 200, { defaultVersion: normalizeVersion(body.version) });
  }

  /* ── 字符列表 / 搜索 ── */
  if (pathname === '/api/chars' && method === 'GET') {
    const db = needDb(res);
    if (!db) return;
    const q = searchParams.get('q');
    const filters = {
      block: searchParams.get('block') || undefined,
      gc: searchParams.get('gc') || undefined,
      script: searchParams.get('script') || undefined,
      age: searchParams.get('age') || undefined,
      plane: searchParams.has('plane') ? Number(searchParams.get('plane')) : undefined,
      offset: Number(searchParams.get('offset') ?? 0),
      limit: Number(searchParams.get('limit') ?? 120),
      includeUnassigned: searchParams.get('unassigned') === '1',
    };
    if (q && q.trim()) return json(res, 200, db.search(q, filters));
    return json(res, 200, db.list(filters));
  }

  /* ── 单字符详情 ── */
  if (pathname.startsWith('/api/char/') && method === 'GET') {
    const db = needDb(res);
    if (!db) return;
    const raw = decodeURIComponent(pathname.slice('/api/char/'.length));
    const cp = parseCp(raw);
    if (cp === null) return json(res, 400, { error: '非法码点' });
    const d = db.detail(cp);
    return json(res, 200, d);
  }

  /* ── Noto 字体包 ── */
  if (pathname === '/api/fonts' && method === 'GET') {
    return json(res, 200, await fonts.fontsStatus());
  }
  if (pathname === '/api/fonts/install' && method === 'POST') {
    if (fonts.fontJob.running) return json(res, 409, { error: '字体正在下载中', code: 'BUSY' });
    const body = await readBody(req);
    fonts.installFonts({ force: body.force === true }).catch(() => {});
    return json(res, 202, { started: true, total: fonts.FONT_LIST.length });
  }
  if (pathname === '/api/fonts/status' && method === 'GET') {
    return json(res, 200, await fonts.fontsStatus());
  }
  /* 某个码点能被本机哪些字体显示（字体选择下拉框用） */
  if (pathname === '/api/fonts/coverage' && method === 'GET') {
    const cp = parseCp(searchParams.get('cp') || '');
    if (cp === null) return json(res, 400, { error: '非法码点' });
    try {
      const list = await fontsForCp(cp);
      return json(res, 200, { cp, fonts: list });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }
  if (pathname === '/fonts.css' && method === 'GET') {
    const css = await fonts.fontCss();
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(css);
  }

  /* ── 关闭程序 ── */
  if (pathname === '/api/shutdown' && method === 'POST') {
    json(res, 200, { ok: true, message: '正在关闭' });
    setTimeout(() => {
      process.stdout.write('\n已通过网页关闭。\n');
      process.exit(0);
    }, 400);
    return;
  }

  /* ── 页面心跳（关掉页面后服务端会自动退出） ──
     /api/live 是一条 SSE 长连接：浏览器把标签页放后台时会节流 setInterval（可能一分钟才跑一次），
     用轮询判断「页面还在不在」会误杀；长连接不受节流影响，断开才是真的走了。 */
  if (pathname === '/api/live' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    runtime.aliveConns = (runtime.aliveConns || 0) + 1;
    runtime.lastAlive = Date.now();
    const iv = setInterval(() => {
      try { res.write(': keep\n\n'); } catch { /* 连接已断，close 会收尾 */ }
    }, 15_000);
    iv.unref?.();
    let done = false;
    const bye = () => {
      if (done) return;
      done = true;
      clearInterval(iv);
      runtime.aliveConns = Math.max(0, (runtime.aliveConns || 1) - 1);
      runtime.lastAlive = Date.now();
    };
    req.on('close', bye);
    res.on('close', bye);
    res.on('error', bye);
    return true;
  }

  /* 兼容旧的轮询心跳 */
  if (pathname === '/api/alive') {
    runtime.lastAlive = Date.now();
    return json(res, 200, { ok: true });
  }

  /* ── 健康检查 / 提示 ── */
  if (pathname === '/api/ping' && method === 'GET') {
    // pages：页面请求计数（不含 ping 本身），启动器靠它判断窗口有没有真的渲染出来
    return json(res, 200, {
      ok: true,
      version: runtime.version,
      hasData: !!runtime.db,
      pages: runtime.pageHits || 0,
    });
  }

  /* ── 运行日志（控制台输出都收在这里，页面里可以看） ── */
  if (pathname === '/api/logs' && method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const lines = since > 0 ? ring.lines.slice(since) : ring.lines.slice(-400);
    return json(res, 200, {
      lines,
      offset: ring.lines.length,
      startedAt: ring.startedAt,
      pid: process.pid,
      node: process.version,
    });
  }

  return json(res, 404, { error: 'unknown api', pathname });
}

/** 提供 data/fonts/ 下的字体文件 */
export async function serveFont(req, res, url) {
  const name = decodeURIComponent(url.pathname.slice('/fonts/'.length));
  const resolved = path.resolve(path.join(FONTS_DIR, path.normalize(name).replace(/^([/\\])+/, '')));
  if (!resolved.startsWith(path.resolve(FONTS_DIR))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(resolved).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Number(m[2]) : stat.size - 1;
        if (start <= end && end < stat.size) {
          res.writeHead(206, {
            'content-type': type,
            'content-range': `bytes ${start}-${end}/${stat.size}`,
            'accept-ranges': 'bytes',
            'content-length': end - start + 1,
            'cache-control': 'max-age=31536000, immutable',
          });
          fs.createReadStream(resolved, { start, end }).pipe(res);
          return;
        }
      }
    }
    res.writeHead(200, {
      'content-type': type,
      'accept-ranges': 'bytes',
      'content-length': stat.size,
      'cache-control': 'max-age=31536000, immutable',
    });
    fs.createReadStream(resolved).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 font not found');
  }
}

export async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(resolved).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 not found');
  }
}
