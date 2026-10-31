import http from 'node:http';
import { spawn } from 'node:child_process';
import { handleApi, serveStatic, serveFont, initRuntime, runtime } from './http.js';
import { fontCss } from './fonts.js';
import { ensureDirs, listInstalled } from './vendor.js';
import { installLogCapture } from './logs.js';
import { ROOT } from './paths.js';
import fs from 'node:fs';
import path from 'node:path';

/** 读 `--name value` 或 `--name=value` 形式的命令行参数 */
function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : null;
}

const BASE_PORT = Number(argValue('--port') || process.env.PORT || 8731);
const HOST = process.env.HOST || '127.0.0.1';
const OPEN = !process.argv.includes('--no-open');

/* 日志：接进环形缓冲（网页里能看），同时按需写文件。
   进程自己写文件意味着启动器随时可以退出，不会因为管道断开把服务写崩。 */
installLogCapture(argValue('--log'));

await ensureDirs();

// 已经有一份在跑就直接把浏览器叫起来，省掉后面加载数据的几秒
// 连查两次：刚被网页关闭的实例还会响应几百毫秒，只查一次会误判成"已在运行"
if (await probe(BASE_PORT)) {
  await new Promise((r) => setTimeout(r, 600));
  if (await probe(BASE_PORT)) {
    console.log(`[unicode-atlas] 已经在运行 → http://${HOST}:${BASE_PORT}`);
    if (OPEN) openUrl(`http://${HOST}:${BASE_PORT}`);
    process.exit(0);
  }
}

// 数据在后台加载，服务器先起来，浏览器不用等索引解压
runtime.boot = initRuntime()
  .then((db) => {
    if (db) console.log(`[unicode-atlas] 已载入 Unicode ${runtime.version} — ${db.size.toLocaleString('en-US')} 个已分配字符`);
    else console.log('[unicode-atlas] 本地尚无 UCD 数据，打开页面后会引导安装');
    return db;
  })
  .catch((err) => {
    console.error('[unicode-atlas] 载入数据失败：', err.message);
    return null;
  });

/** 上次有请求进来的时间戳 —— 用来判断「窗口到底有没有真的加载出东西」。
 *  启动器的探活请求（/api/ping）和页面心跳（/api/alive）不算，否则会误判成「界面已经开了」。 */
function touch(req) {
  runtime.lastHit = Date.now();
  const u = req.url || '';
  if (u.startsWith('/api/ping') || u.startsWith('/api/alive')) return;
  runtime.lastPage = Date.now();
  // 页面请求计数：启动器用它判断「窗口有没有真的加载出东西」
  runtime.pageHits = (runtime.pageHits || 0) + 1;
  runtime.hits = (runtime.hits || 0) + 1;
  if (runtime.hits <= 40) console.log(`[hit ${runtime.hits}] ${req.method} ${u}`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${BASE_PORT}`}`);
  touch(req);
  (async () => {
    if (url.pathname === '/fonts.css') {
      const css = await fontCss();
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
      res.end(css);
      return;
    }
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (url.pathname.startsWith('/fonts/')) await serveFont(req, res, url);
    else await serveStatic(req, res, url);
  })().catch((err) => {
    console.error('[unicode-atlas] 请求出错', url.pathname, err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message }));
  });
});

function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 12) {
      listen(port + 1, attempt + 1);
    } else {
      console.error('[unicode-atlas] 无法监听端口：', err.message);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}`;
    console.log(`[unicode-atlas] 服务已启动 → ${url}`);
    if (OPEN) openUrl(url);
    listInstalled().then((list) => {
      if (list.length) console.log(`[unicode-atlas] 已安装版本：${list.map((m) => m.version).join(', ')}`);
      else console.log('[unicode-atlas] 尚未安装任何版本，请在页面里选择安装');
    }).catch(() => {});
  });
}

/** 找 Edge / Chrome 的可执行文件（独立应用窗口模式要用） */
function findChromium() {
  if (process.platform !== 'win32') return null;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    local ? `${local}\\Microsoft\\Edge\\Application\\msedge.exe` : '',
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : '',
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** 打开界面。
 *
 *  只走「独立应用窗口」：自己的 --user-data-dir、自己的进程，不与用户已有的
 *  Edge 实例通信。这样就绕开了两个老毛病：
 *    · 权限级别不同时 Edge 会弹「现有实例正在以提升的权限运行，是否重启」，
 *      选「是」会把用户正开着的页面全部关掉；
 *    · 系统 Shell 委托过来的 URL 经常被静默丢弃，只剩一个空白窗口。
 *  找不到 Chromium 才退回系统默认浏览器。
 */
function openUrl(url) {
  if (process.platform === 'win32') {
    const exe = findChromium();
    if (exe) {
      const profile = path.join(ROOT, 'data', 'browser');
      try { fs.mkdirSync(profile, { recursive: true }); } catch {}
      const args = [
        `--user-data-dir=${profile}`,
        `--app=${url}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--hide-crash-restore-bubble',
        '--window-size=1440,960',
      ];
      try {
        const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
        console.log(`[unicode-atlas] 已用独立应用窗口打开界面（${exe}）`);
        return;
      } catch (err) {
        console.log('[unicode-atlas] 独立应用窗口打开失败：', err.message);
      }
    }
  }

  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    console.log('[unicode-atlas] 已交给系统默认浏览器打开');
  } catch { /* 打不开就算了 */ }
}

/** 探测某个端口上是否已经跑着本程序 */
async function probe(port) {
  try {
    const r = await fetch(`http://${HOST}:${port}/api/ping`, { signal: AbortSignal.timeout(700) });
    if (!r.ok) return false;
    const j = await r.json();
    return j?.ok === true;
  } catch {
    return false;
  }
}

listen(BASE_PORT);

/* 页面心跳：网页开一条 /api/live 的 SSE 长连接。还有连接在，服务就活着；
   连接断开（标签页关了、浏览器退出）后宽限 12 秒，没有新连接就自己收摊。
   不用轮询判定是因为浏览器会把后台标签的 setInterval 节流，容易误杀。 */
const ALIVE_TIMEOUT = 12_000;
setInterval(() => {
  if (!runtime.lastAlive) return;
  if (runtime.aliveConns > 0) return;
  if (Date.now() - runtime.lastAlive > ALIVE_TIMEOUT) {
    console.log('[unicode-atlas] 页面已关闭，服务退出');
    process.exit(0);
  }
}, 4_000).unref();

process.on('SIGINT', () => {
  console.log('\n[unicode-atlas] 已退出');
  process.exit(0);
});
