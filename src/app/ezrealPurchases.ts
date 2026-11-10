export const EZREAL = 81;
export const TEAR = 3070;
export const MANAMUNE = 3004;
export const MURAMANA = 3042;

export function ezrealTearStage(owned: number[], charged: boolean): 'start' | 'charging' | 'ready' | 'complete' {
  const ids = owned.map((id) => id % 10000);
  if (ids.includes(MANAMUNE) || ids.includes(MURAMANA)) return 'complete';
  if (ids.includes(TEAR)) return charged ? 'ready' : 'charging';
  return 'start';
}

export function ezrealNextItems(owned: number[], advised: number[], charged: boolean): number[] {
  const stage = ezrealTearStage(owned, charged);
  if (stage === 'start') return [TEAR];
  const held = new Set(owned.map((id) => id % 10000));
  const next = advised.filter((id) => !held.has(id % 10000));
  if (stage === 'complete') return next.filter((id) => id % 10000 !== MANAMUNE && id % 10000 !== MURAMANA);
  const manamune = next.find((id) => id % 10000 === MANAMUNE);
  const other = next.filter((id) => id % 10000 !== MANAMUNE);
  return stage === 'ready' && manamune !== undefined ? [manamune, ...other] : other;
}
