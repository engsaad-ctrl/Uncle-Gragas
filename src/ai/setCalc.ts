// What a set of augments and items adds up to in one fixed situation, as real quantities kept apart: health, a shield, damage
// per hit, casts a minute. Never win chance: nothing here has been tested against winning. A link between two parts is what
// they give together beyond what each gives alone, so a multiplier shows up as a strong link and an unrelated pair as none.
// Not used by the app yet: it has to beat adding the parts up, against what videos show (knowledge/codex-answer-round2.md).

import type { GameItem } from '../texts/gameData.js';
import { buildStats, type BuildStats } from './calculator.js';

// From the game's texts, in src/ai/mechanicsData.ts.
const PHENOMENAL_EVIL = 1390; // +1 AP each time abilities damage a champion
const BIG_BRAIN = 1180; // a shield of 300% AP
const TANK_ENGINE = 1353; // +5% max health a stack
const HEAVY_HITTER = 1181; // attacks deal 3.5% of health as physical damage
const STEEL_YOUR_HEART = 1152; // Heartsteel stacks x3 once it has 300
const HEARTSTEEL = 3084;
const BLOODMAIL = 2501;
// The quest's reward takes the place of what it asked for: of 1,536 players with Wooglet's Witchcap in our games, none also held
// Rabadon's Deathcap or Zhonya's Hourglass. The text doesn't say so.
const REPLACES: Record<number, number[]> = { 228002: [3089, 3157] };
// Health above base and items on 16.21 screens: 400 at level 18 and 199 at level 9, the same on Nidalee, Kayle and Malzahar. Source unknown.
export const HEALTH_PER_LEVEL = 22.2;

/** What happened by this moment of the game. */
export interface SetSituation {
  level: number;
  /** Items owned whatever the question is. */
  items: number[];
  abilityHits: number;
  /** Tank Engine's stacks. Kills and deaths can't give them, since what a death takes depends on the order: 37 takedowns and 8 deaths left 9. */
  engineStacks: number;
  /** Heartsteel's stacks before Steel Your Heart's times 3, taken as health gained. The number on screen already includes the times 3. */
  heartsteelStacks: number;
}

export interface SetOutput {
  hp: number;
  ad: number;
  ap: number;
  /** Big Brain's shield. */
  shield: number;
  /** Heavy Hitter's physical damage on each attack. */
  damagePerHit: number;
}

type Rec = Parameters<typeof buildStats>[0];
const value = (item: GameItem | undefined, name: string) => item?.DataValues?.find((d) => d.name === name)?.values?.[0] ?? 0;

/**
 * shortcuts, each a reading the texts don't settle: Tank Engine's percents add up instead of compounding, and apply to all
 * health; several AP amps multiply, as compareBuilds does. Check them against a video's numbers before trusting a total.
 * Warmog's HPAmp is on item health only, as its text says.
 */
export function setOutput(record: Rec, shop: Record<number, GameItem>, parts: number[], s: SetSituation): SetOutput {
  const bought = [...new Set([...s.items, ...parts.filter((p) => shop[p])])];
  const gone = bought.flatMap((id) => REPLACES[id] ?? []);
  const owned = bought.filter((id) => !gone.includes(id));
  const items = owned.flatMap((id) => shop[id] ?? []);
  const has = (id: number) => parts.includes(id) || owned.includes(id);
  const stats: BuildStats = buildStats(record, items, s.level);
  const baseHp = stats.hp - stats.bonusHp;
  const amp = (name: string) => items.reduce((m, it) => m * (1 + value(it, name)), 1);

  const stacks = has(HEARTSTEEL) ? s.heartsteelStacks * (has(STEEL_YOUR_HEART) && s.heartsteelStacks >= 100 ? 3 : 1) : 0;
  const engine = has(TANK_ENGINE) ? 1 + 0.05 * s.engineStacks : 1;
  const hp = (baseHp + HEALTH_PER_LEVEL * s.level + stats.bonusHp * amp('HPAmp') + stacks) * engine;
  const ap = (stats.ap + (has(PHENOMENAL_EVIL) ? s.abilityHits : 0)) * amp('APAmp');
  const ad = stats.ad + (has(BLOODMAIL) ? value(shop[BLOODMAIL], 'HPToADPercentage') * (hp - baseHp) : 0);
  return { hp, ad, ap, shield: has(BIG_BRAIN) ? 3 * ap : 0, damagePerHit: has(HEAVY_HITTER) ? 0.035 * hp : 0 };
}

/** What two parts give together beyond each alone, in each quantity: 0 means no link in this situation. */
export function linkBetween(record: Rec, shop: Record<number, GameItem>, a: number, b: number, s: SetSituation): SetOutput {
  const f = (parts: number[]) => setOutput(record, shop, parts, s);
  const [ab, x, y, none] = [f([a, b]), f([a]), f([b]), f([])];
  const part = (k: keyof SetOutput) => ab[k] - x[k] - y[k] + none[k];
  return { hp: part('hp'), ad: part('ad'), ap: part('ap'), shield: part('shield'), damagePerHit: part('damagePerHit') };
}

export interface AbilityRate {
  key: string;
  cooldown: number;
  range: number;
  mana: number;
}

const SNIPER_RANGE = 600;
/**
 * Skilled Sniper: casts a minute with and without it, what mana allows in that minute, and how many land. A cast that lands
 * from beyond 600 gets 80% of its cooldown back; `refund` is lower for abilities that return (65%). shortcut: every cast is
 * from afar at the same chance of landing, so read the result as an upper limit; real fights are shorter and closer.
 */
export function sniperRates(abilities: AbilityRate[], o: { haste: number; landed: number; manaPool: number; manaPerSecond: number; refund?: number }) {
  const refund = o.refund ?? 0.8;
  const rates = (sniper: boolean) => {
    const plan = abilities.map((a) => {
      const back = sniper && a.range > SNIPER_RANGE ? refund * o.landed : 0;
      return { ...a, casts: (60 * (100 + o.haste)) / 100 / (a.cooldown * (1 - back)) };
    });
    const wanted = plan.reduce((t, a) => t + a.casts * a.mana, 0);
    const budget = o.manaPool + 60 * o.manaPerSecond;
    let left = budget; // short of mana, the cheapest casts come first, as a player would spend it
    const usable = new Map([...plan].sort((x, y) => x.mana - y.mana).map((a) => {
      const casts = Math.min(a.casts, left / a.mana);
      left -= casts * a.mana;
      return [a.key, casts] as const;
    }));
    return { byAbility: plan.map((a) => ({ key: a.key, casts: a.casts, usable: usable.get(a.key)! })), manaWanted: wanted, manaBudget: budget, hits: plan.reduce((t, a) => t + usable.get(a.key)! * o.landed, 0) };
  };
  return { without: rates(false), with: rates(true) };
}
