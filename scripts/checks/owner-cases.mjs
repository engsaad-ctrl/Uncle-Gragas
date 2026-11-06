// The owner's cases, judged as a player: each passes or fails on the first three items from the app's services. Plan: knowledge/burst-value-plan.md, step 1.
// Arg (optional): --burst-window=N tries that burst window when the engine has one.
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { shop, writeResult } from './common.mjs';

const imp = (p) => import(pathToFileURL(`${process.cwd()}/dist/${p}`).href);
const { createServices } = await imp('main/services.js');
const itemMath = await imp('ai/itemMath.js');
const w = process.argv.find((a) => a.startsWith('--burst-window='));
if (w && itemMath.BURST) itemMath.BURST.window = Number(w.split('=')[1]);
const gapArg = process.argv.find((a) => a.startsWith('--gap='));
if (gapArg) (await import(pathToFileURL(`${process.cwd()}/dist/ai/cardMath.js`).href)).FIGHT.gapSeconds = Number(gapArg.split('=')[1]);
const secArg = process.argv.find((a) => a.startsWith('--fight-seconds='));
if (secArg) (await import(pathToFileURL(`${process.cwd()}/dist/ai/cardMath.js`).href)).FIGHT.seconds = Number(secArg.split('=')[1]);
const ab = process.argv.find((a) => a.startsWith('--absorbed-back='));
if (ab && itemMath.ABSORBED_WORTH_BACK) itemMath.ABSORBED_WORTH_BACK.value = Number(ab.split('=')[1]);
const dir = `${process.env.APPDATA}/LOL_helper`;
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const champs = read(`${dir}/cdragon/default/champion-summary.json`);
const idOf = (name) => (champs.data ?? champs).find((c) => c.name === name).id;
const services = createServices({ cacheDir: dir, fetchImpl: fetch });
const JEWELED_GAUNTLET = 1048, TYPHOON = 1087, VULNERABILITY = 1092, ETHEREAL_WEAPON = 1029, BEES = 3086;
const manaItem = (it) => (shop[it.id]?.DataValues?.find((d) => d.name === 'FlatMPPoolMod')?.values?.[0] ?? 0) > 0;
const crit = (it) => (shop[it.id]?.DataValues?.find((d) => d.name === 'FlatCritChanceMod')?.values?.[0] ?? 0) > 0;
const three = async (name, augments = []) => (await services.mathBuild(idOf(name), augments)).slice(0, 3).map((s) => s.item);
const names = (its) => its.map((i) => i.enName);
const boots = (its) => its.find((i) => i.group === 'boots')?.enName ?? 'none';
const has = (its, n) => names(its).includes(n);

const cases = [
  ['1 Lux: first item not Riftmaker', ['Lux'], ([a]) => a[0].enName !== 'Riftmaker', ([a]) => `Luden's first: ${a[0].enName === "Luden's Companion" ? 'yes' : 'no'}`],
  ['2 Veigar: first item not Riftmaker, Rabadon\'s in the first three', ['Veigar'], ([a]) => a[0].enName !== 'Riftmaker' && has(a, "Rabadon's Deathcap")],
  ['3 Ahri: no Riftmaker nor Dusk and Dawn', ['Ahri'], ([a]) => !has(a, 'Riftmaker') && !has(a, 'Dusk and Dawn')],
  ['4 Zed: no Warmog\'s nor Sorcerer\'s Shoes', ['Zed'], ([a]) => !has(a, "Warmog's Armor") && !has(a, "Sorcerer's Shoes")],
  ['5 Jinx: a crit item in the first three', ['Jinx'], ([a]) => a.some(crit)],
  ['6 Yasuo: first item not Bloodthirster', ['Yasuo'], ([a]) => a[0].enName !== 'Bloodthirster'],
  ['7 Ezreal: no Lord Dominik\'s without augments, a crit item with Jeweled Gauntlet', ['Ezreal', ['Ezreal', [JEWELED_GAUNTLET]]], ([a, b]) => !has(a, "Lord Dominik's Regards") && b.some(crit)],
  // Case 8 (Katarina: Heartsteel in the first three) dropped by the owner 2026-11-06: Heartsteel lowers her build's value 18-25% and her stored games win 46.6% with it (322) against 49.7% without (1,055).
  ['9 Sett: boots not Berserker\'s Greaves', ['Sett'], ([a]) => boots(a) !== "Berserker's Greaves"],
  ['10 Garen: boots not Sorcerer\'s Shoes', ['Garen'], ([a]) => boots(a) !== "Sorcerer's Shoes"],
  ['11 Dr. Mundo: boots not Berserker\'s Greaves', ['Dr. Mundo'], ([a]) => boots(a) !== "Berserker's Greaves"],
  ['12 Soraka: no Dusk and Dawn', ['Soraka'], ([a]) => !has(a, 'Dusk and Dawn')],
  ['13 Master Yi: Bloodthirster or Blade of the Ruined King', ['Master Yi'], ([a]) => has(a, 'Bloodthirster') || has(a, 'Blade of The Ruined King')],
  ['14 Vayne with Typhoon: Blade of the Ruined King and Bloodthirster', [['Vayne', [TYPHOON]]], ([a]) => has(a, 'Blade of The Ruined King') && has(a, 'Bloodthirster')],
  // The owner (2026-11-06, BodyThoseFools' Karthus): a mana item first (Blackfire Torch); with Ethereal Weapon and BEES, Lich Bane: on-hit and AP at once.
  ['17 Karthus with Ethereal Weapon and BEES: a mana item first, Lich Bane in the first three', [['Karthus', [ETHEREAL_WEAPON, BEES]]], ([a]) => manaItem(a[0]) && has(a, 'Lich Bane')],
  // The owner (2026-11-06, «لا، خطأ»): enchanters don't start Liandry's Torment (they took it once burns spread over two enemies).
  ["18 Sona and Rakan: not Liandry's Torment first", ['Sona', 'Rakan'], (b) => b.every((a) => !has([a[0]], "Liandry's Torment"))],
  // The owner (2026-11-06, «لا، خطأ»): Sona doesn't start Heartsteel.
  ['19 Sona: no Heartsteel first', ['Sona'], ([a]) => !has([a[0]], 'Heartsteel')],
  // The owner (2026-11-06, «لا، خطأ»): Pyke doesn't take Heartsteel.
  ['20 Pyke: no Heartsteel', ['Pyke'], ([a]) => !has(a, 'Heartsteel')],
];
const lines = [`owner cases${w && itemMath.BURST ? `, burst window ${itemMath.BURST.window} s` : ''}`];
let passed = 0;
for (const [label, runs, test, extra] of cases) {
  const builds = await Promise.all(runs.map((r) => (Array.isArray(r) ? three(r[0], r[1]) : three(r))));
  const ok = test(builds);
  passed += ok;
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}: ${builds.map((b, i) => `${runs.length > 1 ? (i ? 'with Jeweled Gauntlet ' : 'none ') : ''}${names(b).join(', ')}`).join(' | ')}${extra ? ` (${extra(builds)})` : ''}`);
}
// Not a build: the magic button must be there for her once Vulnerability is held (the owner: an AP build with burns).
const mfStyles = await services.buildStyles(idOf('Miss Fortune'), [VULNERABILITY]);
passed += mfStyles.includes('ap');
lines.push(`${mfStyles.includes('ap') ? 'PASS' : 'FAIL'} 15 Miss Fortune with Vulnerability: the magic build offered: ${mfStyles.join(', ')}`);
// The owner: Galio has three builds, all magic, magic with health, all tank.
const galioStyles = await services.buildStyles(idOf('Galio'), []);
const galioOk = ['ap', 'aphp', 'tank'].every((s) => galioStyles.includes(s));
passed += galioOk;
lines.push(`${galioOk ? 'PASS' : 'FAIL'} 16 Galio: magic, magic with health and tank offered: ${galioStyles.join(', ')}`);
lines.splice(1, 0, `passed ${passed} of ${cases.length + 2}`);
writeResult(import.meta.url, lines);
process.exit(0);
