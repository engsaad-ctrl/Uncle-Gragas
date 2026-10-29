// The over-the-game window: the picked champion's build (spells, runes, skills, items) and augments, with a quick search.

import { adaptBuild, FOCUS_LABEL } from '../app/augmentBuild.js';
import type { ChampionPage, ItemChoice } from '../app/championPage.js';
import { placeFlash } from '../lcu/apply.js';
import type { OverlayData } from '../main/services.js';
import { RARITY_LABEL } from './augmentsView.js';
import { byId, el, getFlashKey, getNameLang, icon, isError, MODE_TITLE, pct, shownName, withTooltip, type Describable } from './dom.js';
import { filterAugments } from './search.js';
import { applyRandomTheme } from './theme.js';

applyRandomTheme(); // colours only: the overlay hides the background art
const search = byId<HTMLInputElement>('ov-search');
const list = byId('ov-list');
let data: OverlayData | undefined;
let open: number | undefined;
/** The Mayhem augments the player marked this game (up to 4), for the adapted build; cleared for a new champion. */
const picked = new Set<number>();
let pickedFor: number | undefined;
const MAX_PICKS = 4;

function render() {
  if (!data) return;
  // Grouped by type (prismatic, gold, silver, special) like the champion page; in each group this champion's rated
  // augments first in the recommended order (#1 = best), then the rest by name.
  const rated = (a: OverlayData['augments'][number]) => (data!.rated && a.rank !== undefined ? 0 : 1);
  const all = filterAugments(data.augments, search.value, 'all', 'all');
  const groups = (Object.keys(RARITY_LABEL) as (keyof typeof RARITY_LABEL)[]).flatMap((rarity) => {
    const list = all
      .filter((a) => a.rarity === rarity)
      .sort((x, y) => rated(x) - rated(y) || (x.rank ?? 0) - (y.rank ?? 0) || shownName(x).localeCompare(shownName(y), getNameLang()));
    if (!list.length) return [];
    return [el('h3', `ov-group r-${rarity}`, RARITY_LABEL[rarity]), ...list.map(row)];
  });
  list.replaceChildren(...groups);
  if (!groups.length) list.replaceChildren(el('p', 'missing', 'لا يوجد تعزيز بهذا الاسم.'));

  function row(a: OverlayData['augments'][number]) {
    const r = el('button', `ov-row r-${a.rarity}${open === a.id ? ' open' : ''}`);
    r.type = 'button';
    const name = el('div', 'ov-name');
    name.append(el('b', '', shownName(a)), el('small', '', RARITY_LABEL[a.rarity]));
    r.append(icon(a.iconUrl), name);
    if (rated(a) === 0) r.append(el('span', 'ov-score', `#${a.rank} · ${pct(a.popularity ?? 0)}`));
    if (data!.mode === 'mayhem') {
      const on = picked.has(a.id);
      const pick = el('span', `ov-pick${on ? ' on' : ''}`, on ? '✓ اخترته' : 'اخترته');
      pick.setAttribute('role', 'button');
      pick.title = 'علّم التعزيز الذي أخذته ليُعاد ترتيب الأيتمات في تبويب البناء';
      pick.addEventListener('click', (e) => {
        e.stopPropagation(); // not the row's "show description"
        if (on) picked.delete(a.id);
        else if (picked.size < MAX_PICKS) picked.add(a.id);
        render();
        if (data?.build) renderBuild(data.build);
      });
      r.classList.toggle('picked', on);
      r.append(pick);
    }
    if (open === a.id) {
      const desc = el('div', 'ov-desc');
      if (a.html) desc.innerHTML = a.html; // safe: produced by cleanText (escaped text, whitelisted tags only)
      else desc.textContent = 'لا يوجد وصف.';
      r.append(desc);
    }
    r.addEventListener('click', () => ((open = open === a.id ? undefined : a.id), render()));
    if (open !== a.id) withTooltip(r, a, { className: `r-${a.rarity}` }); // hover shows it too, like everywhere else
    return r;
  }
}

const tabs = byId('ov-tabs');
const buildBox = byId('ov-build');
const augBox = byId('ov-aug');
let tab: 'build' | 'augments' = 'build';

function showTab(t: typeof tab) {
  tab = t;
  buildBox.hidden = t !== 'build';
  augBox.hidden = t !== 'augments';
  for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('active', b.dataset.tab === t);
  if (t === 'augments') search.focus();
}
tabs.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (b) showTab(b.dataset.tab as typeof tab);
});

const ic = (x: Describable) => withTooltip(icon(x.iconUrl, 'ic'), x);

function section(title: string, ...body: (HTMLElement | string)[]) {
  const s = el('section', 'ov-sec');
  s.append(el('h3', '', title), ...body);
  return s;
}
function icons(xs: Describable[]) {
  const row = el('div', 'ov-icons');
  row.append(...xs.map(ic));
  return row;
}

/** Mayhem: the items re-ranked for the augments the player marked, each with its reason. */
function adaptedSection(p: ChampionPage): HTMLElement {
  const chosen = (data?.augments ?? []).filter((a) => picked.has(a.id));
  if (!chosen.length) return section('الأيتمات حسب تعزيزاتك', el('p', 'hint', 'من تبويب التعزيزات اضغط «اخترته» على كل تعزيز تأخذه، فيُعاد ترتيب الأيتمات هنا.'));
  const adapted = adaptBuild(p, chosen.map((a) => ({ name: shownName(a), enName: a.enName, html: a.html })), data?.items ?? []);
  const rows = el('div', 'ov-adapted');
  for (const { item, reasons } of adapted.items) {
    const r = el('div', 'ov-adapted-row');
    const txt = el('div', 'ov-name');
    txt.append(el('b', '', shownName(item)), el('small', '', reasons.join(' · ')));
    r.append(ic(item), txt);
    rows.append(r);
  }
  const why = adapted.focus.length ? `تعزيزاتك تميل إلى: ${adapted.focus.slice(0, 3).map((f) => FOCUS_LABEL[f]).join('، ')}.` : '';
  return section('الأيتمات حسب تعزيزاتك', icons(chosen), el('p', 'hint', `${why} ترتيب تقديري من نصوص اللعبة وبناء البطل، لا إحصائية مباريات.`), rows);
}

/** Compact build: what to set and buy, in the order the player needs it during the game. */
function renderBuild(p: ChampionPage) {
  if (p.buildError) return buildBox.replaceChildren(el('p', 'missing', p.buildError));
  const out: HTMLElement[] = [];
  // No stats site has Mayhem builds: say so, or the ARAM build looks like a wrong mode.
  if (p.mode === 'mayhem') out.push(adaptedSection(p));
  if (p.mode === 'mayhem') out.push(el('p', 'hint', 'بناء ARAM: لا توجد إحصائيات بناء خاصة بـ Mayhem، فهذا أقرب بناء متاح. التعزيزات في تبويبها خاصة بـ Mayhem.'));
  if (p.stats) out.push(el('p', 'en', `نسبة الفوز ${pct(p.stats.winRate)} · ${p.stats.games.toLocaleString('en')} مباراة`));
  if (p.skillPriority.length || p.skillOrder.length) {
    const prio = el('div', 'ov-skills');
    prio.dir = 'ltr';
    prio.append(...p.skillPriority.flatMap((k, i) => [...(i ? [el('span', 'arrow', '›')] : []), el('b', `k-${k}`, k)]));
    const order = el('div', 'ov-order');
    order.dir = 'ltr';
    order.append(...p.skillOrder.slice(0, 18).map((k, i) => {
      const n = el('span', `k-${k}`, k);
      n.title = `مستوى ${i + 1}`;
      return n;
    }));
    out.push(section('ترتيب المهارات', prio, order));
  }
  if (p.runes?.primary) {
    const chosen = (t: NonNullable<typeof p.runes>['primary']) => (t?.rows ?? []).flatMap((r) => r.options.filter((o) => o.selected));
    const runes = el('div', 'ov-runes');
    runes.append(icons(chosen(p.runes.primary)), icons(chosen(p.runes.sub)), icons(p.runes.shards.flatMap((r) => r.options.filter((o) => o.selected))));
    out.push(section('الرونز', runes));
  }
  if (p.spells.length) {
    const key = getFlashKey();
    out.push(section('التعاويذ', icons(key && p.spells.length === 2 ? placeFlash([p.spells[0], p.spells[1]], key) : p.spells)));
  }
  const items: [string, ItemChoice | null][] = [
    ['البداية', p.starter], ['الأساسية', p.core], ['الحذاء', p.boots],
    ['الرابع', p.fourth[0] ?? null], ['الخامس', p.fifth[0] ?? null], ['السادس', p.sixth[0] ?? null],
  ];
  const grid = el('div', 'ov-items');
  for (const [label, c] of items) {
    if (!c?.items.length) continue;
    const row = el('div', 'ov-item-row');
    row.append(el('small', '', label), icons(c.items));
    grid.append(row);
  }
  if (grid.childElementCount) out.push(section('الأيتمات', grid));
  buildBox.replaceChildren(...(out.length ? out : [el('p', 'missing', 'لا يوجد بناء لهذا البطل.')]));
}

let loadId = 0;
async function load() {
  const id = ++loadId;
  const reply = await window.lolh.overlayData();
  if (id !== loadId) return; // F7 pressed again meanwhile: the newer answer wins
  if (isError(reply)) {
    // Drop the last game's champion and build: they would stay on screen under the error.
    data = undefined;
    tabs.hidden = true;
    byId('ov-champ').hidden = true;
    byId('ov-title').textContent = 'التعزيزات';
    byId('ov-sub').textContent = '';
    showTab('augments');
    list.replaceChildren(el('p', 'missing', `تعذّر التحميل: ${reply.error}`));
    return;
  }
  data = reply;
  if (pickedFor !== reply.champion?.id) (picked.clear(), (pickedFor = reply.champion?.id)); // a new game's champion
  const champ = byId<HTMLImageElement>('ov-champ');
  champ.hidden = !reply.champion;
  if (reply.champion) champ.src = reply.champion.portraitUrl;
  byId('ov-title').textContent = reply.champion ? shownName(reply.champion) : 'كل التعزيزات';
  byId('ov-sub').textContent = reply.build && reply.mode
    ? `${MODE_TITLE[reply.mode]}${reply.build.position ? ` · ${reply.build.position.toUpperCase()}` : ''}${reply.rated ? ' · الأفضل لهذا البطل أولاً' : ''}`
    : reply.rated
    ? 'Mayhem · الأفضل لهذا البطل أولاً'
    : reply.mode === 'arena'
      ? 'Arena · ابحث عن التعزيزات التي ظهرت لك'
      : 'اختر بطلاً في شاشة الاختيار ليظهر ترتيبه';
  render();
  tabs.hidden = !reply.build;
  if (reply.build) renderBuild(reply.build);
  showTab(reply.build ? 'build' : 'augments');
}

search.addEventListener('input', () => ((open = undefined), render()));
addEventListener('keydown', (e) => e.key === 'Escape' && void window.lolh.hideOverlay());
byId('ov-close').addEventListener('click', () => void window.lolh.hideOverlay());
window.lolh.onOverlayShow(() => {
  search.value = '';
  open = undefined;
  void load();
});
void load();
