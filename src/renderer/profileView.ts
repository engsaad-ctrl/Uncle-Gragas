import type { MatchView, ProfilePage } from '../app/profilePage.js';
import type { RankedQueue } from '../lcu/profile.js';
import { el, icon, isError, PAGE_MODE, pct, stagger, withTooltip } from './dom.js';
import { duration, gamesCount, kdaRatio, lastGames, timeAgo } from './format.js';

const QUEUE_TITLE: Record<RankedQueue['queue'], string> = { solo: 'Ranked Solo/Duo', flex: 'Ranked Flex' };
const TIER = (t: string) => t.charAt(0) + t.slice(1).toLowerCase(); // GOLD → Gold, as the English client writes it

/** #/profile (the logged-in player) or #/profile/<puuid> (someone from the recent players list). */
export async function profileView(root: HTMLElement, alive: () => boolean, puuid?: string) {
  const status = el('p', 'status loading', 'جاري قراءة البروفايل من عميل اللعبة…');
  root.replaceChildren(status);
  const reply = await window.lolh.profile(puuid);
  if (!alive()) return;
  status.classList.remove('loading');
  if (isError(reply)) {
    status.textContent = reply.error;
    return;
  }
  root.replaceChildren(...render(reply));
}

function render(p: ProfilePage): HTMLElement[] {
  const head = el('header', 'profile-head');
  const name = el('h1');
  name.dir = 'ltr';
  name.append(p.gameName, el('span', 'tag', ` #${p.tagLine}`));
  const info = el('div');
  info.append(name, el('div', 'en', `المستوى ${p.level}${p.me ? ' · حسابك' : ''}`));
  head.append(icon(p.iconUrl, 'profile-icon'), info);
  if (!p.me) {
    const back = el('a', 'pill', 'رجوع لحسابي');
    back.href = '#/profile';
    head.append(back);
  }

  const out: HTMLElement[] = [head];

  // Ranked + summary of the matches shown.
  const row = el('div', 'row');
  const ranked = el('section', 'panel narrow');
  ranked.append(el('h2', '', 'الرتبة'));
  if (!p.ranked.length) ranked.append(el('p', 'missing', 'بدون رتبة هذا الموسم.'));
  for (const q of p.ranked) {
    const games = q.wins + q.losses;
    const box = el('div', 'rank');
    box.append(
      el('div', 'rank-queue', QUEUE_TITLE[q.queue]),
      el('div', 'rank-tier', `${TIER(q.tier)} ${q.division} · ${q.lp} LP`),
      el('div', 'en', `${q.wins} فوز · ${q.losses} خسارة${games ? ` · ${pct(q.wins / games)}` : ''}`),
    );
    ranked.append(box);
  }
  row.append(ranked);

  const s = p.summary;
  if (s.games) {
    const sum = el('section', 'panel');
    sum.append(el('h2', '', lastGames(s.games)));
    sum.append(
      el('div', 'rank-tier', `${s.wins} فوز · ${s.games - s.wins} خسارة · ${pct(s.wins / s.games)}`),
      ltr(el('div', 'en', `KDA ${(s.kills / s.games).toFixed(1)} / ${(s.deaths / s.games).toFixed(1)} / ${(s.assists / s.games).toFixed(1)} · ${kdaRatio(s.kills, s.deaths, s.assists)}`)),
    );
    const top = el('div', 'champ-row');
    for (const t of s.top) {
      const a = el('a', 'champ mini');
      a.href = `#/champion/${t.champion.id}/${PAGE_MODE.normal}`;
      a.append(icon(t.champion.portraitUrl), el('span', '', t.champion.enName), el('small', '', `${gamesCount(t.games)} · ${pct(t.wins / t.games)}`));
      top.append(a);
    }
    sum.append(el('h3', '', 'الأكثر لعباً'), top);
    row.append(sum);
  }
  out.push(row);

  // Match list.
  const list = el('section', 'panel');
  list.append(el('h2', '', 'سجل المباريات'));
  if (!p.matches.length) list.append(el('p', 'missing', 'لا توجد مباريات في السجل.'));
  p.matches.forEach((m, i) => list.append(stagger(matchRow(m), i)));
  out.push(list);

  // Recently played with (own profile only).
  if (p.me && p.recent.length) {
    const rec = el('section', 'panel');
    rec.append(el('h2', '', 'آخر من لعبت معهم'));
    const grid = el('div', 'champ-row');
    p.recent.forEach((r, i) => {
      const a = stagger(el('a', 'champ mini player'), i);
      a.href = `#/profile/${r.puuid}`;
      const label = el('span', '', r.tagLine ? `${r.gameName}#${r.tagLine}` : r.gameName);
      label.dir = 'ltr';
      a.append(icon(r.champion?.portraitUrl ?? ''), label, el('small', '', r.playedAt ? timeAgo(r.playedAt) : ''));
      grid.append(a);
    });
    rec.append(grid, el('p', 'hint', 'اضغط على أي لاعب لترى رتبته وسجل مبارياته.'));
    out.push(rec);
  }
  return out;
}

/** K / D / A reads left to right in every game client, even inside Arabic text. */
function ltr<T extends HTMLElement>(node: T): T {
  node.dir = 'ltr';
  node.style.textAlign = 'right';
  return node;
}

function matchRow(m: MatchView): HTMLElement {
  const row = el('div', `match ${m.win ? 'win' : 'loss'}`);
  const champ = el('a', 'match-champ');
  if (m.champion) {
    champ.href = `#/champion/${m.champion.id}/${PAGE_MODE.normal}`;
    champ.append(icon(m.champion.portraitUrl), el('span', '', m.champion.enName));
  }
  const meta = el('div', 'match-meta');
  meta.append(el('b', '', m.win ? 'فوز' : 'خسارة'), el('div', '', m.queue), el('div', 'en', `${timeAgo(m.createdAt)} · ${duration(m.durationSec)}`));
  const score = el('div', 'match-score');
  const minutes = m.durationSec / 60;
  score.append(
    ltr(el('b', '', `${m.kills} / ${m.deaths} / ${m.assists}`)),
    el('div', 'en', `KDA ${kdaRatio(m.kills, m.deaths, m.assists)}`),
    el('div', 'en', `${m.cs} CS${minutes ? ` (${(m.cs / minutes).toFixed(1)})` : ''}${m.level ? ` · مستوى ${m.level}` : ''}`),
  );
  const gear = el('div', 'match-items');
  for (const x of [...m.spells, ...m.items]) gear.append(withTooltip(icon(x.iconUrl, 'ic'), x));
  row.append(champ, meta, score, gear);
  return row;
}
