import type { CardOp } from './cardMath.js';

/** What share of a card's fight value counts, from its tags (knowledge/fight-rules.md, conditions). One that works on his death gives nothing in a fight
 * he survives (0), unless each of its ops says when it acts (T051: its live ops count, its death ops don't run). Any other counts in full: its value is what it gives when its condition holds. A condition the fight doesn't settle is `open`, and the
 * card is never certain; it used to count half, a number no one measured (knowledge/math-generation.md, conditions). */
// Conditions the fight runs as events, when the card's ops hang on that event: takedowns at its kill times, attacks at his attack pace.
const TAKEDOWN = /^condition:(takedown|score takedowns|after a takedown)$/;
const ATTACKS = /^condition:(attack enemy champions|keep attacking within 5 s|champion basic attacks often)$/;
export function tagWeight(tags: { tags: string[] } | undefined, ops: CardOp[], holds?: 'yes' | 'no' | 'unknown'): { weight: number; unread: boolean; open: string[] } {
  // A selected skill's cooldown is simulated directly, and Dashing's "has a dash or blink" is checked per skill (movement_abilities).
  const targetedHaste = ops.some((x) => x.op === 'add' && x.stat === 'haste' && x.scope === 'chosen_ability');
  const movementHaste = ops.some((x) => x.op === 'add' && x.scope === 'movement_abilities');
  const on = (re: RegExp) => ops.some((x) => re.test(String((x as { trigger?: string }).trigger ?? (x as { per?: string }).per ?? '')));
  const stated = ops.some((x) => typeof (x as { needs?: unknown }).needs === 'string'); // the fight reads the condition from the op itself
  const settled = (t: string) => stated || holds === 'yes'
    || (targetedHaste && /^condition:[QWER] is a main ability$/.test(t))
    || (movementHaste && t === 'condition:ability has a dash or blink')
    || (TAKEDOWN.test(t) && on(/^(takedown|kill)$/))
    || (ATTACKS.test(t) && on(/^(attack|on_hit)$/));
  const open = (tags?.tags ?? []).filter((t) => t.startsWith('condition:') && !settled(t)).map((t) => t.slice('condition:'.length));
  // T051: an op whose state, event or target is not proven is not run (cardMath); the card is then open, never a settled number.
  for (const x of ops) if (x.eligibility === 'unknown') open.push(x.eligibilityWhy ?? 'state or event not proven');
  // A card tagged on_death counts its live ops only when every op says when it acts (eligibility); otherwise the whole card gives nothing, as before.
  const deathUnsorted = !!tags?.tags.includes('on_death') && !ops.every((x) => x.eligibility);
  return { weight: deathUnsorted ? 0 : 1, unread: open.length > 0, open };
}
