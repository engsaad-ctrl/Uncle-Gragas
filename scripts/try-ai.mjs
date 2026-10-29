// Try the Mayhem AI build without the game: champion and augment names in, Gemini's build out.
// Usage: npm run try-ai -- "Miss Fortune" "Vulnerability" ["Another augment" ...]
// Asks for the Gemini key (or reads GEMINI_KEY). Downloads the game files on the first run (a few minutes).
import { createInterface } from 'node:readline/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geminiPost } from '../dist/ai/advisor.js';
import { createServices } from '../dist/main/services.js';

// npm on Windows hands names with spaces over as ^Miss^ Fortune^: the carets are cmd's escapes, not part of the name.
const [championName, ...augmentNames] = process.argv.slice(2).map((a) => a.replace(/\^/g, ''));
if (!championName || !augmentNames.length) {
  console.error('Usage: node scripts/try-ai.mjs "<champion>" "<augment>" ["<augment>" ...]');
  process.exit(1);
}
const key = process.env.GEMINI_KEY ?? (await createInterface({ input: process.stdin, output: process.stdout }).question('Gemini key: '));
const services = createServices({ cacheDir: join(tmpdir(), 'uncle-gragas-try'), fetchImpl: fetch });

const lower = (s) => s.trim().toLowerCase();
const champion = (await services.champions()).find((c) => [c.enName, c.name, c.alias].some((n) => lower(n) === lower(championName)));
if (!champion) throw new Error(`No champion named ${championName}`);
const all = (await services.augments()).augments.filter((a) => a.modes.includes('mayhem'));
const augments = augmentNames.map((n) => {
  const a = all.find((x) => lower(x.enName) === lower(n) || lower(x.name) === lower(n));
  if (!a) throw new Error(`No Mayhem augment named ${n}`);
  return a;
});
console.log(`${champion.enName} + ${augments.map((a) => a.enName).join(', ')}: asking Gemini…`);
const advice = await services.aiBuild(champion.id, augments.map((a) => a.id), geminiPost(key.trim(), fetch));
const items = (await services.items('mayhem')).list;
const name = (id) => items.find((i) => i.id === id)?.enName ?? `#${id}`;
console.log(`\nStyle: ${advice.style} — ${advice.styleReason}`);
for (const i of advice.items) console.log(`  ${name(i.id)}: ${i.reason}${i.inUsual ? ' (in the usual ARAM build)' : ''}`);
if (advice.avoid.length) console.log(`Avoid: ${advice.avoid.map((a) => `${name(a.id)} (${a.reason})`).join('; ')}`);
console.log(`\n${advice.summary}`);
console.log(`\nEffects read from the texts: ${advice.effects.length}`);
for (const e of advice.effects) console.log(`  ${e.kind} from ${e.source}: "${e.evidence}"`);
process.exit(0);
