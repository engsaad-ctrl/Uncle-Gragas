// Writes the page's build into the League client through its local API, like the stat-site apps do:
// a rune page, an item set (shown in the in-game shop) and, during champ select, the summoner spells.
// Only pages and sets this app created (named "LOL_helper …") are ever replaced; the player's own are left alone.

import type { ChampionPage, PageMode, RuneRow } from '../app/championPage.js';
import type { LcuCall } from './client.js';

export const TAG = 'LOL_helper';

export interface RunePagePayload {
  name: string;
  primaryStyleId: number;
  subStyleId: number;
  /** 4 primary, 2 secondary, 3 shards, in the client's order. */
  selectedPerkIds: number[];
}

export interface ItemSetPayload {
  title: string;
  championId: number;
  mapId: number;
  blocks: { type: string; items: number[] }[];
}

export interface Payloads {
  runePage: RunePagePayload | null;
  itemSet: ItemSetPayload | null;
  spells: [number, number] | null;
}

// Summoner's Rift 11, Howling Abyss 12 (ARAM, Mayhem), Arena 30.
const MAP_ID: Record<PageMode, number> = { ranked: 11, flex: 11, urf: 11, nexus: 11, aram: 12, mayhem: 12, arena: 30 };

const picked = (rows: RuneRow[]) => rows.flatMap((r) => r.options.filter((o) => o.selected).map((o) => o.id));

export function toPayloads(page: ChampionPage): Payloads {
  const name = page.champion.enName || page.champion.name;
  const r = page.runes;
  const perks = r?.primary && r.sub ? [...picked(r.primary.rows), ...picked(r.sub.rows), ...picked(r.shards)] : [];
  const runePage =
    r?.primary && r.sub && perks.length === 9
      ? { name: `${TAG} ${name}`.slice(0, 25), primaryStyleId: r.primary.style.id, subStyleId: r.sub.style.id, selectedPerkIds: perks }
      : null; // an incomplete page would be rejected by the client

  const ids = (choices: { items: { id: number }[] }[]) => [...new Set(choices.flatMap((c) => c.items.map((i) => i.id)))];
  const one = (c: ChampionPage['starter']) => (c ? [c] : []);
  const blocks = [
    { type: 'أيتمات البداية', items: ids(one(page.starter)) },
    { type: 'الأيتمات الأساسية', items: ids(one(page.core)) },
    { type: 'الحذاء', items: ids(one(page.boots)) },
    { type: 'خيارات الأيتم الرابع', items: ids(page.fourth) },
    { type: 'خيارات الأيتم الخامس', items: ids(page.fifth) },
    { type: 'خيارات الأيتم السادس', items: ids(page.sixth) },
  ].filter((b) => b.items.length);
  const lane = page.position ? ` ${page.position}` : '';
  const itemSet = blocks.length ? { title: `${TAG} ${name}${lane}`, championId: page.champion.id, mapId: MAP_ID[page.mode], blocks } : null;

  const spells = page.spells.length >= 2 ? ([page.spells[0].id, page.spells[1].id] as [number, number]) : null;
  return { runePage, itemSet, spells };
}

interface ClientPage {
  id: number;
  name: string;
  isDeletable?: boolean;
}

/** Replaces this app's previous rune page (if any) with a new one and makes it the current page. */
export async function applyRunePage(call: LcuCall, page: RunePagePayload): Promise<void> {
  const pages = ((await call('GET', '/lol-perks/v1/pages')) as ClientPage[] | null) ?? [];
  for (const p of pages) if (p.name.startsWith(TAG) && p.isDeletable !== false) await call('DELETE', `/lol-perks/v1/pages/${p.id}`);
  try {
    await call('POST', '/lol-perks/v1/pages', { ...page, current: true });
  } catch (err) {
    throw new Error(`رفض العميل إنشاء صفحة الرونز، وأشهر سبب أنه لا توجد خانة فارغة: احذف صفحة واحدة من العميل وأعد المحاولة. (${err instanceof Error ? err.message : String(err)})`);
  }
}

interface ClientItemSets {
  itemSets?: { title?: string; associatedChampions?: number[] }[];
  [field: string]: unknown;
}

/** Adds the item set to the player's sets, replacing this app's earlier set for the same champion. */
export async function applyItemSet(call: LcuCall, set: ItemSetPayload, uid: string): Promise<void> {
  const me = (await call('GET', '/lol-summoner/v1/current-summoner')) as { summonerId?: number } | null;
  if (!me?.summonerId) throw new Error('تعذّر معرفة الحساب المسجّل في العميل.');
  const path = `/lol-item-sets/v1/item-sets/${me.summonerId}/sets`;
  const current = (await call('GET', path)) as ClientItemSets | null;
  // The PUT below replaces every set: without a real list to keep, writing would wipe the player's own sets.
  if (!current || !Array.isArray(current.itemSets)) throw new Error('تعذّر قراءة قوائم الأيتمات الحالية من العميل، فلم يُكتب شيء حتى لا تضيع قوائمك.');
  const kept = current.itemSets.filter((s) => !(s.title?.startsWith(TAG) && s.associatedChampions?.includes(set.championId)));
  const mine = {
    uid,
    title: set.title,
    type: 'custom',
    map: 'any',
    mode: 'any',
    sortrank: 0,
    startedFrom: 'blank',
    associatedChampions: [set.championId],
    associatedMaps: [set.mapId],
    preferredItemSlots: [],
    blocks: set.blocks.map((b) => ({ type: b.type, items: b.items.map((id) => ({ id: String(id), count: 1 })) })),
  };
  // The endpoint replaces the whole list, so send the player's sets back untouched with ours added.
  await call('PUT', path, { ...current, itemSets: [...kept, mine] });
}

/**
 * Puts the build's two spells on the player's keys without moving the ones they already have:
 * Flash on F stays on F. Spells the player does not have yet fill the remaining slots in build order.
 */
export function arrangeSpells(build: [number, number], current: [number, number] | null): [number, number] {
  if (!current) return build;
  const slots: (number | null)[] = current.map((id) => (build.includes(id) ? id : null));
  const rest = build.filter((id) => !slots.includes(id));
  return slots.map((id) => id ?? rest.shift()!) as [number, number];
}

export async function applySpells(call: LcuCall, build: [number, number]): Promise<void> {
  const session = (await call('GET', '/lol-champ-select/v1/session')) as { localPlayerCellId?: number; myTeam?: { cellId?: number; spell1Id?: number; spell2Id?: number }[] } | null;
  const me = session?.myTeam?.find((p) => p.cellId === session.localPlayerCellId);
  const current = me?.spell1Id && me.spell2Id ? ([me.spell1Id, me.spell2Id] as [number, number]) : null;
  const [spell1Id, spell2Id] = arrangeSpells(build, current);
  await call('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id, spell2Id });
}

/** "ok", "none" (nothing to write, or not the right moment) or an Arabic error message, per part. */
export interface ApplyResult {
  runes: string;
  items: string;
  spells: string;
}

export async function applyAll(call: LcuCall, p: Payloads, opts: { inChampSelect: boolean; uid: string }): Promise<ApplyResult> {
  const run = async (has: unknown, f: () => Promise<void>) => {
    if (!has) return 'none';
    try {
      await f();
      return 'ok';
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };
  return {
    runes: await run(p.runePage, () => applyRunePage(call, p.runePage!)),
    items: await run(p.itemSet, () => applyItemSet(call, p.itemSet!, opts.uid)),
    spells: await run(p.spells && opts.inChampSelect, () => applySpells(call, p.spells!)),
  };
}
