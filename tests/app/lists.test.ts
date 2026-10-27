import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import itemsAr from '../fixtures/cdragon/items.ar_ae.groups.json' with { type: 'json' };
import summaryAr from '../fixtures/cdragon/champion-summary.ar_ae.sample.json' with { type: 'json' };
import summaryEn from '../fixtures/cdragon/champion-summary.default.sample.json' with { type: 'json' };
import { composeItemList } from '../../src/app/itemList.js';
import { composeAllLanes, composeTierList } from '../../src/app/tierList.js';
import { parseOpgg } from '../../src/stats/opggFormat.js';
import { toLaneMeta, toMapItems } from '../../src/stats/opgg.js';
import { buildChampionList } from '../../src/texts/champions.js';
import { buildItemTexts, type ItemText, type RawItem } from '../../src/texts/items.js';

const opgg = (f: string) => parseOpgg(readFileSync(new URL(`../fixtures/opgg/${f}`, import.meta.url), 'utf8'));

describe('composeItemList', () => {
  const list = composeItemList(toMapItems(opgg('items-SUMMONERS_RIFT.json')), buildItemTexts(itemsAr as RawItem[], []));
  const group = (id: number) => list.find((i) => i.id === id)?.group;

  it('keeps purchasable map items that have text, with gold', () => {
    expect(list.map((i) => i.id).sort((a, b) => a - b)).toEqual([1001, 1036, 1055, 2003, 3020, 3031, 3133, 3157, 3340]);
    expect(list.find((i) => i.id === 3031)).toMatchObject({ name: 'السيف الأبدي', gold: 3500 });
  });

  it('groups items the way the shop does', () => {
    expect([group(1001), group(3020)]).toEqual(['boots', 'boots']);
    expect(group(1036)).toBe('basic');
    expect(group(3133)).toBe('epic');
    expect([group(3031), group(3157)]).toEqual(['legendary', 'legendary']);
    expect(group(1055)).toBe('starter');
    expect([group(2003), group(3340)]).toEqual(['consumable', 'consumable']);
  });
});

describe('composeItemList de-duplication', () => {
  // Real pairs from OP.GG's Summoner's Rift list: Thornmail 3075/323075, Hextech Gunblade 3146/663146, pups 1101/1107.
  const text = (id: number, enName: string): [number, ItemText] => [id, { id, name: enName, enName, html: '', translated: true, inStore: true, iconPath: '', categories: [], classes: [] }];
  const item = (id: number, gold: number) => ({ id, gold, purchasable: true, from: [1], into: [] });
  const texts = new Map([text(3075, 'Thornmail'), text(323075, 'Thornmail'), text(3146, 'Hextech Gunblade'), text(663146, 'Hextech Gunblade'),
    text(1101, 'Scorchclaw Pup'), text(1107, 'Scorchclaw Pup'), text(223031, 'Infinity Edge')]);
  const list = composeItemList([item(323075, 2650), item(3075, 2450), item(663146, 2500), item(3146, 3000), item(1107, 450), item(1101, 450), item(223031, 3500)], texts);

  it('keeps one entry per name: the base item, else the smallest id', () => {
    expect(list.map((i) => i.id).sort((a, b) => a - b)).toEqual([1101, 3075, 3146, 223031]);
    expect(list.find((i) => i.id === 3075)!.gold).toBe(2450);
  });

  it('groups a mode copy under its base item even when the English names differ', () => {
    // Real ARAM case: 3072 "Bloodthirster" and 773072 "The Bloodthirster" both showed.
    const t = new Map([text(3072, 'Bloodthirster'), text(773072, 'The Bloodthirster')]);
    expect(composeItemList([item(773072, 3200), item(3072, 3400)], t).map((i) => i.id)).toEqual([3072]);
  });
});

describe('composeTierList', () => {
  const champions = buildChampionList(summaryAr, summaryEn);
  const rows = composeTierList(toLaneMeta(opgg('meta-all.txt')).mid, champions);

  it('keeps OP.GG order and links rows to champions by English name', () => {
    expect(rows[0]).toMatchObject({ enName: 'Ahri', id: 103, name: 'آري', tier: 1, rank: 1, change: 0 });
    expect(rows[0].portraitUrl).toMatch(/champion-icons\/103\.png$/);
    expect(rows.length).toBeGreaterThan(50);
  });

  it('puts every lane in one list, best tier then win rate, renumbered and tagged with its lane', () => {
    const all = composeAllLanes(toLaneMeta(opgg('meta-all.txt')), champions);
    expect(all.map((r) => r.rank)).toEqual(all.map((_, i) => i + 1));
    expect(all.every((r, i) => i === 0 || all[i - 1].tier < r.tier || (all[i - 1].tier === r.tier && all[i - 1].winRate >= r.winRate))).toBe(true);
    expect(new Set(all.map((r) => r.lane))).toEqual(new Set(['top', 'jungle', 'mid', 'adc', 'support']));
    expect(all.every((r) => r.change === 0)).toBe(true);
  });

  it('shows champions missing from the champion data without a link', () => {
    const other = rows.find((r) => r.enName !== 'Ahri')!;
    expect(other).toMatchObject({ id: null, name: other.enName, portraitUrl: '' });
  });

  it('computes rank change (positive = moved up)', () => {
    for (const r of rows) expect(r.change).toBe(r.rankPrev ? r.rankPrev - r.rank : 0);
  });
});
