import { describe, expect, it, vi } from 'vitest';
import { adviseBuild, contextText, legalBuilds, MODELS, namedItems, realBuild, toEffect, type AdviceInput, type GeminiPost } from '../../src/ai/advisor.js';
import type { BuildResult } from '../../src/ai/calculator.js';

const input: AdviceInput = {
  champion: { name: 'ميس فورتشن', enName: 'Miss Fortune', abilities: [{ key: 'Q', enName: 'Double Up', text: '<magicDamage>bounces</magicDamage>' }] },
  augments: [{ id: 1205, name: 'الضعف', enName: 'Vulnerability', text: 'Attacks deal magic damage' }],
  pool: [
    { id: 3089, enName: "Rabadon's Deathcap", gold: 3500, boots: false, text: '+130 AP' },
    { id: 3031, enName: 'Infinity Edge', gold: 3450, boots: false, text: '+65 AD' },
    { id: 3020, enName: "Sorcerer's Shoes", gold: 1100, boots: true, text: '+18 magic pen' },
    { id: 3006, enName: "Berserker's Greaves", gold: 1100, boots: true, text: '+25% AS' },
  ],
  usual: [3006, 3031],
};

/** generateContent's reply shape: a thought part (skipped) and the JSON text. */
const reply = (o: object) => ({ status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'thinking' }, { text: JSON.stringify(o) }] } }] } });
const fakeResult = (items: number[]) => ({ items, stats: {}, abilities: [] }) as unknown as BuildResult;

describe('legalBuilds', () => {
  it('drops builds with unknown or repeated items, more than six, or two pairs of boots', () => {
    const ok = { label: 'ap', items: [3020, 3089] };
    const out = legalBuilds([ok, { label: 'x', items: [1] }, { label: 'y', items: [3089, 3089] }, { label: 'z', items: [3020, 3006] }], input.pool);
    expect(out).toEqual([ok]);
  });
});

describe('realBuild', () => {
  const played = (withAugments: number) => ({
    games: 20, items: [], withAugments,
    itemsWithAugments: [3089, 3020, 3031, 3006, 9999].map((id, i) => ({ id, games: 9 - i, wins: 4 })),
  });
  it('takes what players with the augments bought, boots first and one pair only, items off the map left out', () => {
    expect(realBuild({ ...input, played: played(9) })).toEqual([3020, 3089, 3031]);
  });
  it('gives nothing with too few games', () => {
    expect(realBuild({ ...input, played: played(2) })).toBeNull();
    expect(realBuild(input)).toBeNull();
  });
});

describe('toEffect', () => {
  it('keeps a passive that fits the calculator and drops one that does not', () => {
    expect(toEffect({ kind: 'statMultiplier', source: 3089, evidence: '+30%', stat: 'ap', factor: 1.3 })).toMatchObject({ factor: 1.3 });
    expect(toEffect({ kind: 'statMultiplier', source: 3089, evidence: '+3000%', stat: 'ap', factor: 30 })).toBeNull();
    expect(toEffect({ kind: 'attackSpeedCap', source: 1205, evidence: 'no cap', cap: 0 })).toMatchObject({ cap: null });
  });
});

describe('contextText', () => {
  it('lists the items in id order whatever order they come in', () => {
    expect(contextText({ ...input, pool: [...input.pool].reverse() })).toBe(contextText(input));
  });

  it('gives the real games with their counts, and flags a small sample', () => {
    const text = contextText({
      ...input,
      augments: [{ ...input.augments[0], tier: 'S+' }],
      played: { games: 12, items: [{ id: 3031, games: 9, wins: 5 }], withAugments: 2, itemsWithAugments: [{ id: 3089, games: 2, wins: 2 }] },
    });
    expect(text).toContain('1205 | Vulnerability (الضعف) | S+ |');
    expect(text).toContain("games of this champion: 12. Items bought: 3031 Infinity Edge (9 games, 5 wins)");
    expect(text).toContain("chosen augments: 2 (too few). Items bought: 3089 Rabadon's Deathcap (2 games, 2 wins)");
    expect(contextText(input)).toContain('none recorded yet');
  });

  it('finds the items an augment is about, by its English name or the whole Arabic item name in its text', () => {
    const shop = [
      { id: 3084, name: 'القلب الفولاذي', enName: 'Heartsteel' },
      { id: 6676, name: 'الجامع', enName: 'The Collector' },
      { id: 6701, name: 'الفرصة', enName: 'Opportunity' },
    ];
    expect(namedItems({ enName: 'Steel Your Heart', text: 'المهمة: امتلك <b>القلب الفولاذي</b> مع 300+ من التكدسات.' }, shop)).toEqual([3084]);
    expect(namedItems({ enName: 'Upgrade Collector', text: 'يؤدي الإجهاز باستخدام عنصر جامع الضرائب' }, shop)).toEqual([6676]);
    expect(namedItems({ enName: 'Time Warp: Heartsteel', text: '' }, shop)).toEqual([3084]);
    expect(namedItems({ enName: "It's Critical", text: 'تكسب 20% فرصة ضربة حرجة' }, shop)).toEqual([]); // "chance", not the item
  });

  it('points an augment to the items its text names', () => {
    const text = contextText({ ...input, augments: [{ ...input.augments[0], items: [3089] }] });
    expect(text).toContain("| names items: 3089 Rabadon's Deathcap");
  });
});

describe('adviseBuild', () => {
  it('calculates the candidates plus the usual build, then keeps the chosen one exactly as calculated', async () => {
    const bodies: { contents: { parts: { text: string }[] }[] }[] = [];
    const replies = [
      reply({
        style: 'ap', styleReason: 'التعزيز يحول الهجمات لضرر سحري',
        candidates: [{ label: 'ap', items: [3020, 3089] }, { label: 'bad', items: [3089, 9999] }],
        effects: [{ kind: 'onHit', source: 1205, evidence: 'Attacks deal magic damage', damageType: 'magic', flat: 10, apRatio: 0.1, totalAdRatio: 0, bonusAdRatio: 0 }],
      }),
      reply({ chosen: 0, alternative: 1, alternativeStyle: 'ad', alternativeWhen: 'إذا احتاج فريقك ضرراً مادياً', alternativeItems: [{ id: 3031, reason: 'ضرر هجوم' }], style: 'burn', styleReason: 'حرق', items: [{ id: 3089, reason: 'أعلى قوة قدرة' }, { id: 3031, reason: 'ليس في البناء' }], avoid: [{ id: 3031, reason: 'لا يناسب الضرر السحري' }], summary: 'ابنِ AP.' }),
    ];
    const post: GeminiPost = async (_model, b) => (bodies.push(b as never), replies.shift()!);
    const asked: number[][][] = [];
    const a = await adviseBuild(post, input, (builds) => (asked.push(builds), builds.map(fakeResult)));
    expect(asked).toEqual([[[3020, 3089], [3006, 3031]]]); // the bad candidate never reaches the calculator
    expect(a.items).toEqual([{ id: 3020, reason: '', inUsual: false }, { id: 3089, reason: 'أعلى قوة قدرة', inUsual: false }]);
    expect(a.avoid).toEqual([]); // 3031 was avoided but is in the alternative build
    expect(a.effects).toHaveLength(1);
    expect(a.style).toBe('burn'); // the final step's style, not step 1's 'ap'
    expect(a.alternative).toMatchObject({ style: 'ad', when: 'إذا احتاج فريقك ضرراً مادياً', items: [{ id: 3006, reason: '', inUsual: true }, { id: 3031, reason: 'ضرر هجوم', inUsual: true }] });
    expect(a.calc.items).toEqual([3020, 3089]); // each build carries its own calculator numbers
    expect(a.alternative?.calc.items).toEqual([3006, 3031]);
    expect(bodies[1].contents[0].parts[0].text).toContain('usual build');
  });

  it('reads a bad-key reply in the shape Google sends it', async () => {
    const post: GeminiPost = async () => ({ status: 400, json: [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }] });
    await expect(adviseBuild(post, input, () => [])).rejects.toThrow(/مفتاح Gemini غير صالح/);
  });

  it('says plainly when the free quota is used up on every model', async () => {
    const post: GeminiPost = async () => ({ status: 429, json: null });
    await expect(adviseBuild(post, input, () => [])).rejects.toThrow(/الحد المجاني/);
  });

  it('tries a busy model once more, then the next one', async () => {
    vi.useFakeTimers();
    const tried: string[] = [];
    const post: GeminiPost = async (model) => (tried.push(model), model === MODELS[2] ? reply({ style: 'ap', styleReason: 'س', candidates: [], effects: [] }) : { status: 503, json: null });
    const run = expect(adviseBuild(post, { ...input, usual: [] }, () => [])).rejects.toThrow(/بناءً صالحاً/);
    await vi.runAllTimersAsync();
    await run;
    expect(tried).toEqual([MODELS[0], MODELS[0], MODELS[1], MODELS[1], MODELS[2]]);
    vi.useRealTimers();
  });

  it('moves on to the next model when the first does not answer in time', async () => {
    const tried: string[] = [];
    const post: GeminiPost = async (model) => (tried.push(model), model === MODELS[0] ? { status: 0, json: null } : reply({ style: 'ap', styleReason: 'س', candidates: [], effects: [] }));
    await expect(adviseBuild(post, { ...input, usual: [] }, () => [])).rejects.toThrow(/بناءً صالحاً/); // got past Gemini
    expect(tried).toEqual(MODELS.slice(0, 2));
  });
});

describe('synergy in the context', () => {
  it('lists the items that won more with each chosen augment', () => {
    const text = contextText({ ...input, synergy: [{ augment: 1205, item: 3089, games: 40, wins: 26, lift: 0.12 }] });
    expect(text).toContain("Vulnerability: 3089 Rabadon's Deathcap (40 games, 65% wins, +12)");
    expect(contextText(input)).not.toContain('won more with these augments');
  });
});
