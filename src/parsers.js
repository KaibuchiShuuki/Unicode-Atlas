/**
 * UCD 纯文本解析器集合。
 * 所有函数都接受文件全文（string），返回纯数据结构。
 * 设计原则：不猜格式，严格按实测到的字段位置解析；缺文件时返回空结构而不是抛错。
 */

export const hex = (cp, pad = 4) => cp.toString(16).toUpperCase().padStart(pad, '0');

/** 逐行迭代，剥掉 # 注释与空行 */
function* eachLine(text) {
  for (const raw of text.split(/\r?\n/)) {
    const hash = raw.indexOf('#');
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (line) yield line;
  }
}

function parseRange(str) {
  const m = /^([0-9A-Fa-f]{1,6})(?:\.\.([0-9A-Fa-f]{1,6}))?$/.exec(str.trim());
  if (!m) return null;
  const first = parseInt(m[1], 16);
  const last = m[2] ? parseInt(m[2], 16) : first;
  return first <= last ? { first, last } : null;
}

/* ─────────────────────────── UnicodeData.txt ─────────────────────────── */

/**
 * 15 列（实测 v18）：0 CP 1 Name 2 GC 3 CCC 4 Bidi 5 Decomp 6 NumDec 7 NumDig
 * 8 NumVal 9 BidiMirrored 10 Unicode1Name 11 ISOComment 12 Upper 13 Lower 14 Title
 * First/Last 区间不展开（交给 DerivedName 或规则生成），单独返回。
 */
export function parseUnicodeData(text) {
  const chars = new Map();
  const ranges = [];
  let pending = null;

  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue;
    const f = raw.split(';');
    if (f.length < 15) continue;
    const cp = parseInt(f[0], 16);
    if (Number.isNaN(cp)) continue;

    const name = f[1];
    const firstM = /^<(.*),\s*First>$/.exec(name);
    const lastM = /^<(.*),\s*Last>$/.exec(name);
    if (firstM) {
      pending = {
        base: firstM[1],
        first: cp,
        gc: f[2],
        ccc: f[3] && f[3] !== '0' ? Number(f[3]) : undefined,
        bidi: f[4] !== 'L' ? f[4] : undefined,
        mirrored: f[9] === 'Y' ? true : undefined,
      };
      continue;
    }
    if (lastM && pending) {
      ranges.push({ ...pending, last: cp });
      pending = null;
      continue;
    }

    chars.set(cp, {
      name,
      gc: f[2],
      ccc: f[3] && f[3] !== '0' ? Number(f[3]) : undefined,
      bidi: f[4] !== 'L' ? f[4] : undefined,
      dec: f[5] || undefined,
      numDec: f[6] || undefined,
      numDig: f[7] || undefined,
      numVal: f[8] || undefined,
      mirrored: f[9] === 'Y' ? true : undefined,
      u1: f[10] || undefined,
      iso: f[11] || undefined,
      upper: f[12] || undefined,
      lower: f[13] || undefined,
      title: f[14] || undefined,
    });
  }
  return { chars, ranges };
}

/**
 * 区间基名 → 名字生成规则（DerivedName.txt 缺失时的兜底）。
 * SMALL SEAL CHARACTER 这个反直觉的写法来自 extracted/DerivedName.txt 实测。
 */
const RANGE_RULES = [
  { re: /CJK Ideograph/i, prefix: 'CJK UNIFIED IDEOGRAPH-' },
  { re: /Tangut Ideograph/i, prefix: 'TANGUT IDEOGRAPH-' },
  { re: /Jurchen Character/i, prefix: 'JURCHEN CHARACTER-' },
  { re: /(Small )?Seal Character/i, prefix: 'SMALL SEAL CHARACTER-' },
  { re: /Khitan/i, prefix: 'KHITAN SMALL SCRIPT CHARACTER-' },
  { re: /Nushu/i, prefix: 'NUSHU CHARACTER-' },
  { re: /Hangul Syllable/i, prefix: 'HANGUL SYLLABLE ' },
  { re: /Surrogate|Private Use/i, prefix: null },
];

const HANGUL_L = ['G', 'GG', 'N', 'D', 'DD', 'R', 'M', 'B', 'BB', 'S', 'SS', '', 'J', 'JJ', 'C', 'K', 'T', 'P', 'H'];
const HANGUL_V = ['A', 'AE', 'YA', 'YAE', 'EO', 'E', 'YEO', 'YE', 'O', 'WA', 'WAE', 'OE', 'YO', 'U', 'WEO', 'WE', 'WI', 'YU', 'EU', 'YI', 'I'];
const HANGUL_T = ['', 'G', 'GG', 'GS', 'N', 'NJ', 'NH', 'D', 'L', 'LG', 'LM', 'LB', 'LS', 'LT', 'LP', 'LH', 'M', 'B', 'BS', 'S', 'SS', 'NG', 'J', 'C', 'K', 'T', 'P', 'H'];

export function hangulName(cp) {
  const s = cp - 0xac00;
  if (s < 0 || s > 11171) return null;
  const l = Math.floor(s / 588);
  const v = Math.floor((s % 588) / 28);
  const t = s % 28;
  return `HANGUL SYLLABLE ${HANGUL_L[l]}${HANGUL_V[v]}${HANGUL_T[t]}`;
}

/** 按区间基名生成算法名；PUA/代理区返回 null（它们没有正式名） */
export function algorithmicName(base, cp) {
  for (const rule of RANGE_RULES) {
    if (!rule.re.test(base)) continue;
    if (rule.prefix === null) return null;
    if (rule.prefix === 'HANGUL SYLLABLE ') return hangulName(cp);
    return rule.prefix + hex(cp);
  }
  return `${base.toUpperCase()}-${hex(cp)}`;
}

/* ─────────────────────────── Blocks.txt ─────────────────────────── */

/**
 * 0000..007F; Basic Latin
 * 老版本(3.x)可能没有 Blocks.txt，返回空数组。
 */
export function parseBlocks(text) {
  const out = [];
  for (const line of eachLine(text)) {
    const parts = line.split(';');
    if (parts.length < 2) continue;
    const r = parseRange(parts[0]);
    if (!r) continue;
    out.push({ id: parts[1].trim(), first: r.first, last: r.last });
  }
  out.sort((a, b) => a.first - b.first);
  // 补齐：同名块重复出现时合并
  const merged = [];
  for (const b of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.id === b.id && b.first <= prev.last + 1) prev.last = Math.max(prev.last, b.last);
    else merged.push({ ...b });
  }
  return merged;
}

/* ─────────────────────── 通用「区间 ; 值」文件 ─────────────────────── */

/**
 * Scripts.txt / EastAsianWidth.txt / LineBreak.txt 等：
 *   0041..005A ; Latin # ...
 *   0041       ; Latin
 */
export function parseIntervalFile(text, { allowMultiValue = false } = {}) {
  const out = [];
  for (const line of eachLine(text)) {
    const parts = line.split(';');
    if (parts.length < 2) continue;
    const r = parseRange(parts[0]);
    if (!r) continue;
    const raw = parts[1].trim();
    const value = allowMultiValue ? raw.split(/\s+/).filter(Boolean) : raw;
    if (Array.isArray(value) && value.length === 0) continue;
    out.push({ ...r, value });
  }
  return out;
}

/**
 * DerivedAge.txt 实际格式：`0000..001F    ; 1.1 #  [32] <control-0000>..`
 * （早期草案里写作 `1.1: 0020..007E`，两种都兼容）
 */
export function parseDerivedAge(text) {
  const out = [];
  for (const line of eachLine(text)) {
    const legacy = /^([0-9]+\.[0-9]+)\s*:\s*(.+)$/.exec(line);
    if (legacy) {
      const r = parseRange(legacy[2]);
      if (r) out.push({ ...r, value: legacy[1] });
      continue;
    }
    const parts = line.split(';');
    if (parts.length < 2) continue;
    const r = parseRange(parts[0]);
    if (!r) continue;
    const m = /^\s*([0-9]+\.[0-9]+)/.exec(parts[1]);
    if (!m) continue;
    out.push({ ...r, value: m[1] });
  }
  return out;
}

/**
 * PropList.txt / DerivedCoreProperties.txt：多属性。
 * 返回 Map<propName, [{first,last}]>
 */
export function parsePropertyFile(text) {
  const map = new Map();
  for (const line of eachLine(text)) {
    const parts = line.split(';');
    if (parts.length < 2) continue;
    const r = parseRange(parts[0]);
    if (!r) continue;
    const prop = parts[1].trim();
    if (!map.has(prop)) map.set(prop, []);
    map.get(prop).push(r);
  }
  return map;
}

/* ─────────────────────── NameAliases.txt ─────────────────────── */

/** 0000; NULL; control */
export function parseNameAliases(text) {
  const map = new Map();
  for (const line of eachLine(text)) {
    const parts = line.split(';');
    if (parts.length < 3) continue;
    const cp = parseInt(parts[0], 16);
    if (Number.isNaN(cp)) continue;
    if (!map.has(cp)) map.set(cp, []);
    map.get(cp).push({ alias: parts[1].trim(), type: parts[2].trim() });
  }
  return map;
}

/* ─────────────────────── CaseFolding.txt ─────────────────────── */

/** 0041; C; 0061;  →  Map<cp, { status, mapping: number[] }> */
export function parseCaseFolding(text) {
  const map = new Map();
  for (const line of eachLine(text)) {
    const parts = line.split(';');
    if (parts.length < 3) continue;
    const cp = parseInt(parts[0], 16);
    if (Number.isNaN(cp)) continue;
    const status = parts[1].trim();
    const mapping = parts[2].trim().split(/\s+/).map((h) => parseInt(h, 16)).filter((n) => !Number.isNaN(n));
    if (!mapping.length) continue;
    const cur = map.get(cp) || {};
    if (status === 'T') cur.turkic = mapping;
    else if (status === 'F') cur.full = mapping;
    else if (status === 'S') cur.simple = mapping;
    else if (status === 'C') cur.common = mapping;
    map.set(cp, cur);
  }
  return map;
}

/* ─────────────────────── SpecialCasing.txt ─────────────────────── */

/** 00DF; 00DF; 0053 0073; 0053 0053;  或带条件 0049; 0131; 0069; 0069; 0069 0130 0130; tr */
export function parseSpecialCasing(text) {
  const map = new Map();
  for (const line of eachLine(text)) {
    const parts = line.split(';');
    if (parts.length < 4) continue;
    const cp = parseInt(parts[0].trim(), 16);
    if (Number.isNaN(cp)) continue;
    const toSeq = (s) => s.trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16)).filter((n) => !Number.isNaN(n));
    map.set(cp, {
      lower: toSeq(parts[1]),
      title: toSeq(parts[2]),
      upper: toSeq(parts[3]),
      condition: parts[4]?.replace(/#.*/, '').trim() || undefined,
    });
  }
  return map;
}

/* ─────────────────────── NamesList.txt ─────────────────────── */

/**
 * 格式：
 *   2205<TAB>EMPTY SET
 *   <TAB>= null set                等价名
 *   <TAB>* used in linguistics ... 说明
 *   <TAB>x (name - 00D8)           交叉引用
 *   <TAB>~ 2205 FE00 desc          变体说明
 *   @@ / @ / $ / ;                 块指令与块注释（不属于任何单字符）
 */
export function parseNamesList(text) {
  const map = new Map();
  let cur = null;

  for (const raw of text.split(/\r?\n/)) {
    if (!raw) continue;
    const c0 = raw[0];

    if (c0 === '@' || c0 === '$' || c0 === ';') {
      cur = null; // 块级内容，终止当前字符的附属行
      continue;
    }
    if (c0 === '#') continue;

    if (c0 === '\t') {
      if (!cur) continue;
      const body = raw.slice(1);
      if (body.startsWith('=')) {
        cur.aliases.push(body.slice(1).trim());
      } else if (body.startsWith('*')) {
        cur.notes.push(body.slice(1).trim());
      } else if (body.startsWith('x ')) {
        const m = /^x\s+\((.*?)\s*-\s*([0-9A-Fa-f]{4,6})\)\s*$/.exec(body);
        if (m) cur.crossRefs.push({ name: m[1], cp: parseInt(m[2], 16) });
      } else if (body.startsWith('~')) {
        const m = /^~\s*((?:[0-9A-Fa-f]{4,6}\s*)+)(.*)$/.exec(body);
        if (m) {
          const seq = m[1].trim().split(/\s+/).map((h) => parseInt(h, 16));
          const desc = m[2].trim();
          const last = cur.variants[cur.variants.length - 1];
          if (!last || last.desc !== desc) cur.variants.push({ seq, desc });
        }
      }
      continue;
    }

    const m = /^([0-9A-Fa-f]{4,6})\t(.*)$/.exec(raw);
    if (m) {
      cur = { cp: parseInt(m[1], 16), name: m[2].trim(), aliases: [], notes: [], crossRefs: [], variants: [] };
      map.set(cur.cp, cur);
    }
  }
  return map;
}

/* ─────────────────── StandardizedVariants.txt ─────────────────── */

/** 2205 FE00; zero with long diagonal stroke overlay form; # EMPTY SET */
export function parseStandardizedVariants(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.startsWith('#')) continue;
    const hash = raw.indexOf('#');
    const comment = hash >= 0 ? raw.slice(hash + 1).trim() : '';
    const body = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (!body) continue;
    const parts = body.split(';');
    if (parts.length < 2) continue;

    const seq = [];
    let ok = true;
    for (const tok of parts[0].trim().split(/\s+/)) {
      const r = parseRange(tok);
      if (!r) { ok = false; break; }
      for (let c = r.first; c <= r.last; c++) seq.push(c);
    }
    if (!ok || seq.length < 2) continue;

    out.push({
      seq,
      desc: parts[1].trim(),
      context: parts[2]?.trim() || '',
      comment,
    });
  }
  return out;
}

/* ─────────────── emoji/emoji-variation-sequences.txt ─────────────── */

/** 0023 FE0E ; text style; # (1.1) NUMBER SIGN */
export function parseEmojiVariationSequences(text) {
  const out = [];
  for (const line of eachLine(text)) {
    const parts = line.split(';');
    if (parts.length < 2) continue;
    const seq = parts[0].trim().split(/\s+/).map((h) => parseInt(h, 16)).filter((n) => !Number.isNaN(n));
    if (seq.length < 2) continue;
    const style = parts[1].trim();
    out.push({ seq, style, desc: style === 'text style' ? '文字样式 text style' : style === 'emoji style' ? 'Emoji 样式 emoji style' : style });
  }
  return out;
}

/* ─────────────── emoji/emoji-data.txt（属性区间） ─────────────── */

export function parseEmojiData(text) {
  return parsePropertyFile(text);
}

/* ─────────────── extracted/DerivedName.txt ─────────────── */

/**
 * 权威名字表（含算法生成名）：
 *   4E00..9FFF    ; CJK UNIFIED IDEOGRAPH-*
 *   AC00          ; HANGUL SYLLABLE GA
 *   末尾 -* 表示用大写十六进制替换。PUA/代理区不出现。
 */
export function parseDerivedName(text) {
  const exact = new Map();
  const wildcard = []; // { first, last, prefix }

  for (const line of eachLine(text)) {
    const parts = line.split(';');
    if (parts.length < 2) continue;
    const r = parseRange(parts[0]);
    if (!r) continue;
    let name = parts[1].trim();
    if (!name) continue;

    if (name.endsWith('-*')) {
      wildcard.push({ first: r.first, last: r.last, prefix: name.slice(0, -1) });
    } else if (name.includes('*')) {
      wildcard.push({ first: r.first, last: r.last, prefix: name.replace(/\*.*/, '') });
    } else if (r.first === r.last) {
      exact.set(r.first, name);
    } else {
      // 区间但给的是具体名（极少见），逐个填充
      for (let c = r.first; c <= r.last; c++) exact.set(c, name);
    }
  }
  wildcard.sort((a, b) => a.first - b.first);
  return { exact, wildcard };
}

export function lookupDerivedName(derived, cp) {
  const ex = derived.exact.get(cp);
  if (ex) return ex;
  let lo = 0;
  let hi = derived.wildcard.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = derived.wildcard[mid];
    if (cp < w.first) hi = mid - 1;
    else if (cp > w.last) lo = mid + 1;
    else return w.prefix + hex(cp);
  }
  return null;
}

/* ─────────────────────── Unihan.zip ─────────────────────── */

/** 只保留这些字段（其余对百科全书无用且体积巨大） */
const UNIHAN_KEEP = new Set([
  'kDefinition', 'kMandarin', 'kCantonese', 'kJapaneseOn', 'kJapaneseKun', 'kKorean',
  'kHangul', 'kVietnamese', 'kTotalStrokes', 'kRSUnicode', 'kSimplifiedVariant',
  'kTraditionalVariant', 'kCompatibilityVariant', 'kSemanticVariant', 'kZVariant',
  'kSpecializedSemanticVariant', 'kFrequency', 'kGradeLevel',
]);

/**
 * @param {Array<{name:string, data:Buffer}>} entries  zip 内文件
 * @returns {Map<number, Record<string,string>>}
 */
export function parseUnihan(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!/\.txt$/i.test(entry.name)) continue;
    const text = entry.data.toString('utf8');
    for (const raw of text.split(/\r?\n/)) {
      if (!raw || raw[0] === '#') continue;
      const parts = raw.split('\t');
      if (parts.length < 3) continue;
      const m = /^U\+([0-9A-Fa-f]{4,6})$/.exec(parts[0]);
      if (!m) continue;
      const field = parts[1].trim();
      if (!UNIHAN_KEEP.has(field)) continue;
      const cp = parseInt(m[1], 16);
      const value = parts.slice(2).join('\t').trim();
      if (!value) continue;
      let rec = map.get(cp);
      if (!rec) { rec = {}; map.set(cp, rec); }
      rec[field] = value;
    }
  }
  return map;
}

/* ─────────────────────── CLDR annotations ─────────────────────── */

/**
 * cldr-annotations-full/annotations/<locale>/annotations.json
 * 实测结构：{ "annotations": { "identity": {"language":"zh"},
 *                              "annotations": { "❤": {"default":[...], "tts":[...]}, ... } } }
 * 键是字符本身（可能是多码点序列、修饰符、变体选择符），值含 default（关键词）与 tts（名称）。
 * @returns Map<string(hex序列), { tts: string, keywords: string[] }>
 */
export function parseCldrAnnotations(json) {
  const map = new Map();
  const root = json?.annotations?.annotations ?? json?.annotations ?? json;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return map;

  const keyOf = (s) => [...s].map((ch) => hex(ch.codePointAt(0))).join('-');
  const splitList = (v) => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === 'string') return v.split('|').map((x) => x.trim()).filter(Boolean);
    return [];
  };

  for (const [char, val] of Object.entries(root)) {
    if (!char || val === null || val === undefined) continue;
    if (char === 'identity' || char.length > 64) continue;
    let keywords = [];
    let tts = '';
    if (typeof val === 'string') {
      keywords = splitList(val);
    } else if (typeof val === 'object') {
      keywords = splitList(val.default);
      tts = splitList(val.tts).join(' ');
      if (!tts && keywords.length) tts = keywords[0];
    }
    if (!keywords.length && !tts) continue;
    map.set(keyOf(char), { tts, keywords });
  }
  return map;
}

/* ─────────────────────── 版本头嗅探 ─────────────────────── */

/** 从任意 UCD 文件头部拿版本号（`# Blocks-18.0.0.txt`） */
export function sniffVersion(text) {
  const m = /^#\s*(?:[\w-]+-)?(\d+\.\d+\.\d+)\.txt/m.exec(text.slice(0, 2000));
  return m ? m[1] : null;
}
