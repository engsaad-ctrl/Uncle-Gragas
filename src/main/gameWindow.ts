// Where the game's window is, so F7 opens on the game's screen with two monitors, wherever the mouse is. Only the
// window's position is asked of Windows; the game itself is not touched.

import { execFile } from 'node:child_process';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SCRIPT = `
$p = Get-Process 'League of Legends' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { exit }
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public struct R{public int L,T,E,B;}public class U{[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);}'
$r = New-Object R
[void][U]::GetWindowRect($p.MainWindowHandle, [ref]$r)
"$($r.L) $($r.T) $($r.E) $($r.B)"
`;

/** "left top right bottom"; null for anything else, or a window with no size (minimised, still opening). */
export function parseRect(text: string): Rect | null {
  const m = /^(-?\d+) (-?\d+) (-?\d+) (-?\d+)$/.exec(text.trim());
  if (!m) return null;
  const [l, t, r, b] = m.slice(1).map(Number);
  // Windows reports a minimised window far off screen.
  if (r <= l || b <= t || l <= -32000) return null;
  return { x: l, y: t, width: r - l, height: b - t };
}

/** The game's window, or null when it isn't open yet or Windows won't say. */
export const gameWindowRect = () =>
  new Promise<Rect | null>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? null : parseRect(stdout)));
  });
