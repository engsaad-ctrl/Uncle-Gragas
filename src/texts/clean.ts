// Converts Riot's tooltip markup into a small, safe HTML subset for display.

const SPAN: Record<string, string> = {
  stats: 't-stats',
  attention: 't-key', keyword: 't-key', keywordmajor: 't-key', keywordstealth: 't-key',
  scalelevel: 't-key', spellname: 't-key', buffedstat: 't-key',
  physicaldamage: 't-ad', armorpen: 't-ad',
  magicdamage: 't-ap',
  truedamage: 't-true',
  healing: 't-heal', health: 't-heal', shield: 't-heal', lifesteal: 't-heal', omnivamp: 't-heal',
  speed: 't-speed', ms: 't-speed',
  gold: 't-gold',
  // Stat tags take the colour of the game's icon for that stat (.s-scale… in styles.css, measured from the icons).
  ...Object.fromEntries(
    ['scalead', 'scaleap', 'scalearmor', 'scalemr', 'scalehealth', 'scaleas', 'scalems', 'scalecrit', 'scalecritmult', 'scaleah', 'scalecooldown',
      'scalemana', 'scalemanaregen', 'scalehpregen', 'scaleapen', 'scalempen', 'scalels', 'scalesv', 'scalehealshield', 'scaletenacity',
      'scaleadaptiveforce', 'scalerange'].map((t) => [t, `s-${t}`]),
  ),
  scalelethality: 's-scaleapen', goldcoins: 't-gold',
  status: 't-status', danger: 't-status',
  nowrap: 't-nw', // ours, from spellValues: a ratio that must not wrap mid-phrase
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

// The game's text icons (%i:scaleAP% …), served by CommunityDragon from the client's own files (2026-10).
const ICON_BASE = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/fonts/texticons/lol/';
/** Stat icons with their Arabic name (shown on hover and read by screen readers). */
const STAT_ICONS: Record<string, string> = {
  scalead: 'ضرر الهجوم', scaleap: 'قوة القدرة', scalearmor: 'الدروع', scalemr: 'مقاومة السحر', scalehealth: 'الصحة',
  scaleas: 'سرعة الهجوم', scalems: 'سرعة الحركة', scalecrit: 'الضربة الحرجة', scalecritmult: 'ضرر الضربة الحرجة',
  scaleah: 'تسارع القدرة', scalecooldown: 'التبريد', scalemana: 'المانا', scalemanaregen: 'تجدد المانا', scalehpregen: 'تجدد الصحة',
  scaleapen: 'اختراق الدروع', scalempen: 'اختراق السحر', scalels: 'سرقة الصحة', scalesv: 'العلاج الكامن', scalehealshield: 'قوة العلاج والدروع',
  scaletenacity: 'التماسك', scaleadaptiveforce: 'القوة المتكيفة', scalelevel: 'المستوى', scalerange: 'المدى', scalesize: 'الحجم', onhit: 'عند الإصابة',
  miniad: 'ضرر الهجوم', miniap: 'قوة القدرة', miniarmor: 'الدروع', minimr: 'مقاومة السحر', minihealth: 'الصحة', miniadaptiveforce: 'القوة المتكيفة',
};
const GAMEPLAY_ICONS: Record<string, string> = {
  cooldown: 'التبريد', activeeffect: 'تأثير نشط', goldcoins: 'الذهب', silvercoins: 'العملات', meleeactive: 'القتال القريب', rangedactive: 'القتال البعيد',
  meleeinactive: 'القتال القريب', rangedinactive: 'القتال البعيد', stun: 'صعق',
};
const ICON_OPEN = '\u0002';
const ICON_CLOSE = '\u0003';

/** The <img> for a known text icon; unknown names show nothing (as before). Names are whitelisted, so the markup is safe. */
function iconHtml(token: string): string {
  const t = token.toLowerCase();
  const folder = STAT_ICONS[t] ? 'statsicon' : GAMEPLAY_ICONS[t] ? 'gameplay' : null;
  if (!folder) return '';
  const title = STAT_ICONS[t] ?? GAMEPLAY_ICONS[t];
  return `<img class="t-ico" src="${ICON_BASE}${folder}/${t}.png" alt="${title}" title="${title}">`;
}

/** Follows a 0 the game files really hold (written by spellValues), so the rule below keeps it as a number. */
export const REAL_ZERO = '\u2060';

function cleanSegment(text: string): string {
  return escapeHtml(text)
    .replace(/(?<![\d.,])0(?![\d.,\u2060])/g, VAR_SENTINEL) // CommunityDragon's text leaves live-computed values as 0
    .replaceAll(REAL_ZERO, '')
    .replaceAll(VAR_SENTINEL, VAR_HTML)
    .replace(new RegExp(`${ICON_OPEN}(\\w+)${ICON_CLOSE}`, 'g'), (_, name: string) => iconHtml(name));
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
    .replace(/%i:(\w+)%/g, (_, name: string) => ICON_OPEN + name + ICON_CLOSE)
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
