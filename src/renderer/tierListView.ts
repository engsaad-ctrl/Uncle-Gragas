import type { TierRow } from '../app/tierList.js';
import type { LanePosition } from '../stats/opgg.js';
import { el, getAppMode, icon, isError, MODE_TITLE, nameEl, PAGE_MODE, pct, pills, stagger } from './dom.js';

const LANES: [LanePosition, string][] = [['top', 'Top'], ['jungle', 'Jungle'], ['mid', 'Mid'], ['adc', 'ADC'], ['support', 'Support']];
const TIER_LABEL: Record<number, string> = { 1: 'OP', 2: '1', 3: '2', 4: '3', 5: '4' };

export async function tierListView(root: HTMLElement, alive: () => boolean, lane: LanePosition) {
  const mode = getAppMode();
  const aram = mode === 'aram' || mode === 'mayhem'; // the same games: no lanes, one list
  const head = el('div', 'view-head');
  const title = el('div', 'title');
  title.append(el('h1', '', 'Tier List'), el('span', 'pill static', aram ? `${MODE_TITLE[mode]} · كل الرتب` : 'Ranked · كل الرتب'));
  head.append(title);
  if (mode === 'arena') {
    head.append(el('p', 'panel note', 'لا تتوفر Tier List لطور Arena: لا توجد إحصائيات لكل بطل فيه.'));
    root.replaceChildren(head);
    return;
  }
  head.append(el('p', 'sub', aram
    ? `ترتيب الأبطال حسب قوتهم في ${MODE_TITLE[mode]} في الباتش الحالي${mode === 'mayhem' ? ' (من مباريات ARAM، فهو نفس البناء)' : ''}. اضغط على بطل لفتح بنائه.`
    : 'ترتيب الأبطال حسب قوتهم في الباتش الحالي. اضغط على بطل لفتح بنائه في هذا المسار.'));
  if (!aram) {
    const filters = el('nav', 'filters');
    filters.append(pills('المسار', LANES, lane, (v) => (location.hash = `#/tierlist/${v}`)));
    head.append(filters);
  }
  const status = el('p', 'status loading', aram ? 'جاري تجميع الترتيب… أول مرة في اليوم قد تستغرق دقيقة.' : 'جاري التحميل…');
  const table = el('div', `tier-table${aram ? ' no-ban' : ''}`);
  root.replaceChildren(head, status, table);

  const reply = await window.lolh.tierList(lane, mode);
  if (!alive()) return;
  status.classList.remove('loading');
  if (isError(reply)) {
    status.textContent = `تعذّر تحميل الترتيب: ${reply.error}`;
    return;
  }
  const header = el('div', 'tier-row tier-head');
  // ARAM has no bans.
  for (const h of ['#', 'البطل', 'المستوى', 'نسبة الفوز', 'نسبة الاختيار', ...(aram ? [] : ['نسبة الحظر']), 'المباريات']) header.append(el('span', '', h));
  table.replaceChildren(
    header,
    ...reply.list.map((r: TierRow, i) => {
      const row = stagger(el(r.id ? 'a' : 'div', `tier-row t${r.tier}`), i, 10);
      if (r.id) (row as HTMLAnchorElement).href = aram ? `#/champion/${r.id}/${PAGE_MODE[mode]}/mid` : `#/champion/${r.id}/ranked/${lane}`;
      const rank = el('span', 'rank', String(r.rank));
      if (r.change) rank.append(el('small', r.change > 0 ? 'up' : 'down', `${r.change > 0 ? '▲' : '▼'}${Math.abs(r.change)}`));
      const champ = el('span', 'who');
      if (r.portraitUrl) champ.append(icon(r.portraitUrl));
      champ.append(nameEl('span', r));
      row.append(rank, champ, el('span', `tier-badge t${r.tier}`, TIER_LABEL[r.tier] ?? String(r.tier)),
        el('span', '', pct(r.winRate)), el('span', '', pct(r.pickRate)), ...(aram ? [] : [el('span', '', pct(r.banRate))]), el('span', 'muted', r.games.toLocaleString('en')));
      return row;
    }),
  );
  status.textContent = (aram ? `${reply.list.length} بطلاً` : `${reply.list.length} بطلاً في مسار ${LANES.find(([v]) => v === lane)![1]}`) + (reply.stale ? ' · بيانات محفوظة (تعذّر التحديث)' : '');
}
