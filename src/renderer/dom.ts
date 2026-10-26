import type { ChampionPage, PageMode } from '../app/championPage.js';
import type { Position } from '../stats/opgg.js';
import type { AugmentsResult } from '../texts/augmentsLoader.js';
import type { ItemEntry } from '../app/itemList.js';
import type { TierRow } from '../app/tierList.js';
import type { ApplyResult } from '../lcu/apply.js';
import type { LcuState } from '../lcu/state.js';
import type { AppMode, Listed } from '../main/services.js';
import type { LanePosition } from '../stats/opgg.js';
import type { RankRow } from '../texts/abilityDetails.js';
import type { ChampionListEntry } from '../texts/champions.js';

export type Reply<T> = T | { error: string };

declare global {
  interface Window {
    lolh: {
      getAugments(): Promise<Reply<AugmentsResult>>;
      listChampions(): Promise<Reply<ChampionListEntry[]>>;
      championPage(id: number, mode: PageMode, position: Position): Promise<Reply<ChampionPage>>;
      listItems(mode: AppMode): Promise<Reply<Listed<ItemEntry>>>;
      tierList(position: LanePosition): Promise<Reply<Listed<TierRow>>>;
      lcuState(): Promise<LcuState>;
      applyToClient(id: number, mode: PageMode, position: Position): Promise<Reply<ApplyResult>>;
      onLcuState(callback: (state: LcuState) => void): void;
      exportDiagnostics(): Promise<{ saved: string | null }>;
    };
  }
}

export const isError = <T>(r: Reply<T>): r is { error: string } => typeof r === 'object' && r !== null && 'error' in r;

export const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function icon(src: string, className = ''): HTMLImageElement {
  const img = el('img', className);
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  return img;
}

// The owner plays with the English client: English names by default, descriptions always Arabic.
let nameLang: 'en' | 'ar' = 'en';
try {
  if (localStorage.getItem('nameLang') === 'ar') nameLang = 'ar';
} catch {
  // storage unavailable: keep the default
}
export const getNameLang = () => nameLang;
export function setNameLang(v: 'en' | 'ar') {
  nameLang = v;
  try {
    localStorage.setItem('nameLang', v);
  } catch {
    // not remembered this time; harmless
  }
}

// The side menu's mode drives every page (items map, augment filter, champion build).
const APP_MODES: AppMode[] = ['normal', 'aram', 'mayhem', 'arena'];
let appMode: AppMode = 'normal';
try {
  const saved = localStorage.getItem('appMode') as AppMode | null;
  if (saved && APP_MODES.includes(saved)) appMode = saved;
} catch {
  // storage unavailable: keep the default
}
export const getAppMode = () => appMode;
export function setAppMode(v: AppMode) {
  appMode = v;
  try {
    localStorage.setItem('appMode', v);
  } catch {
    // not remembered this time; harmless
  }
}
export const MODE_TITLE: Record<AppMode, string> = { normal: "Summoner's Rift", aram: 'ARAM', mayhem: 'ARAM Mayhem', arena: 'Arena' };
/** Champion-page build mode for an app mode ("normal" opens the ranked build). */
export const PAGE_MODE: Record<AppMode, PageMode> = { normal: 'ranked', aram: 'aram', mayhem: 'mayhem', arena: 'arena' };

interface Named {
  name: string;
  enName: string;
}
export const shownName = (x: Named) => (nameLang === 'en' && x.enName ? x.enName : x.name);
export const otherName = (x: Named) => (shownName(x) === x.name ? x.enName : x.name);
export function nameEl<K extends keyof HTMLElementTagNameMap>(tag: K, x: Named, className = ''): HTMLElementTagNameMap[K] {
  const node = el(tag, className, shownName(x));
  node.dir = 'auto';
  return node;
}

export interface Describable extends Named {
  html: string;
  iconUrl: string;
  ranks?: RankRow[];
}

/**
 * Cooldown/cost per level. Rows equal at every level become one "التبريد: 7ث" line;
 * the rest share a table whose first column (on the right) is level 1.
 */
export function rankTable(rows: RankRow[] | undefined): HTMLElement | null {
  if (!rows?.length) return null;
  const box = el('div', 'ranks');
  const varying = rows.filter((r) => r.values.some((v) => v !== r.values[0]));
  for (const r of rows.filter((x) => !varying.includes(x))) box.append(el('div', 'rank-line', `${r.label}: ${r.values[0]}`));
  if (varying.length) {
    const table = el('table', 'rank-table');
    const head = el('tr');
    head.append(el('th', '', 'المستوى'), ...varying[0].values.map((_, i) => el('th', '', String(i + 1))));
    table.append(head);
    for (const r of varying) {
      const tr = el('tr');
      tr.append(el('th', '', r.label), ...r.values.map((v) => el('td', '', v)));
      table.append(tr);
    }
    box.append(table);
  }
  return box;
}

/** The sticky panel that shows one item/rune/ability/augment: name, other-language name, Arabic description. */
export function detailPanel() {
  const node = el('section', 'panel detail');
  node.hidden = true;
  return {
    node,
    show(x: Describable | undefined, opts: { tags?: HTMLElement[]; className?: string; missing?: string } = {}) {
      node.hidden = !x;
      if (!x) return;
      node.className = `panel detail ${opts.className ?? ''}`;
      void node.offsetWidth; // restart the slide-in animation for each new pick
      node.classList.add('enter');
      const title = nameEl('h3', x);
      title.append(...(opts.tags ?? []));
      const other = el('div', 'en', otherName(x));
      other.dir = 'auto';
      const desc = el('p');
      if (x.html) desc.innerHTML = x.html; // safe: produced by cleanText (escaped text, whitelisted tags only)
      else {
        desc.className = 'missing';
        desc.textContent = opts.missing ?? 'لا يوجد وصف.';
      }
      const body = el('div');
      body.append(...[title, other, rankTable(x.ranks), desc].filter((n): n is HTMLElement => n !== null));
      node.replaceChildren(icon(x.iconUrl), body);
    },
  };
}

/** A row of pill buttons; calls onChange with the clicked value. */
export function pills(label: string, options: [string, string][], active: string, onChange: (value: string) => void): HTMLElement {
  const group = el('div', 'pills');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const [value, text] of options) {
    const b = el('button', `pill${value === active ? ' active' : ''}`, text);
    b.type = 'button';
    b.addEventListener('click', () => {
      for (const other of group.children) other.classList.toggle('active', other === b);
      onChange(value);
    });
    group.append(b);
  }
  return group;
}

export function searchBox(placeholder: string): { node: HTMLElement; input: HTMLInputElement } {
  const node = el('label', 'search');
  const input = el('input');
  input.type = 'search';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  node.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
  node.prepend(input);
  return { node, input };
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// Latest League client state, kept here so any view can read it; app.ts feeds it.
let lcu: LcuState | undefined;
export const lcuNow = () => lcu;
export function setLcu(s: LcuState) {
  lcu = s;
  document.dispatchEvent(new CustomEvent<LcuState>('lcu', { detail: s }));
}

const PART: [keyof ApplyResult, string][] = [['runes', 'الرونز'], ['items', 'الأيتمات'], ['spells', 'تعاويذ المستدعي']];
/** One line per written part: "✓ الرونز", or the reason it failed. Parts with nothing to write are left out. */
export function applyLines(r: ApplyResult): { ok: boolean; text: string }[] {
  return PART.flatMap(([k, label]) => (r[k] === 'none' ? [] : [{ ok: r[k] === 'ok', text: r[k] === 'ok' ? `✓ ${label}` : `✗ ${label}: ${r[k]}` }]));
}

let toastEl: HTMLElement | undefined;
let toastTimer: number | undefined;
/** A short notice at the bottom of the window (used when runes are applied automatically). */
export function toast(lines: string[]) {
  toastEl ??= document.body.appendChild(el('div', 'toast'));
  toastEl.replaceChildren(...lines.map((l) => el('div', '', l)));
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 6000);
}

/** Sets the entry-animation delay for the i-th element of a list (capped so long lists don't drag). */
export function stagger<T extends HTMLElement>(node: T, i: number, stepMs = 14): T {
  node.style.setProperty('--delay', `${Math.min(i, 40) * stepMs}ms`);
  return node;
}

// Hover card: one floating element for the whole app, filled from a WeakMap so any node can carry a description.
interface TipContent {
  x: Describable;
  tags?: () => HTMLElement[];
  className?: string;
  missing?: string;
}
const tips = new WeakMap<Element, TipContent>();
let tipEl: HTMLElement | undefined;
let tipTimer: number | undefined;
let tipFor: Element | undefined;

/** Shows a small description card when the pointer rests on `node`. */
export function withTooltip<T extends HTMLElement>(node: T, x: Describable, opts: Omit<TipContent, 'x'> = {}): T {
  tips.set(node, { x, ...opts });
  node.removeAttribute('title'); // the native tooltip would double up
  return node;
}

function findTip(target: EventTarget | null): [Element, TipContent] | undefined {
  for (let n = target instanceof Element ? target : null; n; n = n.parentElement) {
    const t = tips.get(n);
    if (t) return [n, t];
  }
  return undefined;
}

function placeTip(anchor: Element) {
  if (!tipEl) return;
  const a = anchor.getBoundingClientRect();
  // offsetWidth/Height: the real size (getBoundingClientRect would include the entry animation's scale-down);
  // clientWidth/Height: the window without its scrollbar.
  const t = { width: tipEl.offsetWidth, height: tipEl.offsetHeight };
  const { clientWidth: vw, clientHeight: vh } = document.documentElement;
  const gap = 10;
  let top = a.bottom + gap;
  if (top + t.height > vh - 8) top = Math.max(8, a.top - t.height - gap); // no room below: flip above
  const left = Math.min(Math.max(8, a.left + a.width / 2 - t.width / 2), vw - t.width - 8);
  tipEl.style.top = `${top}px`;
  tipEl.style.left = `${left}px`;
}

function showTip(anchor: Element, c: TipContent) {
  tipEl ??= document.body.appendChild(el('div', 'tooltip'));
  tipEl.className = `tooltip ${c.className ?? ''}`;
  const head = el('div', 'tip-head');
  const title = nameEl('strong', c.x);
  title.append(...(c.tags?.() ?? []));
  const other = el('div', 'en', otherName(c.x));
  other.dir = 'auto';
  const names = el('div');
  names.append(title, other);
  head.append(icon(c.x.iconUrl), names);
  const desc = el('div', 'tip-body');
  if (c.x.html) desc.innerHTML = c.x.html; // safe: produced by cleanText (escaped text, whitelisted tags only)
  else {
    desc.className = 'tip-body missing';
    desc.textContent = c.missing ?? 'لا يوجد وصف.';
  }
  tipEl.replaceChildren(...[head, rankTable(c.x.ranks), desc].filter((n): n is HTMLElement => n !== null));
  placeTip(anchor);
  tipEl.classList.add('show');
}

export function hideTip() {
  clearTimeout(tipTimer);
  tipFor = undefined;
  tipEl?.classList.remove('show');
}

document.addEventListener('pointerover', (e) => {
  const hit = findTip(e.target);
  if (!hit) return;
  if (hit[0] === tipFor) return;
  clearTimeout(tipTimer);
  tipFor = hit[0];
  tipTimer = window.setTimeout(() => showTip(hit[0], hit[1]), 120); // short delay: no flicker while sweeping across icons
});
document.addEventListener('pointerout', (e) => {
  if (!tipFor) return;
  const into = (e as PointerEvent).relatedTarget;
  if (into instanceof Node && tipFor.contains(into)) return;
  hideTip();
});
addEventListener('scroll', hideTip, true);
addEventListener('hashchange', hideTip);
