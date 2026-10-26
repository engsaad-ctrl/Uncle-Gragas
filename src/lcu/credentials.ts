// Finding the League client's local API (LCU): port + one-time password.
// Two documented sources: the running LeagueClientUx.exe command line, or the lockfile in the install folder.

export interface LcuCredentials {
  port: number;
  password: string;
}

export function parseLockfile(text: string): LcuCredentials | null {
  const [, , port, password] = text.trim().split(':'); // name:pid:port:password:protocol
  const n = Number(port);
  return Number.isInteger(n) && n > 0 && password ? { port: n, password } : null;
}

export function parseCommandLine(cmd: string): LcuCredentials | null {
  const port = Number(/--app-port=(\d+)/.exec(cmd)?.[1]);
  const password = /--remoting-auth-token=([\w-]+)/.exec(cmd)?.[1];
  return port > 0 && password ? { port, password } : null;
}

const LOCKFILES = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  'E:\\Riot Games\\League of Legends\\lockfile',
];

export interface CredentialSources {
  /** Command line of the running LeagueClientUx.exe, or null when it is not running. */
  processCommandLine: () => Promise<string | null>;
  readFile: (path: string) => Promise<string>;
}

export async function findCredentials(src: CredentialSources): Promise<(LcuCredentials & { source: 'process' | 'lockfile' }) | null> {
  const cmd = await src.processCommandLine().catch(() => null);
  const fromProcess = cmd ? parseCommandLine(cmd) : null;
  if (fromProcess) return { ...fromProcess, source: 'process' };
  for (const path of LOCKFILES) {
    const text = await src.readFile(path).catch(() => null);
    const creds = text ? parseLockfile(text) : null;
    if (creds) return { ...creds, source: 'lockfile' };
  }
  return null;
}
