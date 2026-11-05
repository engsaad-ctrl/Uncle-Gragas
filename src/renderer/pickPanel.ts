import { balancePoints, fillsGaps, teamGaps } from '../ai/teamFit.js';
import type { LcuState } from '../lcu/state.js';
import { champLink, el, isError, lcuNow, PAGE_MODE, pageSignal, stagger } from './dom.js';

/**
 * Champ select in ARAM and Mayhem: the champions the player can take (the ones offered and the bench) and what the team
 * took. In Mayhem each carries its effect on the team's win chance, with how it balances the team's magic and physical damage, the strongest first. Hidden otherwise.
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
    const strength = new Map(scores && !isError(scores) ? scores.map((x) => [x.id, x.points]) : []);
    // Measured on Mayhem games only, so ARAM keeps its plain order.
    const balance = s.mode === 'mayhem' ? balancePoints(choices, s.allies) : new Map<number, number>();
    const points = new Map([...strength].map(([id, p]) => [id, p + (choices.includes(id) ? (balance.get(id) ?? 0) : 0)]));
    const caption = (id: number) => (points.has(id) ? `${points.get(id)! > 0 ? '+' : ''}${points.get(id)!.toFixed(1)}` : '');
    const gaps = teamGaps(s.allies);
    const lacks = [...(gaps.frontline ? ['خط أمامي'] : []), ...(gaps.damage ? [gaps.damage === 'magic' ? 'ضرر سحري' : 'ضرر جسدي'] : [])];
    const card = (id: number, i: number, cls = '', canFill = false) => {
      const c = list.find((x) => x.id === id);
      const text = [caption(id), ...(canFill && fillsGaps(id, gaps) ? ['يكمّل'] : [])].filter(Boolean).join(' · ');
      return c ? [stagger(champLink(c, `#/champion/${id}/${PAGE_MODE[s.mode!]}`, text, `champ mini ${cls}`), i)] : [];
    };
    const sorted = [...choices].sort((a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0));
    const row = el('div', 'champ-row');
    row.append(...sorted.flatMap((id, i) => card(id, i, `${id === s.championId ? 'me' : ''}${i === 0 && points.size ? ' best' : ''}`, true)));
    const body: HTMLElement[] = [el('h2', '', 'اختر بطلك'), row];
    if (s.allies.length) {
      const team = el('div', 'champ-row');
      team.append(...s.allies.flatMap((id, i) => card(id, i)));
      body.push(el('h3', 'sub-title', 'اختيارات فريقك'), team);
      if (lacks.length) body.push(el('p', 'hint', `ينقص فريقك: ${lacks.join('، ')}. كلمة «يكمّل» تدل على من يسدّ ذلك. نقص الضرر داخل في الرقم، ونقص الخط الأمامي ملاحظة غير مثبتة.`));
    }
    if (points.size) body.push(el('p', 'hint', `الرقم: فرق نسبة فوز البطل عن 50% من AramHex وARAMKit، بالنقاط${balance.size ? '، مع أثر توازن الضرر السحري والجسدي في فريقك (مثبت على 17,694 مباراة)' : ''}. الأعلى أولاً.`));
    panel.hidden = false;
    panel.replaceChildren(...body);
  };
  void update(lcuNow());
  const onLcu = (e: Event) => (panel.isConnected ? void update((e as CustomEvent<LcuState>).detail) : document.removeEventListener('lcu', onLcu));
  document.addEventListener('lcu', onLcu, { signal: pageSignal() });
  return panel;
}
