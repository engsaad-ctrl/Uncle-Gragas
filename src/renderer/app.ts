import type { PageMode } from '../app/championPage.js';
import type { AppMode } from '../main/services.js';
import type { LanePosition, Position } from '../stats/opgg.js';
import { augmentsView } from './augmentsView.js';
import { championsView } from './championsView.js';
import { championView } from './championView.js';
import { byId, el, getAppMode, getNameLang, PAGE_MODE, pills, setAppMode, setNameLang } from './dom.js';
import { itemsView } from './itemsView.js';
import { tierListView } from './tierListView.js';
import { applyRandomTheme, nextTheme } from './theme.js';

applyRandomTheme();

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

// Settings panel (gear button at the bottom of the side menu).
const settings = byId('settings');
const settingsBtn = byId<HTMLButtonElement>('settings-btn');
const section = (title: string, ...body: HTMLElement[]) => {
  const s = el('section');
  s.append(el('h4', '', title), ...body);
  return s;
};
const bgButton = el('button', 'pill', 'تغيير الخلفية');
bgButton.type = 'button';
bgButton.addEventListener('click', () => nextTheme());
settings.append(
  section(
    'لغة أسماء الأيتمات والرونز والتعزيزات',
    pills('لغة الأسماء', [['en', 'English'], ['ar', 'عربي']], getNameLang(), (v) => {
      setNameLang(v === 'ar' ? 'ar' : 'en');
      route();
    }),
    el('p', 'hint', 'الأوصاف بالعربي دائماً.'),
  ),
  section('الخلفية', bgButton, el('p', 'hint', 'تتغير الخلفية تلقائياً مع كل تشغيل.')),
);
const setSettingsOpen = (open: boolean) => {
  settings.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
  settingsBtn.classList.toggle('active', open);
  byId('side').classList.toggle('pinned', open); // keep the rail expanded while settings are open
};
settingsBtn.addEventListener('click', () => setSettingsOpen(settings.hidden !== false)); // hidden may also be 'until-found'
document.addEventListener('click', (e) => {
  if (!settings.hidden && !settings.contains(e.target as Node) && !settingsBtn.contains(e.target as Node)) setSettingsOpen(false);
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && setSettingsOpen(false));
window.addEventListener('hashchange', route);
route();
