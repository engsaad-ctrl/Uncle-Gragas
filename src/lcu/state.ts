import type { AppMode } from '../main/services.js';
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
}

export const DISCONNECTED: LcuState = { phase: 'Disconnected', mode: null, queueId: null, gameMode: null, championId: null, locked: false, position: null };

// shortcut: KIWI (Mayhem) is inferred from the mode's internal code name; confirm with a real diagnostics export.
const MODES: Record<string, AppMode> = { CLASSIC: 'normal', ARAM: 'aram', KIWI: 'mayhem', CHERRY: 'arena' };
const LANES: Record<string, Position> = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'support' };

type Json = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);

export function toLcuState(phase: string, gameflow: unknown, champSelect: unknown): LcuState {
  const queue = obj(obj(obj(gameflow)?.gameData)?.queue);
  const gameMode = typeof queue?.gameMode === 'string' ? queue.gameMode : null;
  const base: LcuState = { ...DISCONNECTED, phase, gameMode, queueId: num(queue?.id), mode: gameMode ? (MODES[gameMode] ?? null) : null };
  if (phase !== 'ChampSelect') return base;

  const session = obj(champSelect);
  const cell = num(session?.localPlayerCellId);
  const me = (Array.isArray(session?.myTeam) ? session.myTeam : []).map(obj).find((p) => num(p?.cellId) === cell);
  const locked = num(me?.championId) || 0;
  const hover = num(me?.championPickIntent) || 0;
  return {
    ...base,
    championId: locked || hover || null,
    locked: locked > 0,
    position: LANES[String(me?.assignedPosition ?? '')] ?? null,
  };
}
