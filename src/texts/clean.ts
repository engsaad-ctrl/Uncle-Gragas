// Converts Riot's tooltip markup into a small, safe HTML subset for display.

const SPAN: Record<string, string> = {
  stats: 't-stats',
  attention: 't-key', keyword: 't-key', keywordmajor: 't-key', keywordstealth: 't-key',
  scalelevel: 't-key', spellname: 't-key', buffedstat: 't-key',
  scalead: 't-ad', physicaldamage: 't-ad', scalelethality: 't-ad', armorpen: 't-ad',
  scaleap: 't-ap', magicdamage: 't-ap',
  truedamage: 't-true',
  healing: 't-heal', scalehealth: 't-heal', health: 't-heal', shield: 't-heal', lifesteal: 't-heal', omnivamp: 't-heal',
  speed: 't-speed', ms: 't-speed',
  gold: 't-gold',
  scalearmor: 't-armor', scalemr: 't-mr', scalemana: 't-mana',
  status: 't-status', danger: 't-status',
  raritylegendary: 't-rarity', raritymythic: 't-rarity', raritygeneric: 't-rarity', prismatic: 't-rarity',
};

const WRAP: Record<string, 'b' | 'i'> = {
  passive: 'b', active: 'b', unique: 'b', b: 'b', spellpassive: 'b', onhit: 'b',
  i: 'i', flavortext: 'i', rules: 'i', jaderules: 'i',
};

export const VAR_HTML = '<span class="t-var" title="قيمة تحسبها اللعبة أثناء المباراة">؟</span>';
const VAR_SENTINEL = '\u0001';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function cleanSegment(text: string): string {
  return escapeHtml(text)
    .replace(/(?<![\d.,])0(?![\d.,])/g, VAR_SENTINEL) // the client leaves live-computed values as 0
    .replaceAll(VAR_SENTINEL, VAR_HTML);
}

const openTag = (name: string) => (SPAN[name] ? `<span class="${SPAN[name]}">` : `<${WRAP[name]}>`);
const closeTag = (name: string) => (SPAN[name] ? '</span>' : `</${WRAP[name]}>`);

function tidy(html: string): string {
  return html
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/<span class="[^"]*">\s*<\/span>|<b>\s*<\/b>|<i>\s*<\/i>/g, '')
    .replace(/(?:\s*<br>\s*){3,}/g, '<br><br>')
    .replace(/^(?:\s*(?:<br>|<hr>))+\s*|\s*(?:(?:<br>|<hr>)\s*)+$/g, '')
    .trim();
}

export function cleanText(raw: string): string {
  const pre = raw
    .replace(/@[\w.*]+@/g, VAR_SENTINEL)
    .replace(/\{\{[^}]*\}\}/g, VAR_SENTINEL)
    .replace(/%i:\w+%/g, '')
    .replace(/\[([^[\]|]*?)\s*\|\|\s*([^[\]]*?)\]/g, '$1 / $2')
    .replace(/\[([^[\]|]*)\]/g, '$1');

  const out: string[] = [];
  const stack: string[] = [];
  for (const part of pre.split(/(<[^>]*>)/)) {
    if (!/^<[^>]*>$/.test(part)) {
      out.push(cleanSegment(part));
      continue;
    }
    const m = /^<(\/?)\s*([a-zA-Z][\w-]*)/.exec(part);
    if (!m) continue;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'br') out.push('<br>');
    else if (name === 'hr') out.push('<hr>');
    else if (name === 'li') {
      if (!closing) out.push('<br>• ');
    } else if (SPAN[name] || WRAP[name]) {
      if (!closing) {
        stack.push(name);
        out.push(openTag(name));
      } else if (stack.at(-1) === name) {
        stack.pop();
        out.push(closeTag(name));
      }
    }
  }
  while (stack.length) out.push(closeTag(stack.pop()!));
  return tidy(out.join(''));
}

export function isUntranslated(s: string | undefined): boolean {
  const t = (s ?? '').trim();
  return t === '' || t.startsWith('GeneratedTip_') || /^Item_\d+_Name$/.test(t);
}

export function pickText(ar: string, en: string | undefined): { text: string; translated: boolean } {
  if (!isUntranslated(ar)) return { text: ar, translated: true };
  return { text: isUntranslated(en) ? '' : en!, translated: false };
}
