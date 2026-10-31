import zlib from 'node:zlib';

/**
 * 最小 ZIP 读取器：只依赖 node:zlib 的 inflateRaw。
 * 支持标准中央目录（含 zip64 尺寸字段回退），足够读 UCD.zip / Unihan.zip。
 * 返回 [{ name, size, data: Buffer }]
 */
export function readZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');

  let entryCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let cdSize = buf.readUInt32LE(eocd + 12);

  // zip64 标记位：真实值在 zip64 EOCD 记录里
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    const loc = findZip64Eocd(buf, eocd);
    if (loc >= 0) {
      entryCount = Number(buf.readBigUInt64LE(loc + 32));
      cdSize = Number(buf.readBigUInt64LE(loc + 40));
      cdOffset = Number(buf.readBigUInt64LE(loc + 48));
    }
  }

  const out = [];
  let off = cdOffset;
  const cdEnd = cdOffset + cdSize;

  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break;

    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    let csize = buf.readUInt32LE(off + 20);
    let usize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    let localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', off + 46, off + 46 + nameLen);

    // zip64 扩展字段
    const extraStart = off + 46 + nameLen;
    const extraEnd = extraStart + extraLen;
    let p = extraStart;
    while (p + 4 <= extraEnd) {
      const id = buf.readUInt16LE(p);
      const len = buf.readUInt16LE(p + 2);
      if (id === 0x0001) {
        let q = p + 4;
        if (usize === 0xffffffff && q + 8 <= extraEnd) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff && q + 8 <= extraEnd) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xffffffff && q + 8 <= extraEnd) { localOffset = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      p += 4 + len;
    }

    off = extraEnd + commentLen;
    if (off > cdEnd) break;
    if (name.endsWith('/')) continue;

    const lh = localOffset;
    if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(lh + 26);
    const lExtraLen = buf.readUInt16LE(lh + 28);
    const start = lh + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);

    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else continue; // 只处理 stored / deflate，UCD 只用这两种

    out.push({ name, size: usize || data.length, data });
  }

  return out;
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 0x10000 - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function findZip64Eocd(buf, eocd) {
  for (let i = eocd - 20; i >= Math.max(0, eocd - 4096); i--) {
    if (buf.readUInt32LE(i) === 0x06064b50) return i;
  }
  return -1;
}
