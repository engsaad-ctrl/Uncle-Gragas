import type { LcuCredentials } from './credentials.js';
import { scrub } from './diagnostics.js';
import { DISCONNECTED, toLcuState, type LcuState } from './state.js';

export type LcuGet = (path: string) => Promise<unknown>;

export interface WatcherDeps {
  find: () => Promise<(LcuCredentials & { source: 'process' | 'lockfile' }) | null>;
  connect: (creds: LcuCredentials) => LcuGet;
}

/** Polls the client's gameflow and champ select; calls onChange only when the state really changes. */
export class LcuWatcher {
  state: LcuState = DISCONNECTED;
  /** The client found at the last connect, for requests other than polling (writing runes and item sets). */
  creds: LcuCredentials | undefined;
  private get: LcuGet | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastRaw: Record<string, unknown> = {};
  private lastChampSelect: unknown = null;
  private log: string[] = [];

  constructor(
    private readonly deps: WatcherDeps,
    private readonly onChange: (s: LcuState) => void,
  ) {}

  async tick(): Promise<void> {
    try {
      if (!this.get) {
        const creds = await this.deps.find();
        if (!creds) return this.set(DISCONNECTED);
        this.get = this.deps.connect(creds);
        this.creds = creds;
        this.note(`connected (${creds.source}, port ${creds.port})`);
      }
      const phase = await this.get('/lol-gameflow/v1/gameflow-phase');
      const flow = await this.get('/lol-gameflow/v1/session');
      const champSelect = phase === 'ChampSelect' ? await this.get('/lol-champ-select/v1/session') : null;
      // Modes without this list answer with an error: it just stays empty.
      const offered = phase === 'ChampSelect' ? await this.get('/lol-lobby-team-builder/champ-select/v1/subset-champion-list').catch(() => null) : null;
      this.lastRaw = { at: new Date().toISOString(), phase, gameflowSession: flow, champSelectSession: champSelect, offered };
      if (champSelect) this.lastChampSelect = champSelect;
      this.set(toLcuState(typeof phase === 'string' ? phase : 'None', flow, champSelect, offered));
    } catch (err) {
      this.note(`error: ${err instanceof Error ? err.message : String(err)}`);
      this.get = undefined; // client closed or restarted: find it again next tick
      this.creds = undefined;
      this.set(DISCONNECTED);
    }
  }

  start(intervalMs = 2000, idleMs = 8000) {
    const loop = async () => {
      await this.tick().catch(() => undefined); // a throwing listener must not end the polling for good
      // Finding the client starts PowerShell: every 2s for as long as League is closed was a constant load.
      this.timer = setTimeout(loop, this.get ? intervalMs : idleMs);
    };
    void loop();
  }

  stop() {
    clearTimeout(this.timer);
  }

  /** The last gameflow session the client sent (both teams' champions once a game is loaded). */
  get session(): unknown {
    return this.lastRaw.gameflowSession;
  }

  /** What "تصدير التشخيص" saves: state, recent log and the last raw answers, with identities removed. */
  report(appVersion: string): unknown {
    return {
      app: appVersion,
      generatedAt: new Date().toISOString(),
      state: this.state,
      log: this.log.slice(-50),
      last: scrub(this.lastRaw),
      lastChampSelect: scrub(this.lastChampSelect),
    };
  }

  private set(s: LcuState) {
    if (JSON.stringify(s) === JSON.stringify(this.state)) return;
    this.state = s;
    this.onChange(s);
  }

  /** Adds a line to the diagnostics log (also used by the rune/item writer). */
  note(line: string) {
    this.log.push(`${new Date().toISOString()} ${line}`);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }
}
