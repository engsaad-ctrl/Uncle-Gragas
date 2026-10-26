import type { PageMode } from '../app/championPage.js';
import type { LcuState } from '../lcu/state.js';
import type { AppMode } from '../main/services.js';
import type { LanePosition, Position } from '../stats/opgg.js';
import { augmentsView } from './augmentsView.js';
import { championsView } from './championsView.js';
import { championView } from './championView.js';
import { byId, el, getAppMode, getNameLang, isError, MODE_TITLE, PAGE_MODE, pills, setAppMode, setNameLang } from './dom.js';
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
// Auto-open the champion page during champ select (on by default).
let autoOpen = true;
try {
  autoOpen = localStorage.getItem('autoOpen') !== 'off';
} catch {
  // storage unavailable: keep the default
}
const exportButton = el('button', 'pill', 'تصدير التشخيص');
exportButton.type = 'button';
const exportNote = el('p', 'hint', 'يحفظ ملفاً بردود عميل اللعبة بدون اسمك أو معرّفات حسابك، لترسله عند وجود مشكلة.');
exportButton.addEventListener('click', async () => {
  const r = await window.lolh.exportDiagnostics();
  if (r.saved) exportNote.textContent = `حُفظ في: ${r.saved}`;
});
settings.append(
  section(
    'فتح صفحة البطل تلقائياً في شاشة الاختيار',
    pills('الفتح التلقائي', [['on', 'مفعّل'], ['off', 'معطّل']], autoOpen ? 'on' : 'off', (v) => {
      autoOpen = v === 'on';
      try {
        localStorage.setItem('autoOpen', v);
      } catch {
        // not remembered this time; harmless
      }
    }),
  ),
  section('التشخيص', exportButton, exportNote),
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
// League client status + auto-open.
const PHASE_TEXT: Record<string, string> = {
  Disconnected: 'غير متصل باللعبة', None: 'متصل باللعبة', Lobby: 'في اللوبي', Matchmaking: 'يبحث عن مباراة',
  ReadyCheck: 'تم إيجاد مباراة', ChampSelect: 'اختيار الأبطال', InProgress: 'في مباراة', EndOfGame: 'نهاية المباراة',
};
let championNames: Map<number, { name: string; enName: string }> | undefined;
let lastAutoKey = '';
async function onLcu(state: LcuState) {
  const status = byId('lcu-status');
  status.classList.toggle('on', state.phase !== 'Disconnected');
  status.classList.toggle('live', state.phase === 'ChampSelect' || state.phase === 'InProgress');
  let text = PHASE_TEXT[state.phase] ?? 'متصل باللعبة';
  if (state.championId) {
    if (!championNames) {
      const list = await window.lolh.listChampions();
      if (!isError(list)) championNames = new Map(list.map((c) => [c.id, c]));
    }
    const c = championNames?.get(state.championId);
    if (c) text += ` · ${getNameLang() === 'ar' ? c.name : c.enName}`;
  }
  if (state.mode) text += ` · ${MODE_TITLE[state.mode]}`;
  status.querySelector('span')!.textContent = text;

  // Open the page once per (champion, mode, lane) so the user can still browse elsewhere.
  if (state.phase !== 'ChampSelect' || !state.championId || !autoOpen) return;
  const key = `${state.championId}/${state.mode}/${state.position}`;
  if (key === lastAutoKey) return;
  lastAutoKey = key;
  if (state.mode && state.mode !== getAppMode()) setAppMode(state.mode);
  const target = `#/champion/${state.championId}/${PAGE_MODE[getAppMode()]}/${state.position ?? 'mid'}`;
  if (location.hash === target) route();
  else location.hash = target;
}
window.lolh.onLcuState((s) => void onLcu(s));
void window.lolh.lcuState().then(onLcu);

window.addEventListener('hashchange', route);
route();
