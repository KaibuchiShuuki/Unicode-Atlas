import {
  parseUnicodeData, parseDerivedName, lookupDerivedName, algorithmicName, hangulName,
  parseBlocks, parseIntervalFile, parseDerivedAge, parseNameAliases, parseCaseFolding,
  parseSpecialCasing, parseNamesList, parseStandardizedVariants, parseEmojiVariationSequences,
  parseUnihan, parseCldrAnnotations, hex,
} from './parsers.js';

/** 区间 → 值 的快速查找器（二分） */
export class RangeIndex {
  constructor(pairs) {
    this.list = (pairs || []).slice().sort((a, b) => a.first - b.first);
    this.starts = this.list.map((p) => p.first);
  }
  lookup(cp) {
    let lo = 0;
    let hi = this.starts.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= cp) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (ans < 0) return undefined;
    const p = this.list[ans];
    return cp <= p.last ? p.value : undefined;
  }
  get size() { return this.list.length; }
}

function addToMulti(map, key, value) {
  if (!key) return;
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  arr.push(value);
}

function bump(counter, key) {
  if (!key) return;
  counter[key] = (counter[key] || 0) + 1;
}

/** CLDR 的键可能带变体选择符（如 `2764-FE0F`），逐级兜底 */
function cldrLookup(map, cp) {
  if (!map) return undefined;
  const h = hex(cp);
  return map.get(h) ?? map.get(`${h}-FE0F`) ?? map.get(`${h}-FE0E`);
}

/**
 * 把解析后的原始数据组装成可落盘的索引。
 * @param {object} opts
 * @param {string} opts.version
 * @param {Record<string,string>} opts.raw  文件名 → 全文（Unihan/Cldr 不在其中）
 * @param {Array<{name:string,data:Buffer}>} [opts.unihanEntries]
 * @param {object} [opts.cldr]  zh annotations JSON
 * @param {object} [opts.cldrEn]
 */
export function buildIndex({ version, raw, unihanEntries, cldr, cldrEn, onProgress }) {
  const t0 = Date.now();

  const ud = parseUnicodeData(raw.UnicodeData);
  const derived = raw.DerivedName ? parseDerivedName(raw.DerivedName) : null;
  const blocks = raw.Blocks ? parseBlocks(raw.Blocks) : [];
  const scriptIdx = new RangeIndex(raw.Scripts ? parseIntervalFile(raw.Scripts) : []);
  const scriptExtIdx = raw.ScriptExtensions ? new RangeIndex(parseIntervalFile(raw.ScriptExtensions, { allowMultiValue: true })) : null;
  const ageIdx = new RangeIndex(raw.DerivedAge ? parseDerivedAge(raw.DerivedAge) : []);
  const eawIdx = new RangeIndex(raw.EastAsianWidth ? parseIntervalFile(raw.EastAsianWidth) : []);
  const lbIdx = raw.LineBreak ? new RangeIndex(parseIntervalFile(raw.LineBreak)) : null;
  const blockIdx = new RangeIndex(blocks.map((b) => ({ first: b.first, last: b.last, value: b.id })));

  const nameAliases = raw.NameAliases ? parseNameAliases(raw.NameAliases) : new Map();
  const namesList = raw.NamesList ? parseNamesList(raw.NamesList) : new Map();
  const caseFolding = raw.CaseFolding ? parseCaseFolding(raw.CaseFolding) : new Map();
  const specialCasing = raw.SpecialCasing ? parseSpecialCasing(raw.SpecialCasing) : new Map();
  const stdVariants = raw.StandardizedVariants ? parseStandardizedVariants(raw.StandardizedVariants) : [];
  const emojiVS = raw.EmojiVariationSequences ? parseEmojiVariationSequences(raw.EmojiVariationSequences) : [];
  const unihan = unihanEntries ? parseUnihan(unihanEntries) : new Map();
  const cldrMap = cldr ? parseCldrAnnotations(cldr) : new Map();
  const cldrEnMap = cldrEn ? parseCldrAnnotations(cldrEn) : new Map();

  // 变体序列按基字符归拢：base cp → [{q,d,k}]
  const variantMap = new Map();
  for (const v of stdVariants) addToMulti(variantMap, v.seq[0], { q: v.seq.map((c) => hex(c)).join(' '), d: v.desc, k: 'sv' });
  for (const v of emojiVS) addToMulti(variantMap, v.seq[0], { q: v.seq.map((c) => hex(c)).join(' '), d: v.desc, k: 'emoji' });

  /** 名字：DerivedName > UnicodeData > 算法规则 */
  const nameOf = (cp, udName, base) => {
    if (derived) {
      const n = lookupDerivedName(derived, cp);
      if (n) return n;
    }
    if (udName && !/^<.*>$/.test(udName)) return udName;
    if (base) return algorithmicName(base, cp);
    return null;
  };

  const chars = {};
  const formsByBase = {};
  const catCount = {};
  const scriptCount = {};
  const ageCount = {};
  const blockCount = {};
  let assigned = 0;

  const makeEntry = (cp, udName, base, attrs) => {
    let name = nameOf(cp, udName, base);
    const aliases = nameAliases.get(cp);
    // <control> 字符：正式名是 <control>，可读名来自 NameAliases 的 control 别名
    if (!name && aliases) {
      const ctrl = aliases.find((a) => a.type === 'control');
      if (ctrl) name = ctrl.alias;
    }
    const gc = attrs.gc;
    const block = blockIdx.lookup(cp);
    const script = scriptIdx.lookup(cp);
    const scriptExt = scriptExtIdx?.lookup(cp);
    const age = ageIdx.lookup(cp);
    const eaw = eawIdx.lookup(cp);
    const lineBreak = lbIdx?.lookup(cp);

    const rec = { n: name ?? undefined, g: gc };
    if (attrs.ccc) rec.c = attrs.ccc;
    if (attrs.bidi) rec.bd = attrs.bidi;
    if (attrs.dec) rec.dc = attrs.dec;
    if (attrs.numDec) rec.nd = attrs.numDec;
    if (attrs.numDig) rec.ng = attrs.numDig;
    if (attrs.numVal) rec.nv = attrs.numVal;
    if (attrs.mirrored) rec.mi = 1;
    if (attrs.u1) rec.u1 = attrs.u1;
    if (attrs.iso) rec.iso = attrs.iso;
    if (attrs.up) rec.up = attrs.up;
    if (attrs.lw) rec.lw = attrs.lw;
    if (attrs.ti) rec.ti = attrs.ti;
    if (block) rec.bl = block;
    if (script) rec.sc = script;
    if (scriptExt && scriptExt.length) rec.sx = scriptExt;
    if (age) rec.ag = age;
    if (eaw) rec.ea = eaw;
    if (lineBreak) rec.lb = lineBreak;
    if (aliases?.length) rec.al = aliases.map((a) => ({ t: a.alias, y: a.type }));
    if (caseFolding.has(cp)) {
      const cf = caseFolding.get(cp);
      rec.cf = {};
      if (cf.common) rec.cf.c = cf.common.map((c) => hex(c));
      if (cf.simple) rec.cf.s = cf.simple.map((c) => hex(c));
      if (cf.full) rec.cf.f = cf.full.map((c) => hex(c));
      if (cf.turkic) rec.cf.t = cf.turkic.map((c) => hex(c));
    }
    if (specialCasing.has(cp)) {
      const sc = specialCasing.get(cp);
      rec.scc = {
        l: sc.lower.map((c) => hex(c)),
        t: sc.title.map((c) => hex(c)),
        u: sc.upper.map((c) => hex(c)),
        ...(sc.condition ? { cond: sc.condition } : {}),
      };
    }
    const nl = namesList.get(cp);
    if (nl) {
      const box = {};
      if (nl.aliases.length) box.a = nl.aliases;
      if (nl.notes.length) box.no = nl.notes;
      if (nl.crossRefs.length) box.x = nl.crossRefs.map((r) => ({ n: r.name, c: r.cp }));
      if (nl.variants.length) box.v = nl.variants.map((v) => ({ q: v.seq.map((c) => hex(c)).join(' '), d: v.desc }));
      if (Object.keys(box).length) rec.nl = box;
    }
    if (variantMap.has(cp)) rec.vs = variantMap.get(cp);
    // 分解映射 = 同一基本字符的另一种写法。只收「一对一」的映射：
    //   带标签的（阿拉伯文 isolated/final/initial/medial、全角半角、圆圈方块、上下标…）
    //   以及不带标签的规范等价（CJK 兼容字 F900→8C48、Å→Å 这类）。
    // 多码点的分解是连字（ligature）或组合序列，不是「同一个字的另一种形态」，排除。
    if (attrs.dec) {
      const m = /^(?:<([a-z]+)>\s+)?([0-9A-Fa-f ]+)$/.exec(String(attrs.dec).trim());
      if (m) {
        const bases = m[2].trim().split(/\s+/);
        const base = parseInt(bases[0], 16);
        if (bases.length === 1 && Number.isFinite(base) && base !== cp) {
          (formsByBase[base] ||= []).push({ cp, tag: m[1] || 'canon' });
        }
      }
    }
    if (unihan.has(cp)) rec.uh = unihan.get(cp);
    const zh = cldrLookup(cldrMap, cp);
    if (zh) rec.cl = { ...(zh.tts ? { t: zh.tts } : {}), ...(zh.keywords.length ? { k: zh.keywords } : {}) };
    const en = cldrLookup(cldrEnMap, cp);
    if (en && !rec.cl?.t) rec.cle = { ...(en.tts ? { t: en.tts } : {}), ...(en.keywords.length ? { k: en.keywords } : {}) };

    chars[cp] = rec;
    assigned++;
    bump(catCount, gc);
    bump(scriptCount, script);
    bump(ageCount, age);
    bump(blockCount, block);
    if (onProgress && assigned % 20000 === 0) onProgress(assigned);
  };

  for (const [cp, r] of ud.chars) {
    makeEntry(cp, r.name, null, {
      gc: r.gc, ccc: r.ccc, bidi: r.bidi, dec: r.dec, numDec: r.numDec, numDig: r.numDig,
      numVal: r.numVal, mirrored: r.mirrored, u1: r.u1, iso: r.iso,
      up: r.upper, lw: r.lower, ti: r.title,
    });
  }

  for (const rg of ud.ranges) {
    for (let cp = rg.first; cp <= rg.last; cp++) {
      makeEntry(cp, null, rg.base, { gc: rg.gc, ccc: rg.ccc, bidi: rg.bidi, mirrored: rg.mirrored });
    }
  }

  // 块统计（已分配数来自逐字符计数，避免 O(字符 × 块) 的重复遍历）
  const blockStats = blocks.map((b) => ({
    id: b.id,
    first: b.first,
    last: b.last,
    count: blockCount[b.id] || 0,
  }));

  // 未分配区间（Cn）：从 0..10FFFF 扣掉已分配
  const assignedList = Object.keys(chars).map(Number).sort((a, b) => a - b);
  const unassigned = [];
  let cursor = 0;
  for (const cp of assignedList) {
    if (cp > cursor) unassigned.push([cursor, cp - 1]);
    cursor = cp + 1;
  }
  if (cursor <= 0x10ffff) unassigned.push([cursor, 0x10ffff]);

  const scripts = [...new Set(scriptIdx.list.map((p) => p.value))].sort();
  const ages = [...new Set(ageIdx.list.map((p) => p.value))].sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return pa[0] - pb[0] || (pa[1] || 0) - (pb[1] || 0);
  });

  return {
    version,
    builtAt: new Date().toISOString(),
    buildMs: Date.now() - t0,
    counts: {
      assigned,
      blocks: blocks.length,
      unassignedRanges: unassigned.length,
      withNamesList: namesList.size,
      withUnihan: unihan.size,
      withVariants: variantMap.size,
      withCldrZh: cldrMap.size,
      withAliases: nameAliases.size,
      unihanFields: unihanEntries ? unihanEntries.length : 0,
    },
    sources: Object.keys(raw),
    blocks: blockStats,
    categories: catCount,
    scripts: scriptCount,
    ages: ageCount,
    scriptList: scripts,
    ageList: ages,
    unassigned,
    forms: formsByBase,
    chars,
  };
}

export { hex };
