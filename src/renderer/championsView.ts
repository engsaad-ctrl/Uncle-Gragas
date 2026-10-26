import type { ChampionListEntry } from '../texts/champions.js';
import { el, icon, isError, nameEl, searchBox, shownName, getNameLang } from './dom.js';
import { normalizeArabic } from './search.js';

let cached: ChampionListEntry[] | undefined;

export async function championsView(root: HTMLElement, alive: () => boolean) {
  const head = el('div', 'view-head');
  const title = el('div', 'title');
  title.append(el('h1', '', 'الأبطال'));
  const search = searchBox('ابحث عن بطل');
  const filters = el('nav', 'filters');
  filters.append(search.node);
  head.append(title, el('p', 'sub', 'اختر بطلاً لترى بناءه وقدراته وأفضل تعزيزاته.'), filters);
  const status = el('p', 'status', 'جاري تحميل قائمة الأبطال…');
  const grid = el('div', 'champ-grid');
  root.replaceChildren(head, status, grid);

  if (!cached) {
    const reply = await window.lolh.listChampions();
    if (!alive()) return;
    if (isError(reply)) {
      status.textContent = `تعذّر تحميل قائمة الأبطال: ${reply.error}`;
      return;
    }
    cached = reply;
  }
  const all = cached;

  const render = () => {
    const q = normalizeArabic(search.input.value);
    const shown = all
      .filter((c) => !q || normalizeArabic(c.name).includes(q) || normalizeArabic(c.enName).includes(q))
      .sort((a, b) => shownName(a).localeCompare(shownName(b), getNameLang()));
    grid.replaceChildren(
      ...shown.map((c) => {
        const a = el('a', 'champ');
        a.href = `#/champion/${c.id}`;
        a.append(icon(c.portraitUrl), nameEl('span', c));
        return a;
      }),
    );
    status.textContent = `${shown.length} من ${all.length} بطلاً`;
  };
  search.input.addEventListener('input', render);
  search.input.addEventListener('keydown', (e) => {
    const first = grid.querySelector<HTMLAnchorElement>('a.champ');
    if (e.key === 'Enter' && first) location.hash = first.hash;
  });
  render();
  search.input.focus();
}
