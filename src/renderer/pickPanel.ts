import type { LcuState } from '../lcu/state.js';
import { champLink, el, isError, lcuNow, PAGE_MODE, pageSignal, stagger } from './dom.js';

/**
 * Champ select in ARAM and Mayhem: the champions the player can take (the ones offered and the bench) and what the team
 * took. In Mayhem each carries its effect on the team's win chance from our games, the strongest first. Hidden otherwise.
 */
export function pickPanel(): HTMLElement {
  const panel = el('section', 'panel suggest pick-panel');
  panel.hidden = true;
  let shownKey = '';
  const update = async (s: LcuState | undefined) => {
    const on = s?.phase === 'ChampSelect' && (s.mode === 'mayhem' || s.mode === 'aram');
    const choices = on ? [...new Set([...(s.championId ? [s.championId] : []), ...s.offered, ...s.bench])] : [];
    if (!s || !on || !choices.length) {
      panel.hidden = true;
      shownKey = '';
      return;
    }
    const key = `${s.mode}|${s.championId}|${choices.join(',')}|${s.allies.join(',')}`;
    if (key === shownKey) return;
    shownKey = key;
    const [list, scores] = await Promise.all([window.lolh.listChampions(), s.mode === 'mayhem' ? window.lolh.championStrengths([...choices, ...s.allies]) : null]);
    if (key !== shownKey || isError(list)) return;
    const points = new Map(scores && !isError(scores) ? scores.map((x) => [x.id, x.points]) : []);
    const caption = (id: number) => (points.has(id) ? `${points.get(id)! > 0 ? '+' : ''}${points.get(id)!.toFixed(1)}` : '');
    const card = (id: number, i: number, cls = '') => {
      const c = list.find((x) => x.id === id);
      return c ? [stagger(champLink(c, `#/champion/${id}/${PAGE_MODE[s.mode!]}`, caption(id), `champ mini ${cls}`), i)] : [];
    };
    const sorted = [...choices].sort((a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0));
    const row = el('div', 'champ-row');
    row.append(...sorted.flatMap((id, i) => card(id, i, `${id === s.championId ? 'me' : ''}${i === 0 && points.size ? ' best' : ''}`)));
    const body: HTMLElement[] = [el('h2', '', 'اختر بطلك'), row];
    if (s.allies.length) {
      const team = el('div', 'champ-row');
      team.append(...s.allies.flatMap((id, i) => card(id, i)));
      body.push(el('h3', 'sub-title', 'اختيارات فريقك'), team);
    }
    if (points.size) body.push(el('p', 'hint', 'الرقم: أثر البطل على فوز الفريق في مبارياتنا، بالنقاط. الأعلى أولاً.'));
    panel.hidden = false;
    panel.replaceChildren(...body);
  };
  void update(lcuNow());
  const onLcu = (e: Event) => (panel.isConnected ? void update((e as CustomEvent<LcuState>).detail) : document.removeEventListener('lcu', onLcu));
  document.addEventListener('lcu', onLcu, { signal: pageSignal() });
  return panel;
}
