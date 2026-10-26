// Guesses for required MCP tool arguments; enums are matched case-insensitively.
export const HINTS = {
  champion: 'Ahri',
  champion_name: 'Ahri',
  position: 'mid',
  lane: 'mid',
  game_mode: 'ranked',
  mode: 'ranked',
  region: 'kr',
  lang: 'ar_AE',
  language: 'ar_AE',
  desc_lang: 'ar_AE',
  game_name: 'Hide on bush',
  tag_line: 'KR1',
};

/** @param {any} schema @param {Record<string, unknown>} [hints] */
export function fillArgs(schema, hints = HINTS) {
  const props = schema?.properties ?? {};
  const args = {};
  for (const key of schema?.required ?? []) {
    const p = props[key] ?? {};
    if (Array.isArray(p.enum) && p.enum.length) {
      const hint = String(hints[key] ?? '').toLowerCase();
      args[key] = p.enum.find((v) => String(v).toLowerCase() === hint) ?? p.enum[0];
    } else if (key in hints) args[key] = hints[key];
    else if (p.default !== undefined) args[key] = p.default;
    else if (p.type === 'integer' || p.type === 'number') args[key] = 1;
    else if (p.type === 'boolean') args[key] = false;
    else return null;
  }
  return args;
}

const ARABIC = /[\u0600-\u06FF]/;

function firstArabic(value) {
  if (typeof value === 'string') return ARABIC.test(value) ? value : null;
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const hit = firstArabic(v);
      if (hit) return hit;
    }
  }
  return null;
}

export function summarizeJson(data) {
  const first = Array.isArray(data) ? data[0] : data;
  const keys = first && typeof first === 'object' ? Object.keys(first).slice(0, 25).join(',') : '';
  const ar = firstArabic(first);
  const head = Array.isArray(data) ? `array(${data.length})` : 'object';
  return `${head} keys=[${keys}] ar=${ar ? JSON.stringify(ar.slice(0, 120)) : 'none'}`;
}
