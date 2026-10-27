import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net } from 'electron';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { applyAll, toPayloads } from '../lcu/apply.js';
import { findClient, lcuCaller, lcuGetter } from '../lcu/client.js';
import { loadProfile, parsePuuid } from '../lcu/profile.js';
import { LcuWatcher } from '../lcu/watcher.js';
import type { Position } from '../stats/opgg.js';
import { overlayWindow } from './overlay.js';
import { appUpdater } from './updater.js';
import { createServices, parseAppMode, parseIds, parseLane, parsePageRequest, type AppMode } from './services.js';

const root = app.getAppPath();
// Renamed from LOL_helper: keep its data folder so the downloaded game files and the settings stay.
app.setPath('userData', join(app.getPath('appData'), 'LOL_helper'));
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
ipcMain.handle('tierlist:get', (_e, position: unknown, mode: unknown) => reply(() => services.tierList(parseLane(position), parseAppMode(mode))));
ipcMain.handle('suggest:get', (_e, position: unknown, enemies: unknown, taken: unknown) =>
  reply(() => services.suggestions(parseLane(position), parseIds(enemies), parseIds(taken))),
);

// League client: champ select → the window opens the right champion page.
let mainWindow: BrowserWindow | undefined;
// The client stops naming the champion once the game starts: remember the last champ-select pick for the overlay.
let lastPick: { championId: number; mode: AppMode; position: Position | null } | null = null;
const watcher = new LcuWatcher({ find: findClient, connect: (c) => lcuGetter(c) }, (state) => {
  if (state.championId && state.mode) lastPick = { championId: state.championId, mode: state.mode, position: state.position };
  mainWindow?.webContents.send('lcu:state', state);
});
ipcMain.handle('lcu:state', () => watcher.state);
// The window only names the page (champion, mode, lane); the build sent to the client is composed here.
ipcMain.handle('lcu:apply', (_e, id: unknown, mode: unknown, position: unknown, flash: unknown) =>
  reply(async () => {
    const r = parsePageRequest(id, mode, position);
    if (!watcher.creds) throw new Error('عميل اللعبة غير مفتوح.');
    const page = await services.championPage(r.id, r.mode, r.position);
    const result = await applyAll(lcuCaller(watcher.creds), toPayloads(page), { inChampSelect: watcher.state.phase === 'ChampSelect', uid: randomUUID(), flash: flash === 'D' || flash === 'F' ? flash : null });
    watcher.note(`apply ${r.id}/${r.mode}/${r.position}: ${JSON.stringify(result)}`);
    return result;
  }),
);
// Profile and match history come from the client itself; without it there is nothing to show.
ipcMain.handle('profile:get', (_e, puuid: unknown) =>
  reply(async () => {
    const id = parsePuuid(puuid);
    if (!watcher.creds) throw new Error('افتح عميل اللعبة لعرض البروفايل وسجل المباريات.');
    const raw = await loadProfile(lcuCaller(watcher.creds), id);
    // Counts only, no names: enough to tell from a diagnostics export whether the client's answers were read.
    watcher.note(`profile ${id ? 'other' : 'me'}: ranked ${raw.ranked.length}, matches ${raw.matches.length}, recent ${raw.recent.length}`);
    return services.profilePage(raw, id === null);
  }),
);
// Over-the-game window (F7): augments of the picked champion, ranked for Mayhem, all of them for Arena.
const overlay = overlayWindow(root);
const OVERLAY_KEY = 'F7';
ipcMain.handle('overlay:data', () => reply(() => services.overlayData(lastPick)));
ipcMain.handle('overlay:hide', () => overlay.hide());
ipcMain.handle('overlay:enabled', (_e, on: unknown) => {
  globalShortcut.unregister(OVERLAY_KEY);
  // register() returns false when another app already holds the key
  return on === true ? globalShortcut.register(OVERLAY_KEY, () => overlay.toggle()) : false;
});
const updates = appUpdater(() => mainWindow);
ipcMain.handle('update:status', () => ({ version: app.getVersion(), status: updates.status }));
ipcMain.handle('update:check', () => updates.check());
ipcMain.handle('update:install', () => updates.install());
ipcMain.handle('diagnostics:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'تصدير التشخيص',
    defaultPath: join(app.getPath('desktop'), `uncle-gragas-diagnostics-${Date.now()}.json`),
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
    title: 'Uncle Gragas',
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
  services.warm();
  watcher.start();
  overlay.prepare();
  void updates.check();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
