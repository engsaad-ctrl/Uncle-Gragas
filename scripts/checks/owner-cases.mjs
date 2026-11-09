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
const JEWELED_GAUNTLET = 1048, TYPHOON = 1087, VULNERABILITY = 1092, ETHEREAL_WEAPON = 1029, BEES = 3086, BACK_TO_BASICS = 1004, WARLOCK_JUICEBOX = 2132, MAGIC_MISSILE = 1133, SKILLED_SNIPER = 1113, PHENOMENAL_EVIL = 1390, DOUBLE_TAP = 2010, ZEALOT = 2009, MYSTIC_PUNCH = 1058, ADAPT = 1205, MINIONMANCER = 1104, HEAVY_CROWN = 3132, CRITICAL_RHYTHM = 1328, DEFT = 1022, UPGRADE_IE = 1336, CRITICAL_MISSILE = 1356, JUICED = 2016, TANK_ENGINE = 1353, PRESSURE_COOKER = 2102, GOLIATH = 1041, SOUL_EATER = 1375, BIG_SHOT = 3018, DRAW_YOUR_SWORD = 1134;
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
  // The owner (2026-11-07): «ممكن يجي بق شوت مع درو يور سورد وايتمات سرعه او دمج»; BodyThoseFools' Caitlyn (n0hr89for64). Soft: crit or attack-speed items lead, no tank item first.
  ["31 Caitlyn with Big Shot and Draw Your Sword: a crit or attack-speed item in the first three", [['Caitlyn', [BIG_SHOT, DRAW_YOUR_SWORD]]], ([a]) => a.some((i) => crit(i) || (shop[i.id]?.DataValues?.find((d) => d.name === 'PercentAttackSpeedMod')?.values?.[0] ?? 0) > 0)],
  // The owner (2026-11-08, «ايوه الريفر افضل لان الابلتي تستهل مانا»), MoreZwag's Sivir (JDI4J_PL1vc, game 35): Essence Reaver first, then The Collector, a Q poke build. Soft: Essence Reaver in the first three.
  // The owner (2026-11-08, «نعم صحيح ... Rite of Ruin يعطي كريت جديد لانه ابلتي بور، Critical Missile كريت اضافي»), MoreZwag's Swain (xPiGhbCx3Kw, game 93): Zhonya's, Blackfire, Rite of Ruin, Rabadon's, Liandry's, Void, no boots.
  // With Jeweled Gauntlet AP turns into crit for his abilities. Soft: no item without AP in the first three, and Rite of Ruin or Rabadon's among them.
  ['35 Swain with Jeweled Gauntlet, Critical Missile, Magic Missile, Infernal Soul: full AP, Rite of Ruin or Rabadon\'s in the first three', [['Swain', [JEWELED_GAUNTLET, CRITICAL_MISSILE, MAGIC_MISSILE, 1046]]], ([a]) => a.every((i) => i.group === 'boots' || (shop[i.id]?.DataValues?.find((d) => d.name === 'FlatMagicDamageMod')?.values?.[0] ?? 0) > 0) && (has(a, 'Rite of Ruin') || has(a, "Rabadon's Deathcap"))],
  // The owner (2026-11-08, «لازم ايتم مانا في البدايه»), MoreZwag's Brand (xPiGhbCx3Kw, game 87): Blackfire, Liandry's, Sorcerer's, Shadowflame, Rabadon's, Void. A mage starts with a mana item even when a card (ADAPt) switches damage.
  // Then: «Blackfire افضل على براند لانه يدمج اكثر من شخص بنفس الوقت فيضيف AP» (4% AP for each burning enemy).
  ['37 Brand with From Beginning To End, ADAPt, Witchful Thinking, Magic Missile: Blackfire Torch first', [['Brand', [1038, ADAPT, 97, MAGIC_MISSILE]]], ([a]) => a[0].enName === 'Blackfire Torch'],
  // The owner (2026-11-04, «نعم، صحيح»): Zilean Rod of Ages, Sorcerer's, Rabadon's; then (2026-11-08) «Zilean يبدا بلودن عادي» and «لست متاكد من اول ايتم له». Soft: a mana item first.
  ['39 Zilean: a mana item first', ['Zilean'], ([a]) => manaItem(a[0])],
  // The owner (2026-11-08): Twisted Fate fights long in Mayhem («غالبا قتال طويل»), so Lich Bane's repeated procs beat Hextech Gunblade's AP with ADAPt; MoreZwag's TF (fXf5gcWuApk, game 95). Soft: Lich Bane, no Gunblade, in the first three.
  ['40 Twisted Fate with Scopiest Weapons, With Haste, ADAPt, Back To Basics: Lich Bane in the first three, no Gunblade', [['Twisted Fate', [1115, 1098, ADAPT, BACK_TO_BASICS]]], ([a]) => has(a, 'Lich Bane') && !has(a, 'Hextech Gunblade')],
  ['34 Sivir with Skilled Sniper, Magic Missile, Upgrade Collector, Stats on Stats!: Essence Reaver in the first three', [['Sivir', [SKILLED_SNIPER, MAGIC_MISSILE, 1320, 1403]]], ([a]) => has(a, 'Essence Reaver')],
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
// Case 8, the owner 2026-11-08: «كاترينا لها اكثر من بيلد لا يحتكر على بلد معين ، على حسب التعزيز يكون البلد» (he never dropped her case; d2fe799 had removed it).
// Her builds AP, AD and tank are offered, and a health augment (Goliath) changes her build to one with Heartsteel: his health build was Heartsteel, Sorcerer's, Riftmaker, Warmog's (required since 2026-11-09, rule 23, «Yes, all»).
const kataStyles = await services.buildStyles(idOf('Katarina'), []);
const [kataPlain, kataHealth] = await Promise.all([three('Katarina'), three('Katarina', [GOLIATH])]);
const kataOk = ['ap', 'ad', 'tank'].every((s) => kataStyles.includes(s)) && names(kataPlain).join() !== names(kataHealth).join() && has(kataHealth, 'Heartsteel');
passed += kataOk;
lines.push(`${kataOk ? 'PASS' : 'FAIL'} 8 Katarina: AP, AD and tank offered, and Goliath changes her build: ${kataStyles.join(', ')} | none ${names(kataPlain).join(', ')} | with Goliath ${names(kataHealth).join(', ')} (Heartsteel with Goliath: ${has(kataHealth, 'Heartsteel') ? 'yes' : 'no'})`);
// The owner's yes (2026-11-07) to BodyThoseFools' AP Nasus (ao3YXjau3FQ): with Infinite Recursion, Marksmage, Infernal Conduit and Overloaded the magic build must be offered. Soft.
const nasusStyles = await services.buildStyles(idOf('Nasus'), [1388, 1129, 1045, 2123]);
// The owner then judged this build right (2026-11-07, «بناءك صحيح»): Blackfire Torch, Liandry's, Sorcerer's Shoes, Riftmaker, Rylai's, Void Staff. Soft: Blackfire or Liandry's in the magic build's first three.
const nasusAp = nasusStyles.includes('ap') ? (await services.mathBuild(idOf('Nasus'), [1388, 1129, 1045, 2123], [], undefined, 'ap')).slice(0, 3).map((x) => x.item) : [];
const nasusOk = nasusAp.length > 0 && (has(nasusAp, 'Blackfire Torch') || has(nasusAp, "Liandry's Torment"));
passed += nasusOk;
lines.push(`${nasusOk ? 'PASS' : 'FAIL'} 29 Nasus with Infinite Recursion, Marksmage, Infernal Conduit, Overloaded: the magic build offered, Blackfire Torch or Liandry's in its first three: ${nasusStyles.join(', ')} | ap: ${names(nasusAp).join(', ')}`);
// The owner (2026-11-07, «دسك اند داون تقريبا اهم ايتم لانه يدبل الضربه»): AP on-hit Kog'Maw, Nashor's Tooth, Dusk and Dawn, Berserker's, Guinsoo's, Rabadon's, Void Staff. Soft: in the magic build's first four, Nashor's and Dusk and Dawn.
const kogAp = (await services.mathBuild(idOf("Kog'Maw"), [], [], undefined, 'ap')).slice(0, 4).map((x) => x.item);
const kogOk = has(kogAp, "Nashor's Tooth") && has(kogAp, 'Dusk and Dawn');
passed += kogOk;
lines.push(`${kogOk ? 'PASS' : 'FAIL'} 32 Kog'Maw, magic build: Nashor's Tooth and Dusk and Dawn in the first four: ${names(kogAp).join(', ')}`);
// The owner (2026-11-07, «لماذا لا تاخذ ماللقننت»): ult-focused Kog'Maw, Malignance, Sorcerer's, Archangel's, Rabadon's, Shadowflame, Void Staff. Soft: with Phenomenal Evil, Magic Missile and Big Brain, Malignance in the magic build's first three.
const kogR = (await services.mathBuild(idOf("Kog'Maw"), [PHENOMENAL_EVIL, MAGIC_MISSILE, 1180], [], undefined, 'ap')).slice(0, 3).map((x) => x.item);
const kogROk = has(kogR, 'Malignance');
passed += kogROk;
lines.push(`${kogROk ? 'PASS' : 'FAIL'} 33 Kog'Maw with Phenomenal Evil, Magic Missile, Big Brain, magic build: Malignance in the first three: ${names(kogR).join(', ')}`);
// The owner (2026-11-08, «ناشور توث بيرزيركر ستاتيك شفت بورك ترمنينس هذي صح»), MoreZwag's Teemo (Y2bT4JXQuu8, game 1) with Dual Wield, Firebrand, Lightning Strikes, Scopier Weapons.
// Soft: at least four of the five in his whole build.
const teemoSet = ["Nashor's Tooth", "Berserker's Greaves", 'Statikk Shiv', 'Blade of The Ruined King', 'Terminus'];
const teemo = (await services.mathBuild(idOf('Teemo'), [1225, 1036, 1052, 1071])).map((x) => x.item);
const teemoOk = teemoSet.filter((n) => has(teemo, n)).length >= 4;
passed += teemoOk;
lines.push(`${teemoOk ? 'PASS' : 'FAIL'} 36 Teemo with Dual Wield, Firebrand, Lightning Strikes, Scopier Weapons: four of Nashor's, Berserker's, Statikk, BotRK, Terminus: ${names(teemo).join(', ')}`);
// The owner (2026-11-08, «Infinity Edge, Bloodthirster, Death's Dance, Wit's End, Phantom Dancer افضل للبطايق اللي اخذها»), MoreZwag's Yone (yMokerCSbZc, game 40). Soft: four of the five in the whole build.
const yoneSet = ["Infinity Edge", "Bloodthirster", "Death's Dance", "Wit's End", "Phantom Dancer"];
const yone = (await services.mathBuild(idOf("Yone"), [UPGRADE_IE, MYSTIC_PUNCH, 2107, 1322])).map((x) => x.item);
const yoneOk = yoneSet.filter((n) => has(yone, n)).length >= 4;
passed += yoneOk;
lines.push(`${yoneOk ? "PASS" : "FAIL"} 38 Yone with Upgrade Infinity Edge, Mystic Punch, Hellbent, Get Excited!: four of IE, Bloodthirster, Death's Dance, Wit's End, Phantom Dancer: ${names(yone).join(", ")}`);
// Case 30, the owner (2026-11-07, «بناء قوي»), BodyThoseFools' Cho'Gath: Heartsteel, Warmog's, Unending Despair, Steelcaps, Riftmaker, Sunfire, Rabadon's.
// 2026-11-08 the frontline draw (FRONT_DRAW) moved Jak'Sho before Warmog's; he kept it («نعم، أبقِه» to that question), so the check reads the whole build: Heartsteel and Warmog's or Unending Despair in it.
const cho = (await services.mathBuild(idOf("Cho'Gath"), [TANK_ENGINE, PRESSURE_COOKER, GOLIATH, SOUL_EATER])).map((x) => x.item);
const choOk = has(cho, 'Heartsteel') && (has(cho, "Warmog's Armor") || has(cho, 'Unending Despair'));
passed += choOk;
lines.push(`${choOk ? 'PASS' : 'FAIL'} 30 Cho'Gath with Tank Engine, Pressure Cooker, Goliath, Soul Eater: Heartsteel and Warmog's or Unending Despair in the build: ${names(cho).join(', ')}`);
lines.splice(1, 0, `passed ${passed} of ${cases.length + 9}`);
writeResult(import.meta.url, lines);
process.exit(0);
