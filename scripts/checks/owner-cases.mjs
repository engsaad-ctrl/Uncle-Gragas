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
const JEWELED_GAUNTLET = 1048, TYPHOON = 1087, VULNERABILITY = 1092, ETHEREAL_WEAPON = 1029, BEES = 3086, BACK_TO_BASICS = 1004, WARLOCK_JUICEBOX = 2132, MAGIC_MISSILE = 1133, SKILLED_SNIPER = 1113, PHENOMENAL_EVIL = 1390, DOUBLE_TAP = 2010, ZEALOT = 2009, MYSTIC_PUNCH = 1058, ADAPT = 1205, MINIONMANCER = 1104, HEAVY_CROWN = 3132, CRITICAL_RHYTHM = 1328, DEFT = 1022, UPGRADE_IE = 1336, CRITICAL_MISSILE = 1356, JUICED = 2016, TANK_ENGINE = 1353, PRESSURE_COOKER = 2102, GOLIATH = 1041, SOUL_EATER = 1375;
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
  // The owner (2026-11-07, «اقرب الى الصحه»): Vladimir with Back To Basics, Liandry's, Sorcerer's, Warmog's, Void Staff, Shadowflame. Soft: two of them in the first three.
  ["21 Vladimir with Back To Basics: two of Liandry's, Sorcerer's, Warmog's, Void Staff, Shadowflame in the first three", [['Vladimir', [BACK_TO_BASICS]]], ([a]) => ["Liandry's Torment", "Sorcerer's Shoes", "Warmog's Armor", 'Void Staff', 'Shadowflame'].filter((n) => has(a, n)).length >= 2],
  // The owner's yes (2026-11-07) to MoreZwag's Vladimir (video 8ThkVX_53as, a win): Warlock Juicebox scales omnivamp with AP, so AP first (Riftmaker, Rabadon's). Soft, not to tune for.
  ["22 Vladimir with Warlock Juicebox: Riftmaker or Rabadon's in the first three", [['Vladimir', [WARLOCK_JUICEBOX]]], ([a]) => has(a, 'Riftmaker') || has(a, "Rabadon's Deathcap")],
  // The owner (2026-11-07, «بلد صحيح وقوي لميس فورشن وهو افضل بناء ap لها»), MoreZwag: Blackfire Torch, The Collector, Liandry's, Stormsurge, anti-heal, Void Staff. Soft: an AP burn item in the first three.
  ["23 Miss Fortune with Vulnerability, Magic Missile, Jeweled Gauntlet, Skilled Sniper: Blackfire Torch or Liandry's in the first three", [['Miss Fortune', [VULNERABILITY, MAGIC_MISSILE, JEWELED_GAUNTLET, SKILLED_SNIPER]]], ([a]) => has(a, 'Blackfire Torch') || has(a, "Liandry's Torment")],
  // The owner (2026-11-07, «بلد قوي»), MoreZwag's Kayle (PE6LuRRlSWY): Dusk and Dawn, boots, Blade of The Ruined King, Guinsoo's, Terminus. Soft: an on-hit item in the first three.
  ["24 Kayle with Phenomenal Evil, Double Tap, Zealot, Mystic Punch: Blade of The Ruined King or Guinsoo's in the first three", [['Kayle', [PHENOMENAL_EVIL, DOUBLE_TAP, ZEALOT, MYSTIC_PUNCH]]], ([a]) => has(a, 'Blade of The Ruined King') || has(a, "Guinsoo's Rageblade")],
  // The owner (2026-11-07, «بلد قوي», then «احسنت هذا التفكير السليم»), MoreZwag's Heimerdinger (7i0Gltpo8hA): he meant to sell Blade of The Ruined King (no effect on turret autos)
  // and planned crit (Infinity Edge, The Collector) with ADAPt and Jeweled Gauntlet. Soft: a crit item, Shadowflame, Lich Bane or Liandry's in the first three; BotRK not required.
  ["25 Heimerdinger with Jeweled Gauntlet, ADAPt, Ethereal Weapon, Minionmancer: crit, Shadowflame, Lich Bane or Liandry's in the first three", [['Heimerdinger', [JEWELED_GAUNTLET, ADAPT, ETHEREAL_WEAPON, MINIONMANCER]]], ([a]) => a.some(crit) || ['Shadowflame', 'Lich Bane', "Liandry's Torment"].some((n) => has(a, n))],
  // The owner (2026-11-07, «بناء قوي»), MoreZwag's Varus (4FAFTMMATzI): Hubris, Lord Dominik's, Infinity Edge, The Collector, built around Q, not attacks. Soft: no attack-speed item in the first three.
  ["26 Varus with Heavy Is The Crown, Back To Basics, Jeweled Gauntlet: Hubris, Lord Dominik's, Infinity Edge or The Collector first", [['Varus', [HEAVY_CROWN, BACK_TO_BASICS, JEWELED_GAUNTLET]]], ([a]) => ['Hubris', "Lord Dominik's Regards", 'Infinity Edge', 'The Collector'].includes(a[0].enName)],
  // The owner (2026-11-07, «بلد قوي»), MoreZwag's Twitch (I7xPMtSGfdU): The Collector, boots, Runaan's, Infinity Edge, Lord Dominik's, then BotRK. Soft: a crit item in the first three.
  ["27 Twitch with Critical Rhythm, Deft, Upgrade Infinity Edge, Critical Missile: a crit item in the first three", [['Twitch', [CRITICAL_RHYTHM, DEFT, UPGRADE_IE, CRITICAL_MISSILE]]], ([a]) => a.some(crit)],
  // The owner (2026-11-07, «بناء صحيح»), MoreZwag's Jinx (FS5bTu2lUWo): The Collector, Yun Tal, Runaan's, Guinsoo's, Manamune, Terminus, BotRK; Juiced's on-hit grows with mana. Soft: an on-hit or crit item first.
  ["28 Jinx with Double Tap, Juiced, Critical Missile: an on-hit or crit item first", [['Jinx', [DOUBLE_TAP, JUICED, CRITICAL_MISSILE]]], ([a]) => crit(a[0]) || ['Blade of The Ruined King', "Guinsoo's Rageblade", 'Terminus', 'Manamune'].includes(a[0].enName)],
  // The owner (2026-11-07, «بناء قوي»), BodyThoseFools' Cho'Gath (Z6K2hZjtRXs): Heartsteel, Warmog's, Unending Despair, Steelcaps, Riftmaker, Sunfire, Rabadon's. Soft: Heartsteel and a health item in the first three.
  ["30 Cho'Gath with Tank Engine, Pressure Cooker, Goliath, Soul Eater: Heartsteel and Warmog's or Unending Despair in the first three", [["Cho'Gath", [TANK_ENGINE, PRESSURE_COOKER, GOLIATH, SOUL_EATER]]], ([a]) => has(a, 'Heartsteel') && (has(a, "Warmog's Armor") || has(a, 'Unending Despair'))],
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
// The owner's yes (2026-11-07) to BodyThoseFools' AP Nasus (ao3YXjau3FQ): with Infinite Recursion, Marksmage, Infernal Conduit and Overloaded the magic build must be offered. Soft.
const nasusStyles = await services.buildStyles(idOf('Nasus'), [1388, 1129, 1045, 2123]);
// The owner then judged this build right (2026-11-07, «بناءك صحيح»): Blackfire Torch, Liandry's, Sorcerer's Shoes, Riftmaker, Rylai's, Void Staff. Soft: Blackfire or Liandry's in the magic build's first three.
const nasusAp = nasusStyles.includes('ap') ? (await services.mathBuild(idOf('Nasus'), [1388, 1129, 1045, 2123], [], undefined, 'ap')).slice(0, 3).map((x) => x.item) : [];
const nasusOk = nasusAp.length > 0 && (has(nasusAp, 'Blackfire Torch') || has(nasusAp, "Liandry's Torment"));
passed += nasusOk;
lines.push(`${nasusOk ? 'PASS' : 'FAIL'} 29 Nasus with Infinite Recursion, Marksmage, Infernal Conduit, Overloaded: the magic build offered, Blackfire Torch or Liandry's in its first three: ${nasusStyles.join(', ')} | ap: ${names(nasusAp).join(', ')}`);
lines.splice(1, 0, `passed ${passed} of ${cases.length + 3}`);
writeResult(import.meta.url, lines);
process.exit(0);
