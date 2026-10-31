/** 各类枚举值的可读名，UI 直接消费 */

export const GC_NAMES = {
  Lu: 'Uppercase Letter', Ll: 'Lowercase Letter', Lt: 'Titlecase Letter',
  Lm: 'Modifier Letter', Lo: 'Other Letter',
  Mn: 'Nonspacing Mark', Mc: 'Spacing Mark', Me: 'Enclosing Mark',
  Nd: 'Decimal Number', Nl: 'Letter Number', No: 'Other Number',
  Pc: 'Connector Punctuation', Pd: 'Dash Punctuation', Ps: 'Open Punctuation',
  Pe: 'Close Punctuation', Pi: 'Initial Punctuation', Pf: 'Final Punctuation', Po: 'Other Punctuation',
  Sm: 'Math Symbol', Sc: 'Currency Symbol', Sk: 'Modifier Symbol', So: 'Other Symbol',
  Zs: 'Space Separator', Zl: 'Line Separator', Zp: 'Paragraph Separator',
  Cc: 'Control', Cf: 'Format', Cs: 'Surrogate', Co: 'Private Use', Cn: 'Unassigned',
};

export const GC_GROUPS = {
  L: { label: '字母 Letter', desc: 'L*', gcs: ['Lu', 'Ll', 'Lt', 'Lm', 'Lo'] },
  M: { label: '组合标记 Mark', desc: 'M*', gcs: ['Mn', 'Mc', 'Me'] },
  N: { label: '数字 Number', desc: 'N*', gcs: ['Nd', 'Nl', 'No'] },
  P: { label: '标点 Punctuation', desc: 'P*', gcs: ['Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po'] },
  S: { label: '符号 Symbol', desc: 'S*', gcs: ['Sm', 'Sc', 'Sk', 'So'] },
  Z: { label: '分隔符 Separator', desc: 'Z*', gcs: ['Zs', 'Zl', 'Zp'] },
  C: { label: '其他 Other', desc: 'C*', gcs: ['Cc', 'Cf', 'Cs', 'Co', 'Cn'] },
};

export const BIDI_NAMES = {
  L: 'Left-to-Right', R: 'Right-to-Left', AL: 'Arabic Letter', EN: 'European Number',
  ES: 'European Separator', ET: 'European Terminator', AN: 'Arabic Number',
  CS: 'Common Separator', NSM: 'Nonspacing Mark', BN: 'Boundary Neutral',
  B: 'Paragraph Separator', S: 'Segment Separator', WS: 'White Space',
  ON: 'Other Neutral', LRE: 'LTR Embedding', LRO: 'LTR Override',
  RLE: 'RTL Embedding', RLO: 'RTL Override', PDF: 'Pop Directional Format',
  LRI: 'LTR Isolate', RLI: 'RTL Isolate', FSI: 'First Strong Isolate', PDI: 'Pop Directional Isolate',
};

export const EAW_NAMES = {
  N: 'Neutral', Na: 'Narrow', A: 'Ambiguous', W: 'Wide', F: 'Fullwidth', H: 'Halfwidth',
};

export const DECOMP_TYPE_NAMES = {
  canonical: 'Canonical',
  compat: 'Compatibility',
  font: 'Font', noBreak: 'No-Break', initial: 'Initial', medial: 'Medial',
  final: 'Final', isolated: 'Isolated', circle: 'Circle', super: 'Superscript',
  sub: 'Subscript', vertical: 'Vertical', wide: 'Wide', narrow: 'Narrow',
  small: 'Small', square: 'Square', fraction: 'Fraction', compat2: 'Compat',
};

export const NUMERIC_TYPE_NAMES = {
  decimal: 'Decimal', digit: 'Digit', numeric: 'Numeric',
};

/** 平面范围 */
export const PLANES = [
  { id: 0, label: 'BMP', first: 0x0, last: 0xffff, desc: '基本多文种平面' },
  { id: 1, label: 'SMP', first: 0x10000, last: 0x1ffff, desc: '辅助多文种平面' },
  { id: 2, label: 'SIP', first: 0x20000, last: 0x2ffff, desc: '表意文字补充平面' },
  { id: 3, label: 'TIP', first: 0x30000, last: 0x3ffff, desc: '表意文字第三平面' },
  { id: 14, label: 'SSP', first: 0xe0000, last: 0xeffff, desc: '特别用途平面' },
  { id: 15, label: 'PUA-A', first: 0xf0000, last: 0xfffff, desc: '私用区平面 15' },
  { id: 16, label: 'PUA-B', first: 0x100000, last: 0x10ffff, desc: '私用区平面 16' },
];

/** 控制字符与不可见字符的通用缩写（用于「看不到的字符」的可见化呈现） */
export const CONTROL_ABBREV = {
  0x00: 'NUL', 0x01: 'SOH', 0x02: 'STX', 0x03: 'ETX', 0x04: 'EOT', 0x05: 'ENQ', 0x06: 'ACK',
  0x07: 'BEL', 0x08: 'BS', 0x09: 'HT', 0x0a: 'LF', 0x0b: 'VT', 0x0c: 'FF', 0x0d: 'CR',
  0x0e: 'SO', 0x0f: 'SI', 0x10: 'DLE', 0x11: 'DC1', 0x12: 'DC2', 0x13: 'DC3', 0x14: 'DC4',
  0x15: 'NAK', 0x16: 'SYN', 0x17: 'ETB', 0x18: 'CAN', 0x19: 'EM', 0x1a: 'SUB', 0x1b: 'ESC',
  0x1c: 'FS', 0x1d: 'GS', 0x1e: 'RS', 0x1f: 'US', 0x20: 'SP', 0x7f: 'DEL',
  0x80: 'PAD', 0x81: 'HOP', 0x82: 'BPH', 0x83: 'NBH', 0x84: 'IND', 0x85: 'NEL', 0x86: 'SSA',
  0x87: 'ESA', 0x88: 'HTS', 0x89: 'HTJ', 0x8a: 'VTS', 0x8b: 'PLD', 0x8c: 'PLU', 0x8d: 'RI',
  0x8e: 'SS2', 0x8f: 'SS3', 0x90: 'DCS', 0x91: 'PU1', 0x92: 'PU2', 0x93: 'STS', 0x94: 'CCH',
  0x95: 'MW', 0x96: 'SPA', 0x97: 'EPA', 0x98: 'SOS', 0x99: 'SGCI', 0x9a: 'SCI', 0x9b: 'CSI',
  0x9c: 'ST', 0x9d: 'OSC', 0x9e: 'PM', 0x9f: 'APC',
};

export const ALIAS_TYPE_NAMES = {
  correction: '更正名 correction',
  control: '控制字符缩写 control',
  alternate: '替代名 alternate',
  figment: '虚构名 figment',
  abbreviation: '缩写 abbreviation',
};

export const CJK_RADICAL_NAMES_HINT = 'Unihan kRSUnicode = 部首编号.附加笔画数';
