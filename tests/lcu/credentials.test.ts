import { describe, expect, it } from 'vitest';
import { findCredentials, parseCommandLine, parseLockfile } from '../../src/lcu/credentials.js';

// Synthetic samples in the documented formats (lockfile: name:pid:port:password:protocol).
const LOCKFILE = 'LeagueClient:12345:54321:AbC-dEf_123:https';
const CMDLINE = '"C:/Riot Games/League of Legends/LeagueClientUx.exe" "--riotclient-auth-token=x" "--app-port=54321" "--remoting-auth-token=AbC-dEf_123" "--install-directory=C:/Riot Games/League of Legends/"';

describe('parseLockfile / parseCommandLine', () => {
  it('reads port and password from the lockfile', () => {
    expect(parseLockfile(LOCKFILE)).toEqual({ port: 54321, password: 'AbC-dEf_123' });
  });
  it('reads them from the client process command line', () => {
    expect(parseCommandLine(CMDLINE)).toEqual({ port: 54321, password: 'AbC-dEf_123' });
  });
  it('rejects malformed input', () => {
    expect(parseLockfile('garbage')).toBeNull();
    expect(parseLockfile('a:b:notaport:pw:https')).toBeNull();
    expect(parseCommandLine('"LeagueClientUx.exe" "--app-port=1"')).toBeNull();
  });
});

describe('findCredentials', () => {
  it('prefers the running process, then the lockfile in default install folders', async () => {
    const fromProcess = await findCredentials({ processCommandLine: async () => CMDLINE, readFile: async () => { throw new Error('unused'); } });
    expect(fromProcess).toEqual({ port: 54321, password: 'AbC-dEf_123', source: 'process' });

    const read: string[] = [];
    const fromLockfile = await findCredentials({
      processCommandLine: async () => null,
      readFile: async (p) => {
        read.push(p);
        if (p.startsWith('D:')) return LOCKFILE;
        throw new Error('ENOENT');
      },
    });
    expect(fromLockfile).toEqual({ port: 54321, password: 'AbC-dEf_123', source: 'lockfile' });
    expect(read[0]).toBe('C:\\Riot Games\\League of Legends\\lockfile');
  });

  it('returns null when the client is not running', async () => {
    expect(await findCredentials({ processCommandLine: async () => null, readFile: async () => { throw new Error('ENOENT'); } })).toBeNull();
  });
});
