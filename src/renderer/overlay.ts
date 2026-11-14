// The over-the-game window: the picked champion's build (spells, runes, skills, items) and augments, with a quick search.

import type { Advice } from '../ai/advisor.js';
import { EZREAL, MANAMUNE, MURAMANA, TEAR, ezrealNextItems, ezrealTearStage } from '../app/ezrealPurchases.js';
import { walkedPath, type BuildPath } from '../app/buildPath.js';
import { offerPlanIds, pathChange, pathChangeLine, planReason, rankOffer, walkItems } from '../app/walk.js';
import { cardFit, conflictsWith, itemPart, openLines, placesOf, type ChampionDamage } from '../ai/lines.js';
import { CHAMPION_KITS } from '../ai/championKits.js';
import { augmentStage, MAYHEM_MAX_LEVEL, type AugmentProgress } from '../ai/augmentProgress.js';
import { dominantOffer } from '../app/offerComparison.js';
import { RANGE_SCENARIO, rangeAccess } from '../ai/rangeAccess.js';
import { lowHealthText } from './lowHealthView.js';
import { linksWith, type Link, type Mechanic } from '../ai/mechanics.js';
import { AUGMENT_MECHANICS } from '../ai/mechanicsData.js';
import { FIT_POINTS, fitOf, gradesFor, healthChain, nextToPicked, outsidePoints, playedOnly, trialScoring } from './fit.js';
import type { ChampionPage, ItemChoice } from '../app/championPage.js';
import type { ItemEntry } from '../app/itemList.js';
import { placeFlash } from '../lcu/apply.js';
import type { AugmentEffect, AugmentValue, ExperimentalBuild, GameTeams, OverlayData, PartnersAnswer } from '../main/services.js';
import type { PickSnapshot } from '../main/pickLog.js';
import { adviceNodes, AI_HINT, AI_LOADING, EXPERIMENTAL_TITLE, experimentalHint, WHY_AR } from './aiAdvice.js';
import { RARITY_LABEL } from './augmentsView.js';
import { byId, el, getFlashKey, getNameLang, icon, isError, MODE_TITLE, pct, pills, shownName, stackInput, withTooltip, type Describable } from './dom.js';
import { filterAugments, findOfferMatches } from './search.js';
import { applyRandomTheme } from './theme.js';
import { progressRequests } from './progressRequests.js';
import { calculationNotes } from './calculationNotes.js';
import { restorePicks } from './pickRestore.js';
import { OFFER_GROUP_TITLE, offerTradeoff, rangeComparison, type OfferGroup } from './offerView.js';
import { needsAbilityTarget, type TargetAbility } from '../ai/abilityTarget.js';

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
let pickedGame: number | undefined;
let manualLevel: number | undefined;
const acquiredLevels: Record<number, number> = {};
const abilityTargets: Record<number, TargetAbility> = {};
const progress = (): AugmentProgress => ({ level: data?.live?.level ?? manualLevel, acquiredLevels: { ...acquiredLevels }, abilityTargets: { ...abilityTargets } });
const liveFinished = (items: number[], finished: Set<number>, champion?: number) => [...new Set(items.map((id) => finished.has(id) ? id : id % 10000).filter((id) => finished.has(id) || (champion === EZREAL && [TEAR, MANAMUNE, MURAMANA].includes(id % 10000))))];
let restoredFor: number | undefined;
const MAX_PICKS = 6;
const FIT_GAMES = 150;
/** Each augment's effect on its team's win chance (team model), loaded with the window's data. */
let effects = new Map<number, AugmentEffect>();
/** What each augment adds to this champion in the open data, in points. */
let openPoints = new Map<number, number>();
/** The Chinese server's win rate for this champion with each augment, and its games. */
let openWin = new Map<number, { win: number; games: number }>();
/** How much more this champion's players take each augment than all players do; winning plays no part. */
const mechOf = (a: { id: number; ids?: number[] }) => AUGMENT_MECHANICS.find((m) => (a.ids ?? [a.id]).includes(m.id));
const NO_MECH: Mechanic = { id: -1, name: '', gives: [], scales: [], converts: [], relies: [], needs: [], note: '' };
const STAT_AR: Record<string, string> = {
  health: 'الصحة', bonus_health: 'الصحة الإضافية', ap: 'قوة القدرة', ad: 'ضرر الهجوم', bonus_ad: 'ضرر الهجوم الإضافي', attack_speed: 'سرعة الهجوم',
  crit: 'الضربة الحرجة', armor: 'الدرع', mr: 'مقاومة السحر', resists: 'المقاومات', mana: 'المانا', ability_haste: 'تسارع القدرات',
  move_speed: 'سرعة الحركة', gold: 'الذهب', omnivamp: 'الامتصاص', heal_shield_power: 'قوة العلاج والدروع',
};
const mechName = (id: number) => AUGMENT_MECHANICS.find((m) => m.id === id)?.name ?? String(id);
const championDamage = (): ChampionDamage | undefined => {
  const d = CHAMPION_KITS.find((k) => k.id === data?.champion?.id)?.damage;
  return d === 'magic' ? 'ap' : d === 'physical' ? 'ad' : d === 'mixed' ? 'mixed' : undefined;
};
/**
 * The player's path so far: the marked augments, and the items he says he bought; until he says, the items reached and the next one
 * suggested (src/ai/lines.ts).
 */
const heldParts = () => {
  return [...(data?.augments ?? []).filter((a) => picked.has(a.id)).flatMap((a) => mechOf(a)?.id ?? []), ...(data?.live?.items ?? owned).map(itemPart)];
};
/** What each card adds to this champion's fight, by arithmetic (src/ai/cardMath.ts); a card missing here can't be computed. */
let cardMath = new Map<number, AugmentValue>();
let cardMathFor = '';
let cardMathContext = '';
let cardMathLoading = false;
/** The state the card values are asked for; an answer for another one is stale (T014: no plan comparison from it). */
const cardContext = () => `${loadId}|${data?.game}|${data?.champion?.id}|${[...picked].join()}|${(data?.live?.items ?? owned).join()}|${JSON.stringify(progress())}|${buildStyle ?? ''}|${stacks ?? ''}`;
async function refreshCardMath() {
  const champion = data?.champion;
  const held = data?.live?.items ?? owned;
  const plans = offerPlanIds(offer, comparePartialOffer);
  const context = cardContext();
  const key = `${context}|${plans.join()}`;
  if (key === cardMathFor || !champion || data?.mode !== 'mayhem') return;
  cardMathFor = key;
  // The stage estimates are independent of which cards the player put on offer.
  if (cardMathContext !== context) cardMath.clear();
  else for (const row of cardMath.values()) { delete row.plan; delete row.planError; }
  cardMathContext = context;
  cardMathLoading = true;
  render();
  redrawBuild();
  const r = await window.lolh.cardValues(champion.id, [...picked], held, progress(), plans, buildStyle, stacks).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  if (cardMathFor !== key) return;
  cardMathLoading = false;
  cardMath = new Map(isError(r) ? [] : r.map((x) => [x.id, x]));
  render();
  redrawBuild();
}
const signed = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(100 * x)}%`;
const mathValue = (id: number) => cardMath.get(id)?.value;
const mathWords = (id: number) => { const m = cardMath.get(id); return m ? `الآن: ضرر ${signed(m.damage)}، تحمّل ${signed(m.health)} · متوسط أثر القتال للمستويات ${m.level}–${m.untilLevel}: ${signed(m.value)}${m.estimatedLevel ? ' · مستوى افتراضي' : ''}${m.estimatedHistory ? ' · توقيت الاختيارات السابقة مقدّر' : ''}${m.certain ? '' : ' (تقديري)'}${m.missing ? ` · ${m.missing}` : ''}` : cardMathLoading ? 'جاري حساب الحالة الحالية…' : 'لا يُحسب'; };
/** A card whose condition the fight doesn't settle: its value is what it gives if it holds (src/ai/tagWeight.ts). */
const isOpen = (id: number) => (cardMath.get(id)?.open.length ?? 0) > 0;
/** Each card's place among its rarity by what it adds; only cards offered in one round can be compared, and these share a rarity.
 * Cards with an open condition are placed among themselves, apart from settled ones (the owner, 2026-11-09). */
const mathPlaces = (pool: OverlayData['augments']) =>
  new Map((Object.keys(RARITY_LABEL) as (keyof typeof RARITY_LABEL)[]).flatMap((rarity) => [false, true].flatMap((open) => [...placesOf(new Map(pool.filter((a) => a.rarity === rarity && cardMath.has(a.id) && isOpen(a.id) === open).map((a) => [a.id, mathValue(a.id)!])))])));
const percentOf = (a: OverlayData['augments'][number], places: Map<number, number>) => {
  if (picked.has(a.id)) return undefined;
  const place = places.get(a.id);
  return place === undefined ? undefined : Math.round(100 * place);
};
const lineText = (f: NonNullable<ReturnType<typeof cardFit>>) => (f.share === undefined ? `يبدأ ${f.line.name}.` : `${f.line.name}: يتناسق مع ${Math.round(100 * f.share)}% مما عندك من أجزاء الخطوط المعروفة.`);
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
let engine: { key: string; items: { item: ItemEntry; why: string[]; offPath?: boolean; missing?: string[] }[]; dropped?: ItemEntry[]; error?: string } | undefined;
let engineAsked = '';
/** Asks made again after a failure, for the state they were spent on; a new state (items, level, champion, match) starts again (T037).
 * A few at most, from the retry button, never from render. */
let engineRetries: { key: string; n: number } | undefined;
const retriesFor = (key: string) => (engineRetries?.key === key ? engineRetries.n : 0);
const ENGINE_RETRIES = 3;
/** The experimental build, apart from the engine's: the engine never waits for it (T036). */
let experimental: { key: string; build: ExperimentalBuild | null } | undefined;
/** The items the player is walking, kept from augment to augment (src/app/buildPath.ts). */
let path: BuildPath | undefined;
/** The engine's build for the known champion, from the first opening: no mark or purchase needed (T036, the owner: the engine is the main page). */
async function refreshEngine() {
  const key = engineKey();
  const champion = data?.champion;
  if (!champion || data?.mode !== 'mayhem' || engineAsked === key) return;
  engineAsked = key;
  void refreshExperimental();
  const r = await window.lolh.engineBuild(champion.id, [...picked], trialScoring(), [...owned], buildStyle, stacks, progress())
    .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  if (engineKey() !== key) return;
  if (isError(r)) engine = { key, items: [], error: r.error };
  else {
    path = walkedPath(path, [...picked], owned, r.map((e) => e.item.id));
    const onPath = path.items.flatMap((id) => r.find((e) => e.item.id === id) ?? []);
    const dropped = path.dropped.flatMap((id) => engine?.items.find((e) => e.item.id === id)?.item ?? []);
    engine = { key, items: onPath, dropped };
  }
  redrawBuild();
  render(); // the percents read the path, which just changed
}
async function refreshExperimental() {
  const champion = data?.champion;
  const key = `${loadId}|${champion?.id}|${pickedKey()}`;
  if (!champion || !picked.size || experimental?.key === key) return;
  experimental = { key, build: null };
  const x = await window.lolh.experimentalBuild(champion.id, [...picked]).catch(() => null); // optional: a failure only leaves it out
  if (experimental?.key !== key) return;
  experimental = { key, build: !x || isError(x) ? null : x };
  redrawBuild();
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

function resetRun() {
  picked.clear(); offer.clear(); owned.length = 0; path = undefined; buildStyle = undefined; stacks = undefined; manualLevel = undefined; tearCharged = false;
  comparePartialOffer = false;
  for (const id of Object.keys(acquiredLevels)) delete acquiredLevels[Number(id)];
  for (const id of Object.keys(abilityTargets)) delete abilityTargets[Number(id)];
  cardMathFor = ''; cardMath.clear(); cardMathLoading = false; engineAsked = ''; engine = undefined; engineRetries = undefined; experimental = undefined;
  pickSnap = undefined; pickNote = undefined; pickRefused = undefined;
}

const requestProgress = progressRequests((champion, fresh) => window.lolh.gameProgress(champion, fresh));
async function refreshProgress(update = true, fresh = false) {
  const champion = data?.champion?.id;
  if (!champion || data?.mode !== 'mayhem') return false;
  const generation = loadId;
  try {
    const r = await requestProgress(champion, fresh);
    if (data?.champion?.id !== champion || generation !== loadId || isError(r)) return false;
    const previous = JSON.stringify([data.live?.level, data.live?.items, pickedGame]);
    // A new match clears the run; the build panel must drop the last match's augments and skills too.
    if (pickedGame !== undefined && pickedGame !== r.game) { void load(); return false; } // load clears the run and reads this match's log (T037)
    pickedGame = r.game;
    data.game = r.game;
    data.live = r.level === undefined ? undefined : { level: r.level, items: r.items ?? [], game: r.game };
    if (data.live) {
      // A previous manual level must not return after a later live reading and contradict recorded choices.
      manualLevel = undefined;
      const finished = new Set([...data.items, ...data.boots].map((i) => i.id));
      owned.splice(0, owned.length, ...liveFinished(data.live.items, finished, champion));
      if (ezrealTearStage(owned, false) !== 'charging') tearCharged = false;
    }
    const changed = previous !== JSON.stringify([data.live?.level, data.live?.items, pickedGame]);
    if (changed && update) ownedChanged();
    return r.level !== undefined;
  } catch { return false; }
}

/** The pick log main keeps for this match (src/main/pickLog.ts), as last returned; undefined when there is none (no match, the phone page). */
let pickSnap: PickSnapshot | undefined;
/** Why the marks are only kept on this page, when main's log can't take them. */
let pickNote: string | undefined;
const PICK_LOG_OFF = 'سجل الاختيارات غير متاح هنا (لا مباراة جارية أو صفحة الهاتف): العلامات محلية ومستوياتها تقديرية.';
/** Why main refused the last mark, in the page's words; the log stays as it was. */
let pickRefused: string | undefined;
const REFUSED: [RegExp, string][] = [[/too many picks/, 'بلغت ستة اختيارات'], [/unknown augment/, 'هذا التعزيز ليس من تعزيزات الطور'], [/pick log full/, 'امتلأ سجل هذه المباراة'], [/bad pick request/, 'طلب غير صالح']];
/** The marks and their levels as main's log holds them; the page keeps no history of its own beside it. An older snapshot of the same log
 * (a late answer to an earlier request) never replaces a newer one. */
function applyPicks(snap: PickSnapshot) {
  if (pickSnap && pickSnap.game === snap.game && pickSnap.championId === snap.championId && snap.version < pickSnap.version) return;
  pickSnap = snap; pickNote = undefined; pickRefused = undefined;
  picked.clear();
  for (const id of Object.keys(acquiredLevels)) delete acquiredLevels[Number(id)];
  for (const h of snap.held) { picked.add(h.id); if (h.recordedLevel !== undefined) acquiredLevels[h.id] = h.recordedLevel; }
  for (const id of Object.keys(abilityTargets)) if (!picked.has(Number(id))) delete abilityTargets[Number(id)];
}
/** No log to write to: the marks stay on this page as before, the level from the game when just read, or typed in. */
function markLocally(id: number, fresh: boolean) {
  if (picked.has(id)) { picked.delete(id); delete acquiredLevels[id]; delete abilityTargets[id]; }
  else if (picked.size < MAX_PICKS) {
    // Without a live/manual level leave history unknown; the calculator labels the unlock-level fallback as estimated.
    const level = fresh ? data?.live?.level : data?.live ? undefined : manualLevel;
    if (level !== undefined) acquiredLevels[id] = level;
    picked.add(id);
  }
}

let marking = false;
async function toggleMark(id: number) {
  if (marking) return;
  marking = true;
  try { if (!(await markNow(id))) return; }
  finally { marking = false; }
  afterMarks();
}
/** One mark, through main's log when there is one. False when the answer belongs to an earlier match or champion and nothing changed. */
async function markNow(id: number): Promise<boolean> {
  const champion = data?.champion?.id;
  const generation = loadId, game = data?.game;
  const fresh = await refreshProgress(false, true);
  const same = () => data?.champion?.id === champion && generation === loadId && (game === undefined || game === data?.game);
  if (!same()) return false;
  const on = !picked.has(id);
  if (on && picked.size >= MAX_PICKS) return false;
  if (champion !== undefined && game !== undefined) {
    const r = await window.lolh.pickMark(game, champion, id, on);
    if (!same()) return false;
    if (!isError(r)) { applyPicks(r); return true; }
    if (/^pick-stale/.test(r.error)) return false; // the match changed meanwhile: main refused it, and so does the page
    // A refused mark in a running log: the log stays as main holds it, the mark isn't kept anywhere, and the page says why.
    if (/^pick-rejected/.test(r.error)) { pickRefused = REFUSED.find(([re]) => re.test(r.error))?.[1] ?? 'رُفض الطلب'; return true; }
  }
  // No log here (no active match, the phone page, main unreachable): the marks stay on this page as before, said so.
  pickSnap = undefined; pickNote = PICK_LOG_OFF;
  markLocally(id, fresh);
  return true;
}
/** One bounded wait for marks main was still recording when this page loaded. */
async function followPending(game: number, champion: number, generation: number) {
  const r = await window.lolh.pickLog(game, champion, true);
  if (generation !== loadId || data?.champion?.id !== champion || data?.game !== game || isError(r) || !r) return;
  applyPicks(r);
  afterMarks();
}
let declaring = false;
async function declarePicks() {
  const champion = data?.champion?.id, game = data?.game, generation = loadId;
  if (declaring || champion === undefined || game === undefined) return;
  declaring = true;
  try {
    const r = await window.lolh.pickDeclare(game, champion);
    if (data?.champion?.id !== champion || generation !== loadId || game !== data?.game) return;
    if (isError(r)) pickRefused = 'تعذّر حفظ التأكيد؛ أعد المحاولة.';
    else applyPicks(r);
  } finally { declaring = false; }
  afterMarks();
}
/** The log's state near the picks, and the optional statement when the log allows it; plain words, nothing of how it is kept. */
function pickStatus(): HTMLElement[] {
  if (!pickSnap) return pickNote ? [el('p', 'hint', pickNote)] : [];
  const refused = pickRefused ? [el('p', 'missing', `لم يُسجَّل الاختيار: ${pickRefused}.`)] : [];
  const line = el('p', 'hint', pickSnap.declaredComplete
    ? 'سجل اختياراتك كامل حسب تأكيدك أنك سجّلت كل اختيار وقت أخذه؛ اللعبة لا تقرأ التعزيزات، فالترتيب والمستويات هي ما سجّلته.'
    : pickSnap.reason ? `سجل اختياراتك غير مكتمل: ${pickSnap.reason}. البناء يتبع ما اخترته، ومكافآت ترتيب الاختيار لا تُحسب.` : 'سجل اختياراتك يُحفظ لهذه المباراة بترتيب ضغطك على «اخترته».');
  line.setAttribute('role', 'status');
  if (!pickSnap.canDeclare) return [...refused, line];
  const confirm = pill(declaring ? 'جارٍ حفظ التأكيد…' : 'أؤكد أنني سجّلت كل اختياراتي بترتيبها، كلٌّ منها وقت أخذه', () => void declarePicks());
  confirm.disabled = declaring;
  return [...refused, line, confirm];
}
function afterMarks() {
  render();
  redrawBuild();
  void refreshEngine(); // the main page needs it even when the champion's page failed to load, as on a weak connection
  void refreshCardMath();
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
  const trial = trialScoring();
  const score = (a: OverlayData['augments'][number]) => {
    const f = fit.get(a.id);
    const kit = fitOf(data!.champion?.id, a.ids ?? [a.id])?.score ?? 0; // a near-tie breaker only (src/renderer/fit.ts)
    const chain = trial && !picked.has(a.id) ? healthChain(pickedMechs.map((m) => m.id), mechOf(a)?.id) : 0;
    return (effects.get(a.id)?.points ?? 0) + outsidePoints(openPoints.get(a.id), a.tierLabel) + FIT_POINTS * kit + nextToPicked(linksOf(a).reduce((s, l) => s + l.strength, 0) + chain, f && f.games >= FIT_GAMES ? f.lift : undefined, trial);
  };
  const fits = (a: OverlayData['augments'][number]) => (picked.has(a.id) ? Infinity : score(a));
  const pool = data.mode === 'mayhem' ? playedOnly(data.augments, effects, picked) : data.augments;
  const grades = gradesFor(pool, score);
  const places = mathPlaces(pool);
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
      const onLine = picked.has(a.id) ? undefined : cardFit(heldParts(), mechOf(a)?.id, championDamage());
      const compat = percentOf(a, places);
      const clashes = picked.has(a.id) ? [] : conflictsWith(heldParts(), mechOf(a)?.id);
      const why = [
        ...clashes.map((c) => `تعارض: ${c}.`),
        ...(compat === undefined ? [] : [`ترتيب نسبي بين ${isOpen(a.id) ? 'المشروطة من ' : ''}نفس الندرة ${compat}%: ${mathWords(a.id)}. ليس احتمال فوز أو نسبة توافق مثبتة.${isOpen(a.id) ? ` مشروطة: ${cardMath.get(a.id)!.open.join('، ')}؛ القيمة إن تحقق الشرط.` : ''}`]),
        ...(onLine ? [lineText(onLine)] : []),
        ...(e ? [`أثره على فوز الفريق: ${e.points.toFixed(1)} نقطة من ${e.games} لاعباً في مبارياتنا.`] : []),
        ...(openWin.has(a.id) ? [`فوزه مع هذا البطل في السيرفر الصيني: ${(100 * openWin.get(a.id)!.win).toFixed(1)}% من ${openWin.get(a.id)!.games.toLocaleString('en')} مباراة.`] : []),
        ...(openPoints.has(a.id) ? [`مع هذا البطل في AramHex وARAMKit: ${openPoints.get(a.id)!.toFixed(1)} نقطة.`] : a.tierLabel ? [`تقييم الموقع لهذا البطل: ${a.tierLabel}.`] : []),
        ...(f && f.games >= FIT_GAMES ? [`مع اختياراتك: ${Math.round(100 * f.lift)}% من ${f.games} لاعباً.`] : []),
        ...(kit?.reasons ?? []),
        ...links.map(linkInArabic),
      ];
      const known = e || openPoints.has(a.id) || links.length || (f && f.games >= FIT_GAMES);
      const letter = known ? (grades.get(a.id) ?? '–') : '–';
      const grade = el('span', `ov-grade g-${letter}`, letter);
      grade.title = why.join('\n');
      // The letter comes last, against the row's end, so the letters of all rows line up.
      if (links.length) tags.append(el('span', 'ov-mech', '⚙ يتكامل'));
      if (compat !== undefined) tags.append(el('span', 'ov-mech', `${clashes.length ? '⚠ ' : ''}${compat}%${isOpen(a.id) ? ' مشروط' : ''}`));
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

/** The cards the player typed in for this round. */
const offer = new Set<number>();
let comparePartialOffer = false;
/** T053: the example scenario's distance; the player can change it in the card's details. A display input only: no value or ranking reads it. */
let rangeDistance: number = RANGE_SCENARIO.distance;

/** T053: a card's range term, beside its value and outside the folded details: the range +N, the declared scenario's window, and its limits. */
/** T061: why a range term has no number, in the words the player reads; each says the card is not thereby without effect. */
export const RANGE_UNSUPPORTED: Record<NonNullable<NonNullable<AugmentValue['range']>['reasonKind']>, string> = {
  ranged: 'مدى الهجوم: نطاق حساب المدى اليوم لأبطال القرب؛ لا رقم له هنا، وهذا لا يعني أنه بلا أثر.',
  'ranged-at-level': 'مدى الهجوم: مهارته الثابتة تجعله بعيد المدى عند هذا المستوى، فهو خارج سيناريو القرب الحالي؛ لا رقم له هنا، وهذا لا يعني أنه بلا أثر.',
  'form-unread': 'مدى الهجوم: هيئته الحالية غير مقروءة، فلا رقم للمدى أو لوقت الوصول؛ وهذا لا يعني أنه بلا أثر.',
  'range-unread': 'مدى الهجوم: مداه غير مقروء؛ لا رقم له هنا، وهذا لا يعني أنه بلا أثر.',
};
function rangeLines(range: NonNullable<AugmentValue['range']>, stageValue: number, estimatedLevel?: boolean): HTMLElement[] {
  if (!range.supported) return [el('small', 'ov-range', RANGE_UNSUPPORTED[range.reasonKind ?? 'ranged'])];
  // T061: a range read from his passive by level says the level (and when that level is estimated).
  const at = range.source === 'passive-rank' && range.level !== undefined ? ` (من مهارته الثابتة عند المستوى ${range.level}${estimatedLevel ? '، مقدّر' : ''})` : '';
  const out = [el('small', 'ov-range', `مدى الهجوم العادي: +${range.delta}، من ${range.before}${at} إلى ${range.after}.`)];
  if (range.moveSpeed === undefined) out.push(el('small', 'ov-range', 'وقت الوصول غير محسوب: سرعته غير مقروءة.'));
  else {
    const a = rangeAccess({ distance: rangeDistance, beforeRange: range.before!, afterRange: range.after!, moveSpeed: range.moveSpeed, windowSeconds: RANGE_SCENARIO.windowSeconds });
    const when = a.before.travelDistance === 0 ? 'الهدف داخل مداك أصلاً، فلا وقت وصول مستعاد'
      : !a.after.reachedWithinWindow ? `لا يصل في ${a.windowSeconds}ث حتى بالمدى الجديد` : `نافذة الوصول +${a.recoveredSeconds.toFixed(2)}ث`;
    out.push(el('small', 'ov-range', `مثال (افتراض، لا قراءة من مباراتك): هدف ثابت على ${a.distance}، مسار مستقيم، سرعتك الأساسية ${a.moveSpeed}؛ ${when}.`));
  }
  out.push(el('small', 'ov-range', `أثر المدى على تجنب الضرر والتحكم، وعلى مدى القدرات والاندفاعات، غير محسوب هنا.${Math.round(100 * stageValue) === 0 ? ' نسبة القتال 0% لا تعني بلا أثر: المدى خارج النسبتين.' : ''}`));
  const more = el('details', 'range-scenario');
  const input = document.createElement('input');
  input.type = 'number'; input.min = '0'; input.step = '25'; input.value = String(rangeDistance); input.className = 'range-distance'; input.setAttribute('aria-label', 'مسافة الهدف في المثال');
  input.addEventListener('change', () => { const v = Number(input.value); if (Number.isFinite(v) && v >= 0) { rangeDistance = v; redrawBuild(); } });
  const label = el('label', '', 'مسافة الهدف في المثال: ');
  label.append(input);
  more.append(el('summary', '', 'افتراض مثال المدى'), label);
  out.push(more);
  return out;
}
/** Actual finished inventory, read live or entered manually; suggestions never count as purchases. */
const owned: number[] = [];
let tearCharged = false;
let shopItems: ItemEntry[] | undefined;
const pill = (text: string, onClick: () => void, cls = 'pill') => {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

/** The main page's build, drawn again after any change of state: the engine shows for a known Mayhem champion even when the site's page failed (T036). */
const redrawBuild = () => { if (data) renderBuild(data.build ?? undefined); };
const ownedChanged = () => {
  if (ezrealTearStage(owned, false) !== 'charging') tearCharged = false;
  void refreshEngine();
  void refreshCardMath();
  render();
  redrawBuild();
};

/** Folded parts of the main page keep the player's open or closed choice across redraws. */
const openFolds = new Set<string>();
function fold(id: string, summary: string, ...body: (HTMLElement | string)[]) {
  const d = el('details', 'ov-sec wide ov-fold') as HTMLDetailsElement;
  d.open = openFolds.has(id);
  d.addEventListener('toggle', () => (d.open ? openFolds.add(id) : openFolds.delete(id)));
  d.append(el('summary', '', summary), ...body);
  return d;
}
const finder = (id: string, placeholder: string, results: (q: string) => HTMLElement[]) => {
  const previous = document.getElementById(id) as HTMLInputElement | null;
  const input = el('input', '') as HTMLInputElement;
  input.id = id;
  input.type = 'search';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.autocomplete = 'off';
  input.value = previous?.value ?? '';
  const box = el('div', 'ov-adapted');
  if (input.value.trim()) box.replaceChildren(...results(input.value));
  input.addEventListener('input', () => box.replaceChildren(...(input.value.trim() ? results(input.value) : [])));
  const label = el('label', 'search');
  label.append(input);
  return { label, box, input };
};

/** The cards on offer this round, typed in only when he wants them compared; nothing else on the page waits for it (T036). */
function offerSection(): HTMLElement {
  const d = data!;
  const pool = playedOnly(d.augments, effects, picked);
  const places = mathPlaces(pool);
  const percent = (a: OverlayData['augments'][number]) => percentOf(a, places);
  const cards = rankOffer(d.augments.filter((a) => offer.has(a.id)), percent, (a) => isOpen(a.id));
  const stageComparable = cards.every((a) => cardMath.get(a.id)?.certain === true);
  // T053: a card with a range term (read or not) sits outside both numbers, so no overall winner while one is on offer; the trade-off is said below.
  const hasRange = cards.some((a) => cardMath.get(a.id)?.range);
  const winner = hasRange ? undefined : dominantOffer(cards.map((a) => cardMath.get(a.id) ?? { id: a.id, value: NaN }));
  const rows = el('div', 'ov-adapted ov-offers');
  // T037 b: the stage and the finished plan are two numbers side by side; the relative place is a third, inside its own group.
  const groupOf = (a: OverlayData['augments'][number]): OfferGroup => (percent(a) === undefined ? 'unmeasured' : isOpen(a.id) ? 'open' : 'settled');
  const groups = new Set(cards.map(groupOf));
  let lastGroup: OfferGroup | undefined;
  for (const a of cards) {
    const g = groupOf(a);
    if (g !== lastGroup && (groups.size > 1 || g !== 'settled')) rows.append(el('p', 'hint ov-offer-group', OFFER_GROUP_TITLE[g]));
    lastGroup = g;
    const r = el('div', 'ov-adapted-row');
    const txt = el('div', 'ov-name');
    const p = percent(a);
    const m = cardMath.get(a.id);
    const planNow = m?.plan ? signed(m.plan.value) : m?.planError ? 'تعذّرت' : cardMathLoading ? 'جاري الحساب…' : 'غير مطلوبة';
    txt.append(el('b', '', shownName(a)), el('small', '', !m ? cardMathLoading ? 'جاري حساب الحالة الحالية…' : 'غير مقاسة: أثرها في حركة أو إيقاف أو هدف آخر، أو شرطها لا ينطبق. هذا لا يعني أنها ضعيفة'
      : [`الآن (حتى مستوى ${m.untilLevel}، بأغراضك الحالية): ${signed(m.value)}`, `الخطة المكتملة${m.plan ? ` (مستوى ${m.plan.level}، يُعاد البحث عن الأغراض)` : ''}: ${planNow}`, ...(m.certain ? [] : ['تقديري'])].join(' · ')));
    if (p !== undefined) txt.append(el('small', '', [`ترتيب نسبي ${p}% بين ${g === 'open' ? 'المشروطة' : 'المحسومة'} من الندرة نفسها${a.id === winner ? ' · يتقدم في المرحلة والخطة معاً حسب الأجزاء المحسوبة' : stageComparable && a === cards[0] && cards.length > 1 ? ' · الأعلى في المرحلة الحالية' : ''}`, ...conflictsWith(heldParts(), mechOf(a)?.id).map((c) => `تعارض: ${c}`)].join(' · ')));
    if (!m && a.unmeasuredReason) txt.append(el('small', 'missing', `غير محسوب: ${a.unmeasuredReason}`));
    if (m?.open.length) txt.append(el('small', '', `الشرط: ${m.open.join('، ')}. احتماله غير مقاس.`));
    // T048: beside the value, not only in the folded details: part of the gain is attacks the engine assumes, not attacks read from the match.
    const assumed = m?.attacksAssumed;
    if (assumed) txt.append(el('small', 'ov-assume', assumed.by === 'offered'
      ? `يشمل هجمات عادية يفترضها المحرك بسبب هذا التعزيز: ${assumed.before ?? 0} هجمة قبل هذا التعزيز، و${assumed.after} بعده، في ${assumed.seconds}ث عند المستوى ${assumed.level}. هذا العدد افتراض، لا قراءة من مباراتك.`
      : `يشمل هجمات عادية يفترضها المحرك بسبب ${assumed.names.join('، ')} المختار: ${assumed.before ?? assumed.after} هجمة قبل هذا التعزيز، و${assumed.after} بعده، في ${assumed.seconds}ث عند المستوى ${assumed.level}. هذا العدد افتراض، لا قراءة من مباراتك.`));
    if (m?.range) txt.append(...rangeLines(m.range, m.value, m.estimatedLevel));
    // T072: a shield on his own low health, as its condition and amount only: outside the value above, with no chance or use estimated.
    if (m?.lowHealth) txt.append(el('small', 'ov-lowhealth', lowHealthText(m.lowHealth)));
    if (m) {
      const more = el('details', 'plan-reason');
      more.append(el('summary', '', 'تفاصيل الحساب'), el('small', '', mathWords(a.id)));
      if (m.plan) more.append(el('small', '', `الخطة المكتملة: ضرر ${signed(m.plan.damage)}، تحمّل ${signed(m.plan.health)}`), el('small', 'en', m.plan.items.map((id) => [...d.items, ...d.boots].find((i) => i.id === id)?.enName ?? String(id)).join(' › ')));
      txt.append(more);
    }
    if (m?.plan) {
      // The plan with this card against the plan without it, same state and style (T014), past the held items main's search itself kept (T015),
      // never the page's own list; only for an answer to the current state.
      const itemName = (id: number) => [...d.items, ...d.boots].find((i) => i.id === id)?.enName;
      const verdict = !cardMathLoading && cardMathContext === cardContext() ? pathChange(m.plan.baselineItems, m.plan.items, m.plan.baselineOwned, m.plan.itemsOwned) : undefined;
      const change = pathChangeLine(verdict, itemName);
      if (change) {
        txt.append(el('small', 'path-change', change));
        // The card plan's own reason for the item the line names (T017), folded: the search's words, not a claim that the card alone caused it.
        const reason = planReason(verdict, m.plan.items, m.plan.itemsOwned, m.plan.itemsWhy);
        const reasonName = reason && itemName(reason.id);
        if (reason && reasonName) {
          const more = el('details', 'plan-reason');
          more.append(el('summary', '', `سبب ترشيح ${reasonName} في هذه الخطة`), el('small', '', reason.why.join(' · ')));
          txt.append(more);
        }
      }
      if (m.plan.missing.length) txt.append(el('small', '', `غير محسوب في الخطة: ${m.plan.missing.join(' · ')}`));
      if (assumed) txt.append(el('small', 'ov-assume', 'والخطة المكتملة تحمل افتراض الهجمات نفسه؛ عددها فيها غير معروض لأن أغراضها غير أغراضك الآن.'));
    } else if (m?.planError) txt.append(el('small', 'missing', m.planError));
    const targetField = abilityTargetField(a);
    if (targetField) txt.append(targetField);
    r.append(ic(a), txt, pill('اخترته', () => {
      for (const id of offer) if (id !== a.id && !picked.has(id)) delete abilityTargets[id];
      offer.clear(); comparePartialOffer = false; void toggleMark(a.id); redrawBuild();
    }), pill('✕', () => { offer.delete(a.id); comparePartialOffer = false; delete abilityTargets[a.id]; void refreshCardMath(); redrawBuild(); }, 'pill ghost'));
    rows.append(r);
  }
  const availableOffers = pool.filter((a) => !offer.has(a.id) && !picked.has(a.id));
  const findCard = finder('ov-offer-card', 'اكتب اسم بطاقة معروضة واضغط Enter عند ظهور نتيجة واحدة', (q) =>
    findOfferMatches(availableOffers, q).slice(0, 6).map((a) => pill(shownName(a), () => {
      if (offer.size >= 3) return;
      offer.add(a.id); comparePartialOffer = false;
      byId<HTMLInputElement>('ov-offer-card').value = '';
      void refreshCardMath(); redrawBuild();
      document.getElementById('ov-offer-card')?.focus();
    })));
  // T053: range against the computed fight, as a trade-off to read, not a score: never units added together, never a winner overall (rangeComparison).
  const rc = !cardMathLoading ? rangeComparison(cards.map((a) => ({ id: a.id, group: groupOf(a), stage: cardMath.get(a.id)?.value, range: cardMath.get(a.id)?.range }))) : undefined;
  if (rc) {
    const nameOf = (id: number) => shownName(cards.find((a) => a.id === id)!);
    const fight = rc.fightTop !== undefined ? `${nameOf(rc.fightTop)} أعلى في الأجزاء القتالية المحسوبة${rc.amongSettled ? ' (بين المحسومة)' : ''}`
      : rc.fightTie.length ? `تعادل في الأجزاء القتالية المحسوبة${rc.amongSettled ? ' (بين المحسومة)' : ''} بين ${rc.fightTie.map(nameOf).join(' و')}` : '';
    const reach = rc.rangeTop !== undefined ? `${nameOf(rc.rangeTop)} أعلى في المدى` : '';
    rows.append(el('p', 'hint ov-range-trade', `${[fight, reach].filter(Boolean).join('؛ ')}${fight || reach ? '. ' : ''}لا فائز إجمالي: المدى خارج نسبتي الآن والخطة، ولا يُجمع معهما${rc.rangeUnread ? '، ومقدار المدى غير محسوب لبعض البطاقات' : ''}.`));
  }
  const trade = winner === undefined && !cardMathLoading ? offerTradeoff(cards.map((a) => ({ id: a.id, group: groupOf(a), stage: cardMath.get(a.id)?.value, plan: cardMath.get(a.id)?.plan?.value }))) : undefined;
  if (trade) {
    const nameOf = (id: number) => shownName(cards.find((a) => a.id === id)!);
    rows.append(el('p', 'hint ov-tradeoff', `مقايضة محسوبة: ${nameOf(trade.stage)} أعلى الآن بأغراضك الحالية، و${nameOf(trade.plan)} أعلى في الخطة المكتملة. لا فائز محسوم، والخطة ليست أمر شراء.`));
  }
  if (offer.size > 0 && offer.size < 3 && !comparePartialOffer) {
    rows.append(pill('قارن الخطط للبطاقات المدخلة', () => { comparePartialOffer = true; void refreshCardMath(); redrawBuild(); }));
  } else if (offer.size && cardMathLoading) {
    rows.append(el('p', 'hint', 'جاري حساب خطط البناء المكتملة…'));
  }
  findCard.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.repeat || findCard.box.childElementCount !== 1) return;
    event.preventDefault();
    findCard.box.querySelector('button')?.click();
  });
  if (offer.size) openFolds.add('offer');
  return fold('offer', offer.size ? `مقارنة البطاقات المعروضة (${offer.size} من 3)` : 'قارن البطاقات المعروضة عليك (اختياري)',
    findCard.label, findCard.box, rows,
    el('p', 'hint', 'الأرقام هنا من حساب المحرك، وليست احتمال فوز. «الآن» بأغراضك الحالية، و«الخطة المكتملة» تعيد البحث عن الأغراض لكل بطاقة بلا تعزيزات قادمة. حرف S–C في قائمة التعزيزات من نتائج المباريات والمواقع، ومنفصل عن هذه الأرقام.'));
}

/** What he holds and his level: read from the game when a match is read; typed in only without one, folded (T036). */
function ownedSection(): HTMLElement {
  const d = data!;
  if (!shopItems) {
    shopItems = [];
    void window.lolh.listItems('mayhem').then((r) => {
      shopItems = isError(r) ? [] : r.list.filter((i) => i.group === 'legendary' || i.group === 'boots' || i.id % 10000 === TEAR);
      redrawBuild();
    });
  }
  const known = new Map((shopItems ?? []).map((i) => [i.id, i]));
  const advised = engine?.key === engineKey() ? engine.items : [];
  for (const { item } of advised) known.set(item.id, item);
  const ezreal = d.champion?.id === EZREAL;
  const tear = ezreal ? ezrealTearStage(owned, tearCharged) : undefined;
  const tearItem = shopItems?.find((item) => item.id % 10000 === TEAR);
  const offPath = advised.flatMap((e) => (e.offPath ? e.item.id : []));
  const ownedRow = el('div', 'ov-adapted');
  for (const id of owned) {
    const item = known.get(id) ?? (id % 10000 === TEAR ? tearItem : undefined);
    if (!item && id % 10000 !== TEAR) continue;
    const r = el('div', 'ov-adapted-row');
    const txt = el('div', 'ov-name');
    txt.append(el('b', '', item ? shownName(item) : 'Tear of the Goddess'), el('small', '', offPath.includes(id) ? 'لم يكن المحرك ليختاره الآن' : 'مملوك'));
    if (item) r.append(ic(item));
    r.append(txt);
    if (!d.live) r.append(pill('✕', () => { owned.splice(owned.indexOf(id), 1); ownedChanged(); }, 'pill ghost'));
    ownedRow.append(r);
  }
  const tearControl = el('label', 'hint');
  const charge = el('input', '') as HTMLInputElement;
  charge.type = 'checkbox';
  charge.checked = tearCharged;
  charge.addEventListener('change', () => { tearCharged = charge.checked; redrawBuild(); });
  tearControl.append(charge, ' اكتملت تراكمات Tear of the Goddess في اللعبة');
  const tearRows = tear === 'charging' || tear === 'ready' ? [tearControl] : [];
  if (d.live) return section('أغراضك', el('p', 'hint', owned.length ? 'تُقرأ من اللعبة.' : 'تُقرأ من اللعبة: لا غرض مكتمل بعد.'), ownedRow, ...tearRows);
  // No match read (before the game, or the phone page): his level and items can be typed, without being a step the build waits for.
  const stage = augmentStage([...picked], progress());
  const levelInput = el('input', '') as HTMLInputElement;
  levelInput.type = 'number'; levelInput.min = '3'; levelInput.max = String(MAYHEM_MAX_LEVEL); levelInput.step = '1';
  levelInput.value = String(stage.level);
  const levelLabel = el('label', 'hint', 'مستواك: ');
  levelLabel.append(levelInput);
  levelInput.addEventListener('change', () => {
    const level = levelInput.valueAsNumber;
    if (!Number.isInteger(level) || level < 3 || level > MAYHEM_MAX_LEVEL || Object.values(acquiredLevels).some((at) => at > level)) { levelInput.value = String(stage.level); return; }
    manualLevel = level;
    ownedChanged();
  });
  const findItem = finder('ov-owned-item', 'اكتب اسم الغرض الذي اشتريته…', (q) =>
    (shopItems ?? []).filter((i) => (ezreal || i.id % 10000 !== TEAR) && !owned.includes(i.id) && `${i.name} ${shownName(i)}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6).map((i) =>
      pill(shownName(i), () => { owned.push(i.id); byId<HTMLInputElement>('ov-owned-item').value = ''; ownedChanged(); document.getElementById('ov-owned-item')?.focus(); })));
  return fold('owned', owned.length ? `أغراضك (${owned.length}) ومستواك: لا مباراة مقروءة` : 'أغراضك ومستواك: لا مباراة مقروءة، أدخلهما إن أردت',
    levelLabel, findItem.label, findItem.box, ...(tear === 'start' && !tearItem ? [pill('اشتريت Tear of the Goddess', () => { owned.push(TEAR); ownedChanged(); })] : []), ownedRow, ...tearRows);
}

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

function abilityTargetField(a: OverlayData['augments'][number]): HTMLElement | null {
  if (!needsAbilityTarget(a.ids)) return null;
  const label = el('label', 'hint ov-ability-target');
  const select = el('select', '') as HTMLSelectElement;
  const options: [string, string][] = [['', 'غير محددة'], ['Q', 'Q'], ['W', 'W'], ['E', 'E'], ['R', 'R']];
  for (const [value, text] of options) {
    const option = el('option', '', text) as HTMLOptionElement;
    option.value = value;
    select.append(option);
  }
  select.value = abilityTargets[a.id] ?? '';
  select.addEventListener('change', () => {
    const key = select.value;
    if (key === 'Q' || key === 'W' || key === 'E' || key === 'R') abilityTargets[a.id] = key;
    else delete abilityTargets[a.id];
    path = undefined;
    void refreshCardMath();
    redrawBuild();
    void refreshEngine();
    });
  label.append(el('span', '', `المهارة التي يعرضها ${shownName(a)} في اللعبة: `), select);
  return label;
}

/** T052: one held card's partners, asked when the player opens them (one card at a time, never on each render). The answer belongs to one state:
 * any change of champion, level, picks, items, style, stacks or ranks drops it, and a late answer for another state is refused. */
let partnersFocus: number | undefined;
let partners: { key: string; answer?: PartnersAnswer; error?: string } | undefined;
const partnersKey = () => `${cardContext()}|${buildStyle ?? ''}|${stacks ?? ''}|${partnersFocus ?? ''}`;
async function refreshPartners() {
  const champion = data?.champion;
  if (partnersFocus === undefined || !champion || !picked.has(partnersFocus)) { partners = undefined; return; }
  const key = partnersKey();
  if (partners?.key === key) return;
  partners = { key };
  redrawBuild();
  const r = await window.lolh.cardPartners(champion.id, [...picked], data?.live?.items ?? owned, partnersFocus, progress(), buildStyle, stacks).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  if (partners?.key !== key || partnersKey() !== key) return; // an answer for an old state
  partners = isError(r) ? { key, error: r.error } : { key, answer: r };
  redrawBuild();
}
const PARTNERS_LIMIT = 'تقدير للحالة الحالية من الأجزاء المحسوبة، غير مثبت بنتائج المباريات.';
/** The reason a row gives, from the parts of the fight that grew with the held card; with no such part, an unexplained difference is said so. */
// T052 v2: only explained rows are listed, so a reason always names the parts of the fight that grew with the held card (five parts, never added).
const PART_WORDS: [keyof PartnersAnswer['settled'][number]['parts'], string][] = [['damage', 'الضرر'], ['effectiveHp', 'التحمّل'], ['healedHp', 'شفاؤه ودروعه'], ['abilityHealing', 'الشفاء الذي تعطيه قدراته'], ['healingDenied', 'منع شفاء الخصم']];
const partnerReason = (row: PartnersAnswer['settled'][number], focusName: string) => {
  const parts = PART_WORDS.filter(([k]) => row.parts[k] > 1e-6).map(([, w]) => w);
  return [`في حساب القتال الحالي ازداد أثرها مع ${focusName} في: ${parts.join('، ')}`,
    ...(row.assumedAttacks.length ? [`تشمل هجمات عادية يفترضها المحرك بسبب ${row.assumedAttacks.join('، ')}`] : []),
    ...(row.conditions.length ? [`الشرط: ${row.conditions.join('، ')}`] : []), ...(row.limits.length ? [`حدود: ${row.limits.join('؛ ')}`] : [])].join(' · ');
};
function partnersSection(): HTMLElement | null {
  const d = data!;
  const chosen = d.augments.filter((a) => picked.has(a.id));
  if (!chosen.length || d.mode !== 'mayhem') return null;
  if (partnersFocus !== undefined && !picked.has(partnersFocus)) { partnersFocus = undefined; partners = undefined; }
  if (partnersFocus !== undefined && partners?.key !== partnersKey()) void refreshPartners();
  const nameOf = (id: number) => { const a = d.augments.find((x) => x.ids.includes(id)); return a ? shownName(a) : String(id); };
  const body: HTMLElement[] = [el('p', 'hint ov-partners-limit', PARTNERS_LIMIT)];
  const choose = el('div', 'ov-partners-cards');
  for (const a of chosen) choose.append(pill(shownName(a), () => { partnersFocus = a.id; partners = undefined; openFolds.add('partners'); void refreshPartners(); redrawBuild(); }, a.id === partnersFocus ? 'pill on' : 'pill'));
  body.push(choose);
  const p = partners?.key === partnersKey() ? partners : undefined;
  if (partnersFocus !== undefined) {
    const focusName = nameOf(partnersFocus);
    if (!p || (!p.answer && !p.error)) body.push(el('p', 'hint', `جاري حساب شركاء ${focusName}…`));
    else if (p.error) body.push(el('p', 'missing', `تعذّر حساب الشركاء: ${p.error}`), pill('أعد المحاولة', () => { partners = undefined; void refreshPartners(); }));
    else {
      const ans = p.answer!;
      if (ans.unread) body.push(el('p', 'missing', `لا تكفي الأجزاء المحسوبة لتحديد شركاء لهذه البطاقة: ${ans.unread}.`));
      else {
        const list = (rows: PartnersAnswer['settled'], title: string) => {
          if (!rows.length) return;
          body.push(el('p', 'hint ov-offer-group', title));
          for (const r of rows) {
            const row = el('div', 'ov-adapted-row ov-partner');
            const txt = el('div', 'ov-name');
            txt.append(el('b', '', nameOf(r.id)), el('small', '', `أثرها الآن مع بطاقاتك: ${signed(r.gain)}`), el('small', 'ov-partner-why', partnerReason(r, focusName)));
            row.append(txt);
            body.push(row);
          }
        };
        if (ans.stateLimits.length) body.push(el('small', 'missing ov-partners-state', `حدود حالتك في هذا الحساب: ${ans.stateLimits.join('؛ ')}.`));
        list(ans.settled, 'محسوبة');
        list(ans.open, 'مشروطة: الأثر إن تحقق الشرط');
        list(ans.limited, 'محدودة: أجزاء محسوبة فقط، وفيها ما لم يُحسب');
        if (!ans.settled.length && !ans.open.length && !ans.limited.length) body.push(el('p', 'hint', 'لا تكفي الأجزاء المحسوبة لتحديد شركاء لهذه البطاقة.'));
        const c = ans.coverage;
        body.push(el('small', 'hint ov-partners-coverage', `من ${c.pool} بطاقة في الحوض عند المستوى ${ans.level}${ans.estimatedLevel ? ' (افتراضي)' : ''}: قورنت ${c.compared} (${c.settled} محسوبة، ${c.open} مشروطة، ${c.limited} محدودة)${c.unexplained ? `، ومنها ${c.unexplained} بفرق لم يُفسَّر فلم تُعرض` : ''}؛ ${c.noNumbers} بلا معادلات، ${c.noLiveEffect} بلا أثر حي، ${c.rangeOnly} بطاقة مدى خارج هذا الحساب، ${c.notApplicable} لا ينطبق شرطها، ${c.notComparable} غير قابلة للمقارنة.`));
      }
    }
  }
  return fold('partners', 'شركاء بطاقاتك — تقدير المحرك', ...body);
}

/** The main page (T036, the owner: «its the main page»): his state in one line, the engine's next item and its reason, the rest of the plan;
 * then the optional parts (cards on offer, items typed in without a match) and how it is computed, folded. */
function adaptedSection(): HTMLElement[] {
  const d = data!;
  const chosen = d.augments.filter((a) => picked.has(a.id));
  const stage = augmentStage([...picked], progress());
  const state = el('p', 'ov-state');
  state.setAttribute('role', 'status');
  state.append(
    el('span', '', `المستوى ${stage.level}${d.live ? ' من اللعبة' : stage.estimatedLevel ? ' (افتراضي)' : ''}`),
    el('span', '', chosen.length ? `تعزيزاتك ${chosen.length} من ${MAX_PICKS}` : 'لا تعزيزات مسجّلة بعد'),
    el('span', '', d.live ? `أغراضك من اللعبة: ${owned.length}` : `أغراضك: ${owned.length}`),
  );
  // T053 v3: the range the held cards give, once, in his state: with or without offers; only from an answer to this state (an old one is dropped).
  const heldRange = cardMathContext === cardContext() && !cardMathLoading ? [...cardMath.values()].map((r) => r.heldRange).find(Boolean) : undefined;
  if (heldRange) state.append(el('span', 'ov-range-held', `مدى هجومك العادي ${heldRange.total} (الأساسي ${heldRange.base}، مع ${heldRange.names.join('، ')})`));
  // With no marks yet one line says what to do; the log's state shows once there is something in it, or a mark was refused.
  const head: HTMLElement[] = [state, ...(chosen.length ? [chosenChips(chosen), ...chosen.flatMap((a) => abilityTargetField(a) ?? []), ...pickStatus()] : [el('p', 'hint', NO_PICKS), ...(pickRefused ? pickStatus() : [])])];
  const styleRow = styleSwitch();
  const stackRow = stacksField(() => { path = undefined; redrawBuild(); });
  const controls = [...(styleRow ? [styleRow] : []), ...(stackRow ? [stackRow] : [])];
  const title = 'البناء حسب مباراتك';
  if (engine?.key !== engineKey()) {
    void refreshEngine();
    return [section(title, ...head, ...controls, el('p', 'hint', 'جاري حساب البناء…')), offerSection(), ...[partnersSection()].filter((x): x is HTMLElement => !!x), ownedSection()];
  }
  if (engine.error) {
    const key = engineKey(), tries = retriesFor(key);
    const retry = tries < ENGINE_RETRIES ? [pill('أعد المحاولة', () => { engineRetries = { key, n: tries + 1 }; engineAsked = ''; engine = undefined; redrawBuild(); })] : [el('p', 'hint', 'أعد فتح النافذة (F7) لمحاولة أخرى.')];
    return [section(title, ...head, ...controls, el('p', 'missing', `تعذّر حساب البناء: ${engine.error}`), ...retry), offerSection(), ...[partnersSection()].filter((x): x is HTMLElement => !!x), ownedSection()];
  }
  const rows = el('div', 'ov-adapted');
  const bought = path?.bought ?? 0;
  const ezreal = d.champion?.id === EZREAL;
  const nextEzreal = ezreal ? ezrealNextItems(owned, engine.items.map(({ item }) => item.id), tearCharged)[0] : undefined;
  if (nextEzreal === TEAR) rows.append(el('p', 'hint', 'التالي: Tear of the Goddess وحده لبدء جمع التراكمات.'));
  engine.items.forEach(({ item, why }, place) => {
    const mine = place < bought || why.includes('owned');
    const next = !mine && (ezreal ? item.id === nextEzreal : place === bought);
    const r = el('div', `ov-adapted-row${next ? ' next' : ''}`);
    const txt = el('div', 'ov-name');
    txt.append(el('b', '', shownName(item)), el('small', '', [...(mine ? ['تملكه'] : next ? ['التالي'] : []), ...why.filter((w) => w !== 'owned').map((w) => WHY_AR[w] ?? w)].join(' · ')));
    r.append(ic(item), txt);
    rows.append(r);
  });
  if (!engine.items.length) rows.append(el('p', 'missing', 'لم يُرجع المحرك أغراضاً لهذا البطل.'));
  const dropped = engine.dropped ?? [];
  // A magic build buys no crit, so the crit line isn't his road there (the owner: Miss Fortune with Vulnerability).
  const lines = openLines(heldParts(), championDamage()).filter((o) => o.held.some((part) => part > 0) && !((buildStyle === 'ap' || buildStyle === 'aphp') && o.line.id === 'crit')).map((o) => el('p', 'hint', `${o.line.name}: ${o.held.length} أجزاء. يفشل إذا: ${o.line.breaks.join('، ')}.`));
  const x = experimental?.key === `${loadId}|${d.champion?.id}|${pickedKey()}` ? experimental.build : null;
  return [
    section(title, ...head, ...controls, ...(dropped.length ? [el('p', 'missing', `لم يعد مناسباً بعد التعزيز الجديد: ${dropped.map(shownName).join('، ')}.`)] : []), rows),
    offerSection(),
    ...[partnersSection()].filter((x): x is HTMLElement => !!x),
    ownedSection(),
    fold('notes', 'كيف يُحسب هذا البناء',
      el('p', 'hint', 'نثبت أغراضك المملوكة، ونعيد حساب البقية مع كل اختيار أو تحديث للمباراة.'), ...lines,
      el('p', 'hint', 'أثر الغرض هو الفرق عند حذفه من البناء المكتمل. التفاعل يقيس ما يتجاوز جمع الأثرين مع بقاء بقية البناء؛ هذه الأرقام لا تُجمع ولا تمثل احتمال فوز.'),
      ...calculationNotes(engine.items),
      ...(x ? [el('h3', 'sub-title', EXPERIMENTAL_TITLE), el('p', 'hint', experimentalHint(x)), icons(x.items)] : [])),
  ];
}

/** Buttons for his kit's own build and each other style it allows; asks for the styles once per champion and marked cards. */
/** A field for his stacks when his abilities grow with them: stacks differ from game to game (the owner, 2026-11-06). */
function stacksField(redraw: () => void): HTMLElement | null {
  const champion = data?.champion;
  if (!champion) return null;
  if (stackBase?.champion !== champion.id) {
    stackBase = { champion: champion.id, base: null };
    void window.lolh.stackBase(champion.id).then((x) => {
      if (isError(x) || stackBase?.champion !== champion.id) return;
      stackBase = { champion: champion.id, base: x };
      if (x !== null) redraw();
    });
  }
  if (stackBase.base === null) return null;
  return stackInput(stackBase.base, stacks, (n) => { stacks = n; void refreshCardMath(); redraw(); });
}
function styleSwitch(): HTMLElement | null {
  const champion = data?.champion;
  if (!champion) return null;
  const key = `${loadId}|${data?.game}|${pickedKey()}|${JSON.stringify(abilityTargets)}`;
  if (styles?.champion !== champion.id || styles.key !== key) {
    styles = { champion: champion.id, key, list: styles?.champion === champion.id ? styles.list : [] };
    void window.lolh.buildStyles(champion.id, [...picked], progress()).then((x) => {
      if (isError(x) || styles?.champion !== champion.id || styles.key !== key) return;
      styles = { champion: champion.id, key, list: x };
      if (buildStyle && !x.includes(buildStyle)) { buildStyle = undefined; void refreshCardMath(); } // the card that opened it was unmarked
      redrawBuild();
    });
  }
  if (!styles.list.length) return null;
  const s = el('div', 'ov-tabs');
  for (const v of [undefined, ...styles.list]) {
    const b = el('button', v === buildStyle ? 'active' : '', v ? STYLE_LABEL[v] : 'حسب عدته');
    b.type = 'button';
    b.addEventListener('click', () => {
      buildStyle = v;
      path = undefined; // another way to build: what he walked was for the other one
      void refreshCardMath();
      redrawBuild();
        });
    s.append(b);
  }
  return s;
}

/** Inside its own fold on the main page (T037): the marks already show above, so only the note and the AI box. */
function aiSection(): HTMLElement {
  const chosen = (data?.augments ?? []).filter((a) => picked.has(a.id));
  const box = el('div', '');
  if (!chosen.length) return box.appendChild(el('p', 'hint', NO_PICKS)), box;
  box.append(el('p', 'hint', 'رأي إضافي، وقد يختلف عن بناء المحرك أعلاه.'), aiBox(chosen));
  return box;
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

const NO_PICKS = 'اضغط «اخترته» على التعزيز الذي تأخذه (تبويب التعزيزات أو مقارنة البطاقات)، فيتبعه البناء. بدونه يُحسب البناء لبطلك بلا تعزيزات.';

/** The AI answer for the augments marked now, kept until they change. */
let ai: { key: string; state: 'loading' | 'done' | 'error'; advice?: Advice; error?: string } | undefined;
const pickedKey = () => [...picked].sort((a, b) => a - b).join('-');
/** What the engine's answer depends on: the marks and what he bought. */
const engineKey = () => `${loadId}|${data?.game}|${data?.champion?.id}|${[...picked].join('-')}|${owned.join('-')}|${buildStyle ?? ''}|${stacks ?? ''}|${JSON.stringify(progress())}`;
/** Which way to build: his kit's own (undefined), or magic, physical, tank (the owner: Katarina has all three). */
type Style = 'ap' | 'ad' | 'tank' | 'aphp';
let buildStyle: Style | undefined;
/** Stacks the player typed for a champion whose abilities grow with them (Nasus, Smolder…); none: the engine's estimate. */
let stacks: number | undefined;
let stackBase: { champion: number; base: number | null } | undefined;
/** The styles his kit allows, for the champion they were asked for. */
let styles: { champion: number; key: string; list: Style[] } | undefined;
const STYLE_LABEL: Record<Style, string> = { ap: 'سحري', aphp: 'سحري مع صحة', ad: 'جسدي', tank: 'تانك' };

/** Asks for the marked augments' build (once per set of marks) and shows it in the build tab. */
async function startAi() {
  const champion = data?.champion;
  if (!champion || !picked.size) return;
  const key = pickedKey();
  openFolds.add('ai'); // the AI build has its own fold on the main page
  showTab('build');
  if (ai?.key !== key) {
    ai = { key, state: 'loading' };
    redrawBuild();
    buildBox.querySelector('.ov-ai')?.scrollIntoView({ block: 'nearest' });
    const r = await window.lolh.aiBuild(champion.id, [...picked]);
    if (ai?.key !== key) return; // the marks changed meanwhile
    ai = isError(r) ? { key, state: 'error', error: r.error } : { key, state: 'done', advice: r };
  }
  redrawBuild();
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


/** Compact build: the engine first for Mayhem (T036), then skills, runes and spells; the site's usual build and AI folded below.
 * Without the site's page (failed or slow to load) the engine still shows for the known champion. */
function renderBuild(p?: ChampionPage) {
  const focused = document.activeElement instanceof HTMLInputElement && document.activeElement.id ? document.activeElement.id : undefined;
  const out: HTMLElement[] = [];
  const mayhem = data?.mode === 'mayhem';
  if (mayhem && data?.champion) out.push(...adaptedSection(), fold('ai', 'بناء الذكاء الاصطناعي (اختياري)', aiSection()));
  if (p?.buildError) out.push(el('p', mayhem ? 'hint' : 'missing', mayhem ? `بناء الموقع غير متاح: ${p.buildError}` : p.buildError));
  else if (p) {
    const stats = p.stats && el('p', 'en', `نسبة الفوز ${pct(p.stats.winRate)} · ${p.stats.games.toLocaleString('en')} مباراة`);
    const items = baseItems(p);
    if (mayhem) {
      // Without the site's Mayhem build the ARAM one is shown: say so, or it looks like a wrong mode.
      out.push(fold('site', 'البناء المعتاد للموقع',
        el('p', 'hint', p.siteBuild ? 'ما يشتريه لاعبو البطل عادةً، ولا يتغير بتعزيزاتك؛ ليس حساب المحرك.' : 'لا يتوفر بناء خاص بهذا الطور الآن، فهذا أقرب بناء متاح، وليس حساب المحرك.'),
        ...(stats ? [stats] : []), ...(items ? [items] : [])));
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
  }
  buildBox.replaceChildren(...(out.length ? out : [el('p', 'missing', 'لا يوجد بناء لهذا البطل.')]));
  // A redraw while he types (an answer arriving) keeps him in the field he was typing in.
  if (focused) { const input = document.getElementById(focused) as HTMLInputElement | null; if (input) { input.focus(); const end = input.value.length; try { input.setSelectionRange(end, end); } catch { /* type=number */ } } }
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
  engineRetries = undefined;
  const newGame = reply.game !== undefined && pickedGame !== undefined && pickedGame !== reply.game;
  if (pickedFor !== reply.champion?.id || newGame) {
    resetRun();
    pickedFor = reply.champion?.id;
    if (newGame) restoredFor = reply.champion?.id; // never restore the previous match's picks, even on the same champion
  }
  if (reply.game !== undefined) pickedGame = reply.game;
  if (reply.live) {
    manualLevel = undefined;
    const finished = new Set([...reply.items, ...reply.boots].map((i) => i.id));
    owned.splice(0, owned.length, ...liveFinished(reply.live.items, finished, reply.champion?.id));
    if (ezrealTearStage(owned, false) !== 'charging') tearCharged = false;
  }
  cardMathFor = ''; cardMath.clear();
  // This match's marks come back from main's live log, even an empty one (src/renderer/pickRestore.ts). Only with no live log do the last
  // build's augments come back, as manual marks with no certificate, once per champion.
  if (!picked.size && reply.champion && reply.mode === 'mayhem') {
    const champion = reply.champion.id;
    const plan = await restorePicks(window.lolh, { game: reply.game, championId: champion, known: (a) => reply.augments.some((x) => x.id === a), manualAllowed: restoredFor !== champion });
    if (id !== loadId) return;
    if (plan.source === 'log') {
      if (plan.snap) applyPicks(plan.snap);
      // Marks still being recorded when F7 reloaded: one wait for them, then the log as it ends up (never from an older match or load).
      if (plan.followPending && reply.game !== undefined) void followPending(reply.game, champion, id);
    } else if (plan.source === 'manual') {
      restoredFor = champion;
      for (const a of plan.ids) picked.add(a);
      // The marks brought back here are local and their levels estimated: said from load, not only after the next mark (T014).
      if (plan.ids.length) (pickSnap = undefined, pickNote = PICK_LOG_OFF);
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
    : reply.champion && reply.mode
    ? MODE_TITLE[reply.mode]
    : reply.mode === 'arena'
      ? 'Arena · ابحث عن التعزيزات التي ظهرت لك'
      : 'اختر بطلاً في شاشة الاختيار ليظهر ترتيبه';
  render();
  // The engine shows for a known Mayhem champion even when the site's build page failed (T036).
  const buildShown = !!reply.build || (reply.mode === 'mayhem' && !!reply.champion);
  tabs.hidden = !buildShown;
  redrawBuild();
  showTab(buildShown ? 'build' : 'augments');
  // Restored marks no longer open the AI build on their own (T036): the engine is the page; AI is asked from its button only.
  void refreshCardMath();
  void refreshFit();
  if (reply.mode === 'mayhem') {
    const [r, o] = await Promise.all([window.lolh.augmentEffects(), reply.champion ? window.lolh.openAugments(reply.champion.id) : []]);
    if (id !== loadId) return;
    if (!isError(r)) effects = new Map(r.map((x) => [x.id, x]));
    openPoints = new Map(isError(o) ? [] : o.map((x) => [x.id, x.points]));
    openWin = new Map(isError(o) ? [] : o.flatMap((x) => (x.win === undefined || x.games === undefined ? [] : [[x.id, { win: x.win, games: x.games }]])));
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
// On screen or not: main says it for the F7 window (T038: its Page Visibility stays 'visible' while hidden); the phone page uses the browser's.
const onPhone = document.documentElement.classList.contains('web');
let windowShown = false;
const onScreen = () => (onPhone ? document.visibilityState === 'visible' : windowShown);
let identityStale = false;
window.lolh.onOverlayState((s) => {
  const same = (s.championId ?? undefined) === data?.champion?.id && (s.mode ?? undefined) === data?.mode && (s.game ?? undefined) === data?.game;
  if (same) return;
  if (!onScreen()) identityStale = true; // hidden: only the latest is kept; nothing is read or computed for it now
  else void load();
});
window.lolh.onOverlayVisible((shown) => {
  windowShown = shown;
  if (!shown || onPhone) return;
  // Every show goes through overlay:show (toggle and show both send it first), whose load reads the latest once: nothing more here.
  identityStale = false;
});
// The phone: coming back to the page is its F7 press (web-bridge onOverlayShow), which loads the latest once.
if (onPhone) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') identityStale = false; });
// The desktop overlay and phone can remain open across level-ups. Record a fresh level on a pick as well.
setInterval(() => { if (onScreen()) void refreshProgress().catch(() => undefined); }, 10_000);

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
      .map((a) => ({ a, score: (effects.get(a.id)?.points ?? -9) + outsidePoints(openPoints.get(a.id), a.tierLabel) + FIT_POINTS * (fitOf(champion.id, a.ids ?? [a.id])?.score ?? 0) }))
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
