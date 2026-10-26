import { xxhash3 } from 'hash-wasm';

// Riot string tables key unnamed entries by xxh3-64 of the lowercased key, truncated to 38 bits.
export async function stringTableKey(key: string): Promise<string> {
  const h = BigInt('0x' + (await xxhash3(key.toLowerCase()))) & ((1n << 38n) - 1n);
  return `{${h.toString(16).padStart(10, '0')}}`;
}
