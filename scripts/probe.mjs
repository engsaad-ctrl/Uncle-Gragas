// Phase-0 probe: what do CommunityDragon and OP.GG MCP actually return?
// Usage: npm run probe  → writes probe-output/ (summary.txt is the part to share)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fillArgs, summarizeJson } from './probe-lib.mjs';

const OUT = 'probe-output';
const CD = 'https://raw.communitydragon.org';
const V1 = (loc) => `${CD}/latest/plugins/rcp-be-lol-game-data/global/${loc}/v1`;
const FILES = ['items.json', 'perks.json', 'perkstyles.json', 'cherry-augments.json'];
const LISTINGS = ['latest/plugins/rcp-be-lol-game-data/global/ar_ae/v1/', 'latest/game/data/maps/shipping/'];

const report = [];
const log = (line) => {
  report.push(line);
  console.log(line);
};

async function save(rel, data) {
  const path = join(OUT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function probeCdragon() {
  log('== CommunityDragon');
  for (const loc of ['ar_ae', 'en_us']) {
    for (const file of FILES) {
      try {
        const data = await getJson(`${V1(loc)}/${file}`);
        await save(`cdragon/${loc}/${file}`, data);
        log(`OK ${loc}/${file} ${summarizeJson(data)}`);
      } catch (e) {
        log(`FAIL ${loc}/${file} ${e.message}`);
      }
    }
  }
  for (const dir of LISTINGS) {
    try {
      const names = (await getJson(`${CD}/json/${dir}`)).map((entry) => entry.name);
      await save(`cdragon/listing-${dir.replaceAll('/', '_')}.json`, names);
      const hits = names.filter((n) => /kiwi|augment|cherry|mayhem/i.test(n));
      log(`LIST ${dir} ${names.length} entries; matches: ${hits.join(', ') || 'none'}`);
    } catch (e) {
      log(`FAIL list ${dir} ${e.message}`);
    }
  }
}

async function probeOpgg() {
  log('== OP.GG MCP');
  const client = new Client({ name: 'lol-helper-probe', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp-api.op.gg/mcp')));
  } catch (e) {
    log(`FAIL connect ${e.message}`);
    return;
  }
  const { tools } = await client.listTools();
  await save('opgg/tools.json', tools);
  log(`OK tools(${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
  for (const tool of tools.filter((t) => t.name.startsWith('lol_'))) {
    const args = fillArgs(tool.inputSchema);
    if (!args) {
      log(`SKIP ${tool.name} (cannot fill required args)`);
      continue;
    }
    try {
      const res = await client.callTool({ name: tool.name, arguments: args });
      const text = JSON.stringify(res);
      await save(`opgg/${tool.name}.json`, { args, res });
      log(`${res.isError ? 'ERR' : 'OK'} ${tool.name} ${JSON.stringify(args)} ${text.length}B ${text.slice(0, 150)}`);
    } catch (e) {
      log(`FAIL ${tool.name} ${JSON.stringify(args)} ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1000)); // stay polite to the free API
  }
  await client.close();
}

await probeCdragon();
await probeOpgg();
await save('summary.txt', report.join('\n'));
console.log(`\nDone. Share ${join(OUT, 'summary.txt')}`);
