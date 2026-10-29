// Gemini's answer for a champion and its Mayhem augments, with the calculator's numbers: shared by F7 and the champion page.

import type { Advice, BuildStyle } from '../ai/advisor.js';
import type { BuildResult } from '../ai/calculator.js';
import { el, shownName, type Describable } from './dom.js';

export const STYLE_LABEL: Record<BuildStyle, string> = {
  ap: 'قوة القدرة (AP)', ad: 'ضرر الهجوم (AD)', onhit: 'On-Hit', crit: 'الضربة الحرجة', 'attack-speed': 'سرعة الهجوم', lethality: 'Lethality',
  burn: 'الحرق والسم', tank: 'الصلابة', health: 'الصحة', omnivamp: 'Omnivamp', lifesteal: 'Lifesteal', haste: 'تسارع القدرة', mana: 'المانا', utility: 'الدعم',
};
export const AI_HINT = 'يقرأ Gemini نصوص البطل والتعزيزات والأيتمات، وتحسب حاسبة البرنامج الأرقام. يأخذ حتى نصف دقيقة، والنتيجة تُحفظ.';
export const AI_LOADING = 'يفكّر Gemini… قد يأخذ حتى نصف دقيقة.';

const n = (x: number) => Math.round(x).toLocaleString('en');

/** The numbers a player checks a build by: its stats at level 18, then its damage against the calculator's target. */
export function calcView(r: BuildResult): HTMLElement {
  const s = r.stats;
  const box = el('div', 'ai-calc');
  box.dir = 'ltr';
  const line = (label: string, parts: string[]) => {
    const p = el('p');
    p.append(el('b', '', label), ` ${parts.join(' · ')}`);
    return p;
  };
  box.append(
    line('Stats', [`AD ${n(s.ad)}`, `AP ${n(s.ap)}`, `AS ${s.attackSpeed.toFixed(2)}`, `Crit ${Math.round(s.crit * 100)}%`, `HP ${n(s.hp)}`, `Armor ${n(s.armor)}`, `MR ${n(s.mr)}`, `Haste ${n(s.haste)}`]),
    line('Damage', [`Autos ${n(r.autoAttackDps)}/s`, `On-Hit ${n(r.onHitDps)}/s`, `Burn ${n(r.burnDamage)}`]),
    line('Toughness', [`vs AD ${n(r.effectiveHp.physical)}`, `vs AP ${n(r.effectiveHp.magic)}`]),
  );
  for (const a of r.abilities) {
    if (a.values.length) box.append(line(a.key, a.values.map((v) => `${v.name} ${n(v.value)}${v.partial ? '+' : ''}`)));
  }
  box.append(el('p', 'hint', 'المستوى 18، والهدف: 100 Armor و80 MR و3000 صحة. «+» تعني أن جزءاً من الرقم لم يُحسب.'));
  return box;
}

/**
 * The chosen build and its alternative, each with its items, reasons and numbers. `find` looks up an item by id and
 * `iconOf` draws it the way the page around it draws items.
 */
export function adviceNodes(a: Advice, find: (id: number) => Describable | undefined, iconOf: (x: Describable) => HTMLElement): HTMLElement[] {
  const rowsOf = (list: Advice['items']) => {
    const rows = el('div', 'ov-adapted');
    for (const it of list) {
      const item = find(it.id);
      const r = el('div', 'ov-adapted-row');
      const txt = el('div', 'ov-name');
      txt.append(el('b', '', item ? shownName(item) : `#${it.id}`), el('small', '', it.inUsual ? `${it.reason} · في بناء ARAM المعتاد` : it.reason));
      r.append(item ? iconOf(item) : el('span'), txt);
      rows.append(r);
    }
    return rows;
  };
  const out = [el('h4', '', `بناء Gemini: ${STYLE_LABEL[a.style] ?? a.style}`), el('p', 'hint', a.styleReason), rowsOf(a.items), calcView(a.calc)];
  if (a.alternative) {
    out.push(el('h4', '', `البديل: ${STYLE_LABEL[a.alternative.style] ?? a.alternative.style}`), el('p', 'hint', a.alternative.when), rowsOf(a.alternative.items), calcView(a.alternative.calc));
  }
  if (a.avoid.length) out.push(el('p', 'hint', `تجنّب: ${a.avoid.map((x) => `${find(x.id) ? shownName(find(x.id)!) : x.id} (${x.reason})`).join('، ')}`));
  out.push(el('p', '', a.summary), el('p', 'hint', `تقدير من النصوص وحاسبة اللعبة (${a.effects.length} تأثير من النصوص)، لا إحصائية مباريات Mayhem.`));
  return out;
}
