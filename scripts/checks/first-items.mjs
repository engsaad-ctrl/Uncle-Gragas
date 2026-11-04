// First three items by arithmetic for every champion with a kit, no cards and no teams, as the app's services build them. Plan: knowledge/rebuild-checks-plan.md.
// Arg: a saved file to compare with (default first-items-baseline.json here, written on the first run). Gate for any later change: stop for the owner if more than 30 champions change their first item.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeResult } from './common.mjs';

const { createServices } = await import(pathToFileURL(`${process.cwd()}/dist/main/services.js`).href);
const { CHAMPION_KITS } = await import(pathToFileURL(`${process.cwd()}/dist/ai/championKits.js`).href);
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const services = createServices({ cacheDir: `${process.env.APPDATA}/LOL_helper`, fetchImpl: fetch });
const now = {};
let failed = 0;
for (const k of CHAMPION_KITS) {
  try { now[k.id] = (await services.mathBuild(k.id, [])).slice(0, 3).map((s) => s.item.enName); } catch { failed++; }
}
writeFileSync(here('first-items-latest.json'), JSON.stringify(now, null, 1));
const gapArg = process.argv.find((a) => a.startsWith('--gap='));
if (gapArg) (await import(pathToFileURL(`${process.cwd()}/dist/ai/cardMath.js`).href)).FIGHT.gapSeconds = Number(gapArg.split('=')[1]);
const savedPath = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? here('first-items-baseline.json');
const lines = [`first items, champions ${Object.keys(now).length}, failed ${failed}`];
if (!existsSync(savedPath)) {
  writeFileSync(savedPath, JSON.stringify(now, null, 1));
  lines.push(`no saved file: this run saved as ${savedPath}`);
} else {
  const saved = JSON.parse(readFileSync(savedPath, 'utf8'));
  const ids = Object.keys(now).filter((id) => saved[id]);
  const first = ids.filter((id) => saved[id][0] !== now[id][0]), any = ids.filter((id) => saved[id].join() !== now[id].join());
  lines.push(`against ${savedPath}: first item changed ${first.length} of ${ids.length}, any of the first three ${any.length}${first.length > 30 ? ': MORE THAN 30, stop for the owner' : ''}`);
  for (const id of first) lines.push(`  ${CHAMPION_KITS.find((k) => String(k.id) === id)?.name ?? id}: ${saved[id].join(', ')} -> ${now[id].join(', ')}`);
}
writeResult(import.meta.url, lines);
process.exit(0);
