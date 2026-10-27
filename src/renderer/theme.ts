// Background splash art picked at random on launch; UI colours were extracted from each image
// (median-cut palette → most saturated, bright colour's hue, set to S≈0.66/L≈0.62: vivid over the art without glaring;
// dark low-saturation tints of the same hue for panels).
export interface Theme {
  name: string;
  image: string;
  accent: string;
  accent2: string;
  bg: string;
  panel: string;
  panel2: string;
  line: string;
}

export const THEMES: Theme[] = [
  {
    name: 'malphite-shamrock',
    image: 'backgrounds/malphite-shamrock.jpg',
    accent: '#5ede6d',
    accent2: '#5edeb0',
    bg: '#09110a',
    panel: '#141f15',
    panel2: '#1f2e20',
    line: '#364a38'
  },
  {
    name: 'gragas-gentleman',
    image: 'backgrounds/gragas-gentleman.jpg',
    accent: '#de9e5e',
    accent2: '#de925e',
    bg: '#110d09',
    panel: '#1f1914',
    panel2: '#2e261f',
    line: '#4a4036'
  },
  {
    name: 'blitzcrank',
    image: 'backgrounds/blitzcrank.jpg',
    accent: '#deca5e',
    accent2: '#dea65e',
    bg: '#110f09',
    panel: '#1f1d14',
    panel2: '#2e2b1f',
    line: '#4a4736'
  },
  {
    name: 'gragas-hillbilly',
    image: 'backgrounds/gragas-hillbilly.jpg',
    accent: '#de975e',
    accent2: '#dea35e',
    bg: '#110c09',
    panel: '#1f1914',
    panel2: '#2e251f',
    line: '#4a3f36'
  }
];

/** Random index in [0, count), never `last` when there is another choice. */
export function pickThemeIndex(last: number, count: number, random: () => number): number {
  const choices = Array.from({ length: count }, (_, i) => i).filter((i) => i !== last || count === 1);
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

let current = -1;

/** Applies theme `index` to :root and remembers it as the last one shown. */
export function applyTheme(index: number): Theme {
  const t = THEMES[index];
  const root = document.documentElement.style;
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-2', t.accent2);
  root.setProperty('--bg', t.bg);
  root.setProperty('--panel', t.panel);
  root.setProperty('--panel-2', t.panel2);
  root.setProperty('--line', t.line);
  root.setProperty('--bg-image', `url('${t.image}')`);
  current = index;
  try {
    localStorage.setItem('theme', String(index));
  } catch {
    // not remembered: the next launch may repeat this image
  }
  return t;
}

/** Settings → "تغيير الخلفية": the next image in the list. */
export const nextTheme = () => applyTheme((current + 1) % THEMES.length);

/** Picks a theme different from last launch (when possible) and applies it to :root. */
export function applyRandomTheme(random = Math.random): Theme {
  let last = -1;
  try {
    last = Number(localStorage.getItem('theme') ?? -1);
  } catch {
    // storage unavailable: any theme will do
  }
  return applyTheme(pickThemeIndex(last, THEMES.length, random));
}
