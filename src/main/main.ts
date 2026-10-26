import { app, BrowserWindow, ipcMain, net } from 'electron';
import { join } from 'node:path';
import { loadAugments, type AugmentsResult } from '../texts/augmentsLoader.js';

const root = app.getAppPath();
const cacheDir = process.env.LOLH_CACHE_DIR ?? app.getPath('userData');
let augments: Promise<AugmentsResult> | undefined;

ipcMain.handle('augments:get', async () => {
  augments ??= loadAugments({ cacheDir, fetchImpl: net.fetch as typeof fetch });
  try {
    return await augments;
  } catch (err) {
    augments = undefined; // let the next window load retry
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 760,
    title: 'LOL_helper',
    autoHideMenuBar: true,
    backgroundColor: '#0a1428',
    webPreferences: {
      preload: join(root, 'static/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadFile(join(root, 'static/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
