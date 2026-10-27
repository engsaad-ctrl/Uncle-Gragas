// The over-the-game window: the picked champion's build (spells, runes, skills, items) and augments, with a quick search.

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

function render() {
  if (!data) return;
  // Rarity first (prismatic, gold, silver, special), then name, like the augments page.
  const order = Object.keys(RARITY_LABEL);
  const shown = filterAugments(data.augments, search.value, 'all', 'all').sort(
    (x, y) => order.indexOf(x.rarity) - order.indexOf(y.rarity) || shownName(x).localeCompare(shownName(y), getNameLang()),
  );
  list.replaceChildren(
    ...shown.slice(0, 60).map((a) => {
      const row = el('button', `ov-row r-${a.rarity}${open === a.id ? ' open' : ''}`);
      row.type = 'button';
      const name = el('div', 'ov-name');
      name.append(el('b', '', shownName(a)), el('small', '', RARITY_LABEL[a.rarity]));
      row.append(icon(a.iconUrl), name);
      if (data!.rated && a.performance !== undefined) row.append(el('span', 'ov-score', `أداء ${a.performance.toFixed(0)}`));
      if (open === a.id) {
        const desc = el('div', 'ov-desc');
        if (a.html) desc.innerHTML = a.html; // safe: produced by cleanText (escaped text, whitelisted tags only)
        else desc.textContent = 'لا يوجد وصف.';
        row.append(desc);
      }
      row.addEventListener('click', () => ((open = open === a.id ? undefined : a.id), render()));
      return row;
    }),
  );
  if (!shown.length) list.replaceChildren(el('p', 'missing', 'لا يوجد تعزيز بهذا الاسم.'));
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

/** Compact build: what to set and buy, in the order the player needs it during the game. */
function renderBuild(p: ChampionPage) {
  if (p.buildError) return buildBox.replaceChildren(el('p', 'missing', p.buildError));
  const out: HTMLElement[] = [];
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

async function load() {
  const reply = await window.lolh.overlayData();
  if (isError(reply)) {
    list.replaceChildren(el('p', 'missing', `تعذّر التحميل: ${reply.error}`));
    return;
  }
  data = reply;
  const champ = byId<HTMLImageElement>('ov-champ');
  champ.hidden = !reply.champion;
  if (reply.champion) champ.src = reply.champion.portraitUrl;
  byId('ov-title').textContent = reply.champion ? shownName(reply.champion) : 'كل التعزيزات';
  byId('ov-sub').textContent = reply.build && reply.mode
    ? `${MODE_TITLE[reply.mode]}${reply.build.position ? ` · ${reply.build.position.toUpperCase()}` : ''}${reply.rated ? ' · مع مؤشر أداء التعزيزات' : ''}`
    : reply.rated
    ? 'Mayhem · مع مؤشر أداء كل تعزيز لهذا البطل'
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
