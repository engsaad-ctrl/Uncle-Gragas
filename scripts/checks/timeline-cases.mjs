// Purchase-time cases (T003, T004): case 34's four augments in synthetic pick orders at the unlock levels 3, 7, 11 and 15, projected from level 5.
// The orders are made up to test the timing; they are not the original match's (unknown: video JDI4J_PL1vc has no transcript). Purchase levels
// after the first are estimates (projectBuild), not a match record. Case 34 in owner-cases.mjs is a separate, timeless check.
import { pathToFileURL } from 'node:url';
const imp = (p) => import(pathToFileURL(`${process.cwd()}/dist/${p}`).href);
const { createServices } = await imp('main/services.js');
const s = createServices({ cacheDir: `${process.env.APPDATA}/LOL_helper`, fetchImpl: fetch });
const SIVIR = 15, SNIPER = 1113, MISSILE = 1133, COLLECTOR = 1320, STATS = 1403, ER = 'Essence Reaver', IE = 3031;
const at = (ids) => ids.map((id, i) => ({ id, level: [3, 7, 11, 15][i] }));
const names = (t) => t.steps.map((x) => `L${x.level}${x.estimated ? '~' : ''} ${x.item.enName}`).join(', ');
const knowsSniper = (x) => x.known.includes(SNIPER);
const erAfterSniper = (t) => { const i = t.steps.findIndex((x) => x.item.enName === ER); return i >= 0 && knowsSniper(t.steps[i]) && t.steps.slice(0, i).every((x) => x.item.enName !== ER); };
const cases = [
  ['Skilled Sniper first, nothing bought: Essence Reaver is the first item', at([SNIPER, MISSILE, COLLECTOR, STATS]), [],
    (t) => t.steps.length > 0 && t.steps[0].item.enName === ER && knowsSniper(t.steps[0])],
  ['Skilled Sniper last: the purchases before it never know it, Essence Reaver comes once it is taken', at([MISSILE, COLLECTOR, STATS, SNIPER]), [],
    (t) => t.steps.length >= 5 && t.steps.some((x) => !knowsSniper(x)) && t.steps.filter((x) => x.level <= 15).every((x) => !knowsSniper(x)) && erAfterSniper(t)],
  ['Skilled Sniper third, Infinity Edge owned: Infinity Edge stays held, nothing before 12 knows Sniper, Essence Reaver comes once it is taken', at([MISSILE, COLLECTOR, SNIPER, STATS]), [IE],
    (t) => t.steps.length >= 4 && !t.steps.some((x) => x.item.id === IE) && t.steps.filter((x) => x.level <= 11).every((x) => !knowsSniper(x)) && erAfterSniper(t)],
];
let passed = 0;
for (const [name, picks, owned, ok] of cases) {
  const t = await s.projectBuild(SIVIR, picks, { level: 5, owned });
  const pass = ok(t);
  passed += pass ? 1 : 0;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}\n     ${names(t)}\n     ${t.notes.join(' ; ')}`);
}
const unknown = await s.decisionAt(SIVIR, [{ id: SNIPER }, { id: MISSILE, level: 3 }], { level: 5, owned: [] });
const unknownOk = !unknown.settled && unknown.unsure.includes(SNIPER) && !unknown.known.includes(SNIPER);
console.log(`${unknownOk ? 'PASS' : 'FAIL'} a pick with no level: left out, decision not settled`);
passed += unknownOk ? 1 : 0;
console.log(`passed ${passed} of ${cases.length + 1}`);
