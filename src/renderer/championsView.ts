import type { LcuState } from '../lcu/state.js';
import type { ChampionListEntry } from '../texts/champions.js';
import { champLink, el, getAppMode, icon, isError, lcuNow, MODE_TITLE, nameEl, PAGE_MODE, pageSignal, pct, searchBox, shownName, getNameLang, stagger } from './dom.js';
import { normalizeArabic } from './search.js';

let cached: ChampionListEntry[] | undefined;

export async function championsView(root: HTMLElement, alive: () => boolean) {
  const head = el('div', 'view-head');
  const title = el('div', 'title');
  title.append(el('h1', '', 'الأبطال'), el('span', 'pill static', `بناءات ${MODE_TITLE[getAppMode()]}`));
  const search = searchBox('ابحث عن بطل');
  const filters = el('nav', 'filters');
  filters.append(search.node);
  head.append(title, el('p', 'sub', 'اختر بطلاً لترى بناءه وقدراته وأفضل تعزيزاته.'), filters);
  const status = el('p', 'status loading', 'جاري تحميل قائمة الأبطال…');
  const grid = el('div', 'champ-grid');
  root.replaceChildren(head, suggestionsPanel(alive), status, grid);

  if (!cached) {
    const reply = await window.lolh.listChampions();
    if (!alive()) return;
    if (isError(reply)) {
      status.classList.remove('loading');
      status.textContent = `تعذّر تحميل قائمة الأبطال: ${reply.error}`;
      return;
    }
    cached = reply;
  }
  status.classList.remove('loading');
  const all = cached;

  const render = () => {
    const q = normalizeArabic(search.input.value);
    const shown = all
      .filter((c) => !q || normalizeArabic(c.name).includes(q) || normalizeArabic(c.enName).includes(q))
      .sort((a, b) => shownName(a).localeCompare(shownName(b), getNameLang()));
    grid.replaceChildren(
      ...shown.map((c, i) => {
        const a = stagger(el('a', 'champ'), i);
        a.href = `#/champion/${c.id}/${PAGE_MODE[getAppMode()]}`;
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

const LANE_TITLE: Record<string, string> = { top: 'Top', jungle: 'Jungle', mid: 'Mid', adc: 'ADC', support: 'Support' };

/**
 * Champ select (Summoner's Rift with an assigned lane): answers to the enemy picks shown so far, else the lane's
 * strongest picks. Refreshes when the enemy or taken picks change; hidden the rest of the time.
 */
function suggestionsPanel(alive: () => boolean): HTMLElement {
  const panel = el('section', 'panel suggest');
  panel.hidden = true;
  let shownKey = '';
  const update = async (s: LcuState | undefined) => {
    const on = s?.phase === 'ChampSelect' && s.mode === 'normal' && s.position !== null;
    if (!on || !s?.position) {
      panel.hidden = true;
      shownKey = '';
      return;
    }
    const position = s.position;
    const taken = [...s.allies, ...(s.championId ? [s.championId] : [])];
    const key = `${position}|${s.enemies.join(',')}|${taken.join(',')}`;
    if (key === shownKey) return;
    shownKey = key;
    panel.hidden = false;
    const title = el('h2', '', s.enemies.length ? `اقتراحات لمسار ${LANE_TITLE[position]} ضد الفريق الخصم` : `أقوى أبطال مسار ${LANE_TITLE[position]} (لم يظهر اختيار للخصم بعد)`);
    panel.replaceChildren(title, el('p', 'status loading', 'جاري حساب الاقتراحات…'));
    const reply = await window.lolh.suggestions(position, s.enemies, taken);
    if (!alive() || key !== shownKey) return; // a newer update or route replaced this one
    if (isError(reply) || !reply.length) {
      panel.replaceChildren(title, el('p', 'missing', isError(reply) ? `تعذّر حساب الاقتراحات: ${reply.error}` : 'لا توجد بيانات كافية للاقتراح.'));
      return;
    }
    const row = el('div', 'champ-row');
    row.append(
      ...reply.map((x, i) => {
        const caption = x.vs.length ? x.vs.map((v) => `${pct(v.winRate)} ضد ${shownName(v.enemy)}`).join(' · ') : `Tier ${x.tier} · ${pct(x.winRate ?? 0)}`;
        return stagger(champLink(x.champion, `#/champion/${x.champion.id}/${PAGE_MODE.normal}/${position}`, caption), i);
      }),
    );
    const hint = reply[0].vs.length
      ? 'أولاً من يتفوق على الخصوم الظاهرين (نسبة فوزه في المسار ضد كل منهم)، ثم أقوى أبطال المسار حسب Tier List.'
      : 'حسب ترتيب Tier List للمسار.';
    panel.replaceChildren(title, row, el('p', 'hint', hint));
  };
  void update(lcuNow());
  const onLcu = (e: Event) => (panel.isConnected ? void update((e as CustomEvent<LcuState>).detail) : document.removeEventListener('lcu', onLcu));
  document.addEventListener('lcu', onLcu, { signal: pageSignal() });
  return panel;
}
