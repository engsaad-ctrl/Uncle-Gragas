// The next items by arithmetic alone (src/ai/cardMath.ts): no pick, buy or win rates. Six slots are the real limit late and gold early, so the set is chosen by
// what each item adds to the full fight, then bought in the order that adds most per gold, recomputed each time so a chain shows up. Boots are the exception:
// move speed is worth nothing in a fight model, yet a champion has to reach the fight, so one pair comes second and the fight chooses which.

import { ONE_OF } from '../app/buildEngine.js';
import { FIGHT, fight, type CardNumbers, type CardOp, type EnemyTeam, type FightResult, type Kit } from './cardMath.js';
import { championRecord } from './calculator.js';
import { DAMAGE_SHARE } from './shareData.js';
import { CHAMPION_KITS } from './championKits.js';
import type { GameItem } from '../texts/gameData.js';

export interface PoolItem { id: number; gold: number; boots: boolean; damage?: 'ap' | 'ad' | 'none' | string }
export interface MathStep { id: number; damage: number; health: number; reason: 'owned' | 'required' | 'mana' | 'stacks' | 'boots' | 'math' }
/** A champion's place in a team's fight: his share of the enemy's damage with no items, how fast it grows as he buys health from `health0`, that damage per second, and what a point absorbed for the team is worth in points of damage. */
export interface TeamPlace { carriesHealth?: boolean; healWorth?: number; share: number; rise: number; health0: number; maxRatio?: number; enemyDps: number; absorbedWorth: number; window?: number }
/** A burst champion's damage comes in a few seconds from his abilities and ultimate, then he leaves: the owner's rule (Ahri, Zed). Assumption: the window, tried at 2 to 5 s and chosen on the owner's cases (knowledge/burst-value-plan.md). */
export const BURST = { window: 3 };
/** Fights in a row with no trip back: by the third a champion with no mana item has settled at what his mana allows (Lux at 15: 6300, 5349, 3302, 3302), which two fights' first seconds hid. */
export const FIGHTS = { inARow: 3 };
const isBurst = (traits: string[] = []) => traits.includes('burst') && !traits.includes('sustained') && !traits.includes('frontline');

const LEVEL_BY_ITEMS = [5, 9, 12, 15, 17, 18, 18];
const FULL_BUILD_LEVEL = 15;
const SLOTS = 6;
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
/** The enemies' resists at a late level with no items, the size the fixed target was, and the kind of damage their kits deal. */
export function enemyTeam(list: { bin: Record<string, unknown>; kit: Kit }[], shop: Record<number, GameItem>): EnemyTeam | undefined {
  if (!list.length) return undefined;
  const stats = list.map((e) => fight({ bin: e.bin, shop, kit: e.kit, cards: [], items: [], level: FULL_BUILD_LEVEL }).stats);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  return { armor: mean(stats.map((s) => s.armor)), mr: mean(stats.map((s) => s.mr)), physicalShare: mean(list.map((e) => (e.kit.damage === 'physical' ? 1 : e.kit.damage === 'magic' ? 0 : 0.5))) };
}
/** A way to build one champion: by his kit (none), or one the owner names: magic items only, physical only, or standing in front (Katarina has all three). */
export type BuildStyle = 'ap' | 'ad' | 'tank';
export const teamPlace = (o: { championId: number; bin: Record<string, unknown>; shop: Record<number, GameItem>; kit: Kit; passive?: CardOp[]; enemy?: EnemyTeam; allies?: Record<string, unknown>[]; style?: BuildStyle }): TeamPlace => {
  const w = targetWeight(o.bin);
  // Real allies beside him: his odds of being hit against theirs, scaled from the typical four the share was measured among.
  const others = (o.allies ?? []).slice(0, 4).reduce((sum, bin) => sum + targetWeight(bin), TYPICAL_TARGET_WEIGHT * (4 - Math.min(4, o.allies?.length ?? 0))) / (4 * TYPICAL_TARGET_WEIGHT);
  const alone = DAMAGE_SHARE[o.championId] ?? w / (w + 4 * TYPICAL_TARGET_WEIGHT);
  const melee = ((championRecord(o.bin) as unknown as { attackRangeModifiable?: { baseValue?: number } })?.attackRangeModifiable?.baseValue ?? 0) < 300;
  const kitTraits = CHAMPION_KITS.find((k) => k.id === o.championId)?.traits;
  // A tank build is valued as a frontline champion's: the whole fight, health carried to the next, damage taken in others' place; a magic or physical build as a damage dealer's over the whole fight (Sett's fighter build, Katarina's health and magic build), his kit's own build keeping a burst window.
  const traits = o.style === 'tank' ? [...(kitTraits ?? []).filter((t) => t !== 'burst'), 'frontline'] : o.style ? kitTraits?.filter((t) => t !== 'frontline' && t !== 'burst') : kitTraits;
  return { ...(isBurst(traits) ? { window: BURST.window } : {}), ...(traits?.includes('frontline') ? { carriesHealth: true } : {}), maxRatio: traits?.includes('frontline') ? MAX_HEALTH_RATIO : MAX_HEALTH_RATIO_NOT_FRONT, share: 1 / (1 + ((1 - alone) / alone) * others), rise: melee ? SHARE_RISE.melee : SHARE_RISE.ranged, health0: fight({ bin: o.bin, shop: o.shop, kit: o.kit, passive: o.passive, enemy: o.enemy, cards: [], items: [], level: FULL_BUILD_LEVEL }).effectiveHp, enemyDps: ENEMY_DPS, absorbedWorth: traits?.includes('frontline') ? ABSORBED_WORTH : ABSORBED_WORTH_BACK.value };
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
  const seconds = p.window ?? FIGHT.seconds, lasting = shareAt(p, r.effectiveHp) * p.enemyDps * seconds;
  const one = (x: FightResult, health: number) => { const stays = health + HEALING_WORTH * (x.healedHp ?? 0), alive = Math.min(1, stays / lasting); return { left: Math.min(x.effectiveHp, Math.max(0, stays - lasting)), value: dealtBy(x, alive * seconds) + p.absorbedWorth * Math.min(stays, lasting) + ABSORBED_WORTH * (p.healWorth ?? ABILITY_HEALING_WORTH) * (x.abilityHealing ?? 0) * alive }; }; // healing allies keeps its own worth: the lower absorbed worth of a champion behind the front is for damage he takes, not for heals he gives (Soraka)
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
    if (!beam.length || valueOf(beam[0]!) <= valueOf(best)) break;
    best = beam[0]!;
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

export function mathBuild(o: { bin: Record<string, unknown>; shop: Record<number, GameItem>; kit: Kit; cards: CardNumbers[]; passive?: CardOp[]; itemOps?: Record<number, CardOp[]>; pool: PoolItem[]; owned: number[]; required: number[]; place: TeamPlace; enemy?: EnemyTeam; offKind?: (i: PoolItem) => boolean; manaFirst?: boolean }): MathStep[] {
  // The game's own limits on what can be held together, and those its file doesn't name.
  const clashes = (id: number, held: number[]) => ONE_OF.some((g) => g.includes(id % 10000) && held.some((x) => x !== id && g.includes(x % 10000))) || (o.shop[id]?.limits ?? []).some((g) => held.some((x) => x !== id && o.shop[x]?.limits?.includes(g)));
  const run = (list: number[], level: number) => fight({ bin: o.bin, shop: o.shop, kit: o.kit, cards: o.cards, passive: o.passive, itemOps: o.itemOps, enemy: o.enemy, items: list, level });
  const allowed = (i: PoolItem, held: number[]) => !held.includes(i.id) && !clashes(i.id, held) && !!o.shop[i.id] && !o.offKind?.(i);
  const gain = (held: number[], id: number, level: number) => { const v = fightValue(run(held, level), o.place); return v > 0 ? fightValue(run([...held, id], level), o.place) / v - 1 : 0; };

  // The set: what adds most to the fight at the build's full size.
  const set = [...o.owned];
  for (const id of o.required) if (set.length < SLOTS && !set.includes(id) && !clashes(id, set) && o.shop[id]) set.push(id);
  const isBoots = (id: number) => o.pool.find((p) => p.id === id)?.boots;
  // The owner's rule: a mage starts with a mana item (Luden's, Blackfire Torch), as his mana runs out fast without one; which one, by the full build.
  const mana = (id: number) => (o.shop[id]?.DataValues?.find((d) => d.name === 'FlatMPPoolMod')?.values?.[0] ?? 0) > 0;
  // A mage's mana item carries damage: Winter's Approach and Frozen Heart are tank items (the owner on Zilean).
  const manaItem = o.manaFirst && !set.some(mana) ? o.pool.filter((i) => !i.boots && i.damage !== 'none' && mana(i.id) && allowed(i, set)).map((i) => ({ id: i.id, v: fightValue(run([...set, i.id], FULL_BUILD_LEVEL), o.place) })).sort((a, b) => b.v - a.v)[0]?.id : undefined;
  if (manaItem !== undefined) set.push(manaItem);
  const chosen = searchSet({ start: set, candidates: o.pool.filter((i) => !i.boots).map((i) => i.id), slots: set.some(isBoots) ? SLOTS : SLOTS - 1, width: BEAM_WIDTH, swaps: true, value: (ids) => fightValue(run(ids, FULL_BUILD_LEVEL), o.place), fits: (id, held) => allowed(o.pool.find((p) => p.id === id)!, held) });
  set.splice(0, set.length, ...chosen);
  // Boots last: which pair is best depends on what the other items left short, though they're bought second.
  if (!set.some(isBoots) && set.length < SLOTS) {
    const best = o.pool.filter((i) => i.boots && allowed(i, set)).map((i) => ({ i, g: gain(set, i.id, FULL_BUILD_LEVEL) })).sort((a, b) => b.g - a.g)[0];
    if (best) set.push(best.i.id);
  }

  // The order: owned, what a card asks for, then most per gold; boots second.
  // The owner: Heartsteel is the first item; other stacking items (Hubris, Rod of Ages) first too, except for a marksman, whose first item is his crit.
  const heartsteel = (id: number) => (o.shop[id]?.DataValues?.find((d) => d.name === 'DamageToMaxHealthRatio')?.values?.[0] ?? 0) > 0;
  const marksman = o.kit.attacks && ((championRecord(o.bin) as unknown as { attackRangeModifiable?: { baseValue?: number } })?.attackRangeModifiable?.baseValue ?? 0) >= 300;
  const grows = (id: number) => heartsteel(id) || (!marksman && (o.itemOps?.[id % 10000] ?? []).some((x) => x.op === 'per_stack' && x.per !== 'attack'));
  const steps: MathStep[] = o.owned.map((id) => ({ id, damage: 0, health: 0, reason: 'owned' }));
  const held = [...o.owned];
  const buy = (id: number, reason: MathStep['reason']) => {
    const level = LEVEL_BY_ITEMS[Math.min(held.length, 6)]!;
    const a = run(held, level), b = run([...held, id], level);
    steps.push({ id, damage: a.damage ? b.damage / a.damage - 1 : 0, health: a.effectiveHp ? b.effectiveHp / a.effectiveHp - 1 : 0, reason });
    held.push(id);
  };
  for (const id of o.required) if (set.includes(id) && !held.includes(id)) buy(id, 'required');
  for (const id of set) if (heartsteel(id) && !held.includes(id)) buy(id, 'stacks');
  if (manaItem !== undefined && !held.includes(manaItem)) buy(manaItem, 'mana');
  while (held.length < set.length) {
    const boots = set.find((id) => isBoots(id) && !held.includes(id));
    if (boots !== undefined && held.length >= 1) { buy(boots, 'boots'); continue; }
    const level = LEVEL_BY_ITEMS[Math.min(held.length, 6)]!;
    // An item that grows with stacks (Heartsteel, Hubris, Rod of Ages) first: the set is valued with the stacks of a whole game, which only buying it first earns (the owner).
    const next = set.filter((id) => !held.includes(id) && !isBoots(id)).map((id) => ({ id, grows: grows(id), g: gain(held, id, level) / Math.max(o.pool.find((p) => p.id === id)?.gold ?? 3000, 1) })).sort((a, b) => Number(b.grows) - Number(a.grows) || b.g - a.g)[0];
    if (!next) { buy(boots!, 'boots'); continue; }
    buy(next.id, next.grows ? 'stacks' : 'math');
  }
  return steps;
}
