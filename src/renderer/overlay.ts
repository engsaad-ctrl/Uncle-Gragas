// The over-the-game window: the picked champion's build (spells, runes, skills, items) and augments, with a quick search.

import type { Advice } from '../ai/advisor.js';
import { linksWith, type Link, type Mechanic } from '../ai/mechanics.js';
import { AUGMENT_MECHANICS } from '../ai/mechanicsData.js';
import { FIT_POINTS, fitOf, gradesFor, playedOnly, siteBonus } from './fit.js';
import type { ChampionPage, ItemChoice } from '../app/championPage.js';
import type { ItemEntry } from '../app/itemList.js';
import { placeFlash } from '../lcu/apply.js';
import type { AugmentEffect, GameTeams, OverlayData } from '../main/services.js';
import { adviceNodes, AI_HINT, AI_LOADING, WHY_AR } from './aiAdvice.js';
import { RARITY_LABEL } from './augmentsView.js';
import { byId, el, getFlashKey, getNameLang, icon, isError, MODE_TITLE, pct, pills, shownName, withTooltip, type Describable } from './dom.js';
import { filterAugments } from './search.js';
import { applyRandomTheme } from './theme.js';

applyRandomTheme(); // colours only: the overlay hides the background art
const search = byId<HTMLInputElement>('ov-search');
const list = byId('ov-list');
const aiBar = byId('ov-ai-bar');
// One rarity at a time, picked from the row above the list (all of them at first).
let shownRarity = 'all';
byId('ov-rarity').append(
  pills('نوع التعزيز', [['all', 'الكل'], ...(Object.entries(RARITY_LABEL) as [string, string][])], 'all', (v) => {
    shownRarity = v;
    open = undefined;
    render();
  }),
);
let data: OverlayData | undefined;
let open: number | undefined;
/** The Mayhem augments the player marked this game (up to 6), for the adapted build; cleared for a new champion. */
const picked = new Set<number>();
let pickedFor: number | undefined;
let restoredFor: number | undefined;
const MAX_PICKS = 6;
const FIT_GAMES = 150;
/** Each augment's effect on its team's win chance (team model), loaded with the window's data. */
let effects = new Map<number, AugmentEffect>();
const mechOf = (a: { id: number; ids?: number[] }) => AUGMENT_MECHANICS.find((m) => (a.ids ?? [a.id]).includes(m.id));
const NO_MECH: Mechanic = { id: -1, name: '', gives: [], scales: [], converts: [], relies: [], needs: [], note: '' };
const STAT_AR: Record<string, string> = {
  health: 'الصحة', bonus_health: 'الصحة الإضافية', ap: 'قوة القدرة', ad: 'ضرر الهجوم', bonus_ad: 'ضرر الهجوم الإضافي', attack_speed: 'سرعة الهجوم',
  crit: 'الضربة الحرجة', armor: 'الدرع', mr: 'مقاومة السحر', resists: 'المقاومات', mana: 'المانا', ability_haste: 'تسارع القدرات',
  move_speed: 'سرعة الحركة', gold: 'الذهب', omnivamp: 'الامتصاص', heal_shield_power: 'قوة العلاج والدروع',
};
const mechName = (id: number) => AUGMENT_MECHANICS.find((m) => m.id === id)?.name ?? String(id);
/** Why two augments work together, in one Arabic line. */
const linkInArabic = (l: Link) => {
  const stat = STAT_AR[l.stat] ?? l.stat;
  if (l.kind === 'needs') return `${mechName(l.from)} مبني على ${mechName(l.to)}`;
  if (l.kind === 'boosts') return `${mechName(l.from)} يعطي ${stat}، و${mechName(l.to)} يعتمد عليها`;
  return l.kind === 'feeds' ? `${mechName(l.from)} يزيد ${stat} بلا حد، و${mechName(l.to)} يستفيد منها` : `${mechName(l.from)} يتحوّل إلى ${stat}، و${mechName(l.to)} يستفيد منها`;
};
/** With augments marked: how much more each other one won alongside them in real games (see augmentPairs). */
let fit = new Map<number, { games: number; lift: number }>();
let fitFor = '';
/** The engine's build for the champion and the marked augments; key: the marks it was made for. */
let engine: { key: string; items: { item: ItemEntry; why: string[] }[]; error?: string } | undefined;
let engineAsked = '';
async function refreshEngine() {
  const key = pickedKey();
  const champion = data?.champion;
  if (!champion || !picked.size || engineAsked === key) return;
  engineAsked = key;
  const r = await window.lolh.engineBuild(champion.id, [...picked]);
  if (pickedKey() !== key) return;
  engine = isError(r) ? { key, items: [], error: r.error } : { key, items: r };
  if (data?.build) renderBuild(data.build);
}

async function refreshFit() {
  const key = [...picked].sort((a, b) => a - b).join('-');
  if (key === fitFor) return;
  fitFor = key;
  fit = new Map();
  if (!picked.size || data?.mode !== 'mayhem') return render();
  const r = await window.lolh.augmentFit([...picked]);
  if (fitFor !== key || isError(r)) return; // marks changed meanwhile, or no games to judge by
  fit = new Map(r.map((x) => [x.id, x]));
  render();
}

function toggleMark(id: number) {
  if (picked.has(id)) picked.delete(id);
  else if (picked.size < MAX_PICKS) picked.add(id);
  buildView = undefined; // the marks changed: back to the build that follows them
  render();
  if (data?.build) renderBuild(data.build);
  void refreshFit();
}

function render() {
  if (!data) return;
  // Grouped by type (prismatic, gold, silver, special) like the champion page; in each group this champion's rated
  // augments first in the recommended order (#1 = best), then the rest by name. With augments marked, the ones that
  // went best with them in real games come first.
  const rated = (a: OverlayData['augments'][number]) => (data!.rated && a.rank !== undefined ? 0 : 1);
  // How each augment works with the marked ones: by the texts (mechanics) and, with enough games, by real results.
  const pickedMechs = data.augments.filter((a) => picked.has(a.id)).flatMap((a) => mechOf(a) ?? []);
  const linksOf = (a: OverlayData['augments'][number]) => (picked.has(a.id) || !pickedMechs.length ? [] : linksWith(pickedMechs, mechOf(a) ?? NO_MECH));
  // One score in win-chance points: the augment's own effect (team model), plus, next to the marked augments, a point per
  // unit of text-link strength and a pair's measured lift when it has enough games.
  const score = (a: OverlayData['augments'][number]) => {
    const f = fit.get(a.id);
    const kit = fitOf(data!.champion?.id, a.ids ?? [a.id])?.score ?? 0; // a near-tie breaker only (src/renderer/fit.ts)
    return (effects.get(a.id)?.points ?? 0) + siteBonus(a.tierLabel) + FIT_POINTS * kit + linksOf(a).reduce((s, l) => s + l.strength, 0) + (f && f.games >= FIT_GAMES ? 100 * f.lift : 0);
  };
  const fits = (a: OverlayData['augments'][number]) => (picked.has(a.id) ? Infinity : score(a));
  const pool = data.mode === 'mayhem' ? playedOnly(data.augments, effects, picked) : data.augments;
  const grades = gradesFor(pool, score);
  const all = filterAugments(pool, search.value, 'all', 'all');
  const groups = (Object.keys(RARITY_LABEL) as (keyof typeof RARITY_LABEL)[]).filter((r) => shownRarity === 'all' || r === shownRarity).flatMap((rarity) => {
    const list = all
      .filter((a) => a.rarity === rarity)
      .sort((x, y) => (effects.size || picked.size ? fits(y) - fits(x) || 0 : 0) || rated(x) - rated(y) || (x.rank ?? 0) - (y.rank ?? 0) || shownName(x).localeCompare(shownName(y), getNameLang()));
    if (!list.length) return [];
    return [el('h3', `ov-group r-${rarity}`, RARITY_LABEL[rarity]), ...list.map(row)];
  });
  list.replaceChildren(...groups);
  if (!groups.length) list.replaceChildren(el('p', 'missing', 'لا يوجد تعزيز بهذا الاسم.'));
  // The AI button sits in the build tab; with augments marked, reach it from here too.
  aiBar.hidden = !(data.mode === 'mayhem' && data.champion && picked.size);
  if (!aiBar.hidden) {
    const go = el('button', 'pill', ai?.key === pickedKey() ? 'اعرض بناء الذكاء الاصطناعي' : 'اقترح البناء بالذكاء الاصطناعي');
    go.type = 'button';
    go.addEventListener('click', () => void startAi());
    aiBar.replaceChildren(el('span', '', `اخترت ${picked.size} من ${MAX_PICKS}`), go);
  }

  function row(a: OverlayData['augments'][number]) {
    const mayhem = data!.mode === 'mayhem';
    const r = el('button', `ov-row r-${a.rarity}${open === a.id ? ' open' : ''}`);
    r.type = 'button';
    const name = el('div', 'ov-name');
    name.append(el('b', '', shownName(a)));
    if (!mayhem) name.append(el('small', '', RARITY_LABEL[a.rarity]));
    r.append(icon(a.iconUrl), name);
    const tags = el('div', 'ov-tags');
    if (mayhem) {
      // One letter to read at a glance; what it is made of stays in its tooltip.
      const e = effects.get(a.id);
      const f = picked.has(a.id) ? undefined : fit.get(a.id);
      const kit = picked.has(a.id) ? null : fitOf(data!.champion?.id, a.ids ?? [a.id]);
      const links = linksOf(a);
      const why = [
        ...(e ? [`أثره على فوز الفريق: ${e.points.toFixed(1)} نقطة من ${e.games} لاعباً في مبارياتنا.`] : []),
        ...(a.tierLabel ? [`تقييم الموقع لهذا البطل: ${a.tierLabel}.`] : []),
        ...(f && f.games >= FIT_GAMES ? [`مع اختياراتك: ${Math.round(100 * f.lift)}% من ${f.games} لاعباً.`] : []),
        ...(kit?.reasons ?? []),
        ...links.map(linkInArabic),
      ];
      const known = e || links.length || (f && f.games >= FIT_GAMES);
      const letter = known ? (grades.get(a.id) ?? '–') : '–';
      const grade = el('span', `ov-grade g-${letter}`, letter);
      grade.title = why.join('\n');
      // The letter comes last, against the row's end, so the letters of all rows line up.
      if (links.length) tags.append(el('span', 'ov-mech', '⚙ يتكامل'));
      tags.append(grade);
      r.append(tags);
      const on = picked.has(a.id);
      r.append(el('span', `ov-pick${on ? ' on' : ''}`, on ? '✓' : '+'));
      r.classList.toggle('picked', on);
      // One click marks it, and the build beside it follows; hovering shows what it does.
      r.addEventListener('click', () => toggleMark(a.id));
      withTooltip(r, a, { className: `r-${a.rarity}` });
      return r;
    }
    if (rated(a) === 0) tags.append(el('span', 'ov-score', `${a.tierLabel ?? `#${a.rank}`} · ${pct(a.popularity ?? 0)}`));
    r.append(tags);
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
let tab: 'build' | 'augments' | 'teams' = 'build';
const teamsBox = byId('ov-teams');

function showTab(t: typeof tab) {
  // Mayhem in the large window: augments and build side by side, so a click on an augment shows its build at once.
  const both = document.body.classList.contains('large') && data?.mode === 'mayhem';
  if (both && t === 'augments') t = 'build';
  tab = t;
  byId('ov-main').classList.toggle('both', both && t === 'build');
  buildBox.hidden = t !== 'build';
  augBox.hidden = t !== 'augments' && !(both && t === 'build');
  teamsBox.hidden = t !== 'teams';
  if (t === 'teams') void renderTeams();
  for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) {
    b.classList.toggle('active', b.dataset.tab === t);
    if (b.dataset.tab === 'augments') b.hidden = both;
    if (b.dataset.tab === 'build') b.textContent = both ? 'التعزيزات والبناء' : 'البناء';
  }
  if (t === 'augments') search.focus();
}
tabs.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
  if (b) showTab(b.dataset.tab as typeof tab);
});

const ic = (x: Describable) => withTooltip(icon(x.iconUrl, 'ic'), x);

function section(title: string, ...body: (HTMLElement | string)[]) {
  const s = el('section', title === 'ترتيب المهارات' || title === 'الرونز' || title === 'التعاويذ' ? 'ov-sec' : 'ov-sec wide');
  s.append(el('h3', '', title), ...body);
  return s;
}
function icons(xs: Describable[]) {
  const row = el('div', 'ov-icons');
  row.append(...xs.map(ic));
  return row;
}

/** Mayhem: the items re-ranked for the augments the player marked, each with its reason. */
function chosenChips(chosen: OverlayData['augments']): HTMLElement {
  const row = el('div', 'ov-chosen');
  for (const a of chosen) {
    const chip = el('button', `ov-chip r-${a.rarity}`);
    chip.type = 'button';
    chip.title = 'اضغط لإزالته';
    chip.append(icon(a.iconUrl), el('span', '', shownName(a)), el('b', '', '✕'));
    chip.addEventListener('click', () => toggleMark(a.id));
    row.append(chip);
  }
  return row;
}

function adaptedSection(): HTMLElement {
  const chosen = (data?.augments ?? []).filter((a) => picked.has(a.id));
  if (!chosen.length) return section('البناء حسب تعزيزاتك', el('p', 'hint', NO_PICKS));
  // The build without AI (services.engineBuild), fetched when the marks change.
  const rows = el('div', 'ov-adapted');
  if (engine?.key !== pickedKey()) {
    void refreshEngine();
    return section('البناء حسب تعزيزاتك', chosenChips(chosen), el('p', 'hint', 'جاري حساب البناء…'));
  }
  if (engine.error) return section('البناء حسب تعزيزاتك', chosenChips(chosen), el('p', 'missing', `تعذّر حساب البناء: ${engine.error}`));
  for (const { item, why } of engine.items) {
    const r = el('div', 'ov-adapted-row');
    const txt = el('div', 'ov-name');
    txt.append(el('b', '', shownName(item)), el('small', '', why.map((w) => WHY_AR[w] ?? w).join(' · ')));
    r.append(ic(item), txt);
    rows.append(r);
  }
  return section('البناء حسب تعزيزاتك', chosenChips(chosen), el('p', 'hint', 'ننصحك به: محسوب ليناسب بطلك وتعزيزاتك.'), rows);
}

function aiSection(): HTMLElement {
  const chosen = (data?.augments ?? []).filter((a) => picked.has(a.id));
  if (!chosen.length) return section('بناء الذكاء الاصطناعي', el('p', 'hint', NO_PICKS));
  return section('بناء الذكاء الاصطناعي', chosenChips(chosen), el('p', 'hint', 'رأي إضافي، وقد يختلف عن بناء «حسب تعزيزاتك».'), aiBox(chosen));
}

/** The finished items of the champion's usual build, by slot. */
function baseItems(p: ChampionPage): HTMLElement | null {
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
  return grid.childElementCount ? section('الأيتمات', grid) : null;
}

/** Mayhem has three builds: one shows at a time, so they don't read as a single confusing list. */
function viewSwitch(current: BuildView, p: ChampionPage): HTMLElement {
  const s = el('div', 'ov-tabs');
  for (const [v, label] of BUILD_VIEWS) {
    const b = el('button', v === current ? 'active' : '', label);
    b.type = 'button';
    b.addEventListener('click', () => ((buildView = v), renderBuild(p)));
    s.append(b);
  }
  return s;
}

type BuildView = 'base' | 'engine' | 'ai';
const BUILD_VIEWS: [BuildView, string][] = [['base', 'الأساسي'], ['engine', 'حسب تعزيزاتك'], ['ai', 'الذكاء الاصطناعي']];
/** The player's choice; until then the build that follows the marks, or the usual one with none. */
let buildView: BuildView | undefined;
const NO_PICKS = 'من تبويب التعزيزات اضغط «اخترته» على كل تعزيز تأخذه، فيظهر البناء هنا.';

/** The AI answer for the augments marked now, kept until they change. */
let ai: { key: string; state: 'loading' | 'done' | 'error'; advice?: Advice; error?: string } | undefined;
const pickedKey = () => [...picked].sort((a, b) => a - b).join('-');

/** Asks for the marked augments' build (once per set of marks) and shows it in the build tab. */
async function startAi() {
  const champion = data?.champion;
  if (!champion || !picked.size) return;
  const key = pickedKey();
  buildView = 'ai';
  showTab('build');
  if (ai?.key !== key) {
    ai = { key, state: 'loading' };
    if (data?.build) renderBuild(data.build);
    buildBox.querySelector('.ov-ai')?.scrollIntoView({ block: 'nearest' });
    const r = await window.lolh.aiBuild(champion.id, [...picked]);
    if (ai?.key !== key) return; // the marks changed meanwhile
    ai = isError(r) ? { key, state: 'error', error: r.error } : { key, state: 'done', advice: r };
  }
  if (data?.build) renderBuild(data.build);
  buildBox.querySelector('.ov-ai')?.scrollIntoView({ block: 'nearest' });
}

function aiBox(chosen: { id: number }[]): HTMLElement {
  const key = chosen.map((a) => a.id).sort((a, b) => a - b).join('-');
  const box = el('div', 'ov-ai');
  const champion = data?.champion;
  if (!champion) return box;
  if (ai?.key !== key) ai = undefined;
  if (!ai) {
    const go = el('button', 'pill', 'اقترح البناء بالذكاء الاصطناعي');
    go.type = 'button';
    go.addEventListener('click', () => void startAi());
    box.append(go, el('p', 'hint', AI_HINT));
    return box;
  }
  if (ai.state === 'loading') return box.appendChild(el('p', 'hint', AI_LOADING)), box;
  if (ai.state === 'error') return box.appendChild(el('p', 'missing', ai.error ?? '')), box;
  const find = (id: number) => [...(data?.items ?? []), ...(data?.boots ?? [])].find((i) => i.id === id);
  box.append(...adviceNodes(ai.advice!, find, ic));
  return box;
}


/** Compact build: what to set and buy, in the order the player needs it during the game. */
function renderBuild(p: ChampionPage) {
  if (p.buildError) return buildBox.replaceChildren(el('p', 'missing', p.buildError));
  const out: HTMLElement[] = [];
  const mayhem = p.mode === 'mayhem';
  const view = buildView ?? (picked.size ? 'engine' : 'base');
  const stats = p.stats && el('p', 'en', `نسبة الفوز ${pct(p.stats.winRate)} · ${p.stats.games.toLocaleString('en')} مباراة`);
  const items = baseItems(p);
  if (mayhem) {
    out.push(viewSwitch(view, p));
    if (view === 'engine') out.push(adaptedSection());
    else if (view === 'ai') out.push(aiSection());
    else {
      // Without the site's Mayhem build the ARAM one is shown: say so, or it looks like a wrong mode.
      out.push(el('p', 'hint', p.siteBuild ? 'ما يشتريه لاعبو البطل عادةً، ولا يتغير بتعزيزاتك.' : 'لا يتوفر بناء خاص بهذا الطور الآن، فهذا أقرب بناء متاح.'));
      if (stats) out.push(stats);
      if (items) out.push(items);
    }
  } else if (stats) out.push(stats);
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
  if (!mayhem && items) out.push(items);
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
  // The build is asked again each time F7 opens: the enemy team appears once the game is loaded.
  engine = undefined;
  engineAsked = '';
  buildView = undefined;
  if (pickedFor !== reply.champion?.id) (picked.clear(), (pickedFor = reply.champion?.id)); // a new game's champion
  // A build already asked for in the app (or an earlier F7) for this champion: mark its augments and show it.
  let restored = false;
  if (!picked.size && reply.champion && reply.mode === 'mayhem' && restoredFor !== reply.champion.id) {
    restoredFor = reply.champion.id;
    const last = await window.lolh.lastAiPicks();
    if (id !== loadId) return;
    for (const a of last?.championId === reply.champion.id ? last.augmentIds : []) {
      if (reply.augments.some((x) => x.id === a)) (picked.add(a), (restored = true));
    }
  }
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
  if (restored) void startAi(); // the app's answer is cached: shown without asking Gemini again
  void refreshFit();
  if (reply.mode === 'mayhem') {
    const r = await window.lolh.augmentEffects();
    if (id !== loadId || isError(r)) return;
    effects = new Map(r.map((x) => [x.id, x]));
    render();
  }
}

search.addEventListener('input', () => ((open = undefined), render()));
addEventListener('keydown', (e) => e.key === 'Escape' && void window.lolh.hideOverlay());
byId('ov-close').addEventListener('click', () => void window.lolh.hideOverlay());
// Large by default; the choice is remembered on this machine.
let large = true;
try {
  large = localStorage.getItem('overlayLarge') !== 'normal';
} catch {
  // storage unavailable: keep the default
}
const sizeButton = byId<HTMLButtonElement>('ov-size');
const applySize = () => {
  sizeButton.textContent = large ? 'تصغير النافذة' : 'تكبير النافذة';
  document.body.classList.toggle('large', large);
  void window.lolh.setOverlayLarge(large);
  showTab(tab);
};
sizeButton.addEventListener('click', () => {
  large = !large;
  try {
    localStorage.setItem('overlayLarge', large ? 'large' : 'normal');
  } catch {
    // not remembered this time; harmless
  }
  applySize();
});
applySize();
window.lolh.onOverlayShow((t) => {
  search.value = '';
  open = undefined;
  void load().then(() => t === 'teams' && showTab('teams'));
});
void load();

// The loading screen's view: both teams with ranks, how they compare, and the best augments and full build for the
// player's champion (the build already answers the enemy team's magic damage).
const SIDE_AR = { stronger: 'فريقك أقوى بالأبطال', even: 'الفريقان متقاربان بالأبطال', weaker: 'فريق الخصم أقوى بالأبطال' };
const TIER_AR: Record<string, string> = { IRON: 'حديد', BRONZE: 'برونز', SILVER: 'فضة', GOLD: 'ذهب', PLATINUM: 'بلاتين', EMERALD: 'زمرد', DIAMOND: 'ألماس', MASTER: 'ماستر', GRANDMASTER: 'جراند ماستر', CHALLENGER: 'تشالنجر' };
let championList: { id: number; name: string; enName: string; portraitUrl: string }[] = [];
let teamsRun = 0;
async function renderTeams() {
  const run = ++teamsRun;
  teamsBox.replaceChildren(el('p', 'hint', 'جاري القراءة…'));
  const [teams, champs] = await Promise.all([window.lolh.gameTeams(), championList.length ? Promise.resolve(championList) : window.lolh.listChampions()]);
  if (run !== teamsRun) return;
  if (!isError(champs)) championList = champs;
  if (isError(teams)) return void teamsBox.replaceChildren(el('p', 'missing', teams.error));
  if (!teams) return void teamsBox.replaceChildren(el('p', 'hint', 'يظهر الفريقان بعد تحميل المباراة (شاشة الانتظار).'));
  const player = (p: GameTeams['mine'][number]) => {
    const c = championList.find((x) => x.id === p.championId);
    const row = el('div', 'ov-adapted-row');
    const txt = el('div', 'ov-name');
    const rank = p.rank ? `${TIER_AR[p.rank.tier] ?? p.rank.tier} ${p.rank.division}`.trim() : 'بلا رتبة فردية';
    txt.append(el('b', '', c ? shownName(c) : String(p.championId)), el('small', '', [p.name, rank].filter(Boolean).join(' · ')));
    if (c) row.append(icon(c.portraitUrl, 'ic'));
    row.append(txt);
    return row;
  };
  const list = (title: string, ps: GameTeams['mine']) => section(title, ...ps.map(player));
  const sum = teams.summary;
  const notes = [SIDE_AR[sum.side], `ضرر الخصم السحري: ${sum.magic.enemy} من 5${sum.magic.enemy >= 3 ? ' (البناء يرفع مقاومة السحر)' : ''}`];
  const body: HTMLElement[] = [section('ملخص', ...notes.map((n) => el('p', 'hint', n))), list('فريقك', teams.mine), list('فريق الخصم', teams.enemy)];
  // Best augments for this champion (team model effect, kit fit as a tie breaker) and the full build without augments.
  const champion = data?.champion;
  if (champion && data?.mode === 'mayhem') {
    const best = [...data.augments]
      .map((a) => ({ a, score: (effects.get(a.id)?.points ?? -9) + siteBonus(a.tierLabel) + FIT_POINTS * (fitOf(champion.id, a.ids ?? [a.id])?.score ?? 0) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 8)
      .map(({ a }) => a);
    body.push(section('أفضل التعزيزات لبطلك', icons(best)));
    const b = await window.lolh.engineBuild(champion.id, []);
    if (run !== teamsRun) return;
    if (!isError(b)) body.push(section('البناء الكامل', icons(b.map((x) => x.item)), el('p', 'hint', 'يتغير حين تختار تعزيزاتك من تبويب التعزيزات.')));
  }
  teamsBox.replaceChildren(...body);
}
