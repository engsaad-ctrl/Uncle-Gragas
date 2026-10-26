import type { AugmentText, Mode, Rarity } from '../texts/augments.js';
import { detailPanel, el, icon, isError, nameEl, otherName, pills, searchBox, shownName, getNameLang, stagger } from './dom.js';
import { filterAugments } from './search.js';

export const RARITY_LABEL: Record<Rarity, string> = { prismatic: 'موشوري', gold: 'ذهبي', silver: 'فضي', event: 'خاص' };
export const MODE_LABEL: Record<Mode, string> = { arena: 'Arena', mayhem: 'Mayhem' };
export const AUGMENT_MISSING = 'لا يوجد وصف رسمي لهذا التعزيز في ملفات اللعبة الحالية.';
const SECTIONS: { rarity: Rarity; title: string }[] = [
  { rarity: 'prismatic', title: 'التعزيزات الموشورية' },
  { rarity: 'gold', title: 'التعزيزات الذهبية' },
  { rarity: 'silver', title: 'التعزيزات الفضية' },
  { rarity: 'event', title: 'تعزيزات خاصة' },
];

export const augmentTags = (a: AugmentText) => [el('span', 'tag', RARITY_LABEL[a.rarity]), ...a.modes.map((m) => el('span', 'mode', MODE_LABEL[m]))];

export function augmentChip(a: AugmentText, selected: boolean, onPick: () => void, badge?: string): HTMLButtonElement {
  const chip = el('button', `chip r-${a.rarity}${selected ? ' selected' : ''}`);
  chip.type = 'button';
  chip.title = `${shownName(a)} — ${otherName(a)}`;
  chip.append(icon(a.iconUrl), nameEl('span', a));
  if (badge) chip.append(el('small', 'mode', badge));
  else if (a.modes.length === 1) chip.append(el('small', 'mode', MODE_LABEL[a.modes[0]]));
  chip.addEventListener('click', onPick);
  return chip;
}

export async function augmentsView(root: HTMLElement, alive: () => boolean, initialMode = 'all') {
  const head = el('div', 'view-head');
  const title = el('div', 'title');
  const patch = el('span', 'pill static', 'باتش …');
  title.append(el('h1', '', 'تعزيزات Arena وMayhem'), patch);
  const sub = el('p', 'sub', 'ابحث عن أي تعزيز بالاسم الإنجليزي أو العربي، واضغط عليه لترى وصفه الرسمي بالعربي.');
  const filters = el('nav', 'filters');
  const search = searchBox('ابحث عن تعزيز');
  let rarity = 'all';
  let mode = initialMode;
  let selected: AugmentText | undefined;
  const status = el('p', 'status loading', 'جاري تحميل بيانات التعزيزات… أول مرة قد تستغرق دقيقة.');
  const list = el('div', 'list');
  const detail = detailPanel();
  head.append(title, sub, filters);
  root.replaceChildren(head, detail.node, status, list);

  const reply = await window.lolh.getAugments();
  if (!alive()) return;
  status.classList.remove('loading');
  if (isError(reply)) {
    status.textContent = `تعذّر تحميل البيانات: ${reply.error}`;
    return;
  }
  patch.textContent = `باتش ${reply.version.split('.').slice(0, 2).join('.')}`;

  const render = () => {
    const shown = filterAugments(reply.augments, search.input.value, rarity, mode).sort((x, y) =>
      shownName(x).localeCompare(shownName(y), getNameLang()),
    );
    if (!selected || !shown.includes(selected)) selected = search.input.value.trim() ? shown[0] : undefined;
    list.replaceChildren(
      ...SECTIONS.flatMap(({ rarity: r, title: t }) => {
        const items = shown.filter((a) => a.rarity === r);
        if (!items.length) return [];
        const grid = el('div', 'grid');
        grid.append(...items.map((a, i) => stagger(augmentChip(a, a === selected, () => ((selected = a), render())), i)));
        const section = el('section', 'panel');
        section.append(el('h2', '', `${t} (${items.length})`), grid);
        return [section];
      }),
    );
    detail.show(selected, { tags: selected ? augmentTags(selected) : [], className: selected ? `r-${selected.rarity}` : '', missing: AUGMENT_MISSING });
    status.textContent = `${shown.length} من ${reply.augments.length} تعزيزاً` + (reply.stale ? ' · بيانات محفوظة (تعذّر التحديث)' : '');
  };

  filters.append(
    el('span', 'filters-label', 'تصفية'),
    pills('الطور', [['all', 'كل الأطوار'], ['arena', 'Arena'], ['mayhem', 'Mayhem']], mode, (v) => ((mode = v), render())),
    pills('الندرة', [['all', 'كل الندرات'], ['prismatic', 'موشوري'], ['gold', 'ذهبي'], ['silver', 'فضي']], rarity, (v) => ((rarity = v), render())),
    search.node,
  );
  search.input.addEventListener('input', render);
  render();
  search.input.focus();
}
