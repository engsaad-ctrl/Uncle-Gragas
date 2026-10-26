// Diagnostics export: raw client answers with anything identifying removed, so the owner can share the file.

const SENSITIVE = /name|tagline|puuid|summonerid|accountid|playerid|token|password|chat|email/i;
const KEEP = /^(nameVisibilityType|championName|gameName_?visible)$/i; // flags/labels, not identities

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) && !KEEP.test(k) ? '[حُذف]' : scrub(v)]),
    );
  }
  return value;
}
