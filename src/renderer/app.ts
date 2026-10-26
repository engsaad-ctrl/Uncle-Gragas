import type { AugmentText, Mode, Rarity } from '../texts/augments.js';
import type { AugmentsResult } from '../texts/augmentsLoader.js';
import { filterAugments } from './search.js';

type Reply = AugmentsResult | { error: string };

declare global {
  interface Window {
    lolh: { getAugments(): Promise<Reply> };
  }
}

const RARITY_LABEL: Record<Rarity, string> = { prismatic: 'موشوري', gold: 'ذهبي', silver: 'فضي', event: 'خاص' };
const SECTIONS: { rarity: Rarity; title: string }[] = [
  { rarity: 'prismatic', title: 'التعزيزات الموشورية' },
  { rarity: 'gold', title: 'التعزيزات الذهبية' },
  { rarity: 'silver', title: 'التعزيزات الفضية' },
  { rarity: 'event', title: 'تعزيزات خاصة' },
];
const MODE_LABEL: Record<Mode, string> = { arena: 'Arena', mayhem: 'Mayhem' };
const MISSING = 'لا يوجد وصف رسمي لهذا التعزيز في ملفات اللعبة الحالية.';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function icon(src: string): HTMLImageElement {
  const img = el('img');
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  return img;
}

function showDetail(panel: HTMLElement, a: AugmentText | undefined) {
  panel.hidden = !a;
  if (!a) return;
  panel.className = `panel detail r-${a.rarity}`;
  const title = el('h3', '', a.name);
  title.append(el('span', 'tag', RARITY_LABEL[a.rarity]), ...a.modes.map((m) => el('span', 'mode', MODE_LABEL[m])));
  const desc = el('p');
  if (a.described) desc.innerHTML = a.html; // safe: cleanText escapes text and emits only whitelisted tags
  else {
    desc.className = 'missing';
    desc.textContent = MISSING;
  }
  const body = el('div');
  body.append(title, el('div', 'en', a.enName), desc);
  panel.replaceChildren(icon(a.iconUrl), body);
}

async function main() {
  const status = byId('status');
  const list = byId('list');
  const detail = byId('detail');
  const query = byId<HTMLInputElement>('q');
  let rarity = 'all';
  let mode = 'all';
  let selected: AugmentText | undefined;

  const reply = await window.lolh.getAugments();
  if ('error' in reply) {
    status.textContent = `تعذّر تحميل البيانات: ${reply.error}`;
    return;
  }
  byId('patch').textContent = `باتش ${reply.version.split('.').slice(0, 2).join('.')}`;

  const render = () => {
    const shown = filterAugments(reply.augments, query.value, rarity, mode);
    if (!selected || !shown.includes(selected)) selected = query.value.trim() ? shown[0] : undefined;
    const sections = SECTIONS.flatMap(({ rarity: r, title }) => {
      const items = shown.filter((a) => a.rarity === r);
      if (!items.length) return [];
      const grid = el('div', 'grid');
      for (const a of items) {
        const chip = el('button', `chip r-${a.rarity}${a === selected ? ' selected' : ''}`);
        chip.type = 'button';
        chip.title = `${a.name} — ${a.enName}`;
        chip.append(icon(a.iconUrl), el('span', '', a.name));
        if (a.modes.length === 1) chip.append(el('small', 'mode', MODE_LABEL[a.modes[0]]));
        chip.addEventListener('click', () => {
          selected = a;
          render();
        });
        grid.append(chip);
      }
      const section = el('section', 'panel');
      section.append(el('h2', '', `${title} (${items.length})`), grid);
      return [section];
    });
    list.replaceChildren(...sections);
    showDetail(detail, selected);
    status.textContent =
      `${shown.length} من ${reply.augments.length} تعزيزاً` + (reply.stale ? ' · بيانات محفوظة (تعذّر التحديث)' : '');
  };

  query.addEventListener('input', render);
  const pillGroup = (id: string, set: (value: string) => void) => {
    const group = byId(id);
    group.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
      if (!btn) return;
      set(btn.dataset.value!);
      for (const b of group.querySelectorAll('button')) b.classList.toggle('active', b === btn);
      render();
    });
  };
  pillGroup('rarity', (v) => (rarity = v));
  pillGroup('mode', (v) => (mode = v));
  render();
  query.focus();
}

void main();
