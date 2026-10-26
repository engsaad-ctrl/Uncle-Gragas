import { app, BrowserWindow, dialog, ipcMain, net } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findClient, lcuGetter } from '../lcu/client.js';
import { LcuWatcher } from '../lcu/watcher.js';
import { createServices, parseAppMode, parseLane, parsePageRequest } from './services.js';

const root = app.getAppPath();
const cacheDir = process.env.LOLH_CACHE_DIR ?? app.getPath('userData');
const fetchImpl = net.fetch as typeof fetch; // Chromium network stack: follows Windows proxy settings
const services = createServices({ cacheDir, fetchImpl });

/** Errors cross IPC as { error } so the window can show them instead of hanging. */
const reply = async <T>(work: () => Promise<T>) => {
  try {
    return await work();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
};

ipcMain.handle('augments:get', () => reply(services.augments));
ipcMain.handle('champions:list', () => reply(services.champions));
ipcMain.handle('champion:page', (_e, id: unknown, mode: unknown, position: unknown) =>
  reply(() => {
    const r = parsePageRequest(id, mode, position);
    return services.championPage(r.id, r.mode, r.position);
  }),
);

ipcMain.handle('items:list', (_e, mode: unknown) => reply(() => services.items(parseAppMode(mode))));
ipcMain.handle('tierlist:get', (_e, position: unknown) => reply(() => services.tierList(parseLane(position))));

// League client: champ select → the window opens the right champion page.
let mainWindow: BrowserWindow | undefined;
const watcher = new LcuWatcher({ find: findClient, connect: (c) => lcuGetter(c) }, (state) => mainWindow?.webContents.send('lcu:state', state));
ipcMain.handle('lcu:state', () => watcher.state);
ipcMain.handle('diagnostics:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'تصدير التشخيص',
    defaultPath: join(app.getPath('desktop'), `lol-helper-diagnostics-${Date.now()}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { saved: null };
  await writeFile(filePath, JSON.stringify(watcher.report(app.getVersion()), null, 2));
  return { saved: filePath };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 860,
    title: 'LOL_helper',
    icon: join(root, 'static/icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#070720',
    webPreferences: {
      preload: join(root, 'static/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  void win.loadFile(join(root, 'static/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  watcher.start();
});
app.on('window-all-closed', () => app.quit());
