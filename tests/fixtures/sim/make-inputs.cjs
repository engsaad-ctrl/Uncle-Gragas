// Copies the pinned 16.22 inputs for tests/sim: six champion bins as they are, and the items bin cut to the case items (same raw shape).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SRC = 'C:/Users/FoxOS_User/Documents/Codex/2026-11-09/uk/work/game-assets/16.22/';
const OUT = 'tests/fixtures/sim/16.22/';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const srcManifest = JSON.parse(fs.readFileSync(SRC + 'manifest.json', 'utf8'));
const srcOf = (p) => srcManifest.files.find((f) => f.path === p);
fs.mkdirSync(OUT + 'champions', { recursive: true });
const files = [];
for (const a of ['ahri', 'karthus', 'nasus', 'gragas', 'udyr', 'jayce']) {
  const p = `game/data/characters/${a}/${a}.bin.json`, raw = fs.readFileSync(SRC + p);
  if (sha(raw) !== srcOf(p).sha256) throw new Error('source hash ' + p);
  fs.writeFileSync(OUT + `champions/${a}.bin.json`, raw);
  files.push({ path: `champions/${a}.bin.json`, from: srcOf(p).url, sourceSha256: srcOf(p).sha256, sha256: sha(raw), cut: false });
}
const ITEMS = [3006, 3020, 3031, 3047, 3065, 3068, 3075, 3078, 3084, 3089, 3100, 3115, 3153, 3165, 6653, 6655, 6672];
const p = 'game/items.cdtb.bin.json', raw = fs.readFileSync(SRC + p);
if (sha(raw) !== srcOf(p).sha256) throw new Error('source hash items');
const bin = JSON.parse(raw), cut = {};
for (const [k, v] of Object.entries(bin)) {
  if (v?.__type !== 'ItemData' || !ITEMS.includes(v.itemID)) continue;
  cut[k] = v;
  if (v.spellName) for (const s of [`Items/Spells/${v.spellName}`, `Items/Spells/${v.spellName.replace(/Spell$/, '')}`]) if (bin[s]) cut[s] = bin[s];
  for (const g of v.mItemGroups ?? []) if (bin[g]) cut[g] = bin[g];
}
const found = Object.values(cut).filter((v) => v.__type === 'ItemData').map((v) => v.itemID);
const lost = ITEMS.filter((id) => !found.includes(id));
if (lost.length) throw new Error('items not in bin: ' + lost);
const text = JSON.stringify(cut);
fs.writeFileSync(OUT + 'items.cut.bin.json', text);
files.push({ path: 'items.cut.bin.json', from: srcOf(p).url, sourceSha256: srcOf(p).sha256, sha256: sha(Buffer.from(text)), cut: `ItemData of ${ITEMS.join(', ')}, with their item spells and groups` });
const version = JSON.parse(fs.readFileSync(SRC + 'content-metadata.json', 'utf8')).version;
fs.writeFileSync(OUT + 'manifest.json', JSON.stringify({ meaning: 'Riot game files of patch 16.22 as mirrored by CommunityDragon (not a Riot API), copied so the simulation cases read no network and no APPDATA.', contentVersion: version, files }, null, 1) + '\n');
console.log(files.map((f) => `${f.path} ${f.sha256.slice(0, 12)}`).join('\n'), '\nitems', found.length);
