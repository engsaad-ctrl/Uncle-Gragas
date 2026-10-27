// Updates from the GitHub releases of the app's own repository (electron-updater): checks at start and on demand,
// downloads in the background, and installs on the next quit or when the player presses "restart".
// Only the installed (NSIS) build updates; a dev run or an unpacked copy has nothing to replace.

import { app, type BrowserWindow } from 'electron';
import updater from 'electron-updater';

export type UpdateStatus =
  | { state: 'idle' | 'checking' | 'latest' | 'unsupported' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export function appUpdater(window: () => BrowserWindow | undefined) {
  const { autoUpdater } = updater; // CommonJS package: its named exports are on the default import
  let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'unsupported' };
  const set = (s: UpdateStatus) => {
    status = s;
    window()?.webContents.send('update:status', s);
  };
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest' }));
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => status.state === 'downloading' && set({ ...status, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => set({ state: 'error', message: explain(e) }));

  const check = async () => {
    if (!app.isPackaged) return status;
    await autoUpdater.checkForUpdates().catch(() => undefined); // reported through the 'error' event
    return status;
  };
  return {
    get status() {
      return status;
    },
    check,
    install() {
      if (status.state === 'ready') autoUpdater.quitAndInstall();
    },
  };
}

/** GitHub answers 404 for a private repository's releases: say what fixes it instead of a stack trace. */
function explain(e: Error): string {
  if (/\b404\b/.test(e.message)) return 'لا توجد تحديثات منشورة، أو المستودع خاص (يجب أن يكون عاماً).';
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/.test(e.message)) return 'تعذّر الاتصال بالإنترنت.';
  return 'تعذّر التحقق من التحديثات.';
}
