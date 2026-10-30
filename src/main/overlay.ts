// The small window shown over the game with a hotkey: the augments of the champion picked in champ select.
// It is an ordinary always-on-top window (like Discord's or a browser's): nothing reads or touches the game.
// Works over the game in Borderless/Windowed mode; exclusive fullscreen draws over every other window.

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

export function overlayWindow(root: string) {
  let win: BrowserWindow | undefined;
  // Large by default; the window's own button switches to the normal size, and the window remembers the choice.
  let large = true;
  // On the screen the mouse is on: with two monitors the game is where the player presses F7, not always the main one.
  const place = (w: BrowserWindow) => {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = large ? 520 : 400;
    const height = large ? Math.min(900, workArea.height - 100) : 620;
    w.setBounds({ x: workArea.x + workArea.width - width - 20, y: workArea.y + 70, width, height });
  };
  const create = () => {
    const w = new BrowserWindow({
      width: 400,
      height: 620,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      title: 'Uncle Gragas',
      webPreferences: { preload: join(root, 'static/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    w.setAlwaysOnTop(true, 'screen-saver'); // above a borderless game window
    // Clicking back into the game can push the window behind it while it still counts as visible; F7 would
    // then "hide" an already hidden window and need a second press. Keep it on top whenever it loses focus.
    w.on('blur', () => {
      if (!w.isVisible()) return;
      w.setAlwaysOnTop(true, 'screen-saver');
      w.moveTop();
    });
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
      win.setAlwaysOnTop(true, 'screen-saver'); // Windows can drop the level across hide/show
      place(win);
      win.show();
      win.moveTop();
      win.focus();
    },
    hide() {
      win?.hide();
    },
    setLarge(on: boolean) {
      large = on;
      if (win?.isVisible()) place(win);
    },
  };
}
