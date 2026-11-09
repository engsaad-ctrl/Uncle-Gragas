import { FIGHT, fight, type FightResult } from './cardMath.js';
import { kitWithCards } from './augmentChoice.js';

/** Quantities stay separate. None is a win probability or a score added to another quantity. */
export interface BuildAmounts {
  damage: number;
  effectiveHp: number;
  selfSustain: number;
  abilitySupport: number;
  healingDenied: number;
}
export interface BuildInteraction {
  kind: 'item' | 'augment';
  id: number;
  delta: BuildAmounts;
}
export interface ItemExplanation {
  id: number;
  delta: BuildAmounts;
  interactions: BuildInteraction[];
}
export interface BuildExplanation {
  level: number;
  seconds: number;
  total: BuildAmounts;
  items: ItemExplanation[];
  missing: string[];
}

const amounts = (r: FightResult): BuildAmounts => ({ damage: r.damage, effectiveHp: r.effectiveHp, selfSustain: r.healedHp, abilitySupport: r.abilityHealing, healingDenied: r.healingDenied });
const difference = (a: BuildAmounts, b: BuildAmounts): BuildAmounts => ({ damage: a.damage - b.damage, effectiveHp: a.effectiveHp - b.effectiveHp, selfSustain: a.selfSustain - b.selfSustain, abilitySupport: a.abilitySupport - b.abilitySupport, healingDenied: a.healingDenied - b.healingDenied });

/**
 * Conditional effects in the completed set, using the same fight as item search.
 * Item effect = F(all) - F(without item).
 * Interaction = F(all) - F(without item) - F(without other) + F(without both).
 * Neither the individual effects nor the pair interactions form an additive allocation of the total.
 * Removing a quest item can break the quest; a resulting interaction includes that condition.
 */
export function explainBuild(o: Parameters<typeof fight>[0]): BuildExplanation {
  const items = [...new Set(o.items)];
  const memo = new Map<string, FightResult>();
  const run = (withoutItems: number[] = [], withoutCard?: number) => {
    const held = items.filter((id) => !withoutItems.includes(id));
    const cards = o.cards.filter((_, i) => i !== withoutCard);
    const key = `${held.join()}|${withoutCard ?? ''}`;
    let r = memo.get(key);
    if (!r) {
      r = fight({ ...o, items: held, cards, kit: kitWithCards(o.kit, cards) });
      memo.set(key, r);
    }
    return amounts(r);
  };
  const total = run();
  const effects = items.map((id) => ({ id, delta: difference(total, run([id])) }));
  const explained = effects.map(({ id, delta }): ItemExplanation => {
    const interactions: BuildInteraction[] = [
      ...items.filter((other) => other !== id).map((other) => ({ kind: 'item' as const, id: other, delta: difference(delta, difference(run([other]), run([id, other]))) })),
      ...o.cards.map((card, i) => ({ kind: 'augment' as const, id: card.id, delta: difference(delta, difference(run([], i), run([id], i))) })),
    ];
    return { id, delta, interactions };
  });
  return {
    level: o.level, seconds: FIGHT.seconds, total, items: explained,
    missing: [...new Set([...memo.values()].flatMap((r) => r.notModelled).concat(o.cards.flatMap((c) => !c.ops.length ? [`${c.name}: لا توجد معادلات`] : [])))],
  };
}
