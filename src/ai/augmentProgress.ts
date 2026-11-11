// Mayhem unlocks its four normal offers at champion levels 3, 7, 11 and 15.
// Source: https://support.riotgames.com/en-us/league-of-legends/events/league-of-legends-aram-mayhem-game-mode
// Unlocking is not picking: a player can choose later, while dead.
import type { TargetAbility } from './abilityTarget.js';
export const AUGMENT_LEVELS = [3, 7, 11, 15] as const;
// The highest level accepted here: normal games end at 18; the Superfans event raises the cap to 21 with an extra augment there
// (knowledge/notes-300/notes-9.md:8, its tooltip on screen). Accepting a level proves neither the event nor the history.
export const MAYHEM_MAX_LEVEL = 21;
/** Past this level the fight's champion growth and level numbers are not read (they stop or run on unchecked), so values there are partial. */
export const FIGHT_READ_LEVEL = 18;

export interface AugmentProgress {
  level?: number;
  /** Level when the player recorded each choice. Missing history uses the unlock level, explicitly estimated. */
  acquiredLevels?: Record<number, number>;
  /** The skill shown by a targeted augment in this match. Unset means unknown. */
  abilityTargets?: Record<number, TargetAbility>;
  /** Some augment he took has no known level (the engine's own callers set this, never the page): no order among them is proven. */
  unknownPicks?: boolean;
  /** The caller vouches that acquiredLevels and otherPicks hold every augment taken (engine callers only, never the page). Without it no place in the order is proven. */
  historyComplete?: boolean;
  /** Every augment taken, earliest first, when the order of events is known outright (it settles picks at the same level). Engine callers only. */
  pickOrder?: number[];
  /** Picks that count for the order but not for this decision (taken at its level with no order, or later), with their level or null when unknown. */
  otherPicks?: Record<number, number | null>;
  /** Where acquiredLevels came from when main's pick log gave them: the level at each mark, or the same backed by the player's statement that the log is complete. */
  historySource?: 'recorded-at-mark' | 'player-confirmed';
  /** His skill ranks read from the live game at `level` (set by the main process only, never from the page). */
  abilityRanks?: Partial<Record<TargetAbility, number>>;
}

/** Shared IPC boundary, including the phone overlay. Never accept unbounded history or a fractional level. */
export function parseAugmentProgress(value: unknown): AugmentProgress | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('bad augment progress');
  const { level, acquiredLevels, abilityTargets } = value as Record<string, unknown>;
  const validLevel = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 3 && n <= MAYHEM_MAX_LEVEL;
  if (level !== undefined && !validLevel(level)) throw new Error('bad augment level');
  const history: Record<number, number> = {};
  if (acquiredLevels !== undefined) {
    if (!acquiredLevels || typeof acquiredLevels !== 'object' || Array.isArray(acquiredLevels)) throw new Error('bad augment history');
    const entries = Object.entries(acquiredLevels);
    if (entries.length > 6) throw new Error('bad augment history');
    for (const [id, at] of entries) {
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !validLevel(at) || (level !== undefined && at > level)) throw new Error('bad augment history');
      history[Number(id)] = at;
    }
  }
  const targets: Record<number, TargetAbility> = {};
  if (abilityTargets !== undefined) {
    if (!abilityTargets || typeof abilityTargets !== 'object' || Array.isArray(abilityTargets)) throw new Error('bad augment ability targets');
    const entries = Object.entries(abilityTargets);
    if (entries.length > 9) throw new Error('bad augment ability targets');
    for (const [id, key] of entries) {
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || (key !== 'Q' && key !== 'W' && key !== 'E' && key !== 'R')) throw new Error('bad augment ability targets');
      targets[Number(id)] = key;
    }
  }
  return { ...(level === undefined ? {} : { level }), acquiredLevels: history, ...(abilityTargets === undefined ? {} : { abilityTargets: targets }) };
}

export function augmentStage(held: number[], progress?: AugmentProgress) {
  // Count all marked cards, even ones the calculator cannot read. Otherwise an unreadable card shifts every later round.
  const level = progress?.level ?? Math.max(AUGMENT_LEVELS[Math.min(held.length, AUGMENT_LEVELS.length - 1)]!, ...held.map((id) => progress?.acquiredLevels?.[id] ?? 3));
  const nextOffer = AUGMENT_LEVELS.find((at) => at > level);
  // The horizon never ends before the current level: past 18 (Superfans) it is that level alone, never an empty list (T026).
  const untilLevel = nextOffer === undefined ? Math.max(level, FIGHT_READ_LEVEL) : nextOffer - 1;
  const acquiredLevels = Object.fromEntries(held.map((id, i) => [id, Math.min(level, progress?.acquiredLevels?.[id] ?? AUGMENT_LEVELS[Math.min(i, AUGMENT_LEVELS.length - 1)]!)]));
  return {
    level, untilLevel, nextOffer, acquiredLevels,
    estimatedLevel: progress?.level === undefined,
    estimatedHistory: held.some((id) => progress?.acquiredLevels?.[id] === undefined),
    // An equal-level average is a planning metric, not elapsed time or win probability.
    levels: Array.from({ length: untilLevel - level + 1 }, (_, i) => level + i),
  };
}
