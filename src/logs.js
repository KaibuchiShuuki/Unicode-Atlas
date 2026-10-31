/**
 * 运行日志：把 console 的输出收进一个环形缓冲，页面里可以随时查看，
 * 同时（可选）追加写入日志文件。
 *
 * 这样启动器用 .bat 拉起服务时，控制台窗口最小化了也不影响看日志，
 * 甚至完全关掉控制台（用 --log 时服务自己写文件）。
 */

import fs from 'node:fs';
import path from 'node:path';

export const ring = {
  lines: [],
  max: 1000,
  startedAt: Date.now(),
  push(line) {
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.shift();
  },
};

function format(args) {
  return args
    .map((x) => {
      if (typeof x === 'string') return x;
      if (x instanceof Error) return x.stack || x.message;
      try { return JSON.stringify(x); } catch { return String(x); }
    })
    .join(' ');
}

/** 接管 console，把输出同时送进环形缓冲与日志文件（file 可为 null） */
export function installLogCapture(file) {
  let stream = null;
  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      stream = fs.createWriteStream(file, { flags: 'a' });
    } catch {}
  }

  const emit = (args) => {
    const line = format(args);
    ring.push(line);
    if (stream) { try { stream.write(line + '\n'); } catch {} }
  };

  console.log = (...a) => emit(a);
  console.error = (...a) => emit(a);
  console.warn = (...a) => emit(a);

  return { close() { try { stream?.end(); } catch {} } };
}
