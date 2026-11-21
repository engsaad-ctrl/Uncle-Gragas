import { fight, liveCard, type CardNumbers, type Kit } from './cardMath.js';
import { fightValue, type TeamPlace } from './itemMath.js';

export interface AugmentPlan {
  level: number;
  items: number[];
  baselineItems: number[];
  value: number;
  damage: number;
  health: number;
  missing: string[];
}

/** Keep the same attack-enabling rule in offer evaluation and item search. */
export function kitWithCards(kit: Kit, cards: CardNumbers[]): Kit {
  const on = (...t: string[]) => cards.some((c) => liveCard(c).ops.some((x) => 'trigger' in x && x.trigger !== undefined && t.includes(x.trigger)));
  const attacks = kit.attacks || on('attack', 'on_hit'); // T051 v2: live ops only
  // T196b: an after-cast card (Armored Impact, Bouncing Bees) on a kit that does not attack: attacks only to spend its charge, not at an attacker's pace.
  // T196c (Codex T206): attacks a card turned on (not his own, no attackPace of his own) are made in cast downtime only; kept once set.
  return { ...kit, attacks, ...(!kit.attacks && attacks && kit.attackPace === undefined ? { cardAttacks: true } : {}), ...(!attacks && on('next_attack') ? { chargeAttacks: true } : {}) };
}

/** Compare two independently searched complete builds. This is a conditional end-state, not a gold/time forecast. */
export function compareAugmentPlan(o: {
  base: Parameters<typeof fight>[0]; candidate: CardNumbers; baselineItems: number[]; items: number[]; place: TeamPlace;
}): AugmentPlan {
  const cards = [...o.base.cards, o.candidate];
  const before = fight({ ...o.base, kit: kitWithCards(o.base.kit, o.base.cards), items: o.baselineItems });
  const after = fight({ ...o.base, kit: kitWithCards(o.base.kit, cards), cards, items: o.items });
  const relative = (key: 'damage' | 'effectiveHp') => before[key] ? after[key] / before[key] - 1 : 0;
  return {
    level: o.base.level, items: o.items, baselineItems: o.baselineItems,
    value: fightValue(after, o.place) / Math.max(fightValue(before, o.place), 1e-9) - 1,
    damage: relative('damage'), health: relative('effectiveHp'),
    missing: [...new Set([...before.notModelled, ...after.notModelled])],
  };
}

