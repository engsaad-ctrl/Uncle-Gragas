// OP.GG MCP answers in a compact text format (undocumented; seen in the 2026-10 probe):
//   class Name: field1,field2,…      one header line per class
//   <blank line>
//   Name(value, …)                   values: numbers, "strings", [lists], Name(…), true/false/null
// Some tools answer with plain JSON instead; that is passed through.

export type OpggValue = number | string | boolean | null | OpggValue[] | { [field: string]: OpggValue };

const KEYWORDS: Record<string, OpggValue> = { true: true, True: true, false: false, False: false, null: null, None: null };

export function parseOpgg(text: string): OpggValue {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed) as OpggValue;

  const classes = new Map<string, string[]>();
  const lines = trimmed.split(/\r?\n/); // Windows line endings: '.' in the header regex would not match '\r'
  let line = 0;
  for (; line < lines.length && lines[line].startsWith('class '); line++) {
    const m = /^class (\w+):\s*(.*)$/.exec(lines[line]);
    if (m) classes.set(m[1], m[2] ? m[2].split(',').map((f) => f.trim()) : []);
  }
  const src = lines.slice(line).join('\n').trim();
  let pos = 0;

  const fail = (msg: string): never => {
    throw new Error(`OP.GG format: ${msg} at ${pos}`);
  };
  const skipSpace = () => {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  };

  function list(close: string): OpggValue[] {
    pos++; // opener
    const out: OpggValue[] = [];
    skipSpace();
    if (src[pos] === close) {
      pos++;
      return out;
    }
    for (;;) {
      out.push(value());
      skipSpace();
      if (src[pos] === ',') pos++;
      else if (src[pos] === close) {
        pos++;
        return out;
      } else fail(`expected "," or "${close}"`);
    }
  }

  function string(): string {
    const start = pos++;
    while (pos < src.length && src[pos] !== '"') pos += src[pos] === '\\' ? 2 : 1;
    if (pos >= src.length) fail('unterminated string');
    pos++;
    const quoted = src.slice(start, pos);
    try {
      return JSON.parse(quoted) as string;
    } catch {
      return quoted.slice(1, -1); // raw control characters: keep the text as-is
    }
  }

  function value(): OpggValue {
    skipSpace();
    const ch = src[pos];
    if (ch === '"') return string();
    if (ch === '[') return list(']');
    const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(pos, pos + 40));
    if (num) {
      pos += num[0].length;
      return Number(num[0]);
    }
    const word = /^[A-Za-z_]\w*/.exec(src.slice(pos, pos + 80))?.[0] ?? fail(`unexpected ${JSON.stringify(ch ?? 'end')}`);
    pos += word.length;
    if (src[pos] !== '(') {
      if (word in KEYWORDS) return KEYWORDS[word];
      return fail(`unknown word ${word}`);
    }
    const fields = classes.get(word) ?? fail(`unknown class ${word}`);
    const args = list(')');
    return Object.fromEntries(fields.map((f, i) => [f, args[i] ?? null]));
  }

  const result = value();
  skipSpace();
  if (pos < src.length) fail('trailing text');
  return result;
}
