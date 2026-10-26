// Background splash art picked at random on launch; UI colours were extracted from each image
// (median-cut palette → most saturated, bright colour as accent; dark tints of its hue for panels).
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
    accent: '#42d753',
    accent2: '#3edaa1',
    bg: '#071208',
    panel: '#112213',
    panel2: '#1b321d',
    line: '#2e4c32'
  },
  {
    name: 'gragas-gentleman',
    image: 'backgrounds/gragas-gentleman.jpg',
    accent: '#d78c42',
    accent2: '#d47e44',
    bg: '#120d07',
    panel: '#221911',
    panel2: '#32261b',
    line: '#4c3d2e'
  },
  {
    name: 'blitzcrank',
    image: 'backgrounds/blitzcrank.jpg',
    accent: '#d7bf42',
    accent2: '#cb944d',
    bg: '#121107',
    panel: '#222011',
    panel2: '#322e1b',
    line: '#4c482e'
  },
  {
    name: 'gragas-hillbilly',
    image: 'backgrounds/gragas-hillbilly.jpg',
    accent: '#d78442',
    accent2: '#cb904d',
    bg: '#120c07',
    panel: '#221911',
    panel2: '#32251b',
    line: '#4c3b2e'
  }
];

/** Random index in [0, count), never `last` when there is another choice. */
export function pickThemeIndex(last: number, count: number, random: () => number): number {
  const choices = Array.from({ length: count }, (_, i) => i).filter((i) => i !== last || count === 1);
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

/** Picks a theme different from last launch (when possible) and applies it to :root. */
export function applyRandomTheme(random = Math.random): Theme {
  let last = -1;
  try {
    last = Number(localStorage.getItem('theme') ?? -1);
  } catch {
    // storage unavailable: any theme will do
  }
  const index = pickThemeIndex(last, THEMES.length, random);
  const t = THEMES[index];
  const root = document.documentElement.style;
  root.setProperty('--accent', t.accent);
  root.setProperty('--accent-2', t.accent2);
  root.setProperty('--bg', t.bg);
  root.setProperty('--panel', t.panel);
  root.setProperty('--panel-2', t.panel2);
  root.setProperty('--line', t.line);
  root.setProperty('--bg-image', `url('${t.image}')`);
  try {
    localStorage.setItem('theme', String(index));
  } catch {
    // not remembered: the next launch may repeat this image
  }
  return t;
}
