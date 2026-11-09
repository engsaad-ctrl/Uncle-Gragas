import { describe, expect, it } from 'vitest';
import { explainBuild } from '../../src/ai/buildExplanation.js';
import { itemExplanationWords } from '../../src/app/buildExplanation.js';
import type { GameItem } from '../../src/texts/gameData.js';
import type { CardNumbers } from '../../src/ai/cardMath.js';

const num = (baseValue: number) => ({ baseValue });
const bin = { rec: { __type: 'CharacterRecord', spells: [], attackRangeModifiable: num(500), baseHPModifiable: num(1000), hpPerLevelModifiable: num(0), baseDamageModifiable: num(100), damagePerLevelModifiable: num(0), baseArmorModifiable: num(0), armorPerLevelModifiable: num(0), baseMR: num(0), mrPerLevel: num(0), baseMoveSpeedModifiable: num(325), attackSpeedModifiable: num(0.6), attackSpeedRatioModifiable: num(0.6), attackSpeedPerLevelModifiable: num(0) } };
const item = (stats: Record<string, number>) => ({ DataValues: Object.entries(stats).map(([name, v]) => ({ name, values: [v] })) }) as GameItem;
const card: CardNumbers = { id: 10001, name: 'AP hit', status: 'computed', ops: [{ op: 'proc', trigger: 'on_hit', internal_cooldown: 99, damage: { ap: 1 }, type: 'true' }] };
const base = { bin, shop: { 1: item({ FlatMagicDamageMod: 100 }), 2: item({ FlatHPPoolMod: 300 }), 3: item({ APAmp: 0.5 }) }, level: 15, kit: { damage: 'magic' as const, attacks: true }, items: [1, 2], cards: [card] };

describe('build reasons from conditional changes in physical quantities', () => {
  it('finds an AP item feeding an attack effect and leaves unrelated health out of that link', () => {
    const r = explainBuild(base);
    const ap = r.items.find((i) => i.id === 1)!;
    expect(ap.delta.damage).toBeCloseTo(100);
    expect(ap.interactions.find((i) => i.kind === 'augment')!.delta.damage).toBeCloseTo(100);
    const hp = r.items.find((i) => i.id === 2)!;
    expect(hp.delta.effectiveHp).toBeCloseTo(300);
    expect(hp.interactions.every((i) => Math.abs(i.delta.damage) < 1e-8 && Math.abs(i.delta.effectiveHp) < 1e-8)).toBe(true);
  });
  it('measures a multiplier pair within the rest of the set', () => {
    const r = explainBuild({ ...base, items: [1, 3] });
    const ap = r.items.find((i) => i.id === 1)!;
    expect(ap.delta.damage).toBeCloseTo(150);
    expect(ap.interactions.find((i) => i.kind === 'item' && i.id === 3)!.delta.damage).toBeCloseTo(50);
    expect(r.items.find((i) => i.id === 3)!.interactions.find((i) => i.kind === 'item' && i.id === 1)!.delta.damage).toBeCloseTo(50);
  });
  it('re-evaluates attack enablement when removing the only card that enables attacks', () => {
    const r = explainBuild({ ...base, kit: { ...base.kit, attacks: false } });
    const link = r.items[0]!.interactions.find((i) => i.kind === 'augment')!;
    expect(link.delta.damage).toBeCloseTo(100);
  });
  it('keeps unknown effects visible and does not mutate the supplied set', () => {
    const o = { ...base, cards: [...base.cards, { id: 10002, name: 'Unknown', status: 'unreadable', ops: [] }] };
    const before = JSON.stringify(o);
    expect(explainBuild(o).missing).toContain('Unknown: لا توجد معادلات');
    expect(JSON.stringify(o)).toBe(before);
  });
  it('renders units and scenario without calling the figures win probabilities', () => {
    const r = explainBuild(base);
    const words = itemExplanationWords(r, 1, (_kind, id) => String(id)).join(' ');
    expect(words).toContain('مستوى 15 خلال 15ث');
    expect(words).toContain('ضرر +100');
    expect(words).toContain('10001');
    expect(words).not.toContain('%');
  });
});
