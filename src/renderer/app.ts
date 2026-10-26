import type { PageMode } from '../app/championPage.js';
import type { AppMode } from '../main/services.js';
import type { LanePosition, Position } from '../stats/opgg.js';
import { augmentsView } from './augmentsView.js';
import { championsView } from './championsView.js';
import { championView } from './championView.js';
import { byId, getAppMode, getNameLang, PAGE_MODE, pills, setAppMode, setNameLang } from './dom.js';
import { itemsView } from './itemsView.js';
import { tierListView } from './tierListView.js';

const PAGE_MODES = ['ranked', 'flex', 'aram', 'mayhem', 'arena', 'urf', 'nexus'];
const POSITIONS = ['top', 'jungle', 'mid', 'adc', 'support'];
const root = byId('view');
let renderId = 0;

/**
 * Routes: #/champions (default), #/champion/<id>[/<mode>[/<position>]], #/items, #/augments[/<arena|mayhem>],
 * #/tierlist[/<lane>]. The side-menu mode (normal/aram/mayhem/arena) is app-wide state, not part of the route.
 */
function route() {
  const token = ++renderId;
  const alive = () => token === renderId; // a newer route started: drop late results
  const [, view = 'champions', id, mode, position] = location.hash.split('/');
  const tab = view === 'champion' ? 'champions' : view;
  for (const a of byId('menu').querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === tab);
  for (const b of byId('modes').querySelectorAll('button')) b.classList.toggle('active', b.dataset.mode === getAppMode());
  window.scrollTo(0, 0);
  const app = getAppMode();
  if (view === 'augments') void augmentsView(root, alive, id === 'arena' || id === 'mayhem' ? id : app === 'arena' || app === 'mayhem' ? app : 'all');
  else if (view === 'items') void itemsView(root, alive);
  else if (view === 'tierlist') void tierListView(root, alive, (POSITIONS.includes(id) ? id : 'mid') as LanePosition);
  else if (view === 'champion' && Number(id) > 0) {
    void championView(root, alive, Number(id), (PAGE_MODES.includes(mode) ? mode : PAGE_MODE[app]) as PageMode, (POSITIONS.includes(position) ? position : 'mid') as Position);
  } else void championsView(root, alive);
}

byId('modes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
  if (!b) return;
  setAppMode(b.dataset.mode as AppMode);
  const [, view, id, , position] = location.hash.split('/');
  // On a champion page, switch its build to the new mode; on augments, drop any explicit filter.
  const next =
    view === 'champion' && id ? `#/champion/${id}/${PAGE_MODE[getAppMode()]}/${position ?? 'mid'}` : view === 'augments' ? '#/augments' : location.hash;
  if (next === location.hash) route(); // same address: hashchange will not fire
  else location.hash = next;
});

byId('lang').replaceWith(
  pills('لغة الأسماء', [['en', 'الأسماء: English'], ['ar', 'الأسماء: عربي']], getNameLang(), (v) => {
    setNameLang(v === 'ar' ? 'ar' : 'en');
    route();
  }),
);
window.addEventListener('hashchange', route);
route();
