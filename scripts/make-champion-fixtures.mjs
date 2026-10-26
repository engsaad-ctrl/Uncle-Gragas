// Rebuilds the champion-page fixtures from a probe run (probe-output/). Real data, trimmed to what tests read.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const P = 'probe-output/';
const read = (p) => JSON.parse(readFileSync(P + p, 'utf8'));
const out = (p, data) => writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 1));
mkdirSync('tests/fixtures/opgg', { recursive: true });
mkdirSync('tests/fixtures/cdragon', { recursive: true });

const ability = ({ name, description, abilityIconPath, spellKey }) => ({ name, description, abilityIconPath, spellKey });
const champ = (c) => ({ id: c.id, name: c.name, alias: c.alias, title: c.title, squarePortraitPath: c.squarePortraitPath, passive: ability(c.passive), spells: c.spells.map(ability) });
out('tests/fixtures/cdragon/champion-103.ar_ae.json', champ(read('cdragon/ar_ae/champion-103.json')));
out('tests/fixtures/cdragon/champion-103.default.json', champ(read('cdragon/default/champion-103.json')));

const summary = (l) => read(`cdragon/${l}/champion-summary.json`).filter((c) => [-1, 103, 62, 60001].includes(c.id))
  .map(({ id, name, alias, squarePortraitPath }) => ({ id, name, alias, squarePortraitPath }));
out('tests/fixtures/cdragon/champion-summary.ar_ae.sample.json', summary('ar_ae'));
out('tests/fixtures/cdragon/champion-summary.default.sample.json', summary('default'));

const spells = (l) => read(`cdragon/${l}/summoner-spells.json`).filter((s) => [4, 14].includes(s.id))
  .map(({ id, name, description, iconPath }) => ({ id, name, description, iconPath }));
out('tests/fixtures/cdragon/summoner-spells.ar_ae.sample.json', spells('ar_ae'));
out('tests/fixtures/cdragon/summoner-spells.default.sample.json', spells('default'));

const styles = (l) => ({
  styles: read(`cdragon/${l}/perkstyles.json`).styles.map(({ id, name, iconPath, slots }) => ({
    id, name, iconPath, slots: slots.map(({ type, slotLabel, perks }) => ({ type, slotLabel, perks })),
  })),
});
out('tests/fixtures/cdragon/perkstyles.ar_ae.json', styles('ar_ae'));
out('tests/fixtures/cdragon/perkstyles.default.json', styles('default'));

out('tests/fixtures/opgg/ahri-ranked-mid.txt', readFileSync(P + 'opgg/ana-ahri-ranked.txt', 'utf8'));
out('tests/fixtures/opgg/ahri-aram.txt', readFileSync(P + 'opgg/ana-ahri-aram.txt', 'utf8'));
out('tests/fixtures/opgg/ahri-mayhem-augments.txt', read('opgg/deep-mayhem_aug.json').content[0].text);
console.log('fixtures written');

// Every perk of Ahri's two trees (Domination 8100, Sorcery 8200) plus stat shards, for the rune-page test.
const trees = read('cdragon/ar_ae/perkstyles.json').styles.filter((s) => [8100, 8200].includes(s.id));
const pageIds = new Set(trees.flatMap((s) => s.slots.flatMap((sl) => sl.perks)));
out('tests/fixtures/cdragon/perks.ar_ae.page.json', read('cdragon/ar_ae/perks.json').filter((p) => pageIds.has(p.id))
  .map(({ id, name, shortDesc, longDesc, iconPath }) => ({ id, name, shortDesc, longDesc, iconPath })));
console.log('page perks', pageIds.size);

// Tier list (all lanes) and per-map item lists from OP.GG; item lists trimmed to the fields the app reads.
out('tests/fixtures/opgg/meta-all.txt', readFileSync(P + 'opgg/meta-all.txt', 'utf8'));
for (const map of ['SUMMONERS_RIFT', 'ARENA_MAP_1']) {
  const j = JSON.parse(readFileSync(P + `opgg/items-${map}.txt`, 'utf8'));
  j.data.items = j.data.items.map(({ item_id, name, into_items, from_items, gold_total, gold_purchasable }) => ({ item_id, name, into_items, from_items, gold_total, gold_purchasable }));
  out(`tests/fixtures/opgg/items-${map}.json`, JSON.stringify(j));
}
// The real items of a few groups, for the item-list test: boots, a basic, an epic, a legendary, a starter, a potion, a ward.
const want = [1001, 3020, 1036, 3133, 3031, 1055, 2003, 3340, 3157];
out('tests/fixtures/cdragon/items.ar_ae.groups.json', read('cdragon/ar_ae/items.json').filter((i) => want.includes(i.id))
  .map(({ id, name, description, inStore, iconPath, categories, from, to }) => ({ id, name, description, inStore, iconPath, categories, from, to })));
