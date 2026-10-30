import type { AppMode } from '../main/services.js';
import { teamsInGame } from './teams.js';
import type { Position } from '../stats/opgg.js';

export interface LcuState {
  /** Gameflow phase as the client names it (None, Lobby, ChampSelect, InProgress…); "Disconnected" when no client. */
  phase: string;
  mode: AppMode | null;
  queueId: number | null;
  gameMode: string | null;
  championId: number | null;
  locked: boolean;
  position: Position | null;
  /** Champions the enemy team has shown (locked), and those taken by teammates: for pick suggestions. */
  enemies: number[];
  allies: number[];
}

export const DISCONNECTED: LcuState = {
  phase: 'Disconnected', mode: null, queueId: null, gameMode: null, championId: null, locked: false, position: null, enemies: [], allies: [],
};

// shortcut: KIWI (Mayhem) is inferred from the mode's internal code name; confirm with a real diagnostics export.
const MODES: Record<string, AppMode> = { CLASSIC: 'normal', ARAM: 'aram', KIWI: 'mayhem', CHERRY: 'arena' };
// Mayhem's queue, whatever game mode name the client gives it (it may report plain "ARAM"): read as ARAM, the
// app would show the generic augment list, the same for every champion.
const MAYHEM_QUEUES = new Set([2400]);
const LANES: Record<string, Position> = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'support' };

type Json = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);

export function toLcuState(phase: string, gameflow: unknown, champSelect: unknown): LcuState {
  const queue = obj(obj(obj(gameflow)?.gameData)?.queue);
  const gameMode = typeof queue?.gameMode === 'string' ? queue.gameMode : null;
  const queueId = num(queue?.id);
  const known = gameMode ? MODES[gameMode] : undefined;
  // A mode name we do not know on Howling Abyss (map 12) is Mayhem: plain ARAM always reports "ARAM".
  const mode = (queueId !== null && MAYHEM_QUEUES.has(queueId)) || (!known && num(queue?.mapId) === 12) ? 'mayhem' : (known ?? null);
  const base: LcuState = { ...DISCONNECTED, phase, gameMode, queueId, mode };
  if (phase !== 'ChampSelect') return base;

  const session = obj(champSelect);
  const cell = num(session?.localPlayerCellId);
  const team = (v: unknown) => (Array.isArray(v) ? v : []).map(obj);
  const me = team(session?.myTeam).find((p) => num(p?.cellId) === cell);
  const picked = (list: Json[]) => list.map((p) => num(p?.championId) || 0).filter((id) => id > 0);
  const selected = num(me?.championId) || 0;
  const hover = num(me?.championPickIntent) || 0;
  // championId fills in as soon as the player clicks a champion on their turn; the lock-in is the pick action
  // completing. ARAM and Mayhem have no pick actions (the champion is given), so there a champion is final.
  const picks = (Array.isArray(session?.actions) ? session.actions.flat() : []).map(obj).filter((a) => num(a?.actorCellId) === cell && a?.type === 'pick');
  const locked = selected > 0 && (picks.length === 0 || picks.some((a) => a?.completed === true));
  return {
    ...base,
    championId: selected || hover || null,
    locked,
    position: LANES[String(me?.assignedPosition ?? '')] ?? null,
    enemies: picked(team(session?.theirTeam)),
    allies: picked(team(session?.myTeam).filter((p) => p !== me)),
  };
}

/** The other team's champions once a game is loaded; empty before (see teamsInGame). */
export const enemiesInGame = (gameflow: unknown, myChampion: number | null | undefined): number[] =>
  teamsInGame(gameflow, myChampion)?.enemy.map((p) => p.championId) ?? [];
