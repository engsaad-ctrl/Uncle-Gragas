import type { PageMode } from '../app/championPage.js';
import type { LcuState } from '../lcu/state.js';
import type { AppMode } from '../main/services.js';
import type { UpdateStatus } from '../main/updater.js';
import type { LanePosition, Position } from '../stats/opgg.js';
import { augmentsView } from './augmentsView.js';
import { championsView } from './championsView.js';
import { championView } from './championView.js';
import { applyLines, byId, el, icon, lcuNow, nextPage, getAppMode, getFlashKey, getNameLang, isError, MODE_TITLE, PAGE_MODE, pills, setAppMode, setFlashKey, setLcu, setNameLang, toast, type Reply } from './dom.js';
import { itemsView } from './itemsView.js';
import { profileView } from './profileView.js';
import { tierListView } from './tierListView.js';
import { applyRandomTheme, nextTheme } from './theme.js';

applyRandomTheme();

const PAGE_MODES = ['ranked', 'flex', 'aram', 'mayhem', 'arena', 'urf', 'nexus'];
const POSITIONS = ['top', 'jungle', 'mid', 'adc', 'support'];
const root = byId('view');
let renderId = 0;

/**
 * Routes: #/champions (default), #/champion/<id>[/<mode>[/<position>]], #/items, #/augments[/<arena|mayhem>],
 * #/tierlist[/<lane>], #/profile[/<puuid>]. The side-menu mode (normal/aram/mayhem/arena) is app-wide state, not part of the route.
 */
function route() {
  nextPage();
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
  else if (view === 'tierlist') void tierListView(root, alive, (POSITIONS.includes(id) ? id : 'all') as LanePosition | 'all');
  else if (view === 'profile') void profileView(root, alive, id || undefined);
  else if (view === 'champion' && Number(id) > 0) {
    void championView(root, alive, Number(id), (PAGE_MODES.includes(mode) ? mode : PAGE_MODE[app]) as PageMode, (POSITIONS.includes(position) ? position : 'auto') as Position | 'auto');
  } else void championsView(root, alive);
}

byId('modes').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]');
  if (!b) return;
  setAppMode(b.dataset.mode as AppMode);
  const [, view, id, , position] = location.hash.split('/');
  // On a champion page, switch its build to the new mode; on augments, drop any explicit filter.
  const next =
    view === 'champion' && id ? `#/champion/${id}/${PAGE_MODE[getAppMode()]}/${position ?? 'auto'}` : view === 'augments' ? '#/augments' : location.hash;
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
// Write runes/items into the client when a champion is locked in (on by default, like the stat-site apps).
let autoApply = true;
try {
  autoApply = localStorage.getItem('autoApply') !== 'off';
} catch {
  // storage unavailable: keep the default
}
// The F7 window over the game (on by default). The key is held by the app only while this is on.
let overlayOn = true;
try {
  overlayOn = localStorage.getItem('overlay') !== 'off';
} catch {
  // storage unavailable: keep the default
}
const OVERLAY_HINT = 'اضغط F7 أثناء المباراة لتظهر تعزيزات بطلك فوق اللعبة. يحتاج وضع العرض في اللعبة: Borderless (نافذة بلا حواف).';
const overlayNote = el('p', 'hint', OVERLAY_HINT);
const setOverlay = async (on: boolean) => {
  const ok = await window.lolh.setOverlayEnabled(on);
  overlayNote.textContent = on && !ok ? 'تعذّر حجز زر F7: برنامج آخر يستخدمه.' : OVERLAY_HINT;
};
void setOverlay(overlayOn);
// Exclusive fullscreen hides every window behind the game, F7's too: say so, and offer to switch the game to Borderless.
const modeNote = el('p', 'hint');
const borderlessButton = el('button', 'pill', 'حوّل اللعبة إلى Borderless');
borderlessButton.type = 'button';
borderlessButton.hidden = true;
const showMode = (r: Reply<number | null>) => {
  const fullscreen = !isError(r) && r === 0;
  borderlessButton.hidden = !fullscreen;
  modeNote.className = fullscreen ? 'hint bad' : 'hint';
  modeNote.textContent = isError(r)
    ? `تعذّر قراءة وضع العرض: ${r.error}`
    : r === null
      ? 'افتح عميل اللعبة ليتحقق البرنامج من وضع العرض.'
      : fullscreen
        ? 'اللعبة الآن في وضع ملء الشاشة الحصري، فلن تظهر نافذة F7 فوقها. اضغط الزر لتحويلها إلى Borderless، ويسري التغيير من المباراة القادمة.'
        : 'وضع العرض في اللعبة مناسب لنافذة F7.';
};
borderlessButton.addEventListener('click', async () => {
  borderlessButton.disabled = true;
  showMode(await window.lolh.setBorderless());
  borderlessButton.disabled = false;
});
const exportButton = el('button', 'pill', 'تصدير التشخيص');
exportButton.type = 'button';
const exportNote = el('p', 'hint', 'يحفظ ملفاً بردود عميل اللعبة بدون اسمك أو معرّفات حسابك، لترسله عند وجود مشكلة.');
exportButton.addEventListener('click', async () => {
  const r = await window.lolh.exportDiagnostics();
  if (isError(r)) exportNote.textContent = `تعذّر الحفظ: ${r.error}`;
  else if (r.saved) exportNote.textContent = `حُفظ في: ${r.saved}`;
});
// Gemini key for the Mayhem AI build: saved encrypted on this machine only, never shown again.
const aiKeyInput = el('input', 'key-input');
aiKeyInput.type = 'password';
aiKeyInput.placeholder = 'الصق مفتاح Gemini هنا';
aiKeyInput.autocomplete = 'off';
const aiKeySave = el('button', 'pill', 'حفظ');
aiKeySave.type = 'button';
const aiKeyNote = el('p', 'hint');
const showAiKey = async () => {
  aiKeyNote.textContent = (await window.lolh.hasAiKey()) ? 'المفتاح محفوظ ومشفّر على هذا الجهاز.' : 'لا يوجد مفتاح: زر الذكاء الاصطناعي في F7 لن يعمل.';
};
aiKeySave.addEventListener('click', async () => {
  const r = await window.lolh.setAiKey(aiKeyInput.value);
  aiKeyInput.value = '';
  if (isError(r)) aiKeyNote.textContent = r.error;
  else void showAiKey();
});
void showAiKey();
const updateButton = el('button', 'pill', 'تحقق من التحديثات');
updateButton.type = 'button';
const updateNote = el('p', 'hint');
const UPDATE_TEXT: Record<UpdateStatus['state'], string> = {
  idle: '',
  checking: 'جاري التحقق…',
  latest: 'لديك آخر نسخة.',
  unsupported: 'التحديث يعمل في النسخة المثبّتة فقط.',
  downloading: '',
  ready: '',
  error: '',
};
let updateReady = false;
const showUpdate = (s: UpdateStatus) => {
  updateReady = s.state === 'ready';
  updateSide.hidden = !updateReady;
  updateNote.textContent =
    s.state === 'downloading' ? `جاري تنزيل النسخة ${s.version}… ${s.percent}%`
    : s.state === 'ready' ? `النسخة ${s.version} جاهزة، وتُثبَّت عند إغلاق البرنامج.`
    : s.state === 'error' ? s.message
    : UPDATE_TEXT[s.state];
  updateButton.textContent = updateReady ? 'أعد التشغيل للتحديث' : 'تحقق من التحديثات';
  updateButton.disabled = s.state === 'checking' || s.state === 'downloading' || s.state === 'unsupported';
};
const updateSide = byId<HTMLButtonElement>('update-btn');
updateSide.addEventListener('click', () => void window.lolh.installUpdate());
updateButton.addEventListener('click', async () => {
  if (updateReady) return void window.lolh.installUpdate();
  showUpdate(await window.lolh.checkUpdate());
});
const versionNote = el('p', 'hint');
void window.lolh.updateStatus().then((r) => {
  versionNote.textContent = `الإصدار الحالي: ${r.version}`;
  showUpdate(r.status);
});
window.lolh.onUpdateStatus((s) => {
  showUpdate(s);
  if (s.state === 'ready') toast([`النسخة ${s.version} جاهزة: أعد التشغيل من الإعدادات للتحديث.`]);
});
// Flash's own icon on the D and F choices, so the setting reads at a glance.
const FLASH_ICON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/data/spells/icons2d/summoner_flash.png';
const flashPills = pills('مكان الفلاش', [['keep', 'كما هو'], ['D', 'D'], ['F', 'F']], getFlashKey() ?? 'keep', (v) => {
  setFlashKey(v === 'D' || v === 'F' ? v : null);
  route(); // the build page shows the spells in key order
});
for (const b of [...flashPills.children].slice(1)) b.prepend(icon(FLASH_ICON, 'flash-ico'));
// Sharing games with the other players: off until the player agrees, asked once, and only offered once a server exists.
const SHARE_TEXT = 'تُرسل مباريات Mayhem التي يجمعها البرنامج: الأبطال والتعزيزات والأيتمات والأرقام فقط، دون أسماء أو حسابات أو رقم المباراة، ويأخذ البرنامج مباريات غيرك في المقابل. يمكنك الإيقاف في أي وقت، لكن ما أُرسل لا يمكن حذفه لأنه بلا ما يدل على صاحبه.';
const shareSection = section(
  'مشاركة المباريات لتحسين التقييمات',
  pills('مشاركة المباريات', [['on', 'مفعّلة'], ['off', 'معطّلة']], storedShare() ? 'on' : 'off', (v) => {
    try {
      localStorage.setItem('shareGames', v);
    } catch {
      // not remembered this time; harmless
    }
    void window.lolh.setShareGames(v === 'on');
  }),
  el('p', 'hint', SHARE_TEXT),
);
function storedShare() {
  try {
    return localStorage.getItem('shareGames') === 'on';
  } catch {
    return false;
  }
}
shareSection.hidden = true;
void window.lolh.setShareGames(storedShare()).then((offered) => {
  shareSection.hidden = !offered;
  if (offered && !askedShare()) askShare();
});
function askedShare() {
  try {
    return localStorage.getItem('shareGames') !== null;
  } catch {
    return true; // nowhere to remember the answer: don't ask on every start
  }
}
/** Asks once, first thing. Either answer goes through the setting's own buttons. */
function askShare() {
  const box = el('div', 'settings-pop share-ask');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'مشاركة المباريات');
  const answer = (index: number) => {
    shareSection.querySelectorAll<HTMLButtonElement>('.pills button')[index].click();
    box.remove();
  };
  const yes = el('button', 'pill active', 'شارك مبارياتي');
  const no = el('button', 'pill', 'لا');
  yes.type = no.type = 'button';
  yes.addEventListener('click', () => answer(0));
  no.addEventListener('click', () => answer(1));
  const row = el('div', 'pills');
  row.append(yes, no);
  box.append(el('h4', '', 'هل تشارك مبارياتك لتحسين التقييمات؟'), el('p', 'hint', SHARE_TEXT), row);
  document.body.append(box);
}
settings.append(shareSection);
settings.append(section('مصادر البيانات', el('p', 'hint', 'نِسب فوز الأبطال والتعزيزات من AramHex (السيرفر الصيني): github.com/czgreat/aramhex-data برخصة CC BY-NC 4.0. غيّرناها بخلطها مع مبارياتنا لحساب الحروف، وليس البرنامج تجارياً.')));
settings.append(
  section('التحديثات', updateButton, updateNote, versionNote),
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
  section(
    'تطبيق الرونز والأيتمات تلقائياً عند تثبيت البطل',
    pills('التطبيق التلقائي', [['on', 'مفعّل'], ['off', 'معطّل']], autoApply ? 'on' : 'off', (v) => {
      autoApply = v === 'on';
      try {
        localStorage.setItem('autoApply', v);
      } catch {
        // not remembered this time; harmless
      }
    }),
    el('p', 'hint', 'تُستبدل صفحات البرنامج فقط (اسمها يبدأ بـ Uncle Gragas)، ولا تُمس صفحاتك.'),
  ),
  section(
    'مكان الفلاش',
    flashPills,
    el('p', 'hint', '«كما هو» يُبقي الفلاش حيث وضعته في عميل اللعبة. D أو F: يُطبَّق في شاشة الاختيار ويظهر بنفس الترتيب في صفحة البناء.'),
  ),
  section(
    'نافذة التعزيزات فوق اللعبة (F7)',
    pills('النافذة فوق اللعبة', [['on', 'مفعّلة'], ['off', 'معطّلة']], overlayOn ? 'on' : 'off', (v) => {
      overlayOn = v === 'on';
      void setOverlay(overlayOn);
      try {
        localStorage.setItem('overlay', v);
      } catch {
        // not remembered this time; harmless
      }
    }),
    overlayNote,
    modeNote,
    borderlessButton,
  ),
  section('مفتاح Gemini (بناء Mayhem بالذكاء الاصطناعي)', aiKeyInput, aiKeySave, aiKeyNote),
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
  if (open) void window.lolh.gameWindowMode().then(showMode);
  settingsBtn.setAttribute('aria-expanded', String(open));
  settingsBtn.classList.toggle('active', open);
  byId('side').classList.toggle('pinned', open); // keep the rail expanded while settings are open
};
addEventListener('keydown', (e) => e.key === 'Escape' && !settings.hidden && setSettingsOpen(false));
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
let lastApplyKey = '';
let lastPhase = '';
// The account's own picture on the profile link while the client is connected; asked once per connection.
const accountIcon = byId<HTMLImageElement>('account-icon');
accountIcon.addEventListener('error', () => (accountIcon.hidden = true));
let accountAsked = false;
function showAccount(connected: boolean) {
  if (!connected) {
    accountAsked = false;
    accountIcon.hidden = true;
    return;
  }
  if (accountAsked) return;
  accountAsked = true;
  void window.lolh.profile().then((p) => {
    if (isError(p)) accountAsked = false; // not logged in yet: the next state asks again
    else (accountIcon.src = p.iconUrl), (accountIcon.hidden = false);
  });
}

async function onLcu(state: LcuState) {
  setLcu(state);
  showAccount(state.phase !== 'Disconnected');
  // A new champ select starts fresh: the same champion next game must open and apply again.
  if (state.phase !== 'ChampSelect') lastAutoKey = lastApplyKey = '';
  // Entering champ select with nothing hovered yet: show the champions page, where the pick suggestions are.
  const entering = state.phase === 'ChampSelect' && lastPhase !== 'ChampSelect';
  lastPhase = state.phase;
  if (entering && autoOpen && !state.championId && !location.hash.startsWith('#/champions')) location.hash = '#/champions';
  const status = byId('lcu-status');
  status.classList.toggle('on', state.phase !== 'Disconnected');
  status.classList.toggle('live', state.phase === 'ChampSelect' || state.phase === 'InProgress');
  let text = PHASE_TEXT[state.phase] ?? 'متصل باللعبة';
  if (state.championId) {
    if (!championNames) {
      const list = await window.lolh.listChampions();
      if (!isError(list)) championNames = new Map(list.map((c) => [c.id, c]));
      if (state !== lcuNow()) return; // a newer state arrived while the list loaded (a dodge…): it handles itself
    }
    const c = championNames?.get(state.championId);
    if (c) text += ` · ${getNameLang() === 'ar' ? c.name : c.enName}`;
  }
  if (state.mode) text += ` · ${MODE_TITLE[state.mode]}`;
  status.querySelector('span')!.textContent = text;

  // Write the build once per locked (champion, mode, lane).
  if (state.phase === 'ChampSelect' && state.locked && state.championId && state.mode && autoApply) {
    const key = `${state.championId}/${state.mode}/${state.position}`;
    if (key !== lastApplyKey) {
      lastApplyKey = key;
      // Not awaited: opening the page below should not wait for the client.
      void window.lolh
        .applyToClient(state.championId, PAGE_MODE[state.mode], state.position ?? 'auto', getFlashKey())
        .then((r) => {
          const lines = isError(r) ? [] : applyLines(r);
          toast(isError(r) ? [`✗ ${r.error}`] : lines.length ? ['طُبّق في العميل:', ...lines.map((l) => l.text)] : ['لا يوجد بناء لتطبيقه في هذا الطور.']);
        });
    }
  }

  // Open the page once per (champion, mode, lane) so the user can still browse elsewhere.
  if (state.phase !== 'ChampSelect' || !state.championId || !autoOpen) return;
  const key = `${state.championId}/${state.mode}/${state.position}`;
  if (key === lastAutoKey) return;
  lastAutoKey = key;
  if (state.mode && state.mode !== getAppMode()) setAppMode(state.mode);
  const target = `#/champion/${state.championId}/${PAGE_MODE[getAppMode()]}/${state.position ?? 'auto'}`;
  if (location.hash === target) route();
  else location.hash = target;
}
window.lolh.onLcuState((s) => void onLcu(s));
void window.lolh.lcuState().then(onLcu);

window.addEventListener('hashchange', route);
route();
