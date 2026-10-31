/**
 * 花体英文生成器：把拉丁字母 / 数字映射成 Unicode 里各种「字体」。
 *
 * 这些不是真正的字体，而是同一批字形被单独编码成各自的码点，所以复制到
 * 任何地方都能保持外观 —— 这也是它有意义的原因。
 *
 * 数学字母块不是连续的：script / fraktur / double-struck 里有一部分字母
 * 早在 U+2100 区就有了自己的码点，块里对应位置是空的，必须走 GAPS。
 */

const GAPS = {
  italic: { lower: { 7: '\u210E' } }, // ℎ
  script: {
    upper: { 1: '\u212C', 4: '\u2130', 5: '\u2131', 7: '\u210B', 8: '\u2110', 11: '\u2112', 12: '\u2133', 17: '\u211B' },
    lower: { 4: '\u212F', 6: '\u210A', 14: '\u2134' },
  },
  fraktur: { upper: { 2: '\u212D', 7: '\u210C', 8: '\u2111', 17: '\u211C', 25: '\u2128' } },
  double: { upper: { 2: '\u2102', 7: '\u210D', 13: '\u2115', 15: '\u2119', 16: '\u211A', 17: '\u211D', 25: '\u2124' } },
};

/** 由数学字母块的起点拼出一个映射函数 */
function mathStyle(baseUpper, baseLower, baseDigit, gapKey) {
  const gaps = GAPS[gapKey] || {};
  return (ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x41 && c <= 0x5a) {
      const i = c - 0x41;
      const g = gaps.upper?.[i];
      return g || String.fromCodePoint(baseUpper + i);
    }
    if (c >= 0x61 && c <= 0x7a) {
      const i = c - 0x61;
      const g = gaps.lower?.[i];
      return g || String.fromCodePoint(baseLower + i);
    }
    if (baseDigit && c >= 0x30 && c <= 0x39) return String.fromCodePoint(baseDigit + (c - 0x30));
    return ch;
  };
}

/** 简单的一对一查表风格 */
function tableStyle(map, fallback = (ch) => ch) {
  return (ch) => map[ch] ?? fallback(ch);
}

const SMALL_CAPS = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
  k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ',
  u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
};

const SUPER = {
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ',
  k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ',
  v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
  0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
};

const SUB = {
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ',
  p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
  0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
};

const CIRCLE = (() => {
  const m = {};
  for (let i = 0; i < 26; i++) {
    m[String.fromCharCode(65 + i)] = String.fromCodePoint(0x24b6 + i);
    m[String.fromCharCode(97 + i)] = String.fromCodePoint(0x24d0 + i);
  }
  for (let i = 0; i <= 9; i++) m[String(i)] = String.fromCodePoint(i === 0 ? 0x24ea : 0x2460 + i - 1); // ⓪①②…
  return m;
})();

// 方块字母只有大写（U+1F130 起），小写没有对应码点
const SQUARE = (() => {
  const m = {};
  for (let i = 0; i < 26; i++) m[String.fromCharCode(65 + i)] = String.fromCodePoint(0x1f130 + i);
  return m;
})();
const square = (ch) => SQUARE[ch] ?? SQUARE[ch.toUpperCase()] ?? ch;

const FULLWIDTH = (ch) => {
  const c = ch.codePointAt(0);
  if (c === 0x20) return '\u3000';
  if (c >= 0x21 && c <= 0x7e) return String.fromCodePoint(c + 0xfee0);
  return ch;
};

/* 倒置体：字母先翻转形状，整个字符串再逆序 */
const FLIP = {
  a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ',
  k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ',
  u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z',
  A: '∀', B: '𐐒', C: 'Ɔ', D: '◖', E: 'Ǝ', F: 'Ⅎ', G: '⅁', H: 'H', I: 'I', J: 'ſ',
  K: 'ʞ', L: '˥', M: 'W', N: 'N', O: 'O', P: 'Ԁ', Q: 'Ό', R: 'ᴚ', S: 'S', T: '⊥',
  U: '∩', V: 'Λ', W: 'M', X: 'X', Y: '⅄', Z: 'Z',
  0: '0', 1: 'Ɩ', 2: 'ᄅ', 3: 'Ɛ', 4: 'ㄣ', 5: 'ϛ', 6: '9', 7: 'ㄥ', 8: '8', 9: '6',
  '.': '˙', ',': "'", '?': '¿', '!': '¡', "'": ',', '"': '„', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{',
};
const flip = (text) => [...text].map((ch) => FLIP[ch] ?? ch).reverse().join('');

const perChar = (fn) => (text) => [...text].map(fn).join('');

/** 全部风格；顺序即界面顺序 */
export const STYLES = [
  { id: 'bold', name: '粗体', nameEn: 'Bold', fn: perChar(mathStyle(0x1d400, 0x1d41a, 0x1d7ce)) },
  { id: 'italic', name: '斜体', nameEn: 'Italic', fn: perChar(mathStyle(0x1d434, 0x1d44e, null, 'italic')) },
  { id: 'bolditalic', name: '粗斜体', nameEn: 'Bold italic', fn: perChar(mathStyle(0x1d468, 0x1d482, null)) },
  { id: 'script', name: '花体（手写）', nameEn: 'Script', fn: perChar(mathStyle(0x1d49c, 0x1d4b6, null, 'script')) },
  { id: 'boldscript', name: '粗花体', nameEn: 'Bold script', fn: perChar(mathStyle(0x1d4d0, 0x1d4ea, null)) },
  { id: 'fraktur', name: '哥特体', nameEn: 'Fraktur', fn: perChar(mathStyle(0x1d504, 0x1d51e, null, 'fraktur')) },
  { id: 'boldfraktur', name: '粗哥特体', nameEn: 'Bold fraktur', fn: perChar(mathStyle(0x1d56c, 0x1d586, null)) },
  { id: 'double', name: '空心体（双线）', nameEn: 'Double-struck', fn: perChar(mathStyle(0x1d538, 0x1d552, 0x1d7d8, 'double')) },
  { id: 'sans', name: '无衬线', nameEn: 'Sans-serif', fn: perChar(mathStyle(0x1d5d4, 0x1d5ee, 0x1d7e2)) },
  { id: 'boldsans', name: '粗无衬线', nameEn: 'Bold sans', fn: perChar(mathStyle(0x1d63c, 0x1d656, 0x1d7ec)) },
  { id: 'mono', name: '等宽', nameEn: 'Monospace', fn: perChar(mathStyle(0x1d670, 0x1d68a, 0x1d7f6)) },
  { id: 'smallcaps', name: '小型大写', nameEn: 'Small caps', fn: perChar(tableStyle(SMALL_CAPS, (ch) => SMALL_CAPS[ch.toLowerCase()] ?? ch)) },
  { id: 'circle', name: '圆圈', nameEn: 'Circled', fn: perChar(tableStyle(CIRCLE)) },
  { id: 'square', name: '方框', nameEn: 'Squared', fn: perChar(square) },
  { id: 'fullwidth', name: '全角', nameEn: 'Fullwidth', fn: perChar(FULLWIDTH) },
  { id: 'super', name: '上标', nameEn: 'Superscript', fn: perChar(tableStyle(SUPER)) },
  { id: 'sub', name: '下标', nameEn: 'Subscript', fn: perChar(tableStyle(SUB)) },
  { id: 'flip', name: '倒置', nameEn: 'Upside down', fn: flip },
];

/** 生成所有风格；空输入直接返回空 */
export function stylize(text) {
  const src = String(text ?? '');
  if (!src.trim()) return [];
  return STYLES.map((s) => ({ id: s.id, name: s.name, nameEn: s.nameEn, text: s.fn(src) }));
}
