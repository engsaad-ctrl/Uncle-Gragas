import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { parseOpgg, type OpggValue } from './opggFormat.js';

export const OPGG_MCP_URL = 'https://mcp-api.op.gg/mcp';

/** Calls one OP.GG MCP tool and returns its text answer. */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<string>;

export function mcpCaller(fetchImpl?: typeof fetch): CallTool {
  let client: Promise<Client> | undefined;
  const connect = async () => {
    const c = new Client({ name: 'lol-helper', version: '0.1.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(OPGG_MCP_URL), fetchImpl ? { fetch: fetchImpl } : undefined));
    return c;
  };
  return async (name, args) => {
    client ??= connect();
    try {
      // Raw request: the SDK's strict schema rejects some of OP.GG's tool output schemas.
      const r = await (await client).request({ method: 'tools/call', params: { name, arguments: args } }, z.any());
      const text: unknown = r?.content?.[0]?.text;
      if (typeof text !== 'string' || r?.isError) {
        throw new Error(`OP.GG ${name}: ${typeof text === 'string' ? text.slice(0, 200) : 'empty answer'}`);
      }
      return text;
    } catch (err) {
      client = undefined; // reconnect next time
      throw err;
    }
  };
}

// URF and Nexus Blitz exist upstream, but OP.GG's MCP tool rejects every position value for them (2026-10).
export type BuildMode = 'ranked' | 'flex' | 'aram';
export type Position = 'top' | 'jungle' | 'mid' | 'adc' | 'support';

export interface Pick {
  ids: number[];
  games: number;
  winRate: number;
  pickRate: number;
}

export interface ChampionBuild {
  games: number;
  winRate: number;
  pickRate: number;
  banRate: number | null;
  runes: { primaryStyle: number; subStyle: number; perks: number[]; statMods: number[]; games: number; winRate: number } | null;
  spells: Pick | null;
  starter: Pick | null;
  core: Pick | null;
  boots: Pick | null;
  fourth: Pick[];
  fifth: Pick[];
  sixth: Pick[];
  skillOrder: string[];
  skillPriority: string[];
}

export interface MayhemAugmentStat {
  id: number;
  tier: number;
  performance: number;
  popularity: number;
}

export interface Fetched<T> {
  data: T;
  fetchedAt: number;
  stale: boolean;
}

// Exact strings from the tool's closed field list (OP.GG rejects anything else).
const PICK = '{ids[],ids_names[],pick_rate,play,win}';
export const BUILD_FIELDS = [
  'data.summary.average_stats.{ban_rate,kda,pick_rate,play,rank,tier,win_rate}',
  `data.starter_items.${PICK}`,
  `data.core_items.${PICK}`,
  `data.boots.${PICK}`,
  `data.fourth_items[].${PICK}`,
  `data.fifth_items[].${PICK}`,
  `data.sixth_items[].${PICK}`,
  `data.summoner_spells.${PICK}`,
  'data.runes.{id,pick_rate,play,primary_page_id,primary_page_name,primary_rune_ids[],primary_rune_names[],secondary_page_id,secondary_page_name,secondary_rune_ids[],secondary_rune_names[],stat_mod_ids[],stat_mod_names[],win}',
  'data.skills.{order[],pick_rate,play,win}',
  'data.skill_masteries.{ids[],pick_rate,play,win}',
];

type Obj = { [field: string]: OpggValue };
const obj = (v: OpggValue | undefined): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
const num = (v: OpggValue | undefined): number | null => (typeof v === 'number' ? v : null);
const nums = (v: OpggValue | undefined): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);
const strs = (v: OpggValue | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function pick(v: OpggValue | undefined): Pick | null {
  const o = obj(v);
  const games = num(o?.play) ?? 0;
  if (!o || !games) return null;
  return { ids: nums(o.ids), games, winRate: (num(o.win) ?? 0) / games, pickRate: num(o.pick_rate) ?? 0 };
}
const picks = (v: OpggValue | undefined) => (Array.isArray(v) ? v.map(pick).filter((p): p is Pick => p !== null) : []);

export function toBuild(answer: OpggValue): ChampionBuild {
  const d = obj(obj(answer)?.data);
  const avg = obj(obj(d?.summary)?.average_stats);
  const r = obj(d?.runes);
  const runeGames = num(r?.play) ?? 0;
  return {
    games: num(avg?.play) ?? 0,
    winRate: num(avg?.win_rate) ?? 0,
    pickRate: num(avg?.pick_rate) ?? 0,
    banRate: num(avg?.ban_rate),
    runes: r
      ? {
          primaryStyle: num(r.primary_page_id) ?? 0,
          subStyle: num(r.secondary_page_id) ?? 0,
          perks: [...nums(r.primary_rune_ids), ...nums(r.secondary_rune_ids)],
          statMods: nums(r.stat_mod_ids),
          games: runeGames,
          winRate: runeGames ? (num(r.win) ?? 0) / runeGames : 0,
        }
      : null,
    spells: pick(d?.summoner_spells),
    starter: pick(d?.starter_items),
    core: pick(d?.core_items),
    boots: pick(d?.boots),
    fourth: picks(d?.fourth_items),
    fifth: picks(d?.fifth_items),
    sixth: picks(d?.sixth_items),
    skillOrder: strs(obj(d?.skills)?.order),
    skillPriority: strs(obj(d?.skill_masteries)?.ids),
  };
}

export function toMayhemAugments(answer: OpggValue): MayhemAugmentStat[] {
  const list = obj(obj(answer)?.data)?.augments;
  if (!Array.isArray(list)) return [];
  return list.flatMap((v) => {
    const a = obj(v);
    const id = num(a?.id);
    return id === null ? [] : [{ id, tier: num(a?.tier) ?? 0, performance: num(a?.performance) ?? 0, popularity: num(a?.popular) ?? 0 }];
  });
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

export class OpggStats {
  constructor(
    private readonly call: CallTool,
    private readonly cacheDir: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** `champion` is the CommunityDragon alias (e.g. "MonkeyKing"); OP.GG takes it upper-cased. */
  build(champion: string, mode: BuildMode, position: Position): Promise<Fetched<ChampionBuild>> {
    const key = champion.toUpperCase();
    return this.cached(`build-${key}-${mode}-${position}`, async () =>
      toBuild(
        parseOpgg(
          await this.call('lol_get_champion_analysis', {
            champion: key,
            game_mode: mode,
            position,
            lang: 'en_US',
            desired_output_fields: BUILD_FIELDS,
          }),
        ),
      ),
    );
  }

  mayhemAugments(championId: number): Promise<Fetched<MayhemAugmentStat[]>> {
    return this.cached(`mayhem-${championId}`, async () =>
      toMayhemAugments(
        parseOpgg(
          await this.call('lol_list_aram_augments', {
            champion_id: championId,
            lang: 'en_US',
            desired_output_fields: ['data.augments[].{desc,id,name,performance,popular,tier}'],
          }),
        ),
      ),
    );
  }

  private async cached<T>(name: string, load: () => Promise<T>): Promise<Fetched<T>> {
    const path = join(this.cacheDir, 'opgg', `${name}.json`);
    const cached = await readFile(path, 'utf8')
      .then((s) => JSON.parse(s) as { fetchedAt: number; data: T })
      .catch(() => null);
    if (cached && this.now() - cached.fetchedAt < SIX_HOURS) return { ...cached, stale: false };
    try {
      const fresh = { fetchedAt: this.now(), data: await load() };
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(fresh));
      return { ...fresh, stale: false };
    } catch (err) {
      if (cached) return { ...cached, stale: true };
      throw err;
    }
  }
}
