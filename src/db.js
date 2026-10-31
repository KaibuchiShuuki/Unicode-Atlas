import { GC_GROUPS, GC_NAMES, BIDI_NAMES, EAW_NAMES, DECOMP_TYPE_NAMES, PLANES, CONTROL_ABBREV, ALIAS_TYPE_NAMES } from './constants.js';
import { hex } from './parsers.js';

const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff;
const isPua = (cp) => (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd);

export function charStr(cp) {
  if (isSurrogate(cp)) return '\\u' + cp.toString(16).toUpperCase().padStart(4, '0');
  return String.fromCodePoint(cp);
}

/** 拆解分解映射 `<compat> 0044 017D` */
function parseDecomp(str) {
  if (!str) return null;
  const m = /^<([^>]+)>\s*(.*)$/.exec(str);
  const rest = (m ? m[2] : str).trim();
  const cps = rest.split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16));
  return { type: m ? m[1] : 'canonical', cps };
}

export class CharDB {
  constructor(index) {
    this.index = index;
    this.chars = index.chars;
    this.cps = Object.keys(index.chars).map(Number).sort((a, b) => a - b);
    this.blockById = new Map(index.blocks.map((b) => [b.id, b]));
    this.forms = index.forms || {};
    this.baseOf = new Map();
    for (const [base, list] of Object.entries(this.forms)) {
      for (const f of list) this.baseOf.set(f.cp, Number(base));
    }
    this.searchCache = new Map();
    this._searchIndex = null;
  }

  get size() { return this.cps.length; }

  get(cp) { return this.chars[cp] || null; }

  /** 逐字符的搜索文本（首搜时构建一次，约 160k 条） */
  ensureSearchIndex() {
    if (this._searchIndex) return this._searchIndex;
    const arr = new Array(this.cps.length);
    for (let i = 0; i < this.cps.length; i++) {
      const cp = this.cps[i];
      const r = this.chars[cp];
      let s = (r.n || '') + ' ' + hex(cp);
      if (r.al) s += ' ' + r.al.map((a) => a.t).join(' ');
      if (r.nl?.a) s += ' ' + r.nl.a.join(' ');
      if (r.nl?.no) s += ' ' + r.nl.no.join(' ');
      if (r.uh) {
        if (r.uh.kDefinition) s += ' ' + r.uh.kDefinition;
        if (r.uh.kMandarin) s += ' ' + r.uh.kMandarin;
      }
      if (r.cl?.t) s += ' ' + r.cl.t;
      if (r.cl?.k) s += ' ' + r.cl.k.join(' ');
      arr[i] = s.toLowerCase();
    }
    this._searchIndex = arr;
    return arr;
  }

  /** 块视图 / 分类视图共用的过滤器 */
  _match(cp, r, f) {
    if (f.block && r?.bl !== f.block) return false;
    if (f.gc) {
      if (f.gc.length === 1) { if (r?.g?.[0] !== f.gc) return false; }
      else if (r?.g !== f.gc) return false;
    }
    if (f.script && r?.sc !== f.script) return false;
    if (f.age && r?.ag !== f.age) return false;
    if (f.plane !== undefined && f.plane !== null) {
      const p = PLANES.find((x) => x.id === f.plane);
      if (!p || cp < p.first || cp > p.last) return false;
    }
    return true;
  }

  /**
   * @param {object} f block/gc/script/age/plane/from/to/includeUnassigned/offset/limit/order
   */
  list(f = {}) {
    const limit = Math.min(f.limit ?? 120, 2000);
    const offset = Math.max(f.offset ?? 0, 0);
    const out = [];
    let total = 0;

    const push = (cp, r) => {
      total++;
      if (total > offset && out.length < limit) out.push(this._row(cp, r));
    };

    if (f.block && !f.gc && !f.script && !f.age && f.plane === undefined) {
      const b = this.blockById.get(f.block);
      if (!b) return { total: 0, offset, limit, items: [] };
      const from = Math.max(b.first, f.from ?? 0);
      const to = Math.min(b.last, f.to ?? 0x10ffff);
      for (let cp = from; cp <= to; cp++) {
        const r = this.chars[cp];
        if (!r) {
          if (f.includeUnassigned) push(cp, null);
          continue;
        }
        push(cp, r);
      }
      return { total, offset, limit, items: out };
    }

    const src = this.cps;
    for (let i = 0; i < src.length; i++) {
      const cp = src[i];
      if (f.from && cp < f.from) continue;
      if (f.to && cp > f.to) break;
      const r = this.chars[cp];
      if (!this._match(cp, r, f)) continue;
      push(cp, r);
    }
    return { total, offset, limit, items: out };
  }

  _row(cp, r) {
    const row = {
      cp,
      c: charStr(cp),
      cpHex: hex(cp),
      n: r?.n ?? null,
      g: r?.g ?? 'Cn',
      bl: r?.bl ?? null,
      ag: r?.ag ?? null,
    };
    if (r?.cl?.t) row.zh = r.cl.t;
    if (r?.uh?.kDefinition) row.def = String(r.uh.kDefinition).split(';')[0].trim();
    if (r?.uh?.kMandarin) row.py = String(r.uh.kMandarin).split(' ')[0];
    return row;
  }

  /** 搜索：码点 / 单字符 / 名称与所有文本字段 */
  search(query, opts = {}) {
    const q = String(query || '').trim();
    const limit = Math.min(opts.limit ?? 120, 2000);
    const offset = Math.max(opts.offset ?? 0, 0);
    if (!q) return { total: 0, offset, limit, items: [], mode: 'empty' };

    // 1) 码点：U+4E2D / 0x4E2D / 纯十六进制 4-6 位
    const cpMatch = /^(?:u\+|0x|\\u\{?)?([0-9a-f]{4,6})\}?$/i.exec(q);
    if (cpMatch) {
      const cp = parseInt(cpMatch[1], 16);
      if (cp <= 0x10ffff) {
        const r = this.chars[cp];
        if (r && this._match(cp, r, opts)) return { total: 1, offset, limit, items: [this._row(cp, r)], mode: 'codepoint' };
        return { total: 0, offset, limit, items: [], mode: 'codepoint' };
      }
    }

    // 2) 单个字符（含 emoji 单码点）：自身命中排最前，但不独占结果
    let selfHit = null;
    if ([...q].length === 1) {
      const cp = q.codePointAt(0);
      const r = this.chars[cp];
      if (r && this._match(cp, r, opts)) selfHit = { cp, score: 5000 };
    }

    // 3) 文本搜索
    const needle = q.toLowerCase();
    const idx = this.ensureSearchIndex();
    const hits = [];
    for (let i = 0; i < this.cps.length; i++) {
      if (!idx[i].includes(needle)) continue;
      const cp = this.cps[i];
      if (selfHit && cp === selfHit.cp) continue;
      const r = this.chars[cp];
      if (!this._match(cp, r, opts)) continue;
      const name = (r.n || '').toLowerCase();
      let score = 100;
      if (name === needle) score = 1000;
      else if (name.startsWith(needle)) score = 600;
      else if (name.includes(needle)) score = 400;
      else if (hex(cp).toLowerCase().startsWith(needle)) score = 700;
      hits.push({ cp, score });
    }
    if (selfHit) hits.push(selfHit);
    hits.sort((a, b) => b.score - a.score || a.cp - b.cp);
    const slice = hits.slice(offset, offset + limit).map((h) => this._row(h.cp, this.chars[h.cp]));
    return { total: hits.length, offset, limit, items: slice, mode: 'text' };
  }

  /** 完整详情 */
  detail(cp) {
    if (cp < 0 || cp > 0x10ffff) return null;
    const r = this.chars[cp];
    const block = r?.bl ? this.blockById.get(r.bl) : null;
    const char = charStr(cp);

    const base = {
      cp,
      hex: hex(cp),
      dec: cp,
      char,
      name: r?.n ?? null,
      assigned: !!r,
      gc: r?.g ?? 'Cn',
      gcName: GC_NAMES[r?.g ?? 'Cn'],
      block: block ? { id: block.id, first: block.first, last: block.last } : null,
      script: r?.sc ?? null,
      scriptExt: r?.sx ?? null,
      age: r?.ag ?? null,
      plane: PLANES.find((p) => cp >= p.first && cp <= p.last)?.label ?? null,
      utf8: isSurrogate(cp) ? null : [...Buffer.from(char, 'utf8')].map((b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0')),
      utf16: char.split('').map((ch) => '0x' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')),
      surrogate: isSurrogate(cp),
      pua: isPua(cp),
      controlAbbrev: CONTROL_ABBREV[cp] ?? null,
    };

    if (!r) return base;

    const seqToString = (arr) => (arr || []).map((h) => {
      const n = parseInt(h, 16);
      return String.fromCodePoint(n);
    }).join('');

    return {
      ...base,
      ccc: r.c ?? 0,
      bidi: r.bd ?? 'L',
      bidiName: BIDI_NAMES[r.bd ?? 'L'],
      decomposition: (() => {
        const d = parseDecomp(r.dc);
        if (!d) return null;
        return {
          type: d.type,
          typeName: DECOMP_TYPE_NAMES[d.type] || d.type,
          raw: r.dc,
          cps: d.cps.map((c) => ({ cp: c, hex: hex(c), char: charStr(c), name: this.chars[c]?.n ?? null })),
          string: d.cps.map((c) => charStr(c)).join(''),
        };
      })(),
      numeric: r.nd || r.ng || r.nv
        ? { decimal: r.nd ?? null, digit: r.ng ?? null, value: r.nv ?? null }
        : null,
      mirrored: !!r.mi,
      unicode1Name: r.u1 ?? null,
      isoComment: r.iso ?? null,
      upper: r.up ? { hex: r.up, char: charStr(parseInt(r.up, 16)), name: this.chars[parseInt(r.up, 16)]?.n ?? null } : null,
      lower: r.lw ? { hex: r.lw, char: charStr(parseInt(r.lw, 16)), name: this.chars[parseInt(r.lw, 16)]?.n ?? null } : null,
      title: r.ti ? { hex: r.ti, char: charStr(parseInt(r.ti, 16)), name: this.chars[parseInt(r.ti, 16)]?.n ?? null } : null,
      caseFolding: r.cf ? {
        common: seqToString(r.cf.c),
        simple: seqToString(r.cf.s),
        full: seqToString(r.cf.f),
        turkic: seqToString(r.cf.t),
      } : null,
      specialCasing: r.scc ? {
        lower: seqToString(r.scc.l),
        title: seqToString(r.scc.t),
        upper: seqToString(r.scc.u),
        condition: r.scc.cond ?? null,
      } : null,
      eaw: r.ea ?? null,
      eawName: EAW_NAMES[r.ea] ?? null,
      lineBreak: r.lb ?? null,
      aliases: (r.al || []).map((a) => ({ text: a.t, type: a.y, typeName: ALIAS_TYPE_NAMES[a.y] || a.y })),
      namesList: r.nl ? {
        aliases: r.nl.a || [],
        notes: r.nl.no || [],
        crossRefs: (r.nl.x || []).map((x) => ({ name: x.n, cp: x.c, hex: hex(x.c), char: charStr(x.c) })),
        variants: r.nl.v || [],
      } : null,
      variantSequences: (r.vs || []).map((v) => ({
        kind: v.k,
        hex: v.q,
        chars: v.q.split(' ').map((h) => charStr(parseInt(h, 16))).join(''),
        desc: v.d,
      })),
      forms: (this.forms?.[cp] || []).map((f) => ({
        cp: f.cp, hex: hex(f.cp), char: charStr(f.cp), tag: f.tag, name: this.chars[f.cp]?.n ?? null,
      })),
      baseCp: this.baseOf?.get(cp) ?? null,
      unihan: r.uh ? {
        definition: r.uh.kDefinition ?? null,
        mandarin: r.uh.kMandarin ?? null,
        cantonese: r.uh.kCantonese ?? null,
        japaneseOn: r.uh.kJapaneseOn ?? null,
        japaneseKun: r.uh.kJapaneseKun ?? null,
        korean: r.uh.kKorean ?? null,
        hangul: r.uh.kHangul ?? null,
        vietnamese: r.uh.kVietnamese ?? null,
        totalStrokes: r.uh.kTotalStrokes ?? null,
        radicalStroke: r.uh.kRSUnicode ?? null,
        simplifiedVariant: r.uh.kSimplifiedVariant ?? null,
        traditionalVariant: r.uh.kTraditionalVariant ?? null,
        compatibilityVariant: r.uh.kCompatibilityVariant ?? null,
        semanticVariant: r.uh.kSemanticVariant ?? null,
        zVariant: r.uh.kZVariant ?? null,
        frequency: r.uh.kFrequency ?? null,
        gradeLevel: r.uh.kGradeLevel ?? null,
      } : null,
      cldr: {
        zh: r.cl?.t ?? null,
        zhKeywords: r.cl?.k ?? [],
        en: r.cle?.t ?? null,
        enKeywords: r.cle?.k ?? [],
      },
    };
  }

  /** 侧栏用的分组骨架 */
  meta() {
    const idx = this.index;
    return {
      version: idx.version,
      builtAt: idx.builtAt,
      counts: idx.counts,
      categories: Object.fromEntries(
        Object.entries(GC_GROUPS).map(([k, v]) => [k, {
          label: v.label,
          total: v.gcs.reduce((s, gc) => s + (idx.categories[gc] || 0), 0),
          gcs: v.gcs.map((gc) => ({ gc, name: GC_NAMES[gc], count: idx.categories[gc] || 0 })),
        }])
      ),
      blocks: idx.blocks,
      scripts: Object.entries(idx.scripts).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count })),
      ages: idx.ageList.map((a) => ({ id: a, count: idx.ages[a] || 0 })),
      planes: PLANES.map((p) => ({
        ...p,
        count: this.cps.filter((cp) => cp >= p.first && cp <= p.last).length,
      })),
    };
  }
}
