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

const styles = (l) => ({ styles: read(`cdragon/${l}/perkstyles.json`).styles.map(({ id, name, iconPath }) => ({ id, name, iconPath })) });
out('tests/fixtures/cdragon/perkstyles.ar_ae.json', styles('ar_ae'));
out('tests/fixtures/cdragon/perkstyles.default.json', styles('default'));

out('tests/fixtures/opgg/ahri-ranked-mid.txt', readFileSync(P + 'opgg/ana-ahri-ranked.txt', 'utf8'));
out('tests/fixtures/opgg/ahri-aram.txt', readFileSync(P + 'opgg/ana-ahri-aram.txt', 'utf8'));
out('tests/fixtures/opgg/ahri-mayhem-augments.txt', read('opgg/deep-mayhem_aug.json').content[0].text);
console.log('fixtures written');
