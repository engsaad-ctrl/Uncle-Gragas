// T065: one policy for an item held but not sold, and for a mode id that is its own item (knowledge/codex-claude/T065-owned-void-contract.md).
import type { CardOp } from './cardMath.js';

/** Void Immolation: the mode file names it on its own (Item_223069_Name «إحراق الفويد», Icathia's Fall's aura Item223069Aura), and the map list
 * carries it with no recipe (T064). Whether it can be bought in Mayhem is not read, so it is never a candidate to buy. */
export const VOID_IMMOLATION = 223069;
/** Held, these count as one finished item each and keep their exact id and slot, though they are not in the sold list. */
export const OWNED_FINAL_ONLY: ReadonlySet<number> = new Set([VOID_IMMOLATION]);
/** Mode ids that are a different item from their base id, not a copy of it: they never take the base's ops (223069 is not 3069, whose row is a
 * move speed on ability cast). Every other mode copy (22xxxx) keeps its base's ops, as before. */
export const DISTINCT_ITEM_IDS: ReadonlySet<number> = new Set([VOID_IMMOLATION]);
/** An item's ops: its own for a distinct id, else its base's (the existing mode-copy policy). */
export const itemOpsOf = (itemOps: Record<number, CardOp[]> | undefined, id: number): CardOp[] | undefined =>
  DISTINCT_ITEM_IDS.has(id) ? itemOps?.[id] : itemOps?.[id % 10000];
/** What a held Void Immolation leaves out: its stats count; its burn, explosion and health effects have no op (T064: the burn's contract is not done). */
export const VOID_NOT_MODELLED = 'إحراق الفويد مملوك: إحصاءاته محسوبة، أما حرقه وانفجاره وأثره على الصحة فغير محسوبة';
