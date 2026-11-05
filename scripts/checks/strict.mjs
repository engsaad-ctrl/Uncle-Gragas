// Strict rules that accept more than one right build (the owner, 2026-11-05: «لازم نسوي اختبارات صارمه وتقبل المرونه»).
// Every champion, every build style the app offers him (his kit's own and each button), no augments. A build passes when it breaks none of the owner's rules; which items it holds is free. Each rule is first tried on builds made to break it: a rule that doesn't catch its own breakers isn't counted. Run from the repo root after the build: node scripts/checks/strict.mjs
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { shop, writeResult } from './common.mjs';
const imp = (p) => import(pathToFileURL(`${process.cwd()}/dist/${p}`).href);
const { createServices } = await imp('main/services.js');
const { CHAMPION_KITS } = await imp('ai/championKits.js');
const { ITEM_MECHANICS } = await imp('ai/mechanicsData.js');
const { ITEM_NUMBERS } = await imp('ai/cardMathData.js');
const { ONE_OF } = await imp('app/buildEngine.js');
const dir = `${process.env.APPDATA}/LOL_helper`;
const services = createServices({ cacheDir: dir, fetchImpl: fetch });
const list = (await services.items('mayhem')).list;
const sold = new Map(list.filter((i) => (i.group === 'legendary' || i.group === 'boots') && i.html).map((i) => [i.id, i]));
const byName = (n) => [...sold.values()].find((i) => i.enName === n && Math.floor(i.id / 10000) !== 77)?.id;
const dv = (id, name) => shop[id]?.DataValues?.find((d) => d.name === name)?.values?.[0] ?? 0;
const AD = new Set(['ad', 'bonus_ad', 'lethality']);
// Exact id first: Mayhem-only items keep a six-digit record (Rite of Ruin 123430), as services' itemDamage reads them.
const gives = (id) => new Set((ITEM_MECHANICS.find((m) => m.id === id) ?? ITEM_MECHANICS.find((m) => m.id === id % 10000))?.gives.map((g) => g.stat) ?? []);
const kind = (id) => { if (sold.get(id)?.group === 'boots') return 'boots'; const g = gives(id); const ad = [...g].some((s) => AD.has(s)); return g.has('ap') && !ad ? 'ap' : ad && !g.has('ap') ? 'ad' : g.has('ap') && ad ? 'mixed' : 'tank'; };
const crit = (id) => dv(id, 'FlatCritChanceMod') > 0;
const mana = (id) => dv(id, 'FlatMPPoolMod') > 0;
// Ardent Censer's attack speed is for the allies he heals (an enchanter's item), not his own attacks.
const onHitItem = (id) => (gives(id).has('attack_speed') && id !== byName('Ardent Censer')) || (ITEM_NUMBERS.find((x) => x.id === id % 10000)?.ops ?? []).some((o) => o.trigger === 'on_hit');
const HEARTSTEEL = byName('Heartsteel'), DUSK = byName('Dusk and Dawn');
const binResource = (alias) => { try { const b = JSON.parse(readFileSync(`${dir}/game/champions/${alias.toLowerCase()}.json`, 'utf8')).data; const r = Object.values(b).find((v) => v?.__type === 'CharacterRecord')?.primaryAbilityResource; return (r?.arType ?? 0) === 0 && (r?.['{726ee5cd}']?.baseValue ?? 0) > 0; } catch { return null; } };
const champs = await services.champions();
const RULES = [
  { id: 'shop', text: 'only items in the Mayhem shop (no 77xxxx copies such as Deathfire Grasp)', applies: () => true, broken: (ids) => ids.some((id) => !sold.has(id) || Math.floor(id / 10000) === 77) },
  { id: 'limits', text: 'no two items of one limit group', applies: () => true, broken: (ids) => ONE_OF.some((g) => ids.filter((id) => g.includes(id % 10000)).length > 1) },
  { id: 'boots', text: 'one pair of boots at most', applies: () => true, broken: (ids) => ids.filter((id) => kind(id) === 'boots').length > 1 },
  { id: 'mana-first', text: 'a mage starts with a magic mana item', applies: (c) => c.mage && (c.style === 'kit' || c.style === 'ap'), broken: (ids) => { const f = ids.find((id) => kind(id) !== 'boots' && id !== HEARTSTEEL); return !f || !(mana(f) && kind(f) === 'ap'); } },
  { id: 'no-attack-items', text: 'a magic non-attacker gets no attack or on-hit items, nor Dusk and Dawn', applies: (c) => c.kit.damage === 'magic' && !c.kit.relies.includes('attacks') && c.style !== 'tank', broken: (ids) => ids.some((id) => kind(id) !== 'boots' && (onHitItem(id) || id === DUSK)) },
  { id: 'marksman-crit', text: 'a marksman (ranged physical attacker, not on-hit, not frontline) has a crit item in his first three', applies: (c) => c.ranged && c.kit.damage === 'physical' && c.kit.relies.includes('attacks') && !c.kit.relies.includes('on_hit') && !c.kit.traits.includes('frontline') && c.style === 'kit', broken: (ids) => !ids.filter((id) => kind(id) !== 'boots').slice(0, 3).some(crit) },
  { id: 'damage-kind', text: 'the build keeps its style\'s damage kind', applies: (c) => c.style !== 'tank' && c.style !== 'aphp' && (c.style !== 'kit' || c.kit.damage !== 'mixed'), broken: (ids, c) => { const want = c.style === 'kit' ? (c.kit.damage === 'magic' ? 'ap' : 'ad') : c.style; return ids.some((id) => (kind(id) === 'ap' || kind(id) === 'ad') && kind(id) !== want); } },
  { id: 'tank-style', text: 'the tank button holds no AP or AD items', applies: (c) => c.style === 'tank', broken: (ids) => ids.some((id) => kind(id) === 'ap' || kind(id) === 'ad') },
  { id: 'aphp-style', text: 'magic with health: no physical items, at most one pure tank item besides boots', applies: (c) => c.style === 'aphp', broken: (ids) => ids.some((id) => kind(id) === 'ad') || ids.filter((id) => kind(id) === 'tank').length > 1 },
  { id: 'stacks-first', text: 'Heartsteel, when held, is bought first', applies: () => true, broken: (ids) => ids.includes(HEARTSTEEL) && ids.filter((id) => kind(id) !== 'boots')[0] !== HEARTSTEEL },
];
const pick = (pred) => [...sold.keys()].filter((id) => Math.floor(id / 10000) !== 77 && pred(id));
const pools = { ap: pick((id) => kind(id) === 'ap'), ad: pick((id) => kind(id) === 'ad'), tank: pick((id) => kind(id) === 'tank'), boots: pick((id) => kind(id) === 'boots') };
const BREAKERS = {
  shop: () => [773128, ...pools.ap.slice(0, 5)],
  limits: () => { const g = ONE_OF[0].map((x) => byName(sold.get(x)?.enName) ?? x).filter((x) => sold.has(x)); return [...g.slice(0, 2), ...pools.ad.slice(0, 4)]; },
  boots: () => [...pools.boots.slice(0, 2), ...pools.ap.slice(0, 4)],
  'mana-first': () => [pools.ap.find((id) => !mana(id)), ...pools.ap.filter(mana).slice(0, 1), ...pools.ap.slice(5, 9)],
  'no-attack-items': () => [byName("Nashor's Tooth"), ...pools.ap.slice(0, 5)],
  'marksman-crit': () => pools.ad.filter((id) => !crit(id)).slice(0, 6),
  'damage-kind': (c) => (c.style === 'ap' || (c.style === 'kit' && c.kit.damage === 'magic') ? [...pools.ap.slice(0, 5), pools.ad[0]] : [...pools.ad.slice(0, 5), pools.ap[0]]),
  'tank-style': () => [...pools.tank.slice(0, 5), pools.ap[0]],
  'aphp-style': () => [...pools.tank.slice(0, 2), ...pools.ap.slice(0, 4)],
  'stacks-first': () => [pools.tank.find((id) => id !== HEARTSTEEL), HEARTSTEEL, ...pools.tank.slice(2, 6)],
};
const cases = [];
for (const c of champs.filter((x) => x.id > 0 && x.id < 1000)) {
  const k = CHAMPION_KITS.find((x) => x.id === c.id); if (!k) continue;
  let styles = []; try { styles = await services.buildStyles(c.id, []); } catch { continue; }
  const ranged = (() => { try { const b = JSON.parse(readFileSync(`${dir}/game/champions/${c.alias.toLowerCase()}.json`, 'utf8')).data; return (Object.values(b).find((v) => v?.__type === 'CharacterRecord')?.attackRangeModifiable?.baseValue ?? 0) >= 300; } catch { return false; } })();
  const manaUser = binResource(c.alias);
  const MAGE_SUPPORTS = new Set([99, 1, 61, 147, 25, 43, 26]);
  const buffs = k.relies.includes('allies') && (k.relies.includes('healing') || k.relies.includes('shielding'));
  const mage = !!manaUser && k.damage === 'magic' && !k.relies.includes('attacks') && (!buffs || MAGE_SUPPORTS.has(c.id)) && !k.traits.includes('frontline');
  for (const style of ['kit', ...styles]) {
    let ids; try { ids = (await services.mathBuild(c.id, [], [], undefined, style === 'kit' ? undefined : style)).map((s) => s.item.id); } catch { continue; }
    cases.push({ name: c.name, id: c.id, kit: k, style, ranged, mage, ids });
  }
}
const L = []; let validRules = 0; const counted = new Set();
L.push('rules tried on builds made to break them (a rule must catch all of them to count):');
for (const r of RULES) { const tried = cases.filter((c) => r.applies(c)).slice(0, 40); const caught = tried.filter((c) => r.broken(BREAKERS[r.id](c).filter(Boolean), c)).length; const ok = tried.length > 0 && caught === tried.length; if (ok) { validRules++; counted.add(r.id); } L.push(`- ${r.id}: caught ${caught} of ${tried.length} breakers -> ${ok ? 'counted' : 'NOT COUNTED'}`); }
L.push(`\nthe engine on ${cases.length} builds (${new Set(cases.map((c) => c.id)).size} champions, every style offered, no augments):`);
let failed = 0;
for (const r of RULES.filter((x) => counted.has(x.id))) { const bad = cases.filter((c) => r.applies(c) && r.broken(c.ids, c)); failed += bad.length; L.push(`- ${r.id} (${r.text}): ${bad.length} of ${cases.filter((c) => r.applies(c)).length} break it${bad.length ? ': ' + bad.slice(0, 12).map((c) => `${c.name}/${c.style} [${c.ids.map((id) => sold.get(id)?.enName ?? id).join(', ')}]`).join('; ') : ''}`); }
L.splice(0, 0, `strict rules: ${validRules} of ${RULES.length} rules counted; engine builds breaking a counted rule: ${failed}`);
writeResult(import.meta.url, L);
console.log(L.slice(0, 16).join('\n'));
process.exit(0);
