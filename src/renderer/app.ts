import type { PageMode } from '../app/championPage.js';
import type { Position } from '../stats/opgg.js';
import { augmentsView } from './augmentsView.js';
import { championsView } from './championsView.js';
import { championView } from './championView.js';
import { byId, getNameLang, pills, setNameLang } from './dom.js';

const MODES = ['ranked', 'aram', 'mayhem'];
const POSITIONS = ['top', 'jungle', 'mid', 'adc', 'support'];
const root = byId('view');
let renderId = 0;

/** Routes: #/champions (default), #/champion/<id>[/<mode>[/<position>]], #/augments */
function route() {
  const token = ++renderId;
  const alive = () => token === renderId; // a newer route started: drop late results
  const [, view, id, mode, position] = location.hash.split('/');
  for (const a of byId('tabs').querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === (view === 'augments' ? 'augments' : 'champions'));
  window.scrollTo(0, 0);
  if (view === 'augments') void augmentsView(root, alive);
  else if (view === 'champion' && Number(id) > 0) {
    void championView(
      root,
      alive,
      Number(id),
      (MODES.includes(mode) ? mode : 'ranked') as PageMode,
      (POSITIONS.includes(position) ? position : 'mid') as Position,
    );
  } else void championsView(root, alive);
}

byId('lang').replaceWith(
  pills('لغة الأسماء', [['en', 'الأسماء: English'], ['ar', 'الأسماء: عربي']], getNameLang(), (v) => {
    setNameLang(v === 'ar' ? 'ar' : 'en');
    route();
  }),
);
window.addEventListener('hashchange', route);
route();
