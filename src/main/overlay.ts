// The small window shown over the game with a hotkey: the augments of the champion picked in champ select.
// It is an ordinary always-on-top window (like Discord's or a browser's): nothing reads or touches the game.
// Works over the game in Borderless/Windowed mode; exclusive fullscreen draws over every other window.

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

export function overlayWindow(root: string) {
  let win: BrowserWindow | undefined;
  const create = () => {
    const { workArea } = screen.getPrimaryDisplay();
    const w = new BrowserWindow({
      width: 400,
      height: 620,
      x: workArea.x + workArea.width - 420,
      y: workArea.y + 70,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      title: 'LOL_helper',
      webPreferences: { preload: join(root, 'static/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    w.setAlwaysOnTop(true, 'screen-saver'); // above a borderless game window
    void w.loadFile(join(root, 'static/overlay.html'));
    w.on('closed', () => (win = undefined));
    return w;
  };

  return {
    /** Loaded hidden at start so the hotkey shows it at once. */
    prepare() {
      win ??= create();
    },
    toggle() {
      win ??= create();
      if (win.isVisible()) return win.hide();
      win.webContents.send('overlay:show'); // refresh for the current champion
      win.show();
      win.focus();
    },
    hide() {
      win?.hide();
    },
  };
}
