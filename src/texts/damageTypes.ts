// Each ability's damage type, as its own tooltip marks it: <magicDamage>@TotalDamage@ magic damage</magicDamage>. The fight used one type for a
// whole kit (or the mean of physical and magic for a mixed one); Ahri's Q is magic out and true back, Nasus's Q physical and his E magic.

export type DamageKind = 'physical' | 'magic' | 'true';
/** byName: the types around each value the text names (one entry a span, so magic and true for Ahri's Q); all: every damage span's type. */
export interface SpellDamageTypes { byName: Record<string, DamageKind[]>; all: DamageKind[] }

const SPAN = /<(physical|magic|true)Damage>([\s\S]*?)<\/\1Damage>/gi;
const NAME = /@([^@*\s]+?)(?:\*[-\d.]+)?@/g;

export function damageTypesOf(text: string): SpellDamageTypes {
  const out: SpellDamageTypes = { byName: {}, all: [] };
  for (const [, kind, inner] of text.matchAll(SPAN)) {
    const k = kind!.toLowerCase() as DamageKind;
    out.all.push(k);
    for (const [, name] of inner!.matchAll(NAME)) (out.byName[name!.toLowerCase()] ??= []).push(k);
  }
  return out;
}

type SpellObject = { __type?: string; mSpell?: { mClientData?: { mTooltipData?: { mLocKeys?: { keyTooltip?: string } } } } };

/** The bin with each spell's tooltip damage types attached (mSpell.__damageTypes) when its tooltip is in `strings`; the rest as it is. */
const lowered = new WeakMap<Record<string, string>, Map<string, string>>(); // one lower-case index per string table
export function withDamageTypes<B extends Record<string, unknown>>(bin: B, strings: Record<string, string>): B {
  let lower = lowered.get(strings);
  if (!lower) lowered.set(strings, (lower = new Map(Object.entries(strings).map(([k, v]) => [k.toLowerCase(), v]))));
  return Object.fromEntries(Object.entries(bin).map(([path, v]) => {
    const spell = (v as SpellObject | undefined)?.mSpell;
    const key = spell?.mClientData?.mTooltipData?.mLocKeys?.keyTooltip;
    const text = key ? lower.get(key.toLowerCase()) : undefined;
    if (!spell || !text) return [path, v];
    const types = damageTypesOf(text);
    return [path, types.all.length ? { ...(v as object), mSpell: { ...spell, __damageTypes: types } } : v];
  })) as B;
}
