// The next items by arithmetic alone (src/ai/cardMath.ts): no pick, buy or win rates. Six slots are the real limit late and gold early, so the set is chosen by
// what each item adds to the full fight, then bought in the order that adds most per gold, recomputed each time so a chain shows up. Boots are the exception:
// move speed is worth nothing in a fight model, yet a champion has to reach the fight, so one pair comes second and the fight chooses which.

import { ONE_OF } from '../app/buildEngine.js';
import { FIGHT, fight, type CardNumbers, type CardOp, type EnemyTeam, type FightResult, type Kit } from './cardMath.js';
import type { KnownRanks, SkillPlan } from './abilityRank.js';
import { championRecord } from './calculator.js';
import { DAMAGE_SHARE } from './shareData.js';
import { CHAMPION_KITS } from './championKits.js';
import type { GameItem } from '../texts/gameData.js';

export interface PoolItem { id: number; gold: number; boots: boolean; damage?: 'ap' | 'ad' | 'none' | string }
export interface MathStep { id: number; damage: number; health: number; reason: 'owned' | 'required' | 'mana' | 'stacks' | 'augment' | 'boots' | 'math' }
/** A champion's place in a team's fight: his share of the enemy's damage with no items, how fast it grows as he buys health from `health0`, that damage per second, and what a point absorbed for the team is worth in points of damage. */
export interface TeamPlace { /** More of the enemy damage than his share says (frontline, FRONT_DRAW). */ draw?: number; carriesHealth?: boolean; healWorth?: number; share: number; rise: number; health0: number; maxRatio?: number; enemyDps: number; absorbedWorth: number; window?: number }
/** A burst champion's damage comes in a few seconds from his abilities and ultimate, then he leaves: the owner's rule (Ahri, Zed). Assumption: the window, tried at 2 to 5 s and chosen on the owner's cases (knowledge/burst-value-plan.md). */
export const BURST = { window: 3 };
/** A frontline champion draws more of the enemy's damage than the stored share gives the model: with the engine's own builds he outlived the rest 1.16 to 0.84 fights,
 * while in 22,528 EU and 13,600 NA Mayhem games both die as often (0.63 and 0.61 deaths a minute). The ratio scales his draw (the owner: «عمر المقاتلين», 2026-11-08). */
export const FRONT_DRAW = { value: 1.38 };
/** Fights in a row with no trip back: by the third a champion with no mana item has settled at what his mana allows (Lux at 15: 6300, 5349, 3302, 3302), which two fights' first seconds hid. */
export const FIGHTS = { inARow: 3 };
const isBurst = (traits: string[] = []) => traits.includes('burst') && !traits.includes('sustained') && !traits.includes('frontline');

export const LEVEL_BY_ITEMS = [5, 9, 12, 15, 17, 18, 18];
const FULL_BUILD_LEVEL = 15;
export const SLOTS = 6;
const BEAM_WIDTH = 3; // 99.7% of width 5's value on 58 champions, at two thirds of the time
/** Who gets hit: stored games' damage taken follows E^1.24 * range^-0.53 (correlation 0.672 on 5,586 held-out teams), from the file's level 18 numbers. For a champion with too few games. */
export function targetWeight(bin: Record<string, unknown>): number {
  const r = championRecord(bin);
  const at18 = (base?: { baseValue?: number }, per?: { baseValue?: number }) => (base?.baseValue ?? 0) + (per?.baseValue ?? 0) * 17;
  const e = at18(r?.baseHPModifiable, r?.hpPerLevelModifiable) * (1 + (at18(r?.baseArmorModifiable, r?.armorPerLevelModifiable) + at18(r?.baseMR, r?.mrPerLevel)) / 200);
  return e ** 1.24 * ((r as unknown as { attackRangeModifiable?: { baseValue?: number } })?.attackRangeModifiable?.baseValue || 400) ** -0.53;
}
const TYPICAL_TARGET_WEIGHT = 1954; // the median over 173 champions
/** Within one champion, each doubling of health moves the share of damage taken this far, in logit: measured on 65,550 players of stored games. An association: who buys health may also walk in front. */
const SHARE_RISE = { melee: 0.915, ranged: 0.551 };
/** Stored games rarely go past this much health over none (99th percentile 3.17), so the share stops rising here rather than guess beyond them. */
const MAX_HEALTH_RATIO = 3;
/** A champion whose kit doesn't stand in front draws fire only so far, however much health he buys: from his kit's reading, not from what anyone buys. */
const MAX_HEALTH_RATIO_NOT_FRONT = 1.6;
/** Settles by itself over 173 champions choosing with it: searches from 2000 and 3000 end near 2,530. Absorbed worth: with even teams, four allies' damage over five enemies'. shortcut: one figure for every level and team, late-game sized; use real allies and levels when they're passed in. */
const ENEMY_DPS = 2530;
/** Early cards face far less damage: with 2600 fixed, the order of cards at levels 3 and 7 agrees only 0.73 and 0.80 with this. From the fight, 173 champions with items as a game goes. Full builds keep the fixed figure: their order agrees 0.97 or more across enemy teams. */
const ENEMY_DPS_BY_LEVEL: [number, number][] = [[1,160], [3,176], [5,223], [7,322], [9,368], [11,594], [12,610], [15,1092], [17,1786], [18,2702]];
export function enemyDpsAt(level: number): number {
  const after = ENEMY_DPS_BY_LEVEL.findIndex(([l]) => l >= level);
  if (after <= 0) return after === 0 ? ENEMY_DPS_BY_LEVEL[0]![1] : ENEMY_DPS_BY_LEVEL.at(-1)![1];
  const [l0, d0] = ENEMY_DPS_BY_LEVEL[after - 1]!, [l1, d1] = ENEMY_DPS_BY_LEVEL[after]!;
  return d0 + ((d1 - d0) * (level - l0)) / (l1 - l0);
}
// Stored games: for each ally's health gain, a champion dies 0.167 less often per enemy damage dealt (se 0.002), near the 0.2 this figure predicts; counted per minute it shows nothing, since it then measures how many fights there were.
const ABSORBED_WORTH = 0.8;
/** Damage a champion who doesn't stand in front takes in others' place: an assumption tried at 0, 0.2 and 0.4 on the owner's cases (Yasuo, Zed: health doesn't serve a carry). */
export const ABSORBED_WORTH_BACK = { value: 0.2 };
/** Stored games: real healing per minute follows the fight's self healing at a slope of 0.127 (24,135 players), in the right order by fifths, so a point healed counts this much. */
const HEALING_WORTH = 0.127;
/** Healing from abilities keeps someone on the team up. Stored games, healers by fifths of the file's healing: -24% -> -17%, -7% -> -7%, +2% -> +2%, +10% -> +12%, +28% -> +15%. */
const ABILITY_HEALING_WORTH = 0.6;
/** A champion who heals or shields allies (Janna, Sona, Lulu, Nami, Soraka, Yuumi, Milio, Karma): stored games, within each of 9 enchanters (7,867 players),
 * a point healed a minute goes with winning 1.4 to 5.1 times as much as a point of damage a minute in four quarters of the games (2.9 in all), so his
 * healing counts at least as much as his damage: ABSORBED_WORTH x this = 1 (2026-11-05). Not for a frontline champion who also guards allies
 * (Tahm Kench took Moonstone Renewer, held by 0 of 1,171 of his players): the slope was measured on enchanters only. */
export const ALLY_HEAL_WORTH = { value: 1 / ABSORBED_WORTH };
/** The enemies' resists at a late level with no items, the size the fixed target was, and the kind of damage their kits deal. */
/** The mean health of 172 champions at level 15 with no items (measured 2026-11-04); a team's health scales FIGHT.target.hp by its own against this. */
const TYPICAL_HP = 2415;
/** items: an enemy's own build, for his healing; live: they are what he holds in the running match, so they count for his resists too. Guessed builds leave resists item-free (the owner reverted that, 2026-11-04). */
export function enemyTeam(list: { bin: Record<string, unknown>; kit: Kit; passive?: CardOp[]; items?: number[]; live?: boolean }[], shop: Record<number, GameItem>, itemOps?: Record<number, CardOp[]>): EnemyTeam | undefined {
  if (!list.length) return undefined;
  const fights = list.map((e) => fight({ bin: e.bin, shop, kit: e.kit, passive: e.passive, cards: [], items: [], level: FULL_BUILD_LEVEL }));
  // The owner, 2026-11-08 («نعم، مع أغراضه»): enemies heal with the items they buy (life steal, omnivamp, heal items), which anti-heal cuts.
  const healFights = list.map((e, i) => (e.items?.length ? fight({ bin: e.bin, shop, kit: e.kit, passive: e.passive, itemOps, cards: [], items: e.items, level: FULL_BUILD_LEVEL }) : fights[i]!));
  // In a running match his real items count for his resists too (the owner, 2026-11-08: «نعم، في المباراة الحية»); guessed builds don't, as the owner reverted that on 2026-11-04.
  const stats = list.map((e, i) => (e.live ? healFights[i]! : fights[i]!).stats);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const healing = (r: (typeof fights)[number]) => (r.healParts ? r.healParts.ops - (r.healParts.shields ?? 0) + r.healParts.omnivamp + r.healParts.lifeSteal : 0) + r.abilityHealingOnly; // shields are not healing: anti-heal does not cut them (Malphite read 933 a second with them)
  return { armor: mean(stats.map((s) => s.armor)), mr: mean(stats.map((s) => s.mr)), physicalShare: mean(list.map((e) => (e.kit.damage === 'physical' ? 1 : e.kit.damage === 'magic' ? 0 : 0.5))), hp: (FIGHT.target.hp * mean(stats.map((s) => s.hp))) / TYPICAL_HP, healPerSecond: mean(healFights.map(healing)) / FIGHT.seconds };
}
/** A way to build one champion: by his kit (none), or one the owner names: magic items only, physical only, or standing in front (Katarina has all three). 'aphp': magic with health, valued as a frontline champion's (the owner: Galio has three, all magic, magic with health, all tank). */
export type BuildStyle = 'ap' | 'ad' | 'tank' | 'aphp';
export const teamPlace = (o: { championId: number; bin: Record<string, unknown>; shop: Record<number, GameItem>; kit: Kit; passive?: CardOp[]; enemy?: EnemyTeam; allies?: Record<string, unknown>[]; style?: BuildStyle }): TeamPlace => {
  const w = targetWeight(o.bin);
  // Real allies beside him: his odds of being hit against theirs, scaled from the typical four the share was measured among.
  const others = (o.allies ?? []).slice(0, 4).reduce((sum, bin) => sum + targetWeight(bin), TYPICAL_TARGET_WEIGHT * (4 - Math.min(4, o.allies?.length ?? 0))) / (4 * TYPICAL_TARGET_WEIGHT);
  const alone = DAMAGE_SHARE[o.championId] ?? w / (w + 4 * TYPICAL_TARGET_WEIGHT);
  const melee = ((championRecord(o.bin) as unknown as { attackRangeModifiable?: { baseValue?: number } })?.attackRangeModifiable?.baseValue ?? 0) < 300;
  const kitTraits = CHAMPION_KITS.find((k) => k.id === o.championId)?.traits;
  // A tank build is valued as a frontline champion's: the whole fight, health carried to the next, damage taken in others' place; a magic or physical build as a damage dealer's over the whole fight (Sett's fighter build, Katarina's health and magic build), his kit's own build keeping a burst window.
  const traits = o.style === 'tank' || o.style === 'aphp' ? [...(kitTraits ?? []).filter((t) => t !== 'burst'), 'frontline'] : o.style ? kitTraits?.filter((t) => t !== 'frontline' && t !== 'burst') : kitTraits;
  return { ...(isBurst(traits) ? { window: BURST.window } : {}), ...(traits?.includes('frontline') ? { carriesHealth: true, draw: FRONT_DRAW.value } : {}), maxRatio: traits?.includes('frontline') ? MAX_HEALTH_RATIO : MAX_HEALTH_RATIO_NOT_FRONT, share: 1 / (1 + ((1 - alone) / alone) * others), rise: melee ? SHARE_RISE.melee : SHARE_RISE.ranged, health0: fight({ bin: o.bin, shop: o.shop, kit: o.kit, passive: o.passive, enemy: o.enemy, cards: [], items: [], level: FULL_BUILD_LEVEL }).effectiveHp, enemyDps: ENEMY_DPS, ...(o.kit.buffsAllies && !traits?.includes('frontline') ? { healWorth: ALLY_HEAL_WORTH.value } : {}), absorbedWorth: traits?.includes('frontline') ? ABSORBED_WORTH : ABSORBED_WORTH_BACK.value };
};
const shareAt = (p: TeamPlace, health: number) => 1 / (1 + ((1 - p.share) / p.share) * Math.min(p.maxRatio ?? MAX_HEALTH_RATIO, Math.max(1, health / p.health0)) ** -p.rise);
const dealtBy = (r: FightResult, seconds: number) => { const whole = Math.floor(seconds), from = whole ? (r.damageBySecond[whole - 1] ?? r.damage) : 0, to = r.damageBySecond[whole] ?? r.damage; return from + (to - from) * (seconds - whole); };
/**
 * What fights in a row (FIGHTS.inARow) are worth to the team, each the damage he has dealt by the time he falls and the damage he takes in others' place. Nobody
 * goes back to base in ARAM, so he starts the second with the health the first left him, the mana it left and the cooldowns still running (FightResult.again); dead in the first,
 * he is absent from the second. Health carries only for a frontline champion (TeamPlace.carriesHealth): carried for everyone, losing the whole second
 * fight on falling in the first doubled health's worth near survival, and Warmog's went first for 103 of 172, marksmen too. Mana carries for everyone.
 * His share of the enemy's damage stays the one his full health draws. A burst champion's fights are his window.
 * Assumption: the gap between fights, tried at 0 to 40 s (knowledge/two-fights-plan.md), adds nothing: the fight reads no health or mana regeneration.
 * Stacks come from his level, not from the fight, so they carry as they are.
 */
export const fightValue = (r: FightResult, p: TeamPlace) => {
  const seconds = p.window ?? FIGHT.seconds, lasting = shareAt(p, r.effectiveHp) * p.enemyDps * seconds * (p.draw ?? 1);
  const one = (x: FightResult, health: number) => { const stays = health + HEALING_WORTH * (x.healedHp ?? 0), alive = Math.min(1, stays / lasting); return { left: Math.min(x.effectiveHp, Math.max(0, stays - lasting)), value: dealtBy(x, alive * seconds) + (x.healingDenied ?? 0) * alive * seconds / FIGHT.seconds + p.absorbedWorth * Math.min(stays, lasting) + ABSORBED_WORTH * (p.healWorth ?? ABILITY_HEALING_WORTH) * (x.abilityHealing ?? 0) * alive }; }; // healing allies keeps its own worth: the lower absorbed worth of a champion behind the front is for damage he takes, not for heals he gives (Soraka)
  let value = 0, x = r, health = r.effectiveHp;
  for (let n = 0; n < FIGHTS.inARow && health > 0; n++) {
    if (n) x = x.again?.() ?? x;
    const f = one(x, p.carriesHealth || !n ? health : x.effectiveHp);
    value += f.value;
    health = p.carriesHealth ? f.left : x.effectiveHp;
  }
  return value;
};

/** The best set when items multiply each other, so one strong pair can beat two strong singles: keep the best few sets at each size, then swap items while that helps. No guarantee of the very best set. */
export function searchSet(o: { start: number[]; candidates: number[]; slots: number; value: (ids: number[]) => number; fits: (id: number, held: number[]) => boolean; width: number; swaps: boolean }): number[] {
  const known = new Map<string, number>();
  const valueOf = (ids: number[]) => { const key = [...ids].sort((a, b) => a - b).join(); let v = known.get(key); if (v === undefined) { v = o.value(ids); known.set(key, v); } return v; };
  let beam = [o.start], best = o.start;
  for (let size = o.start.length; size < o.slots; size++) {
    const next = new Map<string, number[]>();
    for (const held of beam) for (const id of o.candidates) if (o.fits(id, held)) { const ids = [...held, id]; next.set([...ids].sort((a, b) => a - b).join(), ids); }
    beam = [...next.values()].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, o.width);
    if (!beam.length) break;
    // A flat or weaker intermediate set can unlock a strong combination at the next depth.
    if (valueOf(beam[0]!) > valueOf(best)) best = beam[0]!;
  }
  for (let improved = o.swaps; improved;) {
    improved = false;
    for (const out of best.filter((id) => !o.start.includes(id))) {
      const rest = best.filter((id) => id !== out);
      for (const id of o.candidates) if (o.fits(id, rest) && valueOf([...rest, id]) > valueOf(best)) { best = [...rest, id]; improved = true; }
      if (improved) break;
    }
  }
  return best;
}

export function mathBuild(o: { /** The live level is a floor: a late purchase never takes the champion back to level 5. */ level?: number; /** He can't buy boots (Cassiopeia): six other items. */ noBoots?: boolean; /** A card that needs one item of a kind (Upgrade Sheen: any Spellblade item): one of each group, which one by the whole build. */ requiredAnyOf?: number[][]; bin: Record<string, unknown>; shop: Record<number, GameItem>; kit: Kit; cards: CardNumbers[]; passive?: CardOp[]; itemOps?: Record<number, CardOp[]>; pool: PoolItem[]; owned: number[]; required: number[]; plannedItem?: number; place: TeamPlace; enemy?: EnemyTeam; offKind?: (i: PoolItem, held: number[]) => boolean; manaFirst?: boolean; stacks?: number; knownRanks?: KnownRanks; skillPlan?: SkillPlan; /** His kit and team place made again from fewer cards, for "would another item be best without this augment". */ contextFor?: (cards: CardNumbers[]) => { kit: Kit; place: TeamPlace } }): MathStep[] {
  // The game's own limits on what can be held together, and those its file doesn't name.
  const clashes = (id: number, held: number[]) => ONE_OF.some((g) => g.includes(id % 10000) && held.some((x) => x !== id && g.includes(x % 10000))) || (o.shop[id]?.limits ?? []).some((g) => held.some((x) => x !== id && o.shop[x]?.limits?.includes(g)));
  // One fight context: the cards and what they make of him (his kit, his place in the team). The build's own is `full`.
  type Context = { key: string; cards: CardNumbers[]; kit: Kit; place: TeamPlace };
  const full: Context = { key: 'all', cards: o.cards, kit: o.kit, place: o.place };
  // Fights already run in this one decision, by context, level and items: never shared across calls, so not across histories or card sets.
  const fights = new Map<string, FightResult>();
  const run = (list: number[], level: number, ctx: Context = full) => {
    const at = Math.max(o.level ?? 1, level), key = `${ctx.key}|${at}|${list.join()}`;
    let r = fights.get(key);
    if (!r) {
      r = fight({ bin: o.bin, shop: o.shop, kit: ctx.kit, cards: ctx.cards, passive: o.passive, itemOps: o.itemOps, enemy: o.enemy, items: list, level: at, stacks: o.stacks, incomingDps: ctx.place.share * ctx.place.enemyDps * (ctx.place.draw ?? 1), knownRanks: o.knownRanks, skillPlan: o.skillPlan });
      fights.set(key, r);
    }
    return r;
  };
  const allowed = (i: PoolItem, held: number[]) => !held.includes(i.id) && !clashes(i.id, held) && !!o.shop[i.id] && !o.offKind?.(i, held);
  const gain = (held: number[], id: number, level: number, ctx: Context = full) => { const v = fightValue(run(held, level, ctx), ctx.place); return v > 0 ? fightValue(run([...held, id], level, ctx), ctx.place) / v - 1 : 0; };
  // What a held augment asks for now: the best next item (gain per gold, as the order reads it) when, without one of his augments, another item
  // would be best. That augment is why it is best now (Skilled Sniper at level 5: Essence Reaver, which without it trails Infinity Edge), so it
  // comes before the stacking items. No threshold: it only asks whether the augment changes the best item.
  // "Without it" is rebuilt whole by the caller (contextFor: his kit and team place from the other cards; Marksmage's attacks go with Marksmage).
  // With no contextFor the comparison can't be made right, and the rule is off.
  const perGold = (id: number) => Math.max(o.pool.find((p) => p.id === id)?.gold ?? 3000, 1);
  const bestOf = (held: number[], ids: number[], level: number, ctx: Context) => ids.map((id) => ({ id, g: gain(held, id, level, ctx) / perGold(id) })).sort((a, b) => b.g - a.g)[0];
  const without = o.contextFor ? o.cards.map((c, i): Context => { const cards = o.cards.filter((x) => x !== c); return { key: `-${i}`, cards, ...o.contextFor!(cards) }; }) : [];
  const augmentLed = (held: number[], ids: number[], level: number) => {
    const best = bestOf(held, ids, level, full);
    if (!best || best.g <= 0) return undefined;
    return without.some((ctx) => bestOf(held, ids, level, ctx)?.id !== best.id) ? best.id : undefined;
  };

  // The set: what adds most to the fight at the build's full size.
  const set = [...o.owned];
  // Reserve the finished item for a staged purchase, without moving it to the front of the buy order.
  const planned = o.plannedItem;
  if (planned !== undefined && set.length < SLOTS && !set.includes(planned) && !clashes(planned, set) && o.shop[planned]) set.push(planned);
  // What a card asks for passes the one-of limits among themselves: Ultra Hydra's quest is to hold all three Hydras, which the shop otherwise allows one at a time.
  for (const id of o.required) if (set.length < SLOTS && !set.includes(id) && !clashes(id, set.filter((x) => !o.required.includes(x))) && o.shop[id]) set.push(id);
  const isBoots = (id: number) => o.pool.find((p) => p.id === id)?.boots;
  // The owner's rule: a mage starts with a mana item (Luden's, Blackfire Torch), as his mana runs out fast without one; which one, by the full build.
  const mana = (id: number) => (o.shop[id]?.DataValues?.find((d) => d.name === 'FlatMPPoolMod')?.values?.[0] ?? 0) > 0;
  // A mage's mana item carries damage: Winter's Approach and Frozen Heart are tank items (the owner on Zilean).
  const search = (start: number[]) => searchSet({ start, candidates: o.pool.filter((i) => !i.boots).map((i) => i.id), slots: start.some(isBoots) || o.noBoots ? SLOTS : SLOTS - 1, width: BEAM_WIDTH, swaps: true, value: (ids) => fightValue(run(ids, FULL_BUILD_LEVEL), o.place), fits: (id, held) => allowed(o.pool.find((p) => p.id === id)!, held) });
  // Which mana item, by the whole build it leads: alone Luden's burst beat Blackfire Torch, whose AP per burning enemy pays with the rest (the owner on Brand, 2026-11-08).
  // shortcut: the three best alone get a full search each; the rest are dropped.
  // One item of each group a card needs, chosen by the whole build it leads to, as the mana item is; the shop's own limits still hold, the build's kind rules don't (a card's need comes first).
  const fromGroups: number[] = [];
  for (const group of o.requiredAnyOf ?? []) {
    if (set.some((id) => group.includes(id)) || set.length >= SLOTS) continue;
    const tries = group.filter((id) => !set.includes(id) && !clashes(id, set) && o.shop[id]).map((id) => { const ids = search([...set, id]); return { id, v: fightValue(run(ids, FULL_BUILD_LEVEL), o.place) }; }).sort((a, b) => b.v - a.v);
    if (tries[0]) { set.push(tries[0].id); fromGroups.push(tries[0].id); }
  }
  const manaTries = o.manaFirst && !set.some(mana) ? o.pool.filter((i) => !i.boots && i.damage !== 'none' && mana(i.id) && allowed(i, set)).map((i) => ({ id: i.id, v: fightValue(run([...set, i.id], FULL_BUILD_LEVEL), o.place) })).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.id) : [];
  const builds = manaTries.length ? manaTries.map((m) => { const ids = search([...set, m]); return { m, ids, v: fightValue(run(ids, FULL_BUILD_LEVEL), o.place) }; }).sort((a, b) => b.v - a.v) : [];
  const manaItem = builds[0]?.m;
  if (manaItem !== undefined) set.push(manaItem);
  const chosen = builds[0]?.ids ?? search(set);
  set.splice(0, set.length, ...chosen);
  // Boots last: which pair is best depends on what the other items left short, though they're bought second.
  if (!o.noBoots && !set.some(isBoots) && set.length < SLOTS) {
    const best = o.pool.filter((i) => i.boots && allowed(i, set)).map((i) => ({ i, g: gain(set, i.id, FULL_BUILD_LEVEL) })).sort((a, b) => b.g - a.g)[0];
    if (best) set.push(best.i.id);
  }

  // The order: owned, what a card asks for, then most per gold; boots second.
  // The owner's rule 35: Heartsteel and other stacking items (Hubris, Rod of Ages) first, marksmen too (2026-11-09, «Yes, all»: his rule names no exception); a mage's mana item still comes right after Heartsteel (rule 34).
  const heartsteel = (id: number) => (o.shop[id]?.DataValues?.find((d) => d.name === 'DamageToMaxHealthRatio')?.values?.[0] ?? 0) > 0;
  const grows = (id: number) => heartsteel(id) || (o.itemOps?.[id % 10000] ?? []).some((x) => x.op === 'per_stack' && x.per !== 'attack');
  const steps: MathStep[] = o.owned.map((id) => ({ id, damage: 0, health: 0, reason: 'owned' }));
  const held = [...o.owned];
  const buy = (id: number, reason: MathStep['reason']) => {
    const level = LEVEL_BY_ITEMS[Math.min(held.length, 6)]!;
    const a = run(held, level), b = run([...held, id], level);
    steps.push({ id, damage: a.damage ? b.damage / a.damage - 1 : 0, health: a.effectiveHp ? b.effectiveHp / a.effectiveHp - 1 : 0, reason });
    held.push(id);
  };
  for (const id of set) if (heartsteel(id) && !held.includes(id)) buy(id, 'stacks');
  for (const id of [...o.required, ...fromGroups]) if (set.includes(id) && !held.includes(id)) buy(id, 'required');
  if (manaItem !== undefined && !held.includes(manaItem)) buy(manaItem, 'mana');
  while (held.length < set.length) {
    const boots = set.find((id) => isBoots(id) && !held.includes(id));
    if (boots !== undefined && held.length >= 1) { buy(boots, 'boots'); continue; }
    const level = LEVEL_BY_ITEMS[Math.min(held.length, 6)]!;
    // An item that grows with stacks (Heartsteel, Hubris, Rod of Ages) first: the set is valued with the stacks of a whole game, which only buying it first earns (the owner).
    // What a held augment asks for now comes before those (augmentLed).
    const left = set.filter((id) => !held.includes(id) && !isBoots(id));
    const led = o.cards.length ? augmentLed(held, left, level) : undefined;
    if (led !== undefined) { buy(led, 'augment'); continue; }
    const next = left.map((id) => ({ id, grows: grows(id), g: gain(held, id, level) / perGold(id) })).sort((a, b) => Number(b.grows) - Number(a.grows) || b.g - a.g)[0];
    if (!next) { buy(boots!, 'boots'); continue; }
    buy(next.id, next.grows ? 'stacks' : 'math');
  }
  return steps;
}
