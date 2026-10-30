import { describe, expect, it } from 'vitest';
import type { LcuState } from '../../src/lcu/state.js';
import { LcuWatcher } from '../../src/lcu/watcher.js';

function fakeClient(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const get = async (path: string) => {
    calls.push(path);
    if (answers.fail) throw new Error('ECONNREFUSED');
    return answers[path] ?? null;
  };
  return { calls, get };
}

const CS = { localPlayerCellId: 0, myTeam: [{ cellId: 0, championId: 0, championPickIntent: 103, assignedPosition: 'middle', summonerName: 'Me' }] };
const FLOW = { gameData: { queue: { id: 420, gameMode: 'CLASSIC' } } };

describe('LcuWatcher', () => {
  it('reports Disconnected when no client is found, and looks again next tick', async () => {
    let finds = 0;
    const seen: LcuState[] = [];
    const w = new LcuWatcher({ find: async () => (finds++, null), connect: () => fakeClient({}).get }, (s) => seen.push(s));
    await w.tick();
    await w.tick();
    expect(finds).toBe(2);
    expect(w.state.phase).toBe('Disconnected');
    expect(seen).toEqual([]); // starts Disconnected: no change to announce
  });

  it('follows champ select and only announces changes', async () => {
    const answers: Record<string, unknown> = { '/lol-gameflow/v1/gameflow-phase': 'ChampSelect', '/lol-gameflow/v1/session': FLOW, '/lol-champ-select/v1/session': CS };
    const client = fakeClient(answers);
    const seen: LcuState[] = [];
    const w = new LcuWatcher({ find: async () => ({ port: 1, password: 'p', source: 'lockfile' as const }), connect: () => client.get }, (s) => seen.push(s));
    await w.tick();
    await w.tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ phase: 'ChampSelect', mode: 'normal', championId: 103, position: 'mid' });
    answers['/lol-gameflow/v1/gameflow-phase'] = 'InProgress';
    await w.tick();
    expect(seen.at(-1)).toMatchObject({ phase: 'InProgress', championId: null });
    expect(client.calls.filter((p) => p.includes('champ-select'))).toHaveLength(4); // the session and the offered list, twice; not asked outside champ select
  });

  it('drops the connection on errors and reconnects later', async () => {
    const answers: Record<string, unknown> = { '/lol-gameflow/v1/gameflow-phase': 'Lobby', '/lol-gameflow/v1/session': FLOW };
    let connects = 0;
    const w = new LcuWatcher({ find: async () => ({ port: 1, password: 'p', source: 'process' as const }), connect: () => (connects++, fakeClient(answers).get) }, () => {});
    await w.tick();
    expect(w.state.phase).toBe('Lobby');
    answers.fail = true;
    await w.tick();
    expect(w.state.phase).toBe('Disconnected');
    delete answers.fail;
    await w.tick();
    expect(w.state.phase).toBe('Lobby');
    expect(connects).toBe(2);
  });

  it('builds a scrubbed diagnostics report that keeps the last champ select', async () => {
    const answers: Record<string, unknown> = { '/lol-gameflow/v1/gameflow-phase': 'ChampSelect', '/lol-gameflow/v1/session': FLOW, '/lol-champ-select/v1/session': CS };
    const w = new LcuWatcher({ find: async () => ({ port: 1, password: 'secret', source: 'lockfile' as const }), connect: () => fakeClient(answers).get }, () => {});
    await w.tick();
    answers['/lol-gameflow/v1/gameflow-phase'] = 'Lobby';
    await w.tick();
    const r = w.report('0.1.0') as any;
    expect(r.app).toBe('0.1.0');
    expect(r.state.phase).toBe('Lobby');
    expect(r.lastChampSelect.myTeam[0]).toMatchObject({ championPickIntent: 103, summonerName: '[حُذف]' });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(r.log.some((l: string) => l.includes('lockfile'))).toBe(true);
  });
});
