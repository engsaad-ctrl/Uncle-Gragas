// The over-the-game window: the picked champion's augments, best first for Mayhem, with a quick search.

import type { OverlayData } from '../main/services.js';
import { RARITY_LABEL } from './augmentsView.js';
import { byId, el, icon, isError, shownName } from './dom.js';
import { filterAugments } from './search.js';
import { applyRandomTheme } from './theme.js';

applyRandomTheme(); // colours only: the overlay hides the background art
const search = byId<HTMLInputElement>('ov-search');
const list = byId('ov-list');
let data: OverlayData | undefined;
let open: number | undefined;

function render() {
  if (!data) return;
  const shown = filterAugments(data.augments, search.value, 'all', 'all');
  list.replaceChildren(
    ...shown.slice(0, 60).map((a, i) => {
      const row = el('button', `ov-row r-${a.rarity}${open === a.id ? ' open' : ''}`);
      row.type = 'button';
      const name = el('div', 'ov-name');
      name.append(el('b', '', shownName(a)), el('small', '', RARITY_LABEL[a.rarity]));
      row.append(icon(a.iconUrl), name);
      if (data!.rated && a.performance !== undefined) row.append(el('span', 'ov-score', `#${i + 1} · ${a.performance.toFixed(0)}`));
      if (open === a.id) {
        const desc = el('div', 'ov-desc');
        if (a.html) desc.innerHTML = a.html; // safe: produced by cleanText (escaped text, whitelisted tags only)
        else desc.textContent = 'لا يوجد وصف.';
        row.append(desc);
      }
      row.addEventListener('click', () => ((open = open === a.id ? undefined : a.id), render()));
      return row;
    }),
  );
  if (!shown.length) list.replaceChildren(el('p', 'missing', 'لا يوجد تعزيز بهذا الاسم.'));
}

async function load() {
  const reply = await window.lolh.overlayData();
  if (isError(reply)) {
    list.replaceChildren(el('p', 'missing', `تعذّر التحميل: ${reply.error}`));
    return;
  }
  data = reply;
  const champ = byId<HTMLImageElement>('ov-champ');
  champ.hidden = !reply.champion;
  if (reply.champion) champ.src = reply.champion.portraitUrl;
  byId('ov-title').textContent = reply.champion ? `تعزيزات ${shownName(reply.champion)}` : 'كل التعزيزات';
  byId('ov-sub').textContent = reply.rated
    ? 'Mayhem · مرتبة حسب الأداء لهذا البطل'
    : reply.mode === 'arena'
      ? 'Arena · ابحث عن التعزيزات التي ظهرت لك'
      : 'اختر بطلاً في شاشة الاختيار ليظهر ترتيبه';
  render();
}

search.addEventListener('input', () => ((open = undefined), render()));
addEventListener('keydown', (e) => e.key === 'Escape' && void window.lolh.hideOverlay());
byId('ov-close').addEventListener('click', () => void window.lolh.hideOverlay());
window.lolh.onOverlayShow(() => {
  search.value = '';
  open = undefined;
  void load().then(() => search.focus());
});
void load();
