import type { ItemEntry, ItemGroup } from '../app/itemList.js';
import type { ItemClass } from '../texts/items.js';
import { withTooltip, detailPanel, el, getAppMode, getNameLang, icon, isError, MODE_TITLE, nameEl, otherName, searchBox, shownName, stagger } from './dom.js';
import { normalizeArabic } from './search.js';

const GROUPS: [ItemGroup, string][] = [
  ['legendary', 'الأيتمات الأسطورية'],
  ['epic', 'الأيتمات المتوسطة'],
  ['basic', 'الأيتمات الأساسية'],
  ['boots', 'الأحذية'],
  ['starter', 'أيتمات البداية'],
  ['consumable', 'المستهلكات والحُلي'],
];
// The in-game shop's class filters, with the game's own Arabic names and the client's class icons.
const CLASSES: [ItemClass, string][] = [
  ['fighter', 'المقاتل'], ['marksman', 'القناص'], ['assassin', 'القاتل'], ['mage', 'الساحر'], ['tank', 'تانك'], ['support', 'الدعم'],
];
const classIcon = (c: ItemClass) => `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-champ-select/global/default/class-icon-${c}.png`;

const MAP_NAME = { normal: "Summoner's Rift", aram: 'Howling Abyss', mayhem: 'Howling Abyss', arena: 'Arena' } as const;

const goldTag = (gold: number) => el('span', 'tag gold', `${gold.toLocaleString('en')} ذهب`);

export async function itemsView(root: HTMLElement, alive: () => boolean) {
  const mode = getAppMode();
  const head = el('div', 'view-head');
  const title = el('div', 'title');
  title.append(el('h1', '', 'الأيتمات'), el('span', 'pill static', `${MODE_TITLE[mode]} · ${MAP_NAME[mode]}`));
  const search = searchBox('ابحث عن أيتم');
  const filters = el('nav', 'filters');
  filters.append(search.node);
  head.append(title, el('p', 'sub', 'كل أيتم باسمه في اللعبة ووصفه الرسمي بالعربي. غيّر الطور من القائمة الجانبية.'), filters);
  const status = el('p', 'status loading', 'جاري تحميل أيتمات هذا الطور…');
  const detail = detailPanel();
  const list = el('div', 'list');
  root.replaceChildren(head, detail.node, status, list);

  const reply = await window.lolh.listItems(mode);
  if (!alive()) return;
  status.classList.remove('loading');
  if (isError(reply)) {
    status.textContent = `تعذّر تحميل الأيتمات: ${reply.error}`;
    return;
  }
  let selected: ItemEntry | undefined;
  let only: ItemClass | 'all' = 'all';
  // Class filter bar, only when the game files gave the classes (else every item would vanish).
  if (reply.list.some((i) => i.classes.length)) {
    const bar = el('div', 'pills class-pills');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'فئة الأيتم');
    for (const [value, label] of [['all', 'الكل'], ...CLASSES] as [ItemClass | 'all', string][]) {
      const b = el('button', `pill${value === only ? ' active' : ''}`);
      b.type = 'button';
      if (value !== 'all') b.append(icon(classIcon(value), 'class-ico'));
      b.append(label);
      b.addEventListener('click', () => {
        only = value;
        for (const other of bar.children) other.classList.toggle('active', other === b);
        render();
      });
      bar.append(b);
    }
    filters.prepend(bar);
  }
  const render = () => {
    const q = normalizeArabic(search.input.value);
    const shown = reply.list
      .filter((i) => only === 'all' || i.classes.includes(only))
      .filter((i) => !q || normalizeArabic(i.name).includes(q) || normalizeArabic(i.enName).includes(q))
      .sort((a, b) => shownName(a).localeCompare(shownName(b), getNameLang()));
    if (selected && !shown.includes(selected)) selected = undefined;
    if (!selected && q) selected = shown[0];
    list.replaceChildren(
      ...GROUPS.flatMap(([group, label]) => {
        const items = shown.filter((i) => i.group === group);
        if (!items.length) return [];
        const grid = el('div', 'grid items-grid');
        grid.append(
          ...items.map((it, n) => {
            const chip = stagger(el('button', `chip item${it === selected ? ' selected' : ''}`), n);
            chip.type = 'button';
            chip.title = `${shownName(it)} — ${otherName(it)}`;
            chip.append(icon(it.iconUrl), nameEl('span', it), el('small', 'gold', it.gold.toLocaleString('en')));
            chip.addEventListener('click', () => ((selected = it), render()));
            return withTooltip(chip, it, { tags: () => [goldTag(it.gold)] });
          }),
        );
        const section = el('section', 'panel');
        section.append(el('h2', '', `${label} (${items.length})`), grid);
        return [section];
      }),
    );
    detail.show(selected, { tags: selected ? [goldTag(selected.gold)] : [] });
    status.textContent = `${shown.length} من ${reply.list.length} أيتماً` + (reply.stale ? ' · بيانات محفوظة (تعذّر التحديث)' : '');
  };
  search.input.addEventListener('input', render);
  render();
  search.input.focus();
}
