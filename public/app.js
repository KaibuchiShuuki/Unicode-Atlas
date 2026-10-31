/* Unicode-Atlas — 前端 */
import { zhBlock, zhScript, zhGc, zhGcGroup, PLANE_ZH_SHORT } from './names-zh.js';
import { stylize } from './stylize.js';

  const $ = (s, r = document) => r.querySelector(s);
  const $all = (s, r = document) => Array.from(r.querySelectorAll(s));

  const LS_HISTORY = 'unicode-atlas.history.v1';
  const LS_TRAY = 'unicode-atlas.tray.v1';
  const LS_LANG = 'unicode-atlas.lang.v1';
  const HISTORY_MAX = 300;

  /* 控制字符的显示缩写（C0 / DEL / C1） */
  const CTRL = {
    0x00: 'NUL', 0x01: 'SOH', 0x02: 'STX', 0x03: 'ETX', 0x04: 'EOT', 0x05: 'ENQ', 0x06: 'ACK', 0x07: 'BEL',
    0x08: 'BS', 0x09: 'HT', 0x0a: 'LF', 0x0b: 'VT', 0x0c: 'FF', 0x0d: 'CR', 0x0e: 'SO', 0x0f: 'SI',
    0x10: 'DLE', 0x11: 'DC1', 0x12: 'DC2', 0x13: 'DC3', 0x14: 'DC4', 0x15: 'NAK', 0x16: 'SYN', 0x17: 'ETB',
    0x18: 'CAN', 0x19: 'EM', 0x1a: 'SUB', 0x1b: 'ESC', 0x1c: 'FS', 0x1d: 'GS', 0x1e: 'RS', 0x1f: 'US',
    0x7f: 'DEL',
    0x80: 'PAD', 0x81: 'HOP', 0x82: 'BPH', 0x83: 'NBH', 0x84: 'IND', 0x85: 'NEL', 0x86: 'SSA', 0x87: 'ESA',
    0x88: 'HTS', 0x89: 'HTJ', 0x8a: 'VTS', 0x8b: 'PLD', 0x8c: 'PLU', 0x8d: 'RI', 0x8e: 'SS2', 0x8f: 'SS3',
    0x90: 'DCS', 0x91: 'PU1', 0x92: 'PU2', 0x93: 'STS', 0x94: 'CCH', 0x95: 'MW', 0x96: 'SPA', 0x97: 'EPA',
    0x98: 'SOS', 0x99: 'SGC', 0x9a: 'SCI', 0x9b: 'CSI', 0x9c: 'ST', 0x9d: 'OSC', 0x9e: 'PM', 0x9f: 'APC',
  };

  const state = {
    meta: null,
    versions: null,
    view: 'categories',
    navFilter: '',
    filter: { label: '全部已分配字符' },
    query: '',
    items: [],
    total: 0,
    offset: 0,
    limit: 200,
    loading: false,
    done: false,
    reqId: 0,
    selected: null,
    detail: null,
    tray: [],
    history: [],
    zh: true,
    installTimer: null,
    fontTimer: null,
    fonts: new Map(),  // 码点 → 字体家族，逐字符记，只活在这一页里
  };

  /* ── 工具 ───────────────────────────────────────────── */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  /* ── 单字换字体：按码点记住，只改这个字符（详情卡 + 网格里那一格） ──
     只活在这一页里：不写 localStorage，退出程序就没了。 */
  function syncFontSelects() {
    const sel = $('#dFont');
    if (!sel) return;
    const cs = state.detail ? (state.fonts.get(state.detail.cp) || '') : '';
    const hit = Array.from(sel.options).find((o) => o.value === cs);
    sel.value = hit ? cs : '';
  }

  function applyDetailFont() {
    const host = $('#detail');
    if (!host) return;
    const fam = state.detail ? state.fonts.get(state.detail.cp) : '';
    const family = fam ? `"${fam}"` : '';
    host.querySelectorAll('.d-hero .d-glyph, .variant-item .g').forEach((n) => {
      n.style.fontFamily = family;
    });
  }

  function applyGridFont(cp) {
    const cell = $(`.cell[data-cp="${cp}"]`);
    const glyph = cell?.querySelector('.glyph');
    if (!glyph) return;
    const fam = state.fonts.get(cp);
    glyph.style.fontFamily = fam ? `"${fam}"` : '';
  }

  function setFont(css) {
    const cp = state.detail?.cp;
    if (cp == null) return;
    if (css) state.fonts.set(cp, css);
    else state.fonts.delete(cp);
    applyDetailFont();
    applyGridFont(cp);
    syncFontSelects();
  }

  const pad = (n, w = 4) => n.toString(16).toUpperCase().padStart(w, '0');
  /**
   * 码点 → 字符串。任何非法输入（NaN、越界、非整数）都返回空串，
   * 绝不把 NaN 喂给 String.fromCodePoint —— 那会抛 RangeError 把整个详情渲染打断。
   * 分解映射里的 `<super>`、`<compat>` 这类标签就是从这里混进来的。
   */
  const fromCp = (cp) => {
    const n = Number(cp);
    if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return '';
    return String.fromCodePoint(n);
  };

  /** "2764 FE0F" → "❤️"；非法片段直接跳过，绝不把 NaN 喂给 fromCodePoint */
  const seqText = (seq) => String(seq ?? '').split(/\s+/)
    .filter((h) => /^[0-9A-Fa-f]{2,6}$/.test(h))
    .map((h) => String.fromCodePoint(parseInt(h, 16))).join('');

  /** 统一成 "2764 FE0F" 这种大写空格分隔形式 */
  const normSeq = (seq) => String(seq).trim().toUpperCase().split(/\s+/).join(' ');

  /** Unicode 官方名全是单引号大写，转成标题式大小写；CJK / GA 这类短缩写保持原样 */
  /** 全大写的真缩写，Title Case 时保留；其余短词按普通单词处理（SET → Set） */
  const KEEP_UPPER = new Set(['CJK', 'GA', 'VS', 'VF', 'IPA', 'IDC', 'VF']);

  /** 分解映射里的形式标签 → 中文 */
  const FORM_TAG_ZH = {
    compat: '兼容字形', isolated: '独立形', final: '词尾形', initial: '词首形', medial: '词中形',
    wide: '全角', narrow: '半角', circle: '圆圈形', square: '方块形', super: '上标', sub: '下标',
    vertical: '竖排形', small: '小写形', noBreak: '不换行形', font: '字体形', fraction: '分数形',
  };
  const formTag = (tag) => (state.zh ? (FORM_TAG_ZH[tag] || tag) : tag);

  function titleCase(name) {
    if (!name) return '';
    return String(name).replace(/[A-Za-z0-9]+/g, (w) => {
      if (/^[0-9A-F]{4,6}$/.test(w) && /[0-9]/.test(w)) return w;
      if (KEEP_UPPER.has(w)) return w;
      return w[0].toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  /** 收集框条目的唯一键：变体序列用 seq，普通字符用码点 */
  const trayKey = (t) => (t.seq ? normSeq(t.seq) : String(t.cp));

  /** 中英双语取词 */
  const T = (cn, en) => (state.zh ? cn : en);

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET' };
    if (opts.body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, init);
    let data = {};
    try { data = await res.json(); } catch { /* 空响应 */ }
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
    return data;
  }

  /** 决定一个码点在界面上的可见形态 */
  function glyphOf(cp, gc) {
    if (gc === 'Cc' || CTRL[cp]) return { text: CTRL[cp] || 'CTL', cls: 'is-control' };
    if (gc === 'Cs') return { text: 'SURR', cls: 'is-surrogate' };
    if (gc === 'Cn') return { text: '', cls: 'unassigned' };
    if (gc === 'Zs' || gc === 'Zl' || gc === 'Zp') {
      if (cp === 0x20) return { text: '␣', cls: 'is-invisible' };
      return { text: '·', cls: 'is-invisible' };
    }
    if (gc === 'Cf' || gc === 'Mn' && cp === 0x200d) return { text: '◌', cls: 'is-invisible' };
    if (gc === 'Mn' || gc === 'Me') return { text: fromCp(cp), cls: 'is-combining' };
    if (gc === 'Co') return { text: fromCp(cp), cls: 'is-pua' };
    return { text: fromCp(cp), cls: '' };
  }

  /* ── 本地存储 ───────────────────────────────────────── */

  function loadLocal() {
    try {
      const h = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
      if (Array.isArray(h)) state.history = h.filter((x) => typeof x?.cp === 'number').slice(0, HISTORY_MAX);
    } catch { state.history = []; }
    try {
      const t = JSON.parse(localStorage.getItem(LS_TRAY) || '[]');
      if (Array.isArray(t)) state.tray = t.filter((x) => typeof x?.cp === 'number');
    } catch { state.tray = []; }
    const lang = localStorage.getItem(LS_LANG);
    if (lang === 'en') state.zh = false;
  }

  const saveTray = () => localStorage.setItem(LS_TRAY, JSON.stringify(state.tray));
  const saveHistory = () => localStorage.setItem(LS_HISTORY, JSON.stringify(state.history));

  function pushHistory(item) {
    if (!item) return;
    state.history = state.history.filter((h) => h.cp !== item.cp);
    state.history.unshift({ cp: item.cp, n: item.n ?? null, g: item.g ?? null, at: Date.now() });
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    saveHistory();
    renderHistory();
  }

  /* ── 版本下拉 ───────────────────────────────────────── */

  function renderVersionSelect() {
    const sel = $('#versionSelect');
    const list = state.versions?.installed || [];
    sel.textContent = '';
    if (!list.length) {
      sel.append(new Option('未安装数据', ''));
      sel.disabled = true;
    } else {
      sel.disabled = false;
      for (const m of list) {
        const o = new Option(`Unicode ${m.version}`, m.version);
        if (m.version === state.versions.active) o.selected = true;
        sel.append(o);
      }
    }
    const badge = $('#verLabel');
    if (badge) badge.textContent = state.versions?.active ? `Unicode ${state.versions.active}` : 'Unicode';
  }

  $('#versionSelect').addEventListener('change', async (e) => {
    const v = e.target.value;
    if (!v) return;
    try {
      const r = await api('/api/switch', { method: 'POST', body: { version: v } });
      state.versions.active = r.active;
      await loadMeta();
      await reload();
      toast(`已切换到 Unicode ${r.active}`);
    } catch (err) {
      toast('切换失败：' + err.message);
      renderVersionSelect();
    }
  });

  /* ── 元信息与侧栏 ───────────────────────────────────── */

  async function loadMeta() {
    state.meta = await api('/api/meta');
    const badge = $('#versionBadge');
    badge.textContent = `Unicode ${state.meta.activeVersion} · ${state.meta.counts.assigned.toLocaleString('en-US')} 字符`;
    renderNav();
  }

  function navItem(label, num, active, onClick, extraClass = '') {
    const b = document.createElement('button');
    b.className = 'nav-item' + (active ? ' active' : '') + (extraClass ? ' ' + extraClass : '');
    b.innerHTML = `<span class="label">${esc(label)}</span><span class="num">${esc(num ?? '')}</span>`;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderNav() {
    const box = $('#navBody');
    box.textContent = '';
    if (!state.meta) return;
    const m = state.meta;
    const f = state.filter;

    const wrap = (children) => {
      const frag = document.createDocumentFragment();
      children.forEach((c) => frag.append(c));
      box.append(frag);
    };

    const mk = (label, num, isActive, filter) => navItem(label, num, isActive, () => applyFilter(filter));

    const gcLabel = (gc, engName) => (state.zh ? zhGc(gc) : String(engName || gc).replace(/_/g, ' '));

    if (state.view === 'categories') {
      wrap([mk(T('全部字符', 'All characters'), m.counts.assigned.toLocaleString('en-US'), !f.gc, { label: T('全部已分配字符', 'All assigned characters') })]);
      for (const [letter, g] of Object.entries(m.categories)) {
        const groupName = state.zh ? zhGcGroup(letter) : g.label;
        const title = document.createElement('div');
        title.className = 'nav-group-title';
        title.textContent = `${groupName} · ${letter}`;
        box.append(title);
        const sub = document.createElement('div');
        sub.className = 'nav-sub';
        sub.append(navItem(`${groupName}${T('（全部）', ' (all)')}`, g.total.toLocaleString('en-US'), f.gc === letter, () => applyFilter({ gc: letter, label: `分类 · ${groupName} (${letter})` })));
        for (const c of g.gcs) {
          if (!c.count) continue;
          const nm = gcLabel(c.gc, c.name);
          sub.append(navItem(nm, c.count.toLocaleString('en-US'), f.gc === c.gc, () => applyFilter({ gc: c.gc, label: `分类 · ${nm} (${c.gc})` })));
        }
        box.append(sub);
      }
      return;
    }

    if (state.view === 'blocks') {
      const q = state.navFilter.toLowerCase();
      const list = m.blocks.filter((b) => !q || b.id.toLowerCase().includes(q) || zhBlock(b.id).includes(state.navFilter));
      wrap([mk(T('全部字符', 'All characters'), m.counts.assigned.toLocaleString('en-US'), !f.block, { label: T('全部已分配字符', 'All assigned characters') })]);
      for (const b of list) {
        const label = state.zh ? zhBlock(b.id) : b.id;
        const item = navItem(label, b.count.toLocaleString('en-US'), f.block === b.id, () => applyFilter({ block: b.id, label: `区块 · ${label} (${pad(b.first)}–${pad(b.last)})` }));
        item.title = `${b.id} · U+${pad(b.first)}–U+${pad(b.last)}`;
        box.append(item);
      }
      if (!list.length) box.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: T('无匹配区块', 'No matching blocks') }));
      return;
    }

    if (state.view === 'scripts') {
      const q = state.navFilter.toLowerCase();
      const list = m.scripts.filter((s) => !q || s.id.toLowerCase().includes(q) || zhScript(s.id).includes(state.navFilter));
      wrap([mk(T('全部字符', 'All characters'), m.counts.assigned.toLocaleString('en-US'), !f.script, { label: T('全部已分配字符', 'All assigned characters') })]);
      for (const s of list) {
        const label = state.zh ? zhScript(s.id) : s.id;
        const item = navItem(label, s.count.toLocaleString('en-US'), f.script === s.id, () => applyFilter({ script: s.id, label: `文字系统 · ${label}` }));
        item.title = s.id;
        box.append(item);
      }
      return;
    }

    if (state.view === 'ages') {
      wrap([mk(T('全部字符', 'All characters'), m.counts.assigned.toLocaleString('en-US'), !f.age, { label: T('全部已分配字符', 'All assigned characters') })]);
      for (const a of m.ages) {
        box.append(navItem(`Unicode ${a.id} ${T('新增', 'added')}`, a.count.toLocaleString('en-US'), f.age === a.id, () => applyFilter({ age: a.id, label: `首次出现于 Unicode ${a.id}` })));
      }
      return;
    }

    if (state.view === 'planes') {
      wrap([mk(T('全部字符', 'All characters'), m.counts.assigned.toLocaleString('en-US'), f.plane === undefined, { label: T('全部已分配字符', 'All assigned characters') })]);
      for (const p of m.planes) {
        if (!p.count) continue;
        const label = state.zh ? (PLANE_ZH_SHORT[p.id] || p.label) : p.label;
        box.append(navItem(`平面 ${p.id} · ${label}`, p.count.toLocaleString('en-US'), f.plane === p.id, () => applyFilter({ plane: p.id, label: `平面 ${p.id} · ${label}` })));
      }
      return;
    }
  }

  $('#navTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    $all('#navTabs button').forEach((b) => b.classList.toggle('active', b === btn));
    state.view = btn.dataset.view;
    state.navFilter = '';
    $('#navSearch').value = '';
    $('#navSearchWrap').hidden = !(state.view === 'blocks' || state.view === 'scripts');
    renderNav();
  });

  let navSearchTimer = null;
  $('#navSearch').addEventListener('input', (e) => {
    clearTimeout(navSearchTimer);
    navSearchTimer = setTimeout(() => {
      state.navFilter = e.target.value.trim();
      renderNav();
    }, 140);
  });

  /* ── 网格 ───────────────────────────────────────────── */

  function applyFilter(filter) {
    state.filter = filter;
    state.query = '';
    $('#search').value = '';
    $('#searchClear').hidden = true;
    $('#crumb').innerHTML = `<b>${esc(filter.label || '全部已分配字符')}</b>`;
    $('#unassignedWrap').hidden = !filter.block;
    renderNav();
    reload();
  }

  async function reload() {
    state.reqId++;
    state.items = [];
    state.offset = 0;
    state.done = false;
    state.total = 0;
    $('#grid').textContent = '';
    $('#gridEmpty').hidden = true;
    await loadMore(state.reqId);
  }

  async function loadMore(reqId = state.reqId) {
    if (state.loading || state.done) return;
    state.loading = true;
    const token = reqId;
    try {
      const p = new URLSearchParams();
      if (state.query) p.set('q', state.query);
      const f = state.filter;
      if (f.block) p.set('block', f.block);
      if (f.gc) p.set('gc', f.gc);
      if (f.script) p.set('script', f.script);
      if (f.age) p.set('age', f.age);
      if (f.plane !== undefined && f.plane !== null) p.set('plane', String(f.plane));
      if (f.unassigned) p.set('unassigned', '1');
      p.set('offset', String(state.offset));
      p.set('limit', String(state.limit));

      const data = await api('/api/chars?' + p.toString());
      if (token !== state.reqId) return;

      state.total = data.total;
      state.offset += data.items.length;
      if (state.offset >= data.total || data.items.length === 0) state.done = true;

      const frag = document.createDocumentFragment();
      for (const item of data.items) frag.append(cellEl(item));
      $('#grid').append(frag);

      $('#resultCount').textContent = `${data.total.toLocaleString('en-US')} 个`;
      $('#gridEmpty').hidden = data.total !== 0;
      if (data.total === 0) {
        $('#gridEmptyText').textContent = state.query
          ? `没有找到与「${state.query}」匹配的字符`
          : '这个筛选条件下没有字符';
      }
    } catch (e) {
      if (token === state.reqId) toast('加载失败：' + e.message);
      state.done = true;
    } finally {
      state.loading = false;
      updateMoreHint();
    }
  }

  function updateMoreHint() {
    let hint = $('#moreHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'moreHint';
      hint.className = 'loading-more';
      $('#sentinel').before(hint);
    }
    if (state.done && state.total > 0) {
      hint.textContent = `已显示全部 ${state.total.toLocaleString('en-US')} 个字符`;
    } else if (!state.done) {
      hint.textContent = `已显示 ${state.offset.toLocaleString('en-US')} / ${state.total.toLocaleString('en-US')}，继续滚动加载…`;
    } else {
      hint.textContent = '';
    }
  }

  function cellEl(item) {
    const g = glyphOf(item.cp, item.g);
    const btn = document.createElement('button');
    btn.className = 'cell' + (g.cls ? ' ' + g.cls : '');
    btn.dataset.cp = item.cp;
    if (state.selected?.cp === item.cp) btn.classList.add('selected');
    if (state.tray.some((t) => t.cp === item.cp)) btn.classList.add('in-tray');

    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = g.text;
    const fam = state.fonts.get(item.cp);
    if (fam) glyph.style.fontFamily = `"${fam}"`;
    const cp = document.createElement('span');
    cp.className = 'cp';
    cp.textContent = pad(item.cp);

    btn.append(glyph, cp);
    btn._item = item;
    btn.addEventListener('click', () => selectChar(item));
    return btn;
  }

  $('#gridScroll').addEventListener('scroll', () => {
    const el = $('#gridScroll');
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 600) loadMore();
  }, { passive: true });

  /* ── 搜索 ───────────────────────────────────────────── */

  let searchTimer = null;
  $('#search').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    $('#searchClear').hidden = !v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (v === state.query) return;
      state.query = v;
      if (v) {
        state.filter = { label: `搜索「${v}」` };
        $('#crumb').innerHTML = `<b>搜索</b> · ${esc(v)}`;
        $('#unassignedWrap').hidden = true;
        $('#gridScroll').scrollTop = 0;
      } else {
        state.filter = { label: '全部已分配字符' };
        $('#crumb').innerHTML = '<b>全部已分配字符</b>';
      }
      renderNav();
      reload();
    }, 220);
  });

  $('#searchClear').addEventListener('click', () => {
    $('#search').value = '';
    $('#searchClear').hidden = true;
    $('#search').dispatchEvent(new Event('input'));
  });

  $('#showUnassigned').addEventListener('change', (e) => {
    state.filter = { ...state.filter, unassigned: e.target.checked };
    reload();
  });

  /* ── 收集框 ─────────────────────────────────────────── */

  /**
   * 加入收集框。同一个字符可以加很多次（重复选取是合法的），
   * 移除只能点 chip 上的 ×（按位置删，不会误删同字符的其他副本）。
   */
  function addToTray(item) {
    state.tray.push({
      cp: item.cp,
      seq: item.seq ? normSeq(item.seq) : undefined,
      n: item.n ?? null,
      g: item.g ?? null,
    });
    toast(`已加入 ${item.seq ? '变体序列 ' : ''}U+${pad(item.cp)}${state.tray.filter((t) => t.cp === item.cp).length > 1 ? '（第 ' + state.tray.filter((t) => t.cp === item.cp).length + ' 个）' : ''}`);
    pushHistory(item); // 历史只记录真正进了收集框的字符，重复选取以最近一次为准
    saveTray();
    renderTray();
    const cell = $(`.cell[data-cp="${item.cp}"]`);
    if (cell) {
      cell.classList.add('in-tray');
      const add = cell.querySelector('.add');
      if (add) add.textContent = '✓';
    }
  }

  function renderTray() {
    const body = $('#trayBody');
    body.textContent = '';
    for (let i = 0; i < state.tray.length; i++) {
      const t = state.tray[i];
      const g = glyphOf(t.cp, t.g);
      const isVar = !!t.seq;
      const chip = document.createElement('button');
      chip.className = 'tray-chip' + (g.cls.includes('control') ? ' is-control' : '') + (isVar ? ' is-variant' : '');
      chip.title = `${t.n ? titleCase(t.n) + ' · ' : ''}U+${pad(t.cp)}${isVar ? ' + ' + t.seq.split(' ').slice(1).map((h) => 'U+' + h).join(' + ') : ''}（点击移除）`;
      const gl = document.createElement('span');
      gl.className = 'glyph';
      gl.textContent = isVar ? seqText(t.seq) : (g.text || pad(t.cp));
      const x = document.createElement('span');
      x.className = 'x';
      x.textContent = '×';
      chip.append(gl, x);
      chip.addEventListener('click', () => {
        state.tray.splice(i, 1);
        saveTray();
        renderTray();
        renderGridMarks();
      });
      body.append(chip);
    }

    $('#trayCount').textContent = String(state.tray.length);
    $('#trayCount').classList.toggle('on', state.tray.length > 0);

    const text = state.tray.map((t) => (t.seq ? seqText(t.seq) : fromCp(t.cp))).join('');
    $('#trayText').value = text;
    const codePoints = Array.from(text).length;
    $('#trayMeta').textContent = state.tray.length
      ? `${state.tray.length} 个选择 · ${codePoints} 个码点 · ${new Blob([text]).size} 字节 UTF-8`
      : '';
  }

  function renderGridMarks() {
    $all('.cell').forEach((cell) => {
      const cp = Number(cell.dataset.cp);
      const inTray = state.tray.some((t) => t.cp === cp);
      cell.classList.toggle('in-tray', inTray);
      const add = cell.querySelector('.add');
      if (add) add.textContent = inTray ? '✓' : '＋';
    });
  }

  $('#btnCopy').addEventListener('click', async () => {
    const text = state.tray.map((t) => (t.seq ? seqText(t.seq) : fromCp(t.cp))).join('');
    if (!text) return toast('收集框还是空的');
    try {
      await navigator.clipboard.writeText(text);
      toast(`已复制 ${state.tray.length} 个字符`);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('已复制');
    }
  });

  $('#btnClearTray').addEventListener('click', () => {
    if (!state.tray.length) return;
    state.tray = [];
    saveTray();
    renderTray();
    renderGridMarks();
  });

  /* ── 详情 ───────────────────────────────────────────── */

  async function selectChar(item) {
    state.selected = item;
    $all('.cell').forEach((c) => c.classList.toggle('selected', Number(c.dataset.cp) === item.cp));
    try {
      const d = await api('/api/char/' + pad(item.cp));
      state.detail = d;
      renderDetail(d);
    } catch (e) {
      toast('读取详情失败：' + e.message);
    }
  }

  const cpLink = (cp, showChar = true) => {
    const ch = fromCp(cp);
    const name = '';
    return `<button class="link-char" data-jump="${cp}">
      ${showChar ? `<span class="g">${esc(ch)}</span>` : ''}
      <span>U+${pad(cp)}</span></button>`;
  };

  function seqLink(seq) {
    return String(seq ?? '')
      .split(/\s+/)
      .filter((h) => /^[0-9A-Fa-f]{1,6}$/.test(h))
      .map((h) => {
        const cp = parseInt(h, 16);
        if (!Number.isFinite(cp) || cp > 0x10ffff) return '';
        return `<button class="link-char" data-jump="${cp}"><span class="g">${esc(fromCp(cp))}</span><span class="c">${pad(cp)}</span></button>`;
      })
      .join('');
  }

  async function setupFontPicker(d) {
    const sel = $('#dFont');
    if (!sel) return;
    sel.addEventListener('change', () => setFont(sel.value));
    try {
      const r = await api('/api/fonts/coverage?cp=' + pad(d.cp));
      if (state.detail?.cp !== d.cp || !sel.isConnected) return;
      const push = (v, t) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        sel.append(o);
      };
      /* 这个字符已经选过不支持它的字体时，也让它留在下拉里，免得看起来像被重置了 */
      const cur = state.fonts.get(d.cp);
      if (cur && !(r.fonts || []).some((f) => f.css === cur)) {
        push(cur, cur);
      }
      for (const f of r.fonts || []) push(f.css, f.name);
      sel.disabled = false;
      syncFontSelects();
    } catch { /* 字体扫描失败就保持默认字体 */ }
  }

  function renderDetail(d) {
    const el = $('#detail');
    if (!d) return;
    const g = glyphOf(d.cp, d.gc);
    const tags = [];
    tags.push(`<span class="tag blue">${esc(state.zh ? zhGc(d.gc) : (d.gcName || d.gc))} · ${esc(d.gc)}</span>`);
    if (d.assigned === false) tags.push('<span class="tag red">未分配</span>');
    if (d.controlAbbrev) tags.push(`<span class="tag amber">${esc(d.controlAbbrev)}</span>`);
    if (d.surrogate) tags.push('<span class="tag red">代理项</span>');
    if (d.pua) tags.push('<span class="tag amber">私用区</span>');
    if (d.age) tags.push(`<span class="tag">Unicode ${esc(d.age)}+</span>`);

    const parts = [];

    parts.push(`
      <div class="d-hero">
        <div class="d-glyph${g.cls === 'is-control' || g.cls === 'is-surrogate' ? ' small' : ''}">${esc(g.text || '')}</div>
        <div class="d-hero-text">
          <div class="d-code">U+${pad(d.cp)}</div>
          <div class="d-name">${esc(titleCase(d.name) || '（未分配）')}</div>
          ${d.cldr?.zh ? `<div class="d-zh">${esc(d.cldr.zh)}</div>` : ''}
          <div class="d-flags">${tags.join('')}</div>
        </div>
      </div>
      <div class="d-fontpick">
        <span class="k">${state.zh ? '当前字符：' : 'Current character:'}</span>
        <select id="dFont" class="select" disabled><option value="">${state.zh ? '默认字体' : 'Default font'}</option></select>
      </div>
      <div class="d-actions">
        <button class="btn tiny primary" id="dAdd">${(() => { const n = state.tray.filter((t) => t.cp === d.cp).length; return n ? `＋ 加入收集框（已有 ${n}）` : '＋ 加入收集框'; })()}</button>
        <button class="btn tiny" id="dCopy">复制字符</button>
        <button class="btn tiny" id="dCopyEsc">复制转义</button>
      </div>
    `);

    /* 编码 */
    const encRows = [];
    encRows.push(copyLine('UTF-8', d.utf8 ? d.utf8.join(' ') : '—'));
    encRows.push(copyLine('UTF-16', d.utf16.join(' ')));
    encRows.push(copyLine('十进制', String(d.dec)));
    encRows.push(copyLine('HTML', `&#x${pad(d.cp)};`));
    encRows.push(copyLine('CSS', `\\${pad(d.cp)}`));
    if (d.surrogate) encRows.push('<div class="muted">代理项码点本身不构成字符，需与配对代理组成 UTF-16 序列。</div>');
    parts.push(section('编码', encRows.join('')));

    /* 基本属性 */
    const kv = [];
    kv.push(['码点', `U+${pad(d.cp)}`]);
    kv.push(['十进制', String(d.dec)]);
    kv.push(['一般类别', `${esc(state.zh ? zhGc(d.gc) : d.gcName)}（${esc(d.gc)}）`]);
    if (d.block) {
      const bn = state.zh ? `${zhBlock(d.block.id)}（${d.block.id}）` : d.block.id;
      kv.push(['所属区块', `${esc(bn)} · U+${pad(d.block.first)}–U+${pad(d.block.last)}`]);
    }
    if (d.script) kv.push(['文字系统', esc(state.zh ? `${zhScript(d.script)}（${d.script}）` : d.script)]);
    if (d.scriptExt) kv.push(['文字扩展', esc(d.scriptExt.join(', '))]);
    if (d.age) kv.push(['首次出现', `Unicode ${esc(d.age)}`]);
    if (d.eaw) kv.push(['东亚宽度', `${esc(d.eawName || '')}（${esc(d.eaw)}）`]);
    if (d.bidi) kv.push(['双向类别', `${esc(d.bidiName || '')}（${esc(d.bidi)}）`]);
    if (d.ccc) kv.push(['组合类别', String(d.ccc)]);
    if (d.lineBreak) kv.push(['断行类别', esc(d.lineBreak)]);
    if (d.mirrored) kv.push(['镜像', '是（双向文本中显示为镜像字形）']);
    if (d.numeric) {
      const n = [];
      if (d.numeric.decimal !== null) n.push(`十进制 ${esc(d.numeric.decimal)}`);
      if (d.numeric.digit !== null) n.push(`位值 ${esc(d.numeric.digit)}`);
      if (d.numeric.value !== null) n.push(`数值 ${esc(d.numeric.value)}`);
      if (n.length) kv.push(['数值', n.join(' · ')]);
    }
    if (d.unicode1Name) kv.push(['Unicode 1.0 名', esc(d.unicode1Name)]);
    if (d.isoComment) kv.push(['ISO 注释', esc(d.isoComment)]);
    if (d.plane) kv.push(['平面', esc(d.plane)]);
    parts.push(section('属性', `<dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`));

    /* 大小写 */
    const caseRows = [];
    if (d.upper) caseRows.push(`<div class="copy-line"><span class="k">大写</span><span class="v">${seqLink(d.upper.hex)} <span class="muted">${esc(d.upper.name || '')}</span></span></div>`);
    if (d.lower) caseRows.push(`<div class="copy-line"><span class="k">小写</span><span class="v">${seqLink(d.lower.hex)} <span class="muted">${esc(d.lower.name || '')}</span></span></div>`);
    if (d.title) caseRows.push(`<div class="copy-line"><span class="k">标题</span><span class="v">${seqLink(d.title.hex)} <span class="muted">${esc(d.title.name || '')}</span></span></div>`);
    if (d.caseFolding) {
      const cf = d.caseFolding;
      const bits = [];
      if (cf.common) bits.push(`common → ${esc(cf.common)}`);
      if (cf.full) bits.push(`full → ${esc(cf.full)}`);
      if (cf.simple) bits.push(`simple → ${esc(cf.simple)}`);
      if (cf.turkic) bits.push(`turkic → ${esc(cf.turkic)}`);
      if (bits.length) caseRows.push(`<div class="muted" style="margin-top:6px">大小写折叠：${bits.join('；')}</div>`);
    }
    if (d.specialCasing) {
      const sc = d.specialCasing;
      const bits = [];
      if (sc.lower) bits.push(`小写 → ${esc(sc.lower)}`);
      if (sc.title) bits.push(`标题 → ${esc(sc.title)}`);
      if (sc.upper) bits.push(`大写 → ${esc(sc.upper)}`);
      if (bits.length) caseRows.push(`<div class="muted" style="margin-top:6px">特殊大小写映射${sc.condition ? `（${esc(sc.condition)}）` : ''}：${bits.join('；')}</div>`);
    }
    if (caseRows.length) parts.push(section('大小写映射', caseRows.join('')));

    /* 分解 */
    if (d.decomposition) {
      const dc = d.decomposition;
      parts.push(section('分解映射', `
        <div class="copy-line"><span class="k">类型</span><span class="v">${esc(dc.typeName)}</span></div>
        <div style="margin-top:6px">${seqLink(dc.raw)}</div>
        <div class="muted" style="margin-top:6px">${dc.cps.map((c) => esc(c.name || '')).filter(Boolean).join(' + ')}</div>
      `));
    }

    /* ── 字形栏：原形 + 全部变体，一张卡一个字形，卡上只有「复制」 ── */
    const glyphCards = [];
    const seenGlyph = new Set();
    const pushCard = (char, tag, cp, copy, note, cls) => {
      if (!char) return;
      const key = (copy || char) + '|' + (cls || '');
      if (seenGlyph.has(key)) return;
      seenGlyph.add(key);
      glyphCards.push({ char, tag, cp, copy: copy || char, note: note || '', cls: cls || '' });
    };

    pushCard(g.text || '—', state.zh ? '原形' : 'Base', d.cp, fromCp(d.cp), '');

    for (const v of d.variantSequences || []) {
      const seq = normSeq(v.hex ?? v.seq ?? '');
      if (!seq) continue;
      const shown = seqText(seq);
      if (!shown) continue;
      pushCard(shown, titleCase(v.desc || v.kind || 'VS'), d.cp, shown, seq);
    }
    for (const f of d.forms || []) {
      pushCard(f.char, formTag(f.tag), f.cp, f.char, '');
    }
    if (d.unihan) {
      const u = d.unihan;
      const addVar = (label, val) => {
        if (!val) return;
        const refs = String(val).replace(/<[^>]*>/g, ' ').match(/U\+[0-9A-F]{4,6}/gi) || [];
        for (const ref of refs) {
          const cp = parseInt(ref.slice(2), 16);
          if (!Number.isFinite(cp) || cp === d.cp) continue;
          pushCard(fromCp(cp), label, cp, fromCp(cp), '');
        }
      };
      addVar(state.zh ? '简体' : 'Simplified', u.simplifiedVariant);
      addVar(state.zh ? '繁体' : 'Traditional', u.traditionalVariant);
      addVar(state.zh ? '兼容' : 'Compatibility', u.compatibilityVariant);
      addVar(state.zh ? '语义' : 'Semantic', u.semanticVariant);
      addVar(state.zh ? 'Z 变体' : 'Z variant', u.zVariant);
    }

    /* 汉字：同一码点在中日韩各自的“标准字形”不同，靠系统字体分别渲染出来 */
    if (d.script === 'Han' && g.text && /[\u3400-\u9fff\uf900-\ufaff]/.test(g.text)) {
      pushCard(g.text, state.zh ? '中国字形' : 'Chinese', d.cp, fromCp(d.cp), '', 'lang-zh');
      pushCard(g.text, state.zh ? '日本字形' : 'Japanese', d.cp, fromCp(d.cp), '', 'lang-ja');
      pushCard(g.text, state.zh ? '韩国字形' : 'Korean', d.cp, fromCp(d.cp), '', 'lang-ko');
    }

    const glyphHtml = glyphCards.map((c, i) => `<div class="variant-item${i === 0 ? ' is-base' : ''}">
        <span class="g${c.cls ? ' ' + c.cls : ''}">${esc(c.char)}</span>
        <span class="v">${esc(c.tag)}${c.cp !== d.cp ? `<span class="mono muted"> · U+${pad(c.cp)}</span>` : ''}${c.note ? `<br><span class="mono muted">${esc(c.note)}</span>` : ''}</span>
        <button class="btn tiny" data-copy="${esc(c.copy)}" data-hist="${d.cp}">复制</button>
      </div>`).join('');

    parts.push(section(`${state.zh ? '字形' : 'Glyphs'}（${glyphCards.length}）`, `<div class="variant-grid">${glyphHtml}</div>`));

    if (d.baseCp) {
      parts.push(`<div class="muted" style="margin-top:6px">它是 <button class="link-char" data-jump="${d.baseCp}"><span class="g">${esc(fromCp(d.baseCp))}</span><span class="c">${pad(d.baseCp)}</span></button> 的一种特殊写法。</div>`);
    }

    /* 注释 */
    if (d.namesList && (d.namesList.notes.length || d.namesList.crossRefs.length || d.namesList.aliases.length)) {
      const nl = d.namesList;
      const bits = [];
      if (nl.aliases.length) bits.push(`<div class="copy-line"><span class="k">等价名</span><span class="v">${nl.aliases.map((a) => esc(a)).join(' · ')}</span></div>`);
      if (nl.notes.length) bits.push(`<ul class="note-list">${nl.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`);
      if (nl.crossRefs.length) {
        bits.push(`<div style="margin-top:6px">${nl.crossRefs.map((x) => `<button class="link-char" data-jump="${x.cp}"><span class="g">${esc(x.char)}</span><span>${esc(x.name)}</span></button>`).join('')}</div>`);
      }
      parts.push(section('字符注释', bits.join('')));
    }

    /* 别名 */
    if (d.aliases && d.aliases.length) {
      parts.push(section('官方别名', `<dl class="kv">${d.aliases.map((a) => `<dt>${esc(a.typeName)}</dt><dd class="mono">${esc(a.text)}</dd>`).join('')}</dl>`));
    }

    /* 描述 */
    if (d.cldr?.zh || d.cldr?.en) {
      const bits = [];
      if (d.cldr.zh) bits.push(`<div class="copy-line"><span class="k">中文</span><span class="v">${esc(d.cldr.zh)}</span></div>`);
      if (d.cldr.zhKeywords?.length) bits.push(`<div class="muted">关键词：${d.cldr.zhKeywords.map((k) => esc(k)).join('、')}</div>`);
      if (d.cldr.en) bits.push(`<div class="copy-line" style="margin-top:6px"><span class="k">English</span><span class="v">${esc(d.cldr.en)}</span></div>`);
      parts.push(section('通俗描述（CLDR）', bits.join('')));
    }

    /* Unihan */
    if (d.unihan) {
      const u = d.unihan;
      const rows = [];
      if (u.definition) rows.push(`<div class="def">${esc(u.definition)}</div>`);
      const meta = [];
      if (u.mandarin) meta.push(`普通话 ${esc(u.mandarin)}`);
      if (u.cantonese) meta.push(`粤语 ${esc(u.cantonese)}`);
      if (u.japaneseOn) meta.push(`日语音读 ${esc(u.japaneseOn)}`);
      if (u.japaneseKun) meta.push(`日语训读 ${esc(u.japaneseKun)}`);
      if (u.korean) meta.push(`朝鲜语 ${esc(u.korean)}`);
      if (u.hangul) meta.push(`谚文 ${esc(u.hangul)}`);
      if (u.vietnamese) meta.push(`越南语 ${esc(u.vietnamese)}`);
      if (meta.length) rows.push(`<div class="py">${meta.join(' · ')}</div>`);
      const nums = [];
      if (u.totalStrokes) nums.push(`总笔画 ${esc(u.totalStrokes)}`);
      if (u.radicalStroke) nums.push(`部首/笔画 ${esc(u.radicalStroke)}`);
      if (u.frequency) nums.push(`频率 ${esc(u.frequency)}`);
      if (u.gradeLevel) nums.push(`等级 ${esc(u.gradeLevel)}`);
      if (nums.length) rows.push(`<div class="muted" style="margin-top:5px">${nums.join(' · ')}</div>`);
      if (rows.length) parts.push(section('汉字信息（Unihan）', `<div class="unihan-block">${rows.join('')}</div>`));
    }

    el.innerHTML = parts.join('');
    el.scrollTop = 0;
    applyDetailFont();
    setupFontPicker(d);

    $('#dAdd').addEventListener('click', () => {
      addToTray({ cp: d.cp, n: d.name, g: d.gc });
      const n = state.tray.filter((t) => t.cp === d.cp).length;
      $('#dAdd').textContent = n > 1 ? `＋ 加入收集框（已有 ${n}）` : '＋ 加入收集框';
    });
    $('#dCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(fromCp(d.cp));
        toast('已复制字符');
        pushHistory({ cp: d.cp, n: d.name, g: d.gc });
      } catch { toast('复制失败'); }
    });
    $('#dCopyEsc').addEventListener('click', async () => {
      const s = d.surrogate ? `\\u${pad(d.cp)}` : (d.cp > 0xffff ? `\\u{${pad(d.cp)}}` : `\\u${pad(d.cp)}`);
      try {
        await navigator.clipboard.writeText(s);
        toast('已复制 ' + s);
        pushHistory({ cp: d.cp, n: d.name, g: d.gc });
      } catch { toast('复制失败'); }
    });

    /* 详情内的字符跳转 */
    el.querySelectorAll('[data-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cp = Number(btn.dataset.jump);
        selectChar({ cp, n: null, g: null });
        const cell = $(`.cell[data-cp="${cp}"]`);
        if (cell) cell.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
  }

  function copyLine(key, value) {
    return `<div class="copy-line"><span class="k">${esc(key)}</span><span class="v">${esc(value)}</span>
      <button data-copy="${esc(value)}" title="复制">⧉</button></div>`;
  }

  function section(title, html) {
    return `<div class="d-section"><h3>${esc(title)}</h3>${html}</div>`;
  }

  $('#detail').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.dataset.copy ?? '';
    navigator.clipboard.writeText(text)
      .then(() => {
        toast('已复制');
        /* 历史按 data-hist 指定的原形码点记，变体也归到原形名下 */
        if (btn.dataset.hist) {
          const cp = Number(btn.dataset.hist);
          if (Number.isFinite(cp)) {
            const d = state.detail;
            pushHistory({ cp, n: cp === d?.cp ? d.name : null, g: cp === d?.cp ? d.gc : null });
          }
        }
      })
      .catch(() => toast('复制失败'));
  });

  /* ── 历史 ───────────────────────────────────────────── */

  function renderHistory() {
    const box = $('#historyList');
    if (!box) return;
    if (!state.history.length) {
      box.innerHTML = '<p class="muted">还没有浏览记录。</p>';
      return;
    }
    box.textContent = '';
    for (let i = 0; i < state.history.length; i++) {
      const h = state.history[i];
      const g = glyphOf(h.cp, h.g);
      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = `
        <span class="g">${esc(g.text || pad(h.cp))}</span>
        <span class="info">
          <div class="nm">${esc(titleCase(h.n) || '（未分配）')}</div>
          <div class="sub">U+${pad(h.cp)} · ${new Date(h.at).toLocaleString('zh-CN')}</div>
        </span>
        <button class="del" title="删除这条记录">×</button>`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.del')) return;
        $('#modalHistory').hidden = true;
        selectChar({ cp: h.cp, n: h.n, g: h.g });
        const cell = $(`.cell[data-cp="${h.cp}"]`);
        if (cell) cell.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      row.querySelector('.del').addEventListener('click', (e) => {
        e.stopPropagation();
        state.history.splice(i, 1);
        saveHistory();
        renderHistory();
      });
      box.append(row);
    }
  }

  $('#btnHistory').addEventListener('click', () => {
    renderHistory();
    $('#modalHistory').hidden = false;
  });

  $('#btnClearHistory').addEventListener('click', () => {
    state.history = [];
    saveHistory();
    renderHistory();
    toast('历史已清空');
  });

  /* ── 版本管理 ───────────────────────────────────────── */

  function fmtBytes(n) {
    if (!n) return '—';
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }

  async function refreshInstalled() {
    const box = $('#installedList');
    try {
      const v = await api('/api/versions');
      state.versions = v;
      renderVersionSelect();
      box.textContent = '';
      if (!v.installed.length) {
        box.innerHTML = '<p class="muted">本地还没有任何版本，先安装一个。</p>';
        return;
      }
      for (const m of v.installed) {
        const row = document.createElement('div');
        row.className = 'version-row' + (m.version === v.active ? ' is-active' : '');
        row.innerHTML = `
          <span class="v">${esc(m.version)}</span>
          <span class="meta">
            <b>${(m.counts?.assigned ?? 0).toLocaleString('en-US')}</b> 个已分配字符 ·
            ${m.sources?.unihan ? '含 Unihan · ' : ''}${m.sources?.cldr ? '含中文注释 · ' : ''}
            索引 ${fmtBytes(m.bytes?.index)}<br>
            安装于 ${new Date(m.installedAt).toLocaleString('zh-CN')}
            ${m.missing?.length ? `<br><span class="warn-text">该版本原有 ${m.missing.length} 类数据文件未发布，缺少：${esc(m.missing.slice(0, 3).join('、'))}${m.missing.length > 3 ? ' 等' : ''}</span>` : ''}
          </span>
          <span class="ops">
            <button class="btn tiny${m.version === v.active ? ' primary' : ''}" data-use="${esc(m.version)}">${m.version === v.active ? '当前' : '查看'}</button>
            <button class="btn tiny ghost" data-del="${esc(m.version)}">删除</button>
          </span>`;
        row.querySelector('[data-use]').addEventListener('click', async () => {
          try {
            await api('/api/switch', { method: 'POST', body: { version: m.version } });
            state.versions.active = m.version;
            await loadMeta();
            await reload();
            await refreshInstalled();
            toast(`已切换到 Unicode ${m.version}`);
          } catch (e) { toast('切换失败：' + e.message); }
        });
        row.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(`删除 Unicode ${m.version} 的本地数据？（可随时重新下载）`)) return;
          try {
            await api('/api/versions/remove', { method: 'POST', body: { version: m.version } });
            await refreshInstalled();
            if (!state.versions.hasData) return location.reload();
            await loadMeta();
            await reload();
            toast(`已删除 ${m.version}`);
          } catch (e) { toast('删除失败：' + e.message); }
        });
        box.append(row);
      }
    } catch (e) {
      box.innerHTML = `<p class="muted">读取失败：${esc(e.message)}</p>`;
    }
  }

  async function loadReleases() {
    try {
      const { dirs } = await api('/api/releases');
      const dl = $('#releaseList');
      dl.textContent = '';
      for (const d of dirs) dl.append(new Option(d, d));
    } catch { /* 离线时忽略 */ }
  }

  $('#btnManage').addEventListener('click', async () => {
    $('#modalManage').hidden = false;
    await refreshInstalled();
    loadReleases();
    refreshFonts();
    if (state.versions?.lastCheck) renderCheckInfo(state.versions.lastCheck);
    if (!$('#installVersion').value) {
      const list = state.versions?.installed || [];
      const latest = list.map((m) => m.version).sort((a, b) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        return 0;
      })[0];
      $('#installVersion').value = latest || '18.0.0';
    }
  });

  function renderCheckInfo(info) {
    const box = $('#updateInfo');
    if (!info) return;
    const newest = info.isNewer;
    box.innerHTML = `
      最新版本：<b style="color:var(--text)">Unicode ${esc(info.latest)}</b>
      （来源 ${esc(info.via)}，${new Date(info.checkedAt).toLocaleString('zh-CN')} 检测）<br>
      当前使用：Unicode ${esc(info.current || '—')}
      ${newest
        ? `<div style="margin-top:8px"><button class="btn tiny primary" id="btnInstallLatest">安装 Unicode ${esc(info.latest)}</button></div>`
        : '<div style="margin-top:6px;color:var(--ok)">已是最新版本。</div>'}
      ${info.installedVersions?.length ? `<div style="margin-top:6px">本机已装：${info.installedVersions.map(esc).join(', ')}</div>` : ''}`;
    const btn = $('#btnInstallLatest');
    if (btn) btn.addEventListener('click', () => {
      $('#installVersion').value = info.latest;
      startInstall();
    });
  }

  $('#btnCheck').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = '检测中…';
    try {
      const info = await api('/api/check-update', { method: 'POST' });
      renderCheckInfo(info);
      if (info.isNewer) {
        toast(`发现新版本 Unicode ${info.latest}`);
        $('#modalManage').hidden = false;
        await refreshInstalled();
        loadReleases();
      } else {
        toast(`已是最新：Unicode ${info.latest}`);
      }
    } catch (err) {
      toast('检测失败：' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '检查更新';
    }
  });

  /* ── 安装流程 ───────────────────────────────────────── */

  async function startInstall() {
    const version = $('#installVersion').value.trim();
    if (!version) return toast('先填一个版本号');
    const btn = $('#btnInstall');
    btn.disabled = true;
    btn.textContent = '安装中…';
    $('#progressWrap').hidden = false;
    $('#progressFill').style.width = '0%';
    $('#progressPhase').textContent = '准备中…';
    $('#progressPct').textContent = '0%';
    $('#progressStep').textContent = '';
    $('#installLog').textContent = '';

    try {
      await api('/api/install', {
        method: 'POST',
        body: {
          version,
          includeUnihan: $('#optUnihan').checked,
          includeCldr: $('#optCldr').checked,
        },
      });
      pollInstall();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '安装';
      toast('启动安装失败：' + e.message);
    }
  }

  function pollInstall() {
    clearInterval(state.installTimer);
    state.installTimer = setInterval(async () => {
      let j;
      try {
        j = await api('/api/install/status');
      } catch {
        return;
      }
      $('#progressFill').style.width = (j.pct || 0) + '%';
      $('#progressPct').textContent = (j.pct || 0) + '%';
      $('#progressPhase').textContent = j.phase === 'error' ? '安装失败' : (j.step || j.phase || '');
      $('#progressStep').textContent = j.received && j.total
        ? `${(j.received / 1048576).toFixed(1)} / ${(j.total / 1048576).toFixed(1)} MB`
        : '';
      $('#installLog').textContent = (j.log || []).map((l) => `[${new Date(l.t).toLocaleTimeString('zh-CN')}] ${l.msg}`).join('\n');

      if (!j.running) {
        clearInterval(state.installTimer);
        const btn = $('#btnInstall');
        btn.disabled = false;
        btn.textContent = '安装';
        if (j.error) {
          toast('安装失败：' + j.error);
        } else if (j.phase === 'done') {
          toast(`Unicode ${j.version} 安装完成`);
          await refreshInstalled();
          await loadMeta();
          await reload();
        }
      }
    }, 500);
  }

  $('#btnInstall').addEventListener('click', startInstall);
  $('#installVersion').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startInstall();
  });

  /* ── 设置菜单 ───────────────────────────────────────── */

  function closeSettings() {
    const m = $('#settingsMenu');
    if (m) m.hidden = true;
    $('#btnSettings')?.setAttribute('aria-expanded', 'false');
  }

  $('#btnSettings')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = $('#settingsMenu');
    if (!m) return;
    m.hidden = !m.hidden;
    $('#btnSettings').setAttribute('aria-expanded', String(!m.hidden));
  });

  $('#settingsMenu')?.addEventListener('click', (e) => {
    if (e.target.closest('.menu-item')) setTimeout(closeSettings, 0);
  });

  /* Emoji 字形：系统彩色 font 或 Noto 单色线条 */
  const LS_EMOJI = 'unicode-atlas.emojiFont.v1';

  function applyEmojiFont() {
    const v = localStorage.getItem(LS_EMOJI) === 'noto' ? 'noto' : 'system';
    document.body.classList.toggle('emoji-noto', v === 'noto');
    document.querySelectorAll('#emojiFontSeg .seg-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.emoji === v);
    });
  }

  $('#emojiFontSeg')?.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    localStorage.setItem(LS_EMOJI, b.dataset.emoji);
    applyEmojiFont();
  });

  document.addEventListener('click', (e) => {
    if (e.target?.closest?.('.settings-wrap')) return;
    closeSettings();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

  $('#btnFontsCheck')?.addEventListener('click', async () => {
    closeSettings();
    try {
      const s = await api('/api/fonts');
      state.fontsInfo = s;
      const head = `字体 ${s.installed}/${s.total} · 本地备份 ${s.backup ?? 0} 个`;
      if (!s.missing?.length) { toast(head + ' · 全部就位'); return; }
      toast(head + ` · 缺 ${s.missing.length} 个，已打开字体面板`);
      $('#btnManage')?.click();
      setTimeout(() => {
        refreshFonts?.();
        $('#fontPanel')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 80);
    } catch (e) {
      toast('字体检查失败：' + e.message);
    }
  });

  /* 恢复默认字体（设置菜单）：清掉这一页里记过的所有单字字体 */
  $('#btnFontReset')?.addEventListener('click', () => {
    closeSettings();
    state.fonts.clear();
    document.querySelectorAll('#grid .cell .glyph').forEach((g) => { g.style.fontFamily = ''; });
    applyDetailFont();
    syncFontSelects();
    toast('已恢复默认字体');
  });

  /* ── 悬停预览 ───────────────────────────────────────── */

  const hoverCard = $('#hoverCard');
  const hoverGrid = $('#grid');
  let hoverTimer = null;

  function hideHover() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (hoverCard) hoverCard.hidden = true;
  }

  function showHover(cell) {
    const it = cell._item;
    if (!it || !hoverCard) return;
    const g = glyphOf(it.cp, it.g);
    const name = it.n ? titleCase(it.n) : (state.zh ? '未分配' : 'Unassigned');
    const gcTxt = state.zh ? zhGc(it.g) : (it.g || '');
    const blTxt = it.bl ? (state.zh ? zhBlock(it.bl) : it.bl) : '';
    const raw = it.zh || (it.def ? String(it.def).split(';').slice(0, 2).join(';') : '');
    const desc = String(raw || '').slice(0, 96);
    hoverCard.innerHTML = `
      <div class="hover-top">
        <div class="hover-glyph">${esc(g.text || '')}</div>
        <div class="hover-meta">
          <div class="hover-name">${esc(name)}</div>
          <div class="hover-sub">U+${pad(it.cp)} · ${esc(gcTxt)}</div>
        </div>
      </div>
      ${blTxt ? `<div class="hover-line">${esc(blTxt)}${it.ag ? ` · Unicode ${esc(it.ag)}+` : ''}</div>` : ''}
      ${desc ? `<div class="hover-line">${esc(desc)}</div>` : ''}
      ${it.py ? `<div class="hover-line">${esc(it.py)}</div>` : ''}`;
    hoverCard.hidden = false;
    const r = cell.getBoundingClientRect();
    const cw = hoverCard.offsetWidth || 248;
    const ch2 = hoverCard.offsetHeight || 130;
    let left = r.right + 10;
    if (left + cw > (window.innerWidth || 1400) - 8) left = Math.max(8, r.left - cw - 10);
    let top = r.top - 4;
    if (top + ch2 > (window.innerHeight || 900) - 8) top = Math.max(8, (window.innerHeight || 900) - ch2 - 8);
    hoverCard.style.left = left + 'px';
    hoverCard.style.top = top + 'px';
  }

  hoverGrid?.addEventListener('mouseover', (e) => {
    const cell = e.target?.closest?.('.cell');
    if (!cell) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showHover(cell), 430);
  });
  hoverGrid?.addEventListener('mouseout', hideHover);
  $('.grid-scroll')?.addEventListener('scroll', hideHover, { passive: true });

  /* ── 中英切换 ───────────────────────────────────────── */

  function renderLangBtn() {
    const b = $('#btnLang');
    if (!b) return;
    b.textContent = state.zh ? '语言：中文 → English' : 'Language: English → 中文';
    b.title = state.zh ? '当前显示中文名，点击切换到英文' : 'Showing English names — click for Chinese';
  }

  $('#btnLang').addEventListener('click', () => {
    state.zh = !state.zh;
    localStorage.setItem(LS_LANG, state.zh ? 'zh' : 'en');
    renderLangBtn();
    renderNav();
    if (state.detail) renderDetail(state.detail);
  });

  /* ── Noto 字体包 ────────────────────────────────────── */

  async function refreshFonts() {
    const box = $('#fontStatus');
    const btn = $('#btnFonts');
    if (!box || !btn) return null;
    try {
      const s = await api('/api/fonts');
      state.fontsInfo = s;
      const running = !!s.job?.running;
      if (running) { btn.disabled = true; btn.textContent = '下载中…'; }
      else if (s.installed >= s.total) { btn.disabled = true; btn.textContent = '已全部安装'; }
      else { btn.disabled = false; btn.textContent = s.installed ? '补齐缺失字体' : '下载全部字体'; }
      box.innerHTML = `已安装 <b style="color:var(--text)">${s.installed}</b> / ${s.total} 个字体 · ${fmtBytes(s.installedBytes)} / ${fmtBytes(s.totalBytes)}`
        + `<br><span class="muted">本地备份 ${s.backup ?? 0} 个${s.backup ? '（断网也能装，装包时优先用备份）' : ''}</span>`;
      if (s.missing?.length) {
        box.innerHTML += `<br><span class="muted">还缺：${esc(s.missing.slice(0, 4).join('、'))}${s.missing.length > 4 ? ` 等 ${s.missing.length} 个` : ''}</span>`;
      }
      return s;
    } catch (e) {
      box.textContent = '读取失败：' + e.message;
      return null;
    }
  }

  function pollFonts() {
    clearInterval(state.fontTimer);
    state.fontTimer = setInterval(async () => {
      let s;
      try { s = await api('/api/fonts/status'); } catch { return; }
      const j = s.job || {};
      const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
      $('#fontFill').style.width = pct + '%';
      $('#fontPct').textContent = pct + '%';
      $('#fontPhase').textContent = j.running
        ? `${j.done}/${j.total} · ${j.current || ''}`
        : (j.error ? '下载失败' : '完成');
      if (!j.running) {
        clearInterval(state.fontTimer);
        $('#fontProgress').hidden = true;
        await refreshFonts();
        if (j.error) {
          toast('字体下载失败：' + j.error);
        } else {
          toast('Noto 字体已装好，正在刷新页面…');
          setTimeout(() => location.reload(), 700);
        }
      }
    }, 500);
  }

  $('#btnFonts').addEventListener('click', async () => {
    $('#btnFonts').disabled = true;
    $('#fontProgress').hidden = false;
    $('#fontFill').style.width = '0%';
    $('#fontPct').textContent = '0%';
    $('#fontPhase').textContent = '准备中…';
    try {
      await api('/api/fonts/install', { method: 'POST', body: { force: false } });
      pollFonts();
    } catch (e) {
      toast('启动下载失败：' + e.message);
      $('#fontProgress').hidden = true;
      refreshFonts();
    }
  });

  /* ── 关闭程序 ───────────────────────────────────────── */

  async function quitApp() {
    try { await api('/api/shutdown', { method: 'POST' }); } catch { /* 进程已退出，属正常 */ }
    document.body.innerHTML = '<div style="display:flex;height:100vh;align-items:center;justify-content:center;'
      + 'font:15px/1.9 system-ui,-apple-system,\'Segoe UI\',sans-serif;color:#8b949e;background:#0d1117;text-align:center">'
      + '<div>Unicode-Atlas 已关闭。</div></div>';
  }

  $('#btnQuit').addEventListener('click', quitApp);
  $('#btnPower')?.addEventListener('click', quitApp);

  /* ── 花体英文生成器 ─────────────────────────────────── */

  const styleList = $('#styleList');

  function renderStyles() {
    if (!styleList) return;
    const rows = stylize($('#styleInput')?.value ?? '');
    if (!rows.length) {
      styleList.innerHTML = '<p class="muted">输入几个拉丁字母试试。</p>';
      return;
    }
    styleList.innerHTML = rows.map((r) => `<div class="style-row">
        <span class="style-name">${esc(state.zh ? r.name : r.nameEn)}</span>
        <span class="style-out" title="${esc(r.text)}">${esc(r.text)}</span>
        <button class="btn tiny" data-scopy="${esc(r.text)}">复制</button>
      </div>`).join('');
  }

  $('#btnStyleOpen')?.addEventListener('click', () => {
    closeSettings();
    $('#modalStyle').hidden = false;
    renderStyles();
    $('#styleInput')?.focus();
  });

  $('#styleInput')?.addEventListener('input', renderStyles);

  styleList?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-scopy]');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.scopy);
      toast('已复制');
    } catch {
      toast('复制失败');
    }
  });

  /* ── 使用教程 / 关于 ───────────────────────────────── */

  /* ── 运行日志 ───────────────────────────────────────── */

  let logTimer = null;

  async function refreshLog() {
    try {
      const r = await api('/api/logs');
      const view = $('#logView');
      if (!view) return;
      view.textContent = r.lines?.length ? r.lines.join('\n') : '（暂无输出）';
      view.scrollTop = view.scrollHeight;
      const meta = $('#logMeta');
      if (meta) {
        const up = Math.round((Date.now() - (r.startedAt || Date.now())) / 1000);
        meta.textContent = `进程 ${r.pid} · Node ${r.node} · 已运行 ${up} 秒 · ${r.lines?.length || 0} 行`;
      }
    } catch (err) {
      const view = $('#logView');
      if (view) view.textContent = `读取失败：${err.message}`;
    }
  }

  function openLog() {
    closeSettings();
    $('#modalLog').hidden = false;
    refreshLog();
    clearInterval(logTimer);
    logTimer = setInterval(() => {
      if ($('#modalLog').hidden) { clearInterval(logTimer); logTimer = null; return; }
      refreshLog();
    }, 2000);
  }

  function openGuide() {
    closeSettings();
    $('#modalGuide').hidden = false;
    const body = $('#modalGuide .modal-body');
    if (body) body.scrollTop = 0;
  }

  function openAbout() {
    closeSettings();
    const v = runtimeVersion();
    $('#aboutUcd').textContent = v ? `Unicode ${v}` : '—';
    $('#modalAbout').hidden = false;
  }

  /** 从已加载的元信息里取当前版本号（没有就回空） */
  function runtimeVersion() {
    const direct = state.meta?.activeVersion || state.versions?.active;
    if (direct) return direct;
    const label = $('#verLabel')?.textContent || '';
    const m = label.match(/(\d+\.\d+(?:\.\d+)?)/);
    return m ? m[1] : '';
  }

  $('#btnGuide')?.addEventListener('click', openGuide);
  $('#btnLog')?.addEventListener('click', openLog);
  $('#btnLogRefresh')?.addEventListener('click', refreshLog);
  $('#btnAbout')?.addEventListener('click', openAbout);

  /* ── 弹窗与键盘 ─────────────────────────────────────── */

  document.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) $('#' + close.dataset.close).hidden = true;
    if (e.target.classList.contains('modal')) e.target.hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $all('.modal').forEach((m) => { m.hidden = true; });
    }
    if (e.key === '/' && document.activeElement !== $('#search') && !e.target.closest('input, textarea')) {
      e.preventDefault();
      $('#search').focus();
    }
    if ((e.key === '?' || e.key === 'F1') && !e.target.closest('input, textarea, select')) {
      e.preventDefault();
      openGuide();
    }
  });

  /* ── 启动 ───────────────────────────────────────────── */

  function renderNoData() {
    $('#grid').innerHTML = `
      <div class="grid-empty" style="grid-column:1/-1;padding:50px 20px">
        <p class="big">🗂️</p>
        <p style="font-size:14px;color:var(--text);margin:0 0 6px">本地还没有 Unicode 数据</p>
        <p style="max-width:420px;margin:0 auto 18px;line-height:1.7">
          程序把每个版本的 UCD 完整下载到本地，装好之后完全离线可用。
          首次安装会下载约 6 MB 的核心数据；勾选 Unihan 再加约 8 MB。
        </p>
        <button class="btn primary" id="btnFirstInstall">安装最新版本</button>
      </div>`;
    $('#versionBadge').textContent = '未安装数据';
    $('#btnFirstInstall').addEventListener('click', async () => {
      const btn = $('#btnFirstInstall');
      btn.disabled = true;
      btn.textContent = '正在询问 unicode.org…';
      let version = '18.0.0';
      try {
        const info = await api('/api/check-update', { method: 'POST' });
        version = info.latest;
      } catch { /* 用兜底版本 */ }
      $('#modalManage').hidden = false;
      $('#installVersion').value = version;
      await refreshInstalled();
      loadReleases();
      startInstall();
    });
  }

  async function boot() {
    loadLocal();
    applyEmojiFont();
    renderLangBtn();
    renderTray();
    renderHistory();
    refreshFonts().catch(() => {});

    try {
      state.versions = await api('/api/versions');
      if (!state.versions.hasData) {
        renderNoData();
        return;
      }
      await loadMeta();
      await reload();
      renderVersionSelect();
      if (state.versions.lastCheck) renderCheckInfo(state.versions.lastCheck);
    } catch (e) {
      renderNoData();
      toast('连接本地服务失败：' + e.message);
    }
  }

  boot().then(() => {
    /* 允许用 #guide / #about 直达弹窗（便于分享与截图），要等元信息加载完才有版本号 */
    if (location.hash === '#guide') openGuide();
    else if (location.hash === '#about') openAbout();
    else if (location.hash === '#log') openLog();
  });

  /* 页面心跳：一条 SSE 长连接。浏览器会把后台标签页的定时器节流，轮询容易误判成
     「页面关了」；长连接不受影响，连接断开（关标签页/退浏览器）才让服务端收摊。 */
  function keepAlive() {
    let es;
    try {
      es = new EventSource('/api/live');
    } catch {
      setTimeout(keepAlive, 3000);
      return;
    }
    es.onerror = () => {
      es.close();
      setTimeout(keepAlive, 3000);
    };
  }
  keepAlive();
