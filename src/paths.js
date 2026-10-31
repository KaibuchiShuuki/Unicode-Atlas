import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const VERSIONS_DIR = path.join(DATA_DIR, 'versions');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const FONTS_DIR = path.join(DATA_DIR, 'fonts');
/** 随程序分发的字体备份，装包时优先从这里复制，断网也能装 */
export const FONT_BACKUP_DIR = path.join(ROOT, 'vendor', 'fonts');

/** 每个已安装版本的目录布局 */
export function versionPaths(version) {
  const base = path.join(VERSIONS_DIR, version);
  return {
    base,
    raw: path.join(base, 'raw'),
    index: path.join(base, 'index.json.gz'),
    manifest: path.join(base, 'manifest.json'),
  };
}
