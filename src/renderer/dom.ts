import type { ChampionPage, PageMode } from '../app/championPage.js';
import type { Position } from '../stats/opgg.js';
import type { AugmentsResult } from '../texts/augmentsLoader.js';
import type { ChampionListEntry } from '../texts/champions.js';

export type Reply<T> = T | { error: string };

declare global {
  interface Window {
    lolh: {
      getAugments(): Promise<Reply<AugmentsResult>>;
      listChampions(): Promise<Reply<ChampionListEntry[]>>;
      championPage(id: number, mode: PageMode, position: Position): Promise<Reply<ChampionPage>>;
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
      body.append(title, other, desc);
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
