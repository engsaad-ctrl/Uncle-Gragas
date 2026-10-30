// The small window shown over the game with a hotkey: the augments of the champion picked in champ select.
// It is an ordinary always-on-top window (like Discord's or a browser's): nothing reads or touches the game.
// Works over the game in Borderless/Windowed mode; exclusive fullscreen draws over every other window.

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Rect } from './gameWindow.js';

export function overlayWindow(root: string) {
  let win: BrowserWindow | undefined;
  // Large by default; the window's own button switches to the normal size, and the window remembers the choice.
  let large = true;
  /** The game's window while it is open: F7 opens on its screen. */
  let game: Rect | null = null;
  // Windows can drop the level across hide/show while still reporting it, and then the game stays in front:
  // turning it off first makes the call really happen.
  const onTop = (w: BrowserWindow) => {
    w.setAlwaysOnTop(false);
    w.setAlwaysOnTop(true, 'screen-saver');
  };
  // On the game's screen, wherever the mouse is; before the game is found, on the screen the mouse is on.
  const place = (w: BrowserWindow) => {
    const at = game ? { x: game.x + game.width / 2, y: game.y + game.height / 2 } : screen.getCursorScreenPoint();
    const { workArea } = screen.getDisplayNearestPoint(at);
    // Large fills most of the screen, centred; normal is the small box at the side.
    const width = large ? Math.round(Math.min(1500, workArea.width * 0.75)) : 400;
    const height = large ? workArea.height - 60 : 620;
    const x = large ? workArea.x + Math.round((workArea.width - width) / 2) : workArea.x + workArea.width - width - 20;
    w.setBounds({ x, y: workArea.y + (large ? 30 : 70), width, height });
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
      webPreferences: { preload: join(root, 'static/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, 'screen-saver'); // above a borderless game window
    // Clicking back into the game can push the window behind it while it still counts as visible; F7 would
    // then "hide" an already hidden window and need a second press. Keep it on top whenever it loses focus.
    w.on('blur', () => {
      if (!w.isVisible()) return;
      onTop(w);
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
    toggle(tab?: string) {
      win ??= create();
      if (win.isVisible()) return win.hide();
      win.webContents.send('overlay:show', tab); // refresh for the current champion
      place(win);
      win.show();
      onTop(win);
      win.moveTop();
      win.focus();
    },
    hide() {
      win?.hide();
    },
    /** Shows the window on a tab without hiding it when already open (the loading screen opens it on the teams). */
    show(tab: string) {
      win ??= create();
      win.webContents.send('overlay:show', tab);
      if (win.isVisible()) return;
      place(win);
      win.showInactive(); // the game keeps the focus: F7 or Esc hides it
      onTop(win);
    },
    setGame(rect: Rect | null) {
      game = rect;
      if (rect && win?.isVisible()) place(win);
    },
    setLarge(on: boolean) {
      large = on;
      if (win?.isVisible()) place(win);
    },
  };
}
