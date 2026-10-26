// Rebuilds tests/fixtures/augments/sample.json from a probe run.
// Needs probe-output/ with cdragon/*/cherry-augments.json, gamestrings/lol.ar_ae.json and bins/*.bin.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { xxhash3 } from 'hash-wasm';

const P = 'probe-output/';
// Adamant (plain key), ArcaneAxiom (hashed key), LegDay (Cherry_ key in kiwi bin), SpeedDemon, Dropkick, Cerberus (no game data)
const IDS = [1327, 3118, 1305, 1405, 2006, 1397];
const read = (p) => JSON.parse(readFileSync(P + p, 'utf8'));

const listAr = read('cdragon/ar_ae/cherry-augments.json').filter((a) => IDS.includes(a.id));
const listEn = read('cdragon/default/cherry-augments.json').filter((a) => IDS.includes(a.id));
const entries = read('gamestrings/lol.ar_ae.json').entries;
const lower = new Map(Object.keys(entries).map((k) => [k.toLowerCase(), k]));

const bins = {};
const keys = new Set();
for (const f of ['cherry', 'kiwi', 'kiwi_jade', 'map30']) {
  bins[f] = {};
  for (const [k, v] of Object.entries(read(`bins/${f}.bin.json`))) {
    if (v?.__type === 'AugmentData' && IDS.includes(v.AugmentPlatformId)) {
      bins[f][k] = v;
      keys.add(v.DescriptionTra);
      keys.add(v.AugmentTooltipTra);
    }
  }
}

const strings = { kiwi_adamant_name: entries.kiwi_adamant_name };
for (const k of keys) {
  if (!k) continue;
  const real = lower.get(k.toLowerCase());
  if (real) {
    strings[real] = entries[real];
    continue;
  }
  const h = BigInt('0x' + (await xxhash3(k.toLowerCase()))) & ((1n << 38n) - 1n);
  const hashed = `{${h.toString(16).padStart(10, '0')}}`;
  if (entries[hashed] !== undefined) strings[hashed] = entries[hashed];
}

mkdirSync('tests/fixtures/augments', { recursive: true });
writeFileSync('tests/fixtures/augments/sample.json', JSON.stringify({ listAr, listEn, bins, strings }, null, 1));
console.log(`augments ${listAr.length}, strings ${Object.keys(strings).length}`);
