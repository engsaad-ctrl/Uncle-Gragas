import type { ChampionPage, ItemChoice, Matchup, PageMode, RatedAugment, RuneRow, RuneTree } from '../app/championPage.js';
import type { Position } from '../stats/opgg.js';
import type { AugmentText, Rarity } from '../texts/augments.js';
import type { ItemEntry } from '../app/itemList.js';
import { adviceNodes, AI_HINT, AI_LOADING } from './aiAdvice.js';
import type { NamedText } from '../texts/champions.js';
import { AUGMENT_MISSING, augmentChip, augmentTags } from './augmentsView.js';
import type { LcuState } from '../lcu/state.js';
import { applyLines, champLink, detailPanel, el, getFlashKey, icon, pageSignal, isError, lcuNow, nameEl, pct, searchBox, shownName, stagger, withTooltip, type Describable } from './dom.js';
import { filterAugments } from './search.js';
import { placeFlash } from '../lcu/apply.js';

const MODES: [PageMode, string][] = [
  ['ranked', 'Ranked'], ['flex', 'Flex'], ['aram', 'ARAM'], ['mayhem', 'ARAM Mayhem'],
  ['arena', 'Arena'], ['urf', 'URF'], ['nexus', 'Nexus Blitz'],
];
/** Modes OP.GG gives no build for (Arena: no data; URF and Nexus Blitz: its tool rejects every position). */
const NO_BUILD: Partial<Record<PageMode, string>> = {
  arena: 'لا تتوفر بناءات لطور Arena. أوصاف تعزيزات Arena في تبويب التعزيزات.',
  urf: 'لا يتوفر بناء URF حالياً.',
  nexus: 'لا يتوفر بناء Nexus Blitz حالياً.',
};
const POSITIONS: [Position, string][] = [['top', 'Top'], ['jungle', 'Jungle'], ['mid', 'Mid'], ['adc', 'ADC'], ['support', 'Support']];
const AUGMENT_GROUPS: [Rarity, string][] = [['prismatic', 'أفضل التعزيزات الموشورية'], ['gold', 'أفضل التعزيزات الذهبية'], ['silver', 'أفضل التعزيزات الفضية'], ['event', 'تعزيزات خاصة']];

export async function championView(root: HTMLElement, alive: () => boolean, id: number, mode: PageMode, position: Position | 'auto') {
  const status = el('p', 'status loading', 'جاري التحميل…');
  root.replaceChildren(status);
  const reply = await window.lolh.championPage(id, mode, position);
  if (!alive()) return;
  status.classList.remove('loading');
  if (isError(reply)) {
    status.textContent = `تعذّر فتح صفحة البطل: ${reply.error}`;
    return;
  }
  root.replaceChildren(...renderPage(reply));
}

/** "تطبيق في العميل": writes this page's runes, item set and (in champ select) summoner spells into the client. */
function applyControl(p: ChampionPage): HTMLElement {
  const box = el('div', 'apply');
  if (!p.runes && !p.starter && !p.core) return box; // nothing to write for this mode
  const btn = el('button', 'pill apply-btn', 'تطبيق في العميل');
  btn.type = 'button';
  const note = el('div', 'apply-note');
  const refresh = (s: LcuState | undefined) => {
    btn.disabled = !s || s.phase === 'Disconnected';
    btn.title = btn.disabled ? 'افتح عميل اللعبة أولاً' : 'يكتب صفحة رونز وقائمة أيتمات في العميل، وتعاويذ المستدعي أثناء شاشة الاختيار';
  };
  refresh(lcuNow());
  const onLcu = (e: Event) => (btn.isConnected ? refresh((e as CustomEvent<LcuState>).detail) : document.removeEventListener('lcu', onLcu));
  document.addEventListener('lcu', onLcu, { signal: pageSignal() });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    note.textContent = 'جاري التطبيق…';
    const r = await window.lolh.applyToClient(p.champion.id, p.mode, p.position ?? 'mid', getFlashKey());
    refresh(lcuNow());
    if (isError(r)) {
      note.textContent = `✗ ${r.error}`;
      return;
    }
    const lines = applyLines(r);
    note.replaceChildren(...(lines.length ? lines.map((l) => el('div', l.ok ? 'ok' : 'bad', l.text)) : [el('div', 'bad', 'لا يوجد ما يُطبَّق.')]));
  });
  box.append(btn, note);
  return box;
}

const MAX_PICKS = 6;
/** Below this many games a win rate says little: shown, but marked. */
const FEW_GAMES = 30;

/** Mayhem from the games the client keeps: what players of this champion really took, and how often they won. */
function realPanel(p: ChampionPage, iconOf: (x: Describable) => HTMLElement, show: ReturnType<typeof detailPanel>['show']): HTMLElement {
  const s = el('section', 'panel');
  const name = shownName(p.champion);
  s.append(el('h2', '', `ماذا أخذ لاعبو ${name} في مبارياتكم`), el('p', 'status loading', 'جاري القراءة…'));
  void window.lolh.mayhemPicks(p.champion.id).then((r) => {
    s.lastElementChild!.remove();
    if (isError(r)) return void s.append(el('p', 'missing', r.error));
    const how = 'تُجمع تلقائياً من سجل مباريات العميل بعد كل مباراة Mayhem، ولكل مباراة عشرة لاعبين.';
    if (!r.championGames) return void s.append(el('p', 'hint', `لا يوجد ${name} في ${r.games} مباراة من باتش ${r.patch} بعد. ${how}`));
    const pct = (games: number, wins: number) => Math.round((100 * wins) / games);
    const badge = (games: number, wins: number) => `${games} · ${pct(games, wins)}% فوز`;
    const base = pct(r.championGames, r.championWins);
    // The team model's effect on the team's win chance; unsure when its bootstrap range crosses zero (or is not ready).
    const sure = (e: NonNullable<(typeof r.augments)[number]['effect']>) => e.low !== undefined && e.high !== undefined && (e.low > 0 || e.high < 0);
    const effectBadge = (e: (typeof r.augments)[number]['effect']) => (e ? `${e.points > 0 ? '+' : ''}${e.points.toFixed(1)}${sure(e) ? '' : '؟'}` : 'بلا بيانات');
    const grid = el('div', 'grid');
    grid.append(...r.augments.slice(0, 12).map((x, i) => {
      const a = x.augment;
      const chip = augmentChip(a, false, () => show(a, { tags: augmentTags(a), className: `r-${a.rarity}`, missing: AUGMENT_MISSING }), effectBadge(x.effect));
      chip.title = `${shownName(a)}: مع ${name} ${badge(x.games, x.wins)}. أثره على فوز الفريق: ${effectBadge(x.effect)} نقطة${x.effect?.low !== undefined ? ` (بين ${x.effect.low.toFixed(1)} و${x.effect.high!.toFixed(1)})` : ''}.`;
      if (!x.effect || !sure(x.effect)) chip.classList.add('few');
      return stagger(chip, i);
    }));
    const items = el('div', 'icons');
    for (const x of r.items.slice(0, 10)) {
      const group = el('div', `choice${x.games < FEW_GAMES ? ' few' : ''}`);
      group.append(iconOf(x.item), el('small', '', badge(x.games, x.wins)));
      items.append(group);
    }
    s.append(
      el('p', 'status', `${r.championGames} مرة في ${r.games} مباراة من باتش ${r.patch}، وفاز ${base}% منها. ${how}`),
      el('h3', 'sub-title', 'أقوى التعزيزات في مبارياتنا'), grid,
      el('h3', 'sub-title', 'الأيتمات الأكثر شراءً'), items,
      el(
        'p',
        'hint',
        `رقم التعزيز: كم يرفع فوز الفريق بالنقاط، محسوباً من مباريات كل الأبطال مع احتساب الزملاء والخصوم. «؟» والباهت: غير مؤكد بعد. مرّر الماوس لترى أرقام ${name} نفسه. رقم الأيتم: عدد المرات ثم نسبة الفوز، والباهت أقل من ${FEW_GAMES} مرة.`,
      ),
    );
  });
  return s;
}

/** Mayhem without a game: pick the augments, ask Gemini, and see both builds with the calculator's numbers. */
function aiPanel(p: ChampionPage, iconOf: (x: Describable) => HTMLElement): HTMLElement {
  const s = el('section', 'panel');
  s.append(el('h2', '', 'جرّب بناء الذكاء الاصطناعي'), el('p', 'hint', `اختر حتى ${MAX_PICKS} تعزيزات كأنك أخذتها في المباراة، ثم اضغط الزر.`));
  const search = searchBox('ابحث عن تعزيز');
  const chosenEl = el('div', 'grid');
  const listEl = el('div', 'grid');
  const box = el('div', 'ov-ai');
  const picked = new Map<number, AugmentText>();
  // The rated ones first (best for this champion), then every other Mayhem augment once it loads.
  let all: AugmentText[] = p.augments;
  let items: ItemEntry[] = [];
  let run = 0;

  const toggle = (a: AugmentText) => {
    if (picked.has(a.id)) picked.delete(a.id);
    else if (picked.size < MAX_PICKS) picked.set(a.id, a);
    run++; // an answer still on its way is for the old picks
    draw();
  };
  const drawList = () => {
    chosenEl.replaceChildren(...[...picked.values()].map((a) => augmentChip(a, true, () => toggle(a))));
    const found = filterAugments(all, search.input.value, 'all').filter((a) => !picked.has(a.id)).slice(0, 12);
    listEl.replaceChildren(...(found.length ? found.map((a) => augmentChip(a, false, () => toggle(a))) : [el('p', 'missing', 'لا يوجد تعزيز بهذا الاسم.')]));
  };
  const draw = () => {
    drawList();
    const go = el('button', 'pill', 'اقترح البناء بالذكاء الاصطناعي');
    go.type = 'button';
    go.disabled = !picked.size;
    go.addEventListener('click', ask);
    box.replaceChildren(go, el('p', 'hint', AI_HINT));
  };
  async function ask() {
    const id = ++run;
    box.replaceChildren(el('p', 'hint', AI_LOADING));
    const [r, listed] = await Promise.all([window.lolh.aiBuild(p.champion.id, [...picked.keys()]), items.length ? null : window.lolh.listItems('mayhem')]);
    if (listed && !isError(listed)) items = listed.list;
    if (id !== run || !box.isConnected) return; // the picks changed or the page closed meanwhile
    if (isError(r)) return void box.replaceChildren(el('p', 'missing', r.error));
    box.replaceChildren(...adviceNodes(r, (i) => items.find((x) => x.id === i), iconOf));
  }

  search.input.addEventListener('input', drawList); // typing keeps the answer on screen
  void window.lolh.getAugments().then((r) => {
    if (isError(r)) return;
    const rated = new Set(all.map((a) => a.id));
    all = [...all, ...r.augments.filter((a) => a.modes.includes('mayhem') && !rated.has(a.id))];
    drawList();
  });
  draw();
  s.append(el('h3', 'sub-title', 'تعزيزاتك'), chosenEl, search.node, listEl, box);
  return s;
}

function renderPage(p: ChampionPage): HTMLElement[] {
  const detail = detailPanel();
  const pickable = (x: Describable, node: HTMLElement, extra: Parameters<typeof detail.show>[1] = {}) => {
    node.classList.add('pickable');
    node.addEventListener('click', () => detail.show(x, extra));
    return withTooltip(node, x, { tags: extra.tags ? () => extra.tags! : undefined, className: extra.className, missing: extra.missing });
  };
  const iconButton = (x: NamedText | Describable, className = 'ic') => {
    const b = el('button', className);
    b.type = 'button';
    b.append(icon(x.iconUrl));
    return pickable(x, b);
  };

  // Header: portrait, name, ability icons (like the build pages on stat sites).
  const c = p.champion;
  const head = el('header', 'champ-head');
  const portrait = icon(c.portraitUrl, 'portrait');
  const info = el('div');
  const title = el('h1');
  title.append(nameEl('span', c), el('span', 'accent', ` · بناء ${MODES.find(([m]) => m === p.mode)![1]}`));
  const abilities = el('div', 'abilities');
  for (const a of c.abilities) {
    const b = iconButton(a, 'ability');
    b.append(el('b', '', a.key));
    abilities.append(b);
  }
  info.append(title, el('div', 'en', c.title), abilities);
  head.append(portrait, info, applyControl(p));

  // Mode tabs + position pills.
  const tabs = el('nav', 'tabs mode-tabs');
  for (const [m, label] of MODES) {
    const a = el('a', m === p.mode ? 'active' : '', label);
    a.href = `#/champion/${c.id}/${m}/${p.position ?? 'mid'}`;
    tabs.append(a);
  }
  const top: HTMLElement[] = [head, tabs];
  if (p.mode === 'ranked' || p.mode === 'flex') {
    const pos = el('nav', 'pills');
    for (const [value, label] of POSITIONS) {
      const a = el('a', `pill${value === p.position ? ' active' : ''}`, label);
      a.href = `#/champion/${c.id}/${p.mode}/${value}`;
      pos.append(a);
    }
    top.push(pos);
  }

  const notes: string[] = [];
  if (p.stats) {
    notes.push(`نسبة الفوز ${pct(p.stats.winRate)}`, `نسبة الاختيار ${pct(p.stats.pickRate)}`);
    if (p.stats.banRate !== null) notes.push(`نسبة الحظر ${pct(p.stats.banRate)}`);
    notes.push(`${p.stats.games.toLocaleString('en')} مباراة`);
  }
  if (p.mode === 'mayhem') notes.push(p.siteBuild ? 'الأيتمات والقدرات من مباريات Mayhem، والرونز والتعاويذ من ARAM' : 'البناء نفسه بناء ARAM');
  if (p.stale) notes.push('بيانات محفوظة (تعذّر التحديث)');
  if (p.fetchedAt) notes.push(`آخر تحديث ${new Date(p.fetchedAt).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' })}`);
  top.push(el('p', 'status', notes.join(' · ')));
  if (p.buildError) top.push(el('p', 'status error', 'تعذّر تحميل البناء الآن. حاول لاحقاً.'));
  const noBuild = NO_BUILD[p.mode];
  if (noBuild) {
    const note = el('p', 'panel note', noBuild);
    if (p.mode === 'arena') {
      const link = el('a', 'link', ' افتح تعزيزات Arena ←');
      link.href = '#/augments/arena';
      note.append(link);
    }
    top.push(note);
  }

  const body: HTMLElement[] = [];

  // Mayhem augments in the stats site's recommended order for this champion, grouped by rarity.
  if (p.mode === 'mayhem') {
    const section = el('section', 'panel');
    section.append(el('h2', '', `أفضل تعزيزات Mayhem لـ ${shownName(c)}`));
    if (!p.augments.length) section.append(el('p', 'missing', 'لا تتوفر تقييمات تعزيزات لهذا البطل حالياً.'));
    const showAll = el('button', 'more', 'عرض كل التعزيزات');
    showAll.type = 'button';
    const groups = el('div');
    const renderGroups = (limit: number) =>
      groups.replaceChildren(
        ...AUGMENT_GROUPS.flatMap(([rarity, label]) => {
          const list = p.augments.filter((a) => a.rarity === rarity).slice(0, limit);
          if (!list.length) return [];
          const grid = el('div', 'grid');
          grid.append(...list.map((a: RatedAugment, i) => {
            const chip = stagger(augmentChip(a, false, () => detail.show(a, { tags: augmentTags(a), className: `r-${a.rarity}`, missing: AUGMENT_MISSING }), `${a.tierLabel ?? `#${a.rank}`} · ${pct(a.popularity)}`), i);
            return chip;
          }));
          const h = el('h3', 'sub-title', label);
          const wrap = el('div');
          wrap.append(h, grid);
          return [wrap];
        }),
      );
    renderGroups(6);
    let all = false;
    showAll.addEventListener('click', () => {
      all = !all;
      renderGroups(all ? Infinity : 6);
      showAll.textContent = all ? 'عرض أقل' : 'عرض كل التعزيزات';
      if (!all) section.scrollIntoView({ block: 'start', behavior: 'smooth' }); // back to the top of the shortened list
    });
    section.append(groups);
    // Each group shows 6 at first: offer the rest whenever any group has more.
    if (AUGMENT_GROUPS.some(([r]) => p.augments.filter((a) => a.rarity === r).length > 6)) section.append(showAll);
    section.append(el('p', 'hint', '#1 هو الأفضل لهذا البطل حسب الإحصائيات، والنسبة هي كم من لاعبي البطل يختارونه. التعزيزات بلا عينة كافية مستبعدة.'));
    body.push(section, realPanel(p, iconButton, detail.show), aiPanel(p, iconButton));
  }

  // Skills: priority, spells, path grid.
  if (p.skillOrder.length || p.spells.length) {
    const row = el('div', 'row');
    const left = el('section', 'panel narrow');
    if (p.skillPriority.length) {
      left.append(el('h2', '', 'أولوية القدرات'));
      const pr = el('div', 'icons');
      p.skillPriority.forEach((k, i) => {
        const a = c.abilities.find((x) => x.key === k);
        if (!a) return;
        if (i) pr.append(el('span', 'arrow', '←'));
        const b = iconButton(a, 'ability');
        b.append(el('b', '', k));
        pr.append(b);
      });
      left.append(pr);
    }
    if (p.spells.length) {
      left.append(el('h2', '', 'تعاويذ المستدعي'));
      const sp = el('div', 'icons');
      const key = getFlashKey();
      const spells = key && p.spells.length === 2 ? placeFlash([p.spells[0], p.spells[1]], key) : p.spells;
      sp.append(...spells.map((s) => iconButton(s)));
      left.append(sp);
    }
    row.append(left);
    if (p.skillOrder.length) {
      const path = el('section', 'panel wide');
      path.append(el('h2', '', 'ترتيب رفع القدرات'));
      const grid = el('div', 'skill-grid');
      for (const key of ['Q', 'W', 'E', 'R']) {
        const a = c.abilities.find((x) => x.key === key);
        const label = el('div', 'skill-label');
        if (a) label.append(icon(a.iconUrl), nameEl('span', a));
        grid.append(label);
        for (let lvl = 0; lvl < 18; lvl++) {
          const on = p.skillOrder[lvl] === key;
          grid.append(on ? stagger(el('div', 'cell on', String(lvl + 1)), lvl, 45) : el('div', 'cell'));
        }
      }
      path.append(grid);
      row.append(path);
    }
    body.push(row);
  }

  // Items.
  const slot = (label: string, choices: ItemChoice[], joiner = '') => {
    if (!choices.length) return null;
    const s = el('section', 'panel slot');
    s.append(el('h2', '', label));
    const wrap = el('div', 'icons');
    choices.forEach((ch, i) => {
      if (i && joiner) wrap.append(el('span', 'arrow', joiner));
      const group = el('div', 'choice');
      const ic = el('div', 'icons');
      ic.append(...ch.items.map((it) => iconButton(it)));
      group.append(ic, el('small', '', `${pct(ch.winRate)} فوز`));
      wrap.append(group);
    });
    s.append(wrap);
    return s;
  };
  const items = el('div', 'row items');
  const slots = [
    slot('أيتمات البداية', p.starter ? [p.starter] : []),
    p.core ? (() => {
      const s = el('section', 'panel slot');
      s.append(el('h2', '', 'الأيتمات الأساسية'));
      const wrap = el('div', 'icons');
      p.core.items.forEach((it, i) => {
        if (i) wrap.append(el('span', 'arrow', '←'));
        wrap.append(iconButton(it));
      });
      // The site gives a pick rate, OP.GG a game count.
      s.append(wrap, el('small', '', `${pct(p.core.winRate)} فوز · ${p.core.games ? `${p.core.games.toLocaleString('en')} مباراة` : `${pct(p.core.pickRate)} اختيار`}`));
      return s;
    })() : null,
    slot('الحذاء', p.boots ? [p.boots] : []),
    slot(p.siteBuild ? 'أيتمات أخرى شائعة' : 'خيارات الأيتم الرابع', p.fourth),
    slot('خيارات الأيتم الخامس', p.fifth),
    slot('خيارات الأيتم السادس', p.sixth),
  ].filter((s): s is HTMLElement => s !== null);
  if (slots.length) {
    items.append(...slots);
    body.push(items);
  }

  // Runes: both trees laid out like the client, chosen runes lit, the rest dimmed.
  if (p.runes) {
    const r = p.runes;
    const s = el('section', 'panel');
    s.append(el('h2', '', `صفحة الرونز · ${pct(r.winRate)} فوز · ${r.games.toLocaleString('en')} مباراة`));
    const rowsEl = (rows: RuneRow[], className = '') =>
      rows.map((row) => {
        const line = el('div', `rune-row ${className}${row.keystone ? ' keystone' : ''}`);
        line.append(...row.options.map((o) => iconButton(o, `ic rune${o.selected ? ' on' : ' off'}`)));
        return line;
      });
    const treeEl = (t: RuneTree | null) => {
      const box = el('div', 'tree');
      if (!t) return box;
      const h = el('div', 'tree-head');
      h.append(iconButton(t.style, 'ic style'), nameEl('span', t.style));
      box.append(h, ...rowsEl(t.rows));
      return box;
    };
    const shards = el('div', 'tree shards');
    shards.append(el('div', 'tree-head', 'الإحصائيات'), ...rowsEl(r.shards, 'small'));
    const trees = el('div', 'runes');
    trees.append(treeEl(r.primary), treeEl(r.sub), shards);
    s.append(trees);
    body.push(s);
  }

  // Lane matchups: whom it beats, who beats it (its own win rate in each matchup).
  if (p.matchups.strong.length || p.matchups.weak.length) {
    const s = el('section', 'panel');
    s.append(el('h2', '', 'المواجهات في المسار'));
    const half = (title: string, list: Matchup[], cls: string) => {
      const box = el('div', `matchups ${cls}`);
      box.append(el('h3', '', title));
      const grid = el('div', 'champ-row');
      grid.append(...list.map((m) => champLink(m.champion, `#/champion/${m.champion.id}/${p.mode}/${p.position ?? 'mid'}`, `${pct(m.winRate)} فوز`)));
      box.append(list.length ? grid : el('p', 'missing', 'لا توجد عينة كافية.'));
      return box;
    };
    const both = el('div', 'matchup-cols');
    both.append(half('يتفوق على', p.matchups.strong, 'good'), half('يعاني أمام', p.matchups.weak, 'bad'));
    s.append(both, el('p', 'hint', `نسبة الفوز هي نسبة فوز ${shownName(c)} في كل مواجهة.`));
    body.push(s);
  }

  if (!body.length && !p.buildError && !noBuild) body.push(el('p', 'missing', 'لا تتوفر بيانات بناء لهذا البطل في هذا الوضع.'));
  return [...top, detail.node, ...body];
}
