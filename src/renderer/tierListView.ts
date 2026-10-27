import type { TierRow } from '../app/tierList.js';
import type { AppMode } from '../main/services.js';
import type { LanePosition } from '../stats/opgg.js';
import { el, getAppMode, getNameLang, icon, isError, MODE_TITLE, TIER_LETTER, nameEl, PAGE_MODE, pct, pills, shownName, stagger } from './dom.js';
import { timeAgo } from './format.js';
import { normalizeArabic } from './search.js';

type Lane = LanePosition | 'all';
/** "S+" reads left to right even in Arabic text. */
const ltr = <T extends HTMLElement>(n: T) => ((n.dir = 'ltr'), n);
const LANES: [Lane, string][] = [['all', 'كل المسارات'], ['top', 'Top'], ['jungle', 'Jungle'], ['mid', 'Mid'], ['adc', 'ADC'], ['support', 'Support']];
// The client's own position icons.
const LANE_ICON: Record<LanePosition, string> = { top: 'top', jungle: 'jungle', mid: 'middle', adc: 'bottom', support: 'utility' };
const laneIcon = (l: LanePosition) => `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/svg/position-${LANE_ICON[l]}.svg`;
/** Win rate colour, as on u.gg: the further above 50%, the warmer. */
const winClass = (w: number) => (w >= 0.54 ? 'wr-top' : w >= 0.52 ? 'wr-great' : w >= 0.505 ? 'wr-good' : w < 0.48 ? 'wr-low' : '');

export async function tierListView(root: HTMLElement, alive: () => boolean, lane: Lane) {
  const mode = getAppMode();
  const aram = mode === 'aram' || mode === 'mayhem'; // the same games: no lanes, one list
  const head = el('div', 'view-head');
  const title = el('div', 'title');
  title.append(el('h1', '', aram || mode === 'arena' ? `Tier List · ${MODE_TITLE[mode]}` : `Tier List · ${LANES.find(([v]) => v === lane)![1]}`));
  head.append(title);
  const info = el('div', 'tier-info');
  head.append(info);

  // Mode tabs (one app-wide mode, same switch as the side menu) and the role filter, like u.gg's header.
  const tabs = el('nav', 'tabs tier-tabs');
  for (const m of Object.keys(MODE_TITLE) as AppMode[]) {
    const a = el('a', m === mode ? 'active' : '', MODE_TITLE[m]);
    a.href = location.hash;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelector<HTMLButtonElement>(`#modes button[data-mode="${m}"]`)?.click();
    });
    tabs.append(a);
  }
  head.append(tabs);
  if (mode === 'arena') {
    head.append(el('p', 'panel note', 'لا تتوفر Tier List لطور Arena: لا توجد إحصائيات لكل بطل فيه.'));
    root.replaceChildren(head);
    return;
  }
  if (!aram) {
    const roles = el('nav', 'role-filter');
    roles.setAttribute('aria-label', 'المسار');
    for (const [v, label] of LANES) {
      const a = el('a', v === lane ? 'active' : '');
      a.href = `#/tierlist/${v}`;
      a.title = label;
      a.setAttribute('aria-label', label);
      if (v === 'all') a.append(el('span', '', 'الكل'));
      else a.append(icon(laneIcon(v)));
      roles.append(a);
    }
    head.append(roles);
  }
  // Search and view, like u.gg's filter row: bands by tier (its default for ARAM) or the classic table.
  const controls = el('div', 'tier-controls');
  const search = el('input', 'tier-search') as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'ابحث عن بطل…';
  let view: 'bands' | 'table' = aram ? 'bands' : 'table';
  controls.append(search, pills('العرض', [['bands', 'حسب المستوى'], ['table', 'جدول']], view, (v) => {
    view = v === 'bands' ? 'bands' : 'table';
    draw();
  }));
  head.append(controls);
  const status = el('p', 'status loading', aram ? 'جاري تجميع الترتيب… أول مرة في اليوم قد تستغرق دقيقة.' : 'جاري التحميل…');
  const table = el('div', 'tier-table');
  root.replaceChildren(head, status, table);
  let draw = () => {};
  search.addEventListener('input', () => draw());

  const reply = await window.lolh.tierList(lane, mode);
  if (!alive()) return;
  status.classList.remove('loading');
  if (isError(reply)) {
    status.textContent = `تعذّر تحميل الترتيب: ${reply.error}`;
    return;
  }
  status.remove();
  const total = reply.list.reduce((n, r) => n + r.games, 0);
  info.replaceChildren(
    el('span', '', aram ? MODE_TITLE[mode] : 'Ranked Solo · كل الرتب'),
    el('span', '', `آخر تحديث: ${timeAgo(reply.fetchedAt)}${reply.stale ? ' (محفوظ، تعذّر التحديث)' : ''}`),
    el('span', '', `${reply.list.length} صف · ${total.toLocaleString('en')} مباراة`),
  );

  // Click a column to sort by it; again to reverse. Starts by rank, best first.
  type Col = { label: string; width: string; value: (r: TierRow) => number | string; desc?: boolean; cell: (r: TierRow) => HTMLElement };
  const cols: Col[] = [
    { label: 'الترتيب', width: '64px', value: (r) => r.rank, cell: (r) => {
      const c = el('span', 'rank-n', String(r.rank));
      if (r.change) c.append(el('small', r.change > 0 ? 'up' : 'down', `${r.change > 0 ? '▲' : '▼'}${Math.abs(r.change)}`));
      return c;
    } },
    ...(!aram && lane === 'all' ? [{ label: 'المسار', width: '56px', value: (r: TierRow) => r.lane ?? '', cell: (r: TierRow) => {
      const c = el('span', 'role');
      if (r.lane) c.append(icon(laneIcon(r.lane)));
      return c;
    } }] : []),
    { label: 'البطل', width: 'minmax(170px, 2fr)', value: (r) => shownName(r), cell: (r) => {
      const c = el('span', 'who');
      if (r.portraitUrl) c.append(icon(r.portraitUrl));
      c.append(nameEl('span', r));
      return c;
    } },
    { label: 'المستوى', width: '70px', value: (r) => r.tier, cell: (r) => ltr(el('span', `tier-letter t${r.tier}`, TIER_LETTER[r.tier] ?? String(r.tier))) },
    { label: 'نسبة الفوز', width: '1fr', value: (r) => r.winRate, desc: true, cell: (r) => el('span', winClass(r.winRate), pct(r.winRate)) },
    { label: 'نسبة الاختيار', width: '1fr', value: (r) => r.pickRate, desc: true, cell: (r) => el('span', '', pct(r.pickRate)) },
    // ARAM has no bans.
    ...(aram ? [] : [{ label: 'نسبة الحظر', width: '1fr', value: (r: TierRow) => r.banRate, desc: true, cell: (r: TierRow) => el('span', '', pct(r.banRate)) }]),
    { label: 'المباريات', width: '1fr', value: (r) => r.games, desc: true, cell: (r) => el('span', 'muted', r.games.toLocaleString('en')) },
  ];
  table.style.setProperty('--cols', cols.map((c) => c.width).join(' '));
  let sortBy = 0;
  let asc = true;
  const link = (r: TierRow) => (aram ? `#/champion/${r.id}/${PAGE_MODE[mode]}/mid` : `#/champion/${r.id}/ranked/${r.lane ?? lane}`);
  const bands = (rows: TierRow[]) => {
    const tiers = [...new Set(rows.map((r) => r.tier))].sort((a, b) => a - b);
    table.replaceChildren(...tiers.map((t) => {
      const band = el('section', `tier-band t${t}`);
      band.append(ltr(el('h3', '', TIER_LETTER[t] ?? String(t))));
      const grid = el('div', 'band-grid');
      rows.filter((r) => r.tier === t).forEach((r, i) => {
        const a = stagger(el(r.id ? 'a' : 'div', 'band-champ'), i, 8);
        if (r.id) (a as HTMLAnchorElement).href = link(r);
        if (r.portraitUrl) a.append(icon(r.portraitUrl));
        const txt = el('span');
        txt.append(nameEl('b', r), el('small', winClass(r.winRate), `${pct(r.winRate)} فوز`));
        if (r.lane) a.append(withLane(r.lane));
        a.append(txt);
        grid.append(a);
      });
      band.append(grid);
      return band;
    }));
  };
  const withLane = (l: LanePosition) => icon(laneIcon(l), 'band-lane');
  draw = () => {
    const q = normalizeArabic(search.value.trim().toLowerCase());
    const shown = q ? reply.list.filter((r) => normalizeArabic(`${r.enName} ${shownName(r)} ${r.name}`.toLowerCase()).includes(q)) : reply.list;
    table.classList.toggle('as-bands', view === 'bands');
    if (view === 'bands') return bands([...shown].sort((x, y) => x.tier - y.tier || y.winRate - x.winRate));
    const key = cols[sortBy].value;
    const rows = [...shown].sort((x, y) => {
      const [a, b] = [key(x), key(y)];
      const d = typeof a === 'string' ? a.localeCompare(String(b), getNameLang()) : a - (b as number);
      return asc ? d : -d;
    });
    const header = el('div', 'tier-row tier-head');
    cols.forEach((c, i) => {
      const h = el('button', `sort${i === sortBy ? ` on ${asc ? 'asc' : 'desc'}` : ''}`, c.label);
      h.type = 'button';
      h.addEventListener('click', () => {
        asc = i === sortBy ? !asc : !c.desc;
        sortBy = i;
        draw();
      });
      header.append(h);
    });
    table.replaceChildren(
      header,
      ...rows.map((r, i) => {
        const row = stagger(el(r.id ? 'a' : 'div', 'tier-row'), i, 10);
        if (r.id) (row as HTMLAnchorElement).href = link(r);
        cols.forEach((c, ci) => {
          const cell = c.cell(r);
          if (ci === sortBy) cell.classList.add('on'); // the sorted column is lit, as on u.gg
          row.append(cell);
        });
        return row;
      }),
    );
  };
  draw();
}
