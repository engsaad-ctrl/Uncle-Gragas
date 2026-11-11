// What a card does for a champion, by arithmetic only: the champion's ability numbers and cooldowns from the game files, item stats, and the
// numbers in each augment's text (knowledge/augment-math-*.jsonl). No pick rate or win rate enters here. One fixed fight against one target
// gives damage dealt and effective health, so cards that multiply each other show it without any table of pairs. What the text does that the
// model can't run is named, never filled in from how often it's picked. Never a win chance.

import type { GameItem } from '../texts/gameData.js';
import { calculationsAt, type SpellData } from '../texts/spellValues.js';
import { buildStats, championRecord, statReader, type BuildStats } from './calculator.js';
import { SPELL_HITS } from './cardMathData.js';
import { AUGMENT_MECHANICS } from './mechanicsData.js';
import { allocateAbilityRanks, estimatedAbilityRank, type KnownRanks, type SkillPlan } from './abilityRank.js';
import type { TargetAbility } from './abilityTarget.js';
import type { SpellDamageTypes } from '../texts/damageTypes.js';

/** The items a quest card asks to be held, read from its text (mechanicsData needs); empty for quests counted in takedowns or hits. */
export const questItems = (cardId: number): number[] => (AUGMENT_MECHANICS.find((m) => m.id === cardId)?.needs ?? []).filter((n): n is number => typeof n === 'number');

type Amount = number | { min: number; max: number };
export interface DamageFormula { flat?: Amount; mana?: number; ap?: number; ad?: number; bonus_ad?: number; hp?: number; bonus_hp?: number; armor?: number; mr?: number; bonus_armor?: number; bonus_mr?: number; target_max_hp?: number; target_missing_hp?: number; target_current_hp?: number; /** AP times bonus health: a ratio on AP that grows with bonus health (Tahm Kench's passive, 1.25% AP per 100 bonus health). */ ap_per_bonus_hp?: number; /** AD times crit chance times crit damage above 100%: a bonus that grows with crit without critting (Caitlyn's headshot, 0.8 of it). */ ad_crit?: number; /** Per 100% crit chance (Essence Reaver's mana: 25). */ crit?: number }
export type CardOp =
  /** scope chosen_ability: haste on the skill the player names (Bread); movement_abilities: on each of his skills the files tag as moving him (Dashing, MOVEMENT_TAGS). */
  | { op: 'add'; stat: string; value: Amount; scope?: 'chosen_ability' | 'movement_abilities'; after_quest?: boolean; /** Only if this card was the Nth augment taken (Soul Eater's 300 health as the second). */ if_pick?: number }
  | { op: 'mult'; stat: string; factor: number; scope?: string; after_quest?: boolean }
  /** A stat raised by a share that grows with his level and with other stats, after all items (Jhin's passive: AD +4-44% by level, +0.35 x crit chance, +0.30 x bonus attack speed). byLevel: levels 1 to 18. */
  | { op: 'mult_from'; stat: string; byLevel: number[]; per: { stat: string; ratio: number }[]; after_quest?: boolean }
  | { op: 'damage_amp'; scope: string; factor: number; after_quest?: boolean }
  | { op: 'mana_amp'; scope: string; per100: number; after_quest?: boolean }
  | { op: 'mana_cost'; factor: number; after_quest?: boolean }
  /** replace: the source is given up, not kept (Pyke turns bonus health into AD and gains none). */
  /** ratio may grow with his level (Hecarim: 12-24% of bonus move speed as AD). from 'bonus_move_speed': above his base move speed, read each moment. */
  | { op: 'convert'; from: string; to: string; ratio: Amount; replace?: boolean; scope?: string; after_quest?: boolean }
  | { op: 'per_stack'; stat: string; value: number; mode: 'add' | 'mult'; per: string; cap?: number | null; lost_on_death?: number | null; after_quest?: boolean }
  | { op: 'lock'; key: string; after_quest?: boolean }
  /** His own permanent stacks (champion passive and ability counters) gained after the card is taken are larger by ratio (Stackosaurus Rex, file StackModifier=1). */
  | { op: 'stack_bonus'; ratio: number; after_quest?: boolean }
  /** The chosen ability's damage rises per100 per 100 ability haste, and that ability no longer gets ability haste (One Hit Wonder). `key` is filled from the card's abilityKey. */
  | { op: 'haste_to_damage'; per100: number; scope: 'chosen_ability'; key?: string; after_quest?: boolean }
  | { op: 'cooldown'; scope: string; factor: number; after_quest?: boolean }
  | { op: 'refund'; scope: string; amount: Amount; unit: string; trigger: string; internal_cooldown?: number | null; periodicAmount?: Amount; minHitRange?: number; after_quest?: boolean }
  | { op: 'recast'; key: string; internal_cooldown?: number | null; after_quest?: boolean }
  | { op: 'proc'; trigger: string; afterCastWindow?: number; internal_cooldown?: number | null; damage: DamageFormula; type: string; after_quest?: boolean }
  | { op: 'dot'; per_second: DamageFormula; duration: number; type: string; stacks_max?: number | null; trigger?: string; after_quest?: boolean }
  /** Sent on the trigger once per cooldown (by his level), it lands `delay` s later and deals `damage` in even ticks over `duration` s, a tick at the end of each 1/ticksPerSecond;
   * ticks past the fight's end are lost. On landing it applies on-hit damage at `onHitEfficacy`, once. BEES!!!, read from the patch's file (src/ai/augmentFiles.ts). */
  /** The chosen ability cast again `delay` s after his own cast, its damage times `ratio` (Echo Cast, read from the patch file). `key` is filled from the
   * card's abilityKey; with none it does nothing and says so. events: the copy also sets off ability-hit effects (unproven in game, a variant to measure). */
  | { op: 'echo'; delay: number; ratio: number; key?: string; events?: boolean; after_quest?: boolean }
  | { op: 'delayed_dot'; trigger: string; cooldown: Amount; delay: number; duration: number; ticksPerSecond: number; damage: DamageFormula; type: string; onHitEfficacy?: number; after_quest?: boolean }
  | { op: 'heal' | 'shield'; amount: DamageFormula; trigger: string; internal_cooldown?: number | null; after_quest?: boolean; /** His kit's own healing, read per ability: then the abilities' generic healing isn't counted again. */ kit?: boolean }
  /** Mana back on a trigger (Essence Reaver's spellblade: 62.5% base AD + 25 per 100% crit, its text): more casts for a champion whose abilities spend mana (the owner, 2026-11-08: «الابلتي تستهل مانا»). */
  | { op: 'mana_restore'; trigger: string; amount: DamageFormula; internal_cooldown?: number | null; after_quest?: boolean }
  | { op: 'crit_abilities'; extra: number; after_quest?: boolean }
  | { op: 'crit_dot'; extra: number; after_quest?: boolean }
  | { op: 'heal_damage'; ratio: number; after_quest?: boolean }
  | { op: 'abilities_on_hit'; internal_cooldown?: number; after_quest?: boolean }
  /** He becomes melee (Draw Your Sword): attack range 200, melee uptime and the mode's melee resists, no ranged-only items. */
  | { op: 'melee'; after_quest?: boolean }
  | { op: 'on_hit_repeat'; extra_hits: number; trigger: string; internal_cooldown?: number; after_quest?: boolean }
  /** Each attack also fires bolts at other enemies near the target (Runaan's Hurricane): this many for a ranged or melee champion, each a share of his AD that crits and applies on-hit. */
  | { op: 'bolts'; ranged: number; melee: number; ad: number; after_quest?: boolean }
  | { op: 'timed'; trigger: string; afterCastWindow?: number; stat: string; value: Amount; mode: 'add' | 'percent'; /** A gain that stays after the fight (Soul Eater's health): carried into the next fight of the chain. */ permanent?: boolean; duration: number; decays?: boolean; stacks_max?: number | null; refresh?: boolean; internal_cooldown?: number | null; repeatOnHitEvery?: number; after_quest?: boolean };

export interface CardNumbers { id: number; name: string; status: string; ops: CardOp[]; needs?: string | null; not_modelled?: string | null; /** Actual or explicitly estimated choice level; only this card's lifetime stacks start here. */ acquiredLevel?: number; abilityKey?: TargetAbility; /** Which augment this was in the order taken (1 = first), only when the order is proven; unset when it isn't. */ pickPlace?: number }

/** The fixed fight. Assumptions, all visible: changing them changes every card alike, not who is popular. */
/** incomingDps: the enemies' damage a second on him before his resists, when the caller doesn't pass his own (itemMath passes his share of the enemy's damage): a typical share 0.2 of ENEMY_DPS 2530 in itemMath.ts. It says when his health falls below a mark (Sterak's, Maw, Escape Plan). */
/** attackUptime: a real fight has moving and chasing; these best fit the share of a team's damage in stored games. */
/** growthProcsPerLevel: procs a game has given an item that grows for good (Heartsteel) by this level: one every 30 s of fighting and a minute of fighting a level, an assumption tried at 0 to 3 a level (knowledge/item-fit-knowledge.md). */
/** gapSeconds: the time between two fights, when mana comes back; an assumption tried at 0, 20 and 40 s on the owner's cases; 40 kept on the owner's word (Ezreal passes, Soraka still fails). */
/** carryCooldowns: the next fight starts gapSeconds after this one ends, with what is still on cooldown (an ultimate cast at the start of a 15 s fight with 90 s of cooldown misses the next), so haste counts there. */
/** boltHitShare: of the bolts an attack can fire at other enemies (Runaan's Hurricane), the share that finds one in range; ARAM's five enemies stand close, an assumption until area damage is modelled (knowledge: area-model). */
/** manaFights: the fights in a row a player paces his mana over, the same three as itemMath's FIGHTS.inARow. */
/** areaTargets: enemies an area ability reaches, the owner's choice of two (2026-11-06, «نعم، عدوّان») until his lane screenshot measures it (knowledge/area-fields-found.md). */
export const FIGHT = { areaTargets: 2, manaFights: 3, boltHitShare: 0.5, partialLastCast: false, carryCooldowns: false, gapSeconds: 40, growthProcsPerLevel: 2, attackUptime: { melee: 0.8, ranged: 0.7 }, everyDamageStacks: { at18: 200, power: 3.5 }, seconds: 15, incomingDps: 506, target: { armor: 80, mr: 60, hp: 3500 }, killTimes: [5, 10], stacksByLevel: (level: number) => Math.round(level * 1.5) };

/** Very high move speed is slowed: the game's soft caps at 415 and 490. shortcut: from memory, not from a file; check on screen. */
/** Stacks a champion's abilities count by level 15 in ARAM Mayhem, where his ability formulas read a buff's stacks (Nasus's Q, Smolder's passive, Aurelion Sol's
 * stardust, Thresh's souls, Kindred's marks, Cho'Gath's Feast, Draven's adoration). The files hold no count, only the per-stack value; without one each
 * per-stack part counted 0. The owner (2026-11-06): «سمولدر يصل الى 250 وياخذ الاعدام»، «كل الشخصيات يمكنها المراكمه لاكثر»، «ناسوس بشكل لا نهائي».
 * Smolder's 250 is his; the rest are Claude's estimates raised on his word, to check on his screens. No cap: they keep growing with level past 15. */
/** Stored games, 176,930 players: 0.67 kills a level (2.16 takedowns, kills and assists, is the 2.2 above); Hubris stacks on kills, not takedowns (2026-11-06). */
const KILLS_PER_LEVEL = 0.67;
/** Triggers that come from an attack: their damage heals through life steal as the attack does. */
const ON_ATTACK = new Set(['on_hit', 'attack', 'crit', 'next_attack']);
export const STACKS_AT_15: Record<string, number> = { Nasus: 700, Smolder: 250, AurelionSol: 150, Thresh: 150, Kindred: 15, Chogath: 20, Draven: 60, Veigar: 300, Senna: 150, Swain: 60 };

/** mSpellTags that mark a skill moving its caster (dash, leap, blink, teleport) in 16.22, checked on 35 champions (tests/fixtures/game/movement-tags-16.22.json).
 * Whether Dashing itself reads these tags is not established; misses seen: Twisted Fate R, Sion R, Nocturne R, Lee Sin's second Q. */
export const MOVEMENT_TAGS = new Set(['PositiveEffect_MoveBlock', 'PositiveEffect_Teleport', 'Trait_PlayerSelectedDashDirection']);

/** Ability kinds his own four skills show in their mSpellTags, for a card's condition (needHolds ability_kind): dash (MOVEMENT_TAGS), immobilize
 * (Trait_ImmobilizingCCSpell). Only "yes" is read from them; a kind not found stays unknown, since the tags miss some (see MOVEMENT_TAGS). */
export function spellTraits(bin: Record<string, unknown>): string[] {
  const record = championRecord(bin);
  const tags = (record?.spells ?? []).slice(0, 4).flatMap((p) => ((bin as Bin)[p]?.mSpell as { mSpellTags?: string[] } | undefined)?.mSpellTags ?? []);
  return [...(tags.some((t) => MOVEMENT_TAGS.has(t)) ? ['dash'] : []), ...(tags.includes('Trait_ImmobilizingCCSpell') ? ['immobilize'] : [])];
}

const softSpeed = (x: number) => (x > 490 ? x * 0.5 + 230 : x > 415 ? x * 0.8 + 83 : x);

/** ALLY: the ally an enchanter heals or shields, whom Ardent Censer and Staff of Flowing Water then raise: his damage a second after resists, attacks a second, AP, and the share of his damage from attacks. An assumption, to try on the owner's cases. */
export const ALLY = { dps: 600, attacksPerSecond: 1.2, ap: 300, attackShare: 0.5 };

/** buffsAllies: the kit heals or shields allies (Sona, Lulu, Janna), so items that act on the ally he heals do something. */
/** aoe: the kit's abilities hit an area (CHAMPION_KITS trait), so a burn they apply reaches FIGHT.areaTargets enemies. */
/** attackPace: his attacks as a share of an attacker's pace, when his casts take his time between them (ATTACK_PACE). */
export interface Kit { damage: 'magic' | 'physical' | 'mixed'; attacks: boolean; buffsAllies?: boolean; aoe?: boolean; attackPace?: number }
/** A melee fighter who attacks but spends his fight on his abilities: his attack pace as a share of an attacker's (1). */
// At an attacker's pace these ten built marksman items (Yun Tal, BotRK, IE) no player of theirs holds (Codex round 14, FoxOS, 2026-11-09);
// at 0.25 the engine's six items held by their players rose 12.3% -> 14.6% (0.5: 14.2%, 0.75: 13.2%). Gangplank 41, Pantheon 80, Kayn 141, Kha'Zix 121, Wukong 62, Zed 238, Qiyana 246, Pyke 555, Ambessa 799, Naafiri 950.
export const ATTACK_PACE: Record<number, number> = { 41: 0.25, 62: 0.25, 80: 0.25, 121: 0.25, 141: 0.25, 238: 0.25, 246: 0.25, 555: 0.25, 799: 0.25, 950: 0.25 };
/** The real enemies when they're known: what their resists do to his damage, and how much of their damage his armor answers rather than his magic resist. */
/** hp: the health a share of the target's health is taken from, when the enemies are known (FIGHT.target.hp otherwise). */
/** healPerSecond: the enemies' mean healing a second in their own fight with no items (their kits' heals, vamp, heals on allies), what anti-heal items cut. */
export interface EnemyTeam { armor: number; mr: number; physicalShare: number; hp?: number; healPerSecond?: number }
export interface FightResult {
  damage: number;
  /** Enemy healing prevented, in health points. An estimated benefit, separate from damage and ineligible for vamp. */
  healingDenied: number;
  /** Damage dealt by the end of each second, so a burst counts even if he dies soon after. */
  damageBySecond: number[];
  fromAbilities: number;
  fromAttacks: number;
  fromCards: number;
  /** Extra damage allies deal from his items' buffs on the ally he heals or shields. */
  fromAllies?: number;
  effectiveHp: number;
  /** Healing and shields he gives himself in the fight, as effective health: vamp, and what cards and items say. */
  healedHp: number;
  /** healedHp by source, before resists: heals and shields cards and items name (shields: the shield part of ops), omnivamp, life steal (to measure each against real games). */
  healParts?: { ops: number; shields?: number; omnivamp: number; lifeSteal: number };
  /** Healing and shields his abilities give, on whoever they reach, with heal power: the files don't say whom. */
  abilityHealing: number;
  /** Ability healing alone, excluding shields. Used by anti-heal; explicit kit heals remain in healParts.ops. */
  abilityHealingOnly: number;
  attacks: number;
  peakMoveSpeed: number;
  peakAttackSpeed: number;
  casts: Record<string, number>;
  /** Each ability's damage on one cast, before resists. */
  perCast: Record<string, number>;
  stats: Pick<BuildStats, 'ad' | 'ap' | 'hp' | 'armor' | 'mr' | 'attackSpeed' | 'crit' | 'haste'>;
  notModelled: string[];
  /** Instances of ability damage on champions in this fight: each hit of a cast, and a tick every half second of a burn an ability or its item started. */
  abilityInstances: number;
  /** Immobilizes his landed ability hits put on the fight target: only abilities checked one by one (IMMOBILIZE_ON_HIT). */
  ccEvents: CcEvent[];
  /** The next fight, started with the mana this one left; this same fight when that mana covers it. */
  again?: () => FightResult;
}

type Bin = Record<string, { __type?: string; mSpell?: SpellData & { cooldownTime?: number[]; Cooldown?: number; mClientData?: { mTooltipData?: { mLists?: { LevelUp?: { levelCount?: number } } } } } } | undefined>;
const scaled = (a: Amount, level: number) => (typeof a === 'number' ? a : a.min + ((a.max - a.min) * (Math.min(level, 18) - 1)) / 17);
const CAST_SECONDS = 0.75;
/** The share of the fight target's health that is bonus health: 1 - 2,415 / 3,500 (the mean health of 172 champions at level 15 with no items, itemMath TYPICAL_HP). A share of the target's bonus health (Sett's R) reads this part. */
const TARGET_BONUS_SHARE = 1 - 2415 / 3500;
const NO_COOLDOWN_IN_FILE = 10; // shortcut: Morgana Q, Milio Q and a few have none in any record; a typical basic ability
/** The mode's extra base health, 20 at level 1 to this at 18 (Kimi, from the wiki); see the screen check. */
const MODE_HEALTH_AT_18 = { melee: 600, ranged: 400 };
const ATTACK_SPEED_CAP = 5; // Mayhem's cap (Kimi); screens show 2.81, past the usual 2.5.
const MELEE_RESISTS = 15;
const DAMAGE_NAME = /damage|dmg|dps/i;
/** Tear items and what they turn into: Manamune into Muramana, Archangel's into Seraph's, Winter's Approach into Fimbulwinter. */
const UPGRADES: Record<number, number> = { 3004: 3042, 3003: 3040, 3119: 3121 };
// Off for now (above any level): at 11, Muramana sent Jinx to Trinity and Manamune and Soraka to Dusk and Dawn, owner cases 11 -> 10; the owner decides.
const UPGRADE_LEVEL = 99;
/** Abilities whose hit takes seconds off all his cooldowns, with the field that holds them, each checked against its tooltip: Mystic Shot lowers Ezreal's cooldowns by 1.5 s. */
const REFUND_ON_HIT: Record<string, string> = { 'Characters/Ezreal/Spells/EzrealQAbility/EzrealQ': 'CDRefund' };
/** Abilities whose landed hit immobilizes the champion it hits, with the field that holds the duration, each checked against its tooltip (16.22):
 * Morgana Q roots the first enemy hit, Lux Q the first two. Only these raise an immobilize event (trigger 'immobilize_hit'); an ability with the
 * Trait_ImmobilizingCCSpell tag that isn't here raises none, since the tag doesn't say whether its hit, its delay or a condition does the CC. */
const IMMOBILIZE_ON_HIT: Record<string, { field: string; kind: 'root' }> = {
  'Characters/Morgana/Spells/MorganaQAbility/MorganaQ': { field: 'RootDuration', kind: 'root' },
  'Characters/Lux/Spells/LuxLightBindingAbility/LuxLightBinding': { field: 'RootDuration', kind: 'root' },
};
export interface CcEvent { source: 'ability'; key: string; path: string; target: 'main'; at: number; kind: 'root'; duration: number }
const GRAGAS_BODY_SLAM = 'Characters/Gragas/Spells/GragasEAbility/GragasE';
const HEALING_NAME = /heal|shield/i;
const NOT_ANY_DAMAGE = /monster|minion|shield|heal|cap|tooltiponly/i;
const HEALTH_SHARE_NAME = /(percent|max|total).*(health|hp)|(health|hp).*(percent|damage)|percent.*damage/i;
const JAYCE_MELEE_E = 'Characters/Jayce/Spells/JayceThunderingBlowAbility/JayceThunderingBlow';
const NASUS_STORM = 'Characters/Nasus/Spells/NasusRAbility/NasusR';
const NASUS_SIPHONING_STRIKE = 'Characters/Nasus/Spells/NasusQAbility/NasusQ';
const NOT_HEALTH_SHARE = /heal$|healing|shield|cost|decay|monster|minion|cap|missing|tooltip$/i;
const NOT_DAMAGE = /monster|minion|shield|heal|bonus|floor|secondary/i;
/** A spell's damage when it crits (CritDamage, TotalDamageCrit, CriticalDamage), not its base (TotalDamageNoCrit, ActiveDamageThatCanCrit, PreCritDamage). */
const CRIT_VARIANT = (name: string) => /crit/i.test(name) && !/nocrit|cancrit|precrit/i.test(name);

function formula(d: DamageFormula, s: BuildStats, level: number, t = FIGHT.target.hp): number {
  return (d.flat === undefined ? 0 : scaled(d.flat, level)) + (d.mana ?? 0) * (s.mana ?? 0) + (d.ap ?? 0) * s.ap + (d.ad ?? 0) * s.ad + (d.bonus_ad ?? 0) * s.bonusAd + (d.hp ?? 0) * s.hp + (d.bonus_hp ?? 0) * s.bonusHp + (d.armor ?? 0) * s.armor + (d.mr ?? 0) * s.mr + (d.bonus_armor ?? 0) * s.bonusArmor + (d.bonus_mr ?? 0) * s.bonusMr + (d.target_max_hp ?? 0) * t + (d.target_missing_hp ?? 0) * (t / 2) + (d.target_current_hp ?? 0) * (t / 2) + (d.ap_per_bonus_hp ?? 0) * s.ap * s.bonusHp + (d.ad_crit ?? 0) * s.ad * s.crit * Math.max(0, s.critDamage - 1) + (d.crit ?? 0) * s.crit;
}

const STAT_ADD: Record<string, (s: BuildStats, v: number) => void> = {
  ap: (s, v) => { s.ap += v; },
  ad: (s, v) => { s.ad += v; s.bonusAd += v; },
  bonus_ad: (s, v) => { s.ad += v; s.bonusAd += v; },
  hp: (s, v) => { s.hp += v; s.bonusHp += v; },
  mana: (s, v) => { if (s.mana !== undefined) s.mana += v; },
  armor: (s, v) => { s.armor += v; s.bonusArmor += v; },
  mr: (s, v) => { s.mr += v; s.bonusMr += v; },
  attack_speed: (s, v) => { s.bonusAttackSpeed += v; },
  crit: (s, v) => { s.crit = Math.min(1, s.crit + v); },
  crit_damage: (s, v) => { s.critDamage += v; },
  haste: (s, v) => { s.haste += v; },
  lethality: (s, v) => { s.lethality += v; },
  armor_pen: (s, v) => { s.armorPenPercent = Math.min(1, s.armorPenPercent + v); },
  magic_pen: (s, v) => { s.magicPenPercent = Math.min(1, s.magicPenPercent + v); },
  omnivamp: (s, v) => { s.omnivamp += v; },
  life_steal: (s, v) => { s.lifeSteal += v; },
  move_speed: (s, v) => { s.moveSpeed += v; },
};
const statValue = (s: BuildStats, k: string) => ({ move_speed: s.moveSpeed, ap: s.ap, ad: s.ad, bonus_ad: s.bonusAd, hp: s.hp, bonus_hp: s.bonusHp, armor: s.armor, mr: s.mr, attack_speed: s.bonusAttackSpeed, crit: s.crit, haste: s.haste, mana: s.mana }[k] ?? NaN);

/** One fight, second by second, with these items and cards at this level, so anything that feeds itself shows up. Cards apply in order: flat stats, then conversions, then multipliers; then the fight runs. */
export function fight(o: { bin: Record<string, unknown>; shop: Record<number, GameItem>; kit: Kit; items: number[]; cards: CardNumbers[]; level: number; passive?: CardOp[]; itemOps?: Record<number, CardOp[]>; enemy?: EnemyTeam; ampStack?: 'add'; mana?: number; cooldowns?: Record<string, number>; /** Health this simulation's earlier fights gave for good (permanent timed gains); nothing from before the chain. */ gainedHp?: number; stacks?: number; noStackScale?: boolean; incomingDps?: number; /** His ranks read from the game at a level; else a legal even allocation (abilityRank.ts). */ knownRanks?: KnownRanks; /** How he levels his skills when his ranks aren't read (the build page's order). */ skillPlan?: SkillPlan }): FightResult {
  const record = championRecord(o.bin);
  if (!record) throw new Error('no character record');
  // Tear items turn into their finished form; in Mayhem two augment rounds after purchase (their mode records' RoundCount 2): an assumption that a build has them by level 11.
  const held = o.items.map((id) => (o.level >= UPGRADE_LEVEL && UPGRADES[id % 10000] && o.shop[UPGRADES[id % 10000]!] ? UPGRADES[id % 10000]! : id));
  const owned = held.flatMap((id) => o.shop[id] ?? []);
  const s = buildStats(record, owned, o.level);
  // The mode's own stats: melee also gets 15 armor and magic resist (Singed, Nasus on screen); the wiki's ranged resists don't show on screen.
  // A card that makes him melee (Draw Your Sword) does it for the whole fight (knowledge/fight-rules.md, melee).
  const becomesMelee = [...(o.passive ?? []), ...o.cards.flatMap((c) => c.ops)].some((x) => x.op === 'melee');
  const melee = becomesMelee || ((record as unknown as { attackRangeModifiable?: { baseValue?: number } }).attackRangeModifiable?.baseValue ?? 0) < 300;
  s.hp += 20 + (((melee ? MODE_HEALTH_AT_18.melee : MODE_HEALTH_AT_18.ranged) - 20) * (o.level - 1)) / 17;
  if (melee) { s.armor += MELEE_RESISTS; s.bonusArmor += MELEE_RESISTS; s.mr += MELEE_RESISTS; s.bonusMr += MELEE_RESISTS; }
  // An item whose own numbers already multiply this stat (Rabadon's 1.3, Warmog's 1.12 on bonus health) isn't multiplied again from its file.
  const itemAmp = (name: string, stat: string) => held.reduce((m, id) => ((o.itemOps?.[id % 10000] ?? []).some((x) => x.op === 'mult' && x.stat === stat) ? m : m * (1 + (o.shop[id]?.DataValues?.find((d) => d.name === name)?.values?.[0] ?? 0))), 1);
  const healPower = owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'PercentHealingAmountMod')?.values?.[0] ?? 0), 0);
  // What his items do for the ally he heals or shields, from their files: Ardent Censer's attack speed and on-hit, Staff of Flowing Water's AP and haste, each for its seconds; Moonstone Renewer heals a second ally for a share.
  const allyBuffs = o.kit.buffsAllies ? owned.flatMap((it) => {
    const dv = (n: string) => it.DataValues?.find((d) => d.name === n)?.values?.[0] ?? 0;
    if (dv('OnHitMin')) return [{ perSecond: ALLY.dps * ALLY.attackShare * dv('AttackSpeedMin') + dv('OnHitMin') * ALLY.attacksPerSecond, seconds: dv('Duration'), until: -1 }];
    if (dv('AHMod')) return [{ perSecond: ALLY.dps * (1 - ALLY.attackShare) * (dv('APMod') / ALLY.ap + dv('AHMod') / 100), seconds: dv('BuffDuration'), until: -1 }];
    return [];
  }) : [];
  const chainHeal = o.kit.buffsAllies ? owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'ChainHeal')?.values?.[0] ?? 0), 0) : 0;
  const itemMana = owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'FlatMPPoolMod')?.values?.[0] ?? 0), 0);
  const res = (record as unknown as { primaryAbilityResource?: Record<string, { baseValue?: number } | number | string | undefined> }).primaryAbilityResource;
  const resBase = (res?.['{726ee5cd}'] as { baseValue?: number } | undefined)?.baseValue ?? 0;
  const resLevel = (res?.['{6216bf7b}'] as { baseValue?: number } | undefined)?.baseValue ?? 0;
  if ((res?.arType ?? 0) === 0 && resBase > 0) s.mana = resBase + resLevel * (o.level - 1) + itemMana;
  // A finished tear item with no reading of its own gives what its file names: mana into AP or AD, and Shock, a share of mana on attacks and on each ability once in its lockout.
  const fromFile = held.flatMap((id): CardOp[] => {
    if (o.itemOps?.[id % 10000]) return [];
    const dv = (n: string) => o.shop[id]?.DataValues?.find((d) => d.name === n)?.values?.[0] ?? 0;
    const onAbility = dv(melee ? 'AbilityManaRatioMeleeTOOLTIPONLY' : 'AbilityManaRatioRangedTOOLTIPONLY');
    return [
      ...(dv('APFromMana') ? [{ op: 'convert', from: 'mana', to: 'ap', ratio: dv('APFromMana') } as CardOp] : []),
      ...(dv('BonusADManaRatioTOOLTIPONLY') ? [{ op: 'convert', from: 'mana', to: 'bonus_ad', ratio: dv('BonusADManaRatioTOOLTIPONLY') } as CardOp] : []),
      ...(dv('OnHitManaRatioTOOLTIPONLY') ? [{ op: 'proc', trigger: 'on_hit', internal_cooldown: null, damage: { mana: dv('OnHitManaRatioTOOLTIPONLY') }, type: 'physical' } as CardOp] : []),
      // shortcut: the lockout is per ability in the game, one for all here; per-ability lockouts if Shock champions look short.
      ...(onAbility ? [{ op: 'proc', trigger: 'ability_hit', internal_cooldown: dv('PerCastIDLockout') || null, damage: { mana: onAbility }, type: 'physical' } as CardOp] : []),
    ];
  });
  // An item's effect marked for the other attack type doesn't count, nor a button's buff; a button's damage is pressed when ready.
  // A stat that comes only near death (Overlord's Bloodmail: 12% AD at or below 30% health) isn't held through the fight.
  // Range in a condition (knowledge/fight-rules.md, conditions): "beyond N range" holds when one of his basic abilities reaches past N (Skilled Sniper: not for
  // Vladimir, whose longest is 600); "target within N range" when he fights at N or closer (Sunfire Aegis's 300: melee only).
  const attackRange = becomesMelee ? 200 : (record as unknown as { attackRangeModifiable?: { baseValue?: number } }).attackRangeModifiable?.baseValue ?? 0;
  const spellReach = (path: string, rank: number) => {
    const sp = (o.bin as Bin)[path]?.mSpell as { mCastRangeGrowthMax?: number[]; castRangeDisplayOverride?: number[]; castRange?: number[] } | undefined;
    const atRank = (values?: number[]) => values?.[rank] ?? values?.[1] ?? values?.[0];
    return atRank(sp?.mCastRangeGrowthMax) ?? atRank(sp?.castRangeDisplayOverride) ?? atRank(sp?.castRange) ?? 0;
  };
  const reach = Math.max(0, ...(record.spells ?? []).slice(0, 3).map((path) => spellReach(path, 1)));
  const inRange = (n: string) => { const beyond = /beyond (\d+) range/i.exec(n), within = /within (\d+)(?: range|$|[;,)])/i.exec(n); return (!beyond || reach > +beyond[1]!) && (!within || attackRange <= +within[1]!); };
  const applies = (x: CardOp) => { const n = String((x as { needs?: string }).needs ?? ''); const atStacks = /at (\d+) (stacks|glory)/i.exec(n); return inRange(n) && !(melee ? /^ranged/ : /^melee/).test(n) && !(/item active|active item/.test(n) && x.op !== 'proc') && !(atStacks && 0.6 * o.level < +atStacks[1]!) && !((x.op === 'mult' || x.op === 'add') && /below \d+% remaining health/i.test(n)); };
  // A quest card's reward counts once its quest items are all held (Ultra Hydra: the three Hydras; Wooglet's Witchcap: Rabadon's and Zhonya's). Quests counted in takedowns or hits never complete here.
  // shortcut: the reward is added on top of the quest items, not in their place, and frees no slot; model the swap if a quest build looks a slot short.
  const questDone = (c: CardNumbers) => { const need = questItems(c.id); return need.length > 0 && need.every((id) => held.some((h) => h % 10000 === id)); };
  const noQuest = (x: CardOp) => !x.after_quest;
  // An ultimate-dependent augment cannot activate before R is available or while it is locked.
  const ultLocked = [...(o.passive ?? []), ...o.cards.flatMap((c) => c.ops)].some((x) => x.op === 'lock' && x.key === 'R');
  const ultimate = (o.bin as Bin)[record.spells?.[3] ?? '']?.mSpell;
  const ultUnavailable = ultLocked || !ultimate || estimatedAbilityRank(record, 'R', o.level, ultimate.mClientData?.mTooltipData?.mLists?.LevelUp?.levelCount).rank === 0;
  const needsUlt = (c: CardNumbers) => ultUnavailable && /ultimate cast|after (?:an|your) ultimate|cast(?:ing)? (?:an|your) ultimate/i.test(String(c.needs ?? ''));
  const targetMissing: string[] = [];
  const cardOps = (card: CardNumbers) => card.ops.filter((x) => noQuest(x) || questDone(card)).flatMap((x): CardOp[] => {
    // A reward for being the Nth augment taken counts only when the order is proven; an unknown order gives nothing and says so.
    if (x.op === 'add' && x.if_pick !== undefined) {
      if (card.pickPlace === undefined) { targetMissing.push(`${card.name}: ترتيب اختياره غير مثبت، فمكافأة كونه الاختيار ${x.if_pick} غير محسوبة`); return []; }
      return card.pickPlace === x.if_pick ? [x] : [];
    }
    if (x.op === 'add' && x.scope === 'movement_abilities') {
      const keys = (['Q', 'W', 'E', 'R'] as const).filter((k) => (((o.bin as Bin)[record.spells?.['QWER'.indexOf(k)] ?? '']?.mSpell as { mSpellTags?: string[] } | undefined)?.mSpellTags ?? []).some((tag) => MOVEMENT_TAGS.has(tag)));
      if (!keys.length) targetMissing.push(`${card.name}: لا مهارة عليها وسم حركة في ملف الشخصية؛ لا أثر`);
      return keys.map((k): CardOp => ({ op: 'add', stat: `${k}_haste`, value: x.value }));
    }
    if (x.op !== 'echo' && x.op !== 'haste_to_damage' && (x.op !== 'add' || x.scope !== 'chosen_ability')) return [x];
    const path = card.abilityKey ? record.spells?.['QWER'.indexOf(card.abilityKey)] : undefined;
    if (!path || !(o.bin as Bin)[path]?.mSpell) {
      targetMissing.push(`${card.name}: ${card.abilityKey ? `المهارة ${card.abilityKey} غير موجودة في ملف الشخصية` : 'المهارة المستهدفة غير محددة'}؛ ${x.op === 'echo' ? 'أثر النسخة' : x.op === 'haste_to_damage' ? 'تحويل التسارع إلى ضرر' : 'أثر التسارع'} غير محسوب`);
      return [];
    }
    if (x.op === 'echo' || x.op === 'haste_to_damage') return [{ ...x, key: card.abilityKey }];
    // Slot haste never enters global stats. Each augment keeps its own selected skill.
    return [{ ...x, stat: `${card.abilityKey}_haste` }];
  });
  const ops = [...(o.passive ?? []).filter(noQuest), ...o.cards.filter((c) => !needsUlt(c)).flatMap(cardOps).filter(applies), ...held.flatMap((id) => o.itemOps?.[id % 10000] ?? []).filter(applies).filter(noQuest), ...fromFile.filter(noQuest)];
  const notModelled = [...o.cards.flatMap((c) => (c.not_modelled ? [`${c.name}: ${c.not_modelled}`] : [])), ...targetMissing];
  // Whether the card also drops haste given to that ability alone (Bread) or to its basic/ult group is not settled by its text (T028 review): say so.
  for (const x of ops) if (x.op === 'haste_to_damage' && ops.some((y) => y.op === 'add' && (y.stat === `${x.key}_haste` || y.stat === `${x.key === 'R' ? 'ult' : 'basic'}_haste`))) notModelled.push(`تحويل التسارع إلى ضرر للمهارة ${x.key}: تفاعله مع تسارع خاص بها (Bread أو تسارع المهارات الأساسية/الخارقة) غير محسوم؛ الحساب يبقي ذلك التسارع على تبريدها ولا يحوّله، وهذا تقدير`);
  // Stacks held by this level, read from 23 screen windows with Tank Engine (health order: Heartsteel, then the multiplier, which one reading of Mundo forces): 0.6 a level when deaths take most of them, 2.2 a level of takedowns when they don't. Other stacks are a guess.
  // Stacks from every instance of ability damage grow fast with the game (Phenomenal Evil); fitted to screens.
  const stackName = (record as { mCharacterName?: string } | undefined)?.mCharacterName ?? '';
  // The stacks the player typed (they differ from game to game), else the estimate for this level.
  // Stackosaurus Rex (stack_bonus): only what his own counters gain after it is taken, so count(now) - count(pick); stacks before it and a count he typed stay as they are (T027).
  const stackBonus = o.cards.flatMap((c) => (c.acquiredLevel === undefined ? [] : c.ops.flatMap((x) => (x.op === 'stack_bonus' ? [{ ratio: x.ratio, at: c.acquiredLevel! }] : []))));
  const gainedAfter = (count: (level: number) => number) => stackBonus.reduce((n, b) => n + b.ratio * Math.max(0, count(o.level) - count(Math.min(o.level, b.at))), 0);
  const estimate = (level: number) => STACKS_AT_15[stackName]! * (level / 15);
  const stacks = STACKS_AT_15[stackName] === undefined ? undefined : o.stacks ?? estimate(o.level) + gainedAfter(estimate);
  // His own passive's stacks (Veigar's AP, Senna's and Thresh's souls) are his count above, not the generic one.
  // One count a stat: Veigar's AP from hits and from takedowns are both in his count, so his second AP source adds nothing more.
  const ownPassive = new Set(o.passive ?? []), firstOfStat = new Map<string, CardOp>();
  for (const x of o.passive ?? []) if (x.op === 'per_stack' && !firstOfStat.has(x.stat)) firstOfStat.set(x.stat, x);
  // Stacks from every instance of ability damage (Phenomenal Evil) follow the fitted curve for a plain build, scaled by how many instances this build
  // makes against the same kit with no items: a burn (Liandry's) or haste (Eureka) gives more (Jayell's Karthus, 181 stacks by 10:45, knowledge/video-cq0NIx0UA-0.md).
  let scaleMemo: number | undefined;
  const instanceScale = () => {
    if (o.noStackScale) return 1;
    if (scaleMemo === undefined) { const mine = fight({ ...o, noStackScale: true }).abilityInstances, plain = fight({ ...o, items: [], noStackScale: true }).abilityInstances; scaleMemo = plain > 0 ? mine / plain : 1; }
    return scaleMemo;
  };
  const acquired = new Map(o.cards.flatMap((c) => c.acquiredLevel === undefined ? [] : c.ops.map((x) => [x, c.acquiredLevel!] as const)));
  const stacksOf = (x: Extract<CardOp, { op: 'per_stack' }>) => {
    // Champion passives keep their own history. A new augment never inherits takedowns or hits made before it was chosen.
    if (stacks !== undefined && ownPassive.has(x)) return firstOfStat.get(x.stat) === x ? stacks : 0;
    const countAt = (level: number) => x.per === 'takedown' ? (x.lost_on_death ? 0.6 : 2.2) * level : x.per === 'kill' ? (x.lost_on_death ? 0.6 : KILLS_PER_LEVEL) * level : x.per === 'every_ability_damage' ? FIGHT.everyDamageStacks.at18 * (level / 18) ** FIGHT.everyDamageStacks.power * instanceScale() : FIGHT.stacksByLevel(level);
    const at = acquired.get(x);
    // These curves remain estimates, not observed stack counts. Subtract before applying the cap.
    const n = Math.max(0, countAt(o.level) - (at === undefined ? 0 : countAt(Math.min(o.level, at)))) + (ownPassive.has(x) ? gainedAfter(countAt) : 0);
    return x.cap == null ? n : Math.min(x.cap, n);
  };
  const add = (t: BuildStats, stat: string, v: number) => { STAT_ADD[stat]?.(t, v); };
  // An add or multiplier that waits seconds of champion combat (Jak'Sho's resists after 5 s, Riftmaker's omnivamp after 4 s) comes from make-card-data.cjs
  // averaged over the fight. The fight gives it in full once its seconds have passed (current), effective health keeps the average (sAvg), and vamp
  // counts only on the damage dealt after it (knowledge/math-generation.md, timing).
  const waitOf = (x: CardOp) => (x.op === 'add' || x.op === 'mult' ? Number(/(\d+(?:\.\d+)?) seconds? (?:in|of) champion combat/i.exec(String((x as { needs?: string }).needs ?? ''))?.[1] ?? 0) : 0);
  const waits = ops.filter((x) => waitOf(x) > 0 && waitOf(x) < FIGHT.seconds);
  for (const x of ops) if (x.op === 'add' && !waits.includes(x)) add(s, x.stat, scaled(x.value, o.level));
  for (const x of ops) if (x.op === 'per_stack' && x.mode === 'add') add(s, x.stat, x.value * stacksOf(x));
  // Health kept from earlier fights of this chain (permanent gains this simulation counted, FightResult.again); nothing from before the chain.
  if (o.gainedHp) add(s, 'hp', o.gainedHp);
  // An item whose proc leaves max health for good (Heartsteel: DamageToMaxHealthRatio of 70 + 6% of max health a proc) has grown by this level.
  for (const it of owned) {
    const dv = (n: string) => it.DataValues?.find((d) => d.name === n)?.values?.[0] ?? 0;
    const keep = dv('DamageToMaxHealthRatio');
    if (keep) for (let i = 0; i < Math.round(FIGHT.growthProcsPerLevel * o.level); i++) add(s, 'hp', keep * (dv('BaseDamage') + dv('HPRatio') * s.hp));
  }
  const multiply = (t: BuildStats, stat: string, factor: number) => {
    if (stat === 'ap') t.ap *= factor;
    if (stat === 'ad') { t.bonusAd += t.ad * (factor - 1); t.ad *= factor; }
    if (stat === 'bonus_ad') { t.ad += t.bonusAd * (factor - 1); t.bonusAd *= factor; }
    if (stat === 'hp') { t.bonusHp += t.hp * (factor - 1); t.hp *= factor; }
    if (stat === 'armor') t.armor *= factor;
    if (stat === 'mr') t.mr *= factor;
    if (stat === 'attack_speed') t.bonusAttackSpeed *= factor;
    if (stat === 'move_speed') t.moveSpeed *= factor;
    if (stat === 'crit_damage') t.critDamage *= factor; // Jhin's crits deal 25% less (CritReductionPercent)
  };
  // Seconds of fighting an op waits for: "N seconds in champion combat" (Riftmaker, Liandry's) or "enemy champion nearby for N seconds" (Heartsteel's charge).
  // When his health falls below an effect's mark ("on falling below 30% Health", Escape Plan's 35%): his effective health over the enemies' damage on him.
  // shortcut: the health he heals back in the fight doesn't delay it, and the mark is read once a fight; upgrade with a health timeline.
  const lowMark = (x: CardOp) => { const m = /(?:falling below|takes health below|at or below|below|at) (\d+)% (?:remaining )?health/i.exec(String((x as { needs?: string }).needs ?? '')); return m && !/target/i.test(String((x as { needs?: string }).needs)) ? +m[1]! / 100 : 0; };
  let effectiveAtStart: number | undefined;
  const lowHealthAt = (x: CardOp) => { const mark = lowMark(x); if (!mark) return 0; effectiveAtStart ??= s.hp * (1 + Math.max(0, s.armor) / 100 + Math.max(0, s.mr) / 100) / 2 + s.hp / 2; return ((1 - mark) * effectiveAtStart) / Math.max(1, o.incomingDps ?? FIGHT.incomingDps); };
  const combatSeconds = (x: CardOp) => { const m = /(\d+(?:\.\d+)?) seconds? (?:in|of) champion combat|nearby for (\d+(?:\.\d+)?) seconds?/i.exec(String((x as { needs?: string }).needs ?? '')); return m ? +(m[1] ?? m[2]!) : 0; };
  // A bonus-only multiplier on resists raises bonus armor or magic resist only. One that waits seconds of combat (Jak'Sho: +30% after 5 s) comes from
  // knowledge/make-card-data.cjs already averaged over the fight (1.3 read as 1.2), which effective health needs: it reads one value a fight.
  const bonusResist = { armor: 'bonusArmor', mr: 'bonusMr' } as const;
  // Order (knowledge/fight-rules.md, convert): multipliers on a stat a conversion reads come first (Tank Engine's health before Overlord's Bloodmail turns it into AD),
  // then the conversions, then the multipliers on everything else (Rabadon's on the AP Riftmaker gives). A stat both read and added keeps the later place.
  const family = (stat: string) => stat.replace(/^bonus_/, '');
  const convertReads = new Set(ops.flatMap((x) => (x.op === 'convert' && !/move_speed/.test(x.from) ? [family(x.from)] : [])));
  const convertAdds = new Set(ops.flatMap((x) => (x.op === 'convert' ? [family(x.to)] : [])));
  const beforeConverts = (stat: string) => convertReads.has(family(stat)) && !convertAdds.has(family(stat));
  const multiplyAll = (early: boolean) => {
    if (beforeConverts('ap') === early) multiply(s, 'ap', itemAmp('APAmp', 'ap'));
    if (beforeConverts('hp') === early) multiply(s, 'hp', itemAmp('HPAmp', 'hp'));
    // A multiplier of 1 or less on a converted source gives part of it up (ADAPt: bonus AD into AP, then none left; Big Shot: 75% of attack speed into crit damage, 25% kept), so it comes after the conversion that reads it.
    for (const x of ops) if (x.op === 'mult' && !waits.includes(x) && (beforeConverts(x.stat) && x.factor > 1) === early) {
      if (x.stat === 'hp' && x.scope === 'bonus') { s.hp += s.bonusHp * (x.factor - 1); s.bonusHp *= x.factor; }
      else if ((x.stat === 'armor' || x.stat === 'mr') && x.scope === 'bonus') { const gain = s[bonusResist[x.stat]] * (x.factor - 1); s[x.stat] += gain; s[bonusResist[x.stat]] += gain; }
      // A multiplier per burning enemy (Blackfire Torch: 4% AP each) counts every enemy an area kit burns (the owner, 2026-11-08: Brand «يدمج اكثر من شخص بنفس الوقت فيضيف AP»).
      else multiply(s, x.stat, o.kit.aoe && /enemy burning/i.test(String((x as { needs?: string }).needs ?? '')) ? 1 + (x.factor - 1) * FIGHT.areaTargets : x.factor);
    }
    for (const x of ops) if (x.op === 'per_stack' && x.mode === 'mult' && beforeConverts(x.stat) === early) multiply(s, x.stat, 1 + (x.value >= 1 ? x.value - 1 : x.value) * stacksOf(x)); // readers wrote +5% a stack as 1.05 or 0.05
  };
  multiplyAll(true);
  // A conversion with scope 'bonus' reads the bonus part of its source (Riftmaker: 2% of bonus health; Vladimir: bonus health).
  const bonusOf: Record<string, keyof BuildStats> = { hp: 'bonusHp', armor: 'bonusArmor', mr: 'bonusMr', ad: 'bonusAd' };
  for (const x of ops) if (x.op === 'convert' && !/move_speed/.test(x.from)) { const key = x.scope === 'bonus' ? bonusOf[x.from] : undefined; const from = key ? (s[key] as number) : statValue(s, x.from); if (!Number.isNaN(from)) add(s, x.to, from * scaled(x.ratio, o.level)); if (x.replace && x.from === 'bonus_hp') { s.hp -= s.bonusHp; s.bonusHp = 0; } }
  multiplyAll(false);
  for (const x of ops) if (x.op === 'mult_from') multiply(s, x.stat, 1 + (x.byLevel[Math.min(Math.max(o.level, 1), 18) - 1] ?? 0) + x.per.reduce((m, p) => m + p.ratio * (statValue(s, p.stat) || 0), 0));
  // share 1: the stored average; FIGHT.seconds / (FIGHT.seconds - wait): the full value once its seconds have passed.
  const applyWait = (t: BuildStats, x: CardOp, share: number) => {
    if (x.op === 'add') add(t, x.stat, scaled(x.value, o.level) * share);
    else if (x.op === 'mult') {
      const f = 1 + (x.factor - 1) * share;
      if ((x.stat === 'armor' || x.stat === 'mr') && x.scope === 'bonus') { const gain = t[bonusResist[x.stat]] * (f - 1); t[x.stat] += gain; t[bonusResist[x.stat]] += gain; }
      else multiply(t, x.stat, f);
    }
  };
  const fullShare = (x: CardOp) => FIGHT.seconds / (FIGHT.seconds - waitOf(x));
  const sAvg: BuildStats = { ...s };
  for (const x of waits) applyWait(sAvg, x, 1);
  const baseRates = record as unknown as { attackSpeedModifiable?: { baseValue?: number }; attackSpeedRatioModifiable?: { baseValue?: number } };
  const as0 = baseRates.attackSpeedModifiable?.baseValue ?? 0.625;
  const asRatio = baseRates.attackSpeedRatioModifiable?.baseValue || as0;
  // An amp for magic damage reaches a champion's abilities unless the kit deals only physical.
  // An amp on one chosen ability counts for one of the three basic ones.
  // An amp that needs some seconds in champion combat (Riftmaker 4, Liandry's 3) starts then, so a burst window of 3 s mostly misses it.
  // withAll false: the all-scope amps are already in another factor of the same damage (an ability takes amp('abilities') and then its own slot's).
  // An item's amp that waits seconds of combat comes averaged over the fight from knowledge/make-card-data.cjs (Riftmaker 8% read as 5.9%); the fight counts
  // the seconds itself, so once they have passed the full amp applies: (factor - 1) x 15 / (15 - seconds). Counting both halved it twice.
  const fullFactor = (x: Extract<CardOp, { op: 'damage_amp' }>) => { const w = combatSeconds(x); return w > 0 && w < FIGHT.seconds ? 1 + ((x.factor - 1) * FIGHT.seconds) / (FIGHT.seconds - w) : x.factor; };
  const amp = (scope: string, t = Infinity, withAll = true) => { const fs = ops.flatMap((x) => (x.op !== 'damage_amp' || t < combatSeconds(x) ? [] : (withAll && x.scope === 'all') || x.scope === scope || (x.scope === 'magic' && scope === 'abilities' && o.kit.damage !== 'physical') ? [fullFactor(x)] : x.scope === 'one_ability' && scope === 'abilities' ? [1 + (fullFactor(x) - 1) / 3] : [])); const byMana = ops.reduce((m, x) => (x.op === 'mana_amp' && ((withAll && x.scope === 'all') || x.scope === scope) && Number.isFinite(fullMana) ? m * (1 + (x.per100 * fullMana) / 100) : m), 1); return byMana * (o.ampStack === 'add' ? 1 + fs.reduce((m, f) => m + f - 1, 0) : fs.reduce((m, f) => m * f, 1)); };
  const cdFactor = (scope: string) => ops.reduce((m, x) => (x.op === 'cooldown' && (x.scope === 'all' || x.scope === scope) ? m * x.factor : m), 1);
  const locked = new Set(ops.flatMap((x) => (x.op === 'lock' ? [x.key] : [])));
  const critExtra = ops.reduce((m, x) => (x.op === 'crit_abilities' ? m + x.extra : m), 0);
  const dotCrit = ops.reduce((m, x) => (x.op === 'crit_dot' ? m + x.extra : m), 0);
  const bin = o.bin as Bin;
  const spellRef = (name: string) => { const tail = `/${name.toLowerCase()}`; return Object.entries(bin).find(([path, v]) => v?.__type === 'SpellObject' && path.toLowerCase().endsWith(tail))?.[1]?.mSpell; };

  // The file names the base and per-level mana only by hash (Karthus: 467 and 31).
  const fullMana = s.mana ?? Infinity;
  const manaCost = ops.reduce((m, x) => (x.op === 'mana_cost' ? m * x.factor : m), 1);
  // Mana a second from the champion's record (base and per level) raised by items' percent of base; flat item regen read as per 5 s, the smaller reading.
  const regenOf = (n: string) => (res?.[n] as { baseValue?: number } | undefined)?.baseValue ?? 0;
  const manaRegen = Number.isFinite(fullMana) ? (regenOf('{c4ab3550}') + regenOf('{3a509002}') * (o.level - 1)) * (1 + owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'PercentBaseMPRegenMod')?.values?.[0] ?? 0), 0)) + owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === 'FlatMPRegenMod')?.values?.[0] ?? 0), 0) / 5 : 0;
  const startMana = Math.min(fullMana, o.mana ?? Infinity);
  let mana = startMana;
  // A player paces his mana over the fights in a row instead of emptying it in the first (the owner, 2026-11-06): basic abilities keep back a floor,
  // so each fight spends an even share of what he starts with and what comes back between fights; the first cast of a fight and the ultimate always go.
  // Without it, haste only spent mana sooner: Karthus with Nashor's dealt 4,325, 4,113, then 832 in the third fight.
  const manaFloor = Number.isFinite(fullMana) ? startMana - (startMana + (FIGHT.manaFights - 1) * manaRegen * FIGHT.gapSeconds) / FIGHT.manaFights : -Infinity;

  interface Slot { rising?: { step: number; window: number; cap: number; casts: number[] }; path: string; key: string; spell: NonNullable<NonNullable<Bin[string]>['mSpell']>; rank: number; ranks: number; cooldown: number; cost: number; perSecond: boolean; overTime: boolean; toggle: boolean; ready: number; on: boolean; recast: boolean; crits: boolean; last?: number; dealt?: number }
  const passiveSpells = stacks === undefined ? [] : Object.values(bin).flatMap((v) => (v?.mSpell && Object.keys((v.mSpell as { mSpellCalculations?: object }).mSpellCalculations ?? {}).some((n) => /^Passive_[QWER]DamageIncrease$/.test(n)) ? [v.mSpell] : []));
  // An execute that comes with enough stacks (Smolder's Q at 225: below 6.5% of maximum health): the rest of a dying target's health, once a kill.
  // An item that executes below a share of health (The Collector: 5%, its file's ExecuteThreshold) does the same at each kill.
  const itemExecute = Math.max(0, ...owned.map((it) => it.DataValues?.find((d) => d.name === 'ExecuteThreshold')?.values?.[0] ?? 0).filter((x) => x > 0 && x < 1));
  const executeShare = stacks === undefined ? itemExecute : Math.max(itemExecute, ...Object.values(bin).flatMap((v) => {
    const sp = v?.mSpell as (SpellData & { DataValues?: { name: string; values?: number[] }[] }) | undefined;
    if (!sp?.mSpellCalculations) return [];
    return calculationsAt(sp, { ranks: 5, rank: 5, level: o.level, statOf: () => NaN, stacks }).flatMap((x) => {
      const tier = /^Tier(\d)_ExecuteThreshold$/.exec(x.name);
      const need = tier ? sp.DataValues?.find((d) => d.name === `StackTier${tier[1]}`)?.values?.[1] : undefined;
      return tier && need !== undefined && stacks >= need && x.value > 0 && x.value < 1 ? [x.value] : [];
    });
  }));
  const slots: Slot[] = [];
  const nasusDefense: Extract<CardOp, { op: 'timed' }>[] = [];
  const rankCounts = Object.fromEntries((['Q', 'W', 'E', 'R'] as const).map((k, i) => [k, bin[record.spells?.[i] ?? '']?.mSpell?.mClientData?.mTooltipData?.mLists?.LevelUp?.levelCount]));
  const allocation = allocateAbilityRanks(record, rankCounts, o.level, { ...o.skillPlan, from: o.knownRanks });
  (['R', 'Q', 'W', 'E'] as const).forEach((key) => {
    const path = record.spells?.['QWER'.indexOf(key)] ?? '';
    const spell = bin[path]?.mSpell;
    if (!spell || locked.has(key)) return;
    const { rank, ranks } = allocation[key];
    if (rank === 0) return;
    const spellLimit = SPELL_HITS[path]?.notModelled;
    if (spellLimit) notModelled.push(spellLimit);
    if (path === 'Characters/Karthus/Spells/KarthusDefileAbility/KarthusDefile') {
      // The simulated target changes carry no last-hit credit for Karthus.
      notModelled.push('Karthus E: استرداد المانا يتطلب قتلاً يُنسب إلى Karthus؛ هوية القاتل وقتل الوحدات الصغيرة والاستنزاف المستمر للمانا غير محسوبة');
    }
    if (path === NASUS_STORM) {
      const value = (name: string) => spell.DataValues?.find((v) => v.name === name)?.values?.[rank] ?? 0;
      const duration = value('Duration');
      const resist = value('InitialResistGain');
      if (duration > 0 && Number.isFinite(duration)) {
        for (const [stat, amount] of [['hp', value('BonusHealth')], ['armor', resist], ['mr', resist]] as const) {
          if (amount > 0 && Number.isFinite(amount)) nasusDefense.push({ op: 'timed', trigger: 'cast_R', stat, value: amount, mode: 'add', duration, refresh: true, stacks_max: 1 });
        }
        ops.push(...nasusDefense);
      }
      if (nasusDefense.length < 3) notModelled.push('Nasus R: بعض مكافآت الدفاع أو مدتها غير متاحة من ملف اللعبة');
    }
    // Some abilities keep their numbers in a sibling record of the same folder (Lux Q in LuxLightBindingMis), or name a base cooldown (Veigar W).
    const folder = path.slice(0, path.lastIndexOf('/') + 1);
    const sibling = folder ? Object.entries(bin).find(([p, v]) => p !== path && p.startsWith(folder) && (v?.mSpell?.cooldownTime?.[rank] ?? 0) > 1)?.[1]?.mSpell : undefined;
    const stated = spell.cooldownTime?.[rank] || sibling?.cooldownTime?.[rank] || spell.DataValues?.find((d) => d.name === 'BaseCooldown')?.values?.[rank] || (spell.cooldownTime ? 0 : NO_COOLDOWN_IN_FILE);
    // Jinx's Q: she fights in minigun, each attack a stack of attack speed (3 stacks for 2.5 s, 30% to 130% in all by rank), so Q is no cast of its own.
    // shortcut: the rockets' splash and range aren't modelled; upgrade when area damage is (knowledge: area-model).
    const minigun = spell.DataValues?.find((d) => d.name === 'MinigunAttackSpeedMax')?.values?.[rank];
    if (minigun) {
      const value = (name: string, fallback: number) => spell.DataValues?.find((d) => d.name === name)?.values?.[rank] || fallback;
      const n = value('MinigunAttackSpeedStacks', 3);
      ops.push({ op: 'timed', trigger: 'attack', stat: 'attack_speed', value: minigun / 100 / n, mode: 'add', duration: value('MinigunAttackSpeedDuration', 2.5), decays: false, stacks_max: n, refresh: true, internal_cooldown: null });
      return;
    }
    // Ashe's Q: no cast of its own (cooldown 0 in the file, so it was cast every second as a 1.2 AD nuke). After MaxStacks attacks it turns her attacks
    // for BuffDuration into a flurry of DamagePerStrike AD with BonusAS attack speed; taken here as its share of the fight: buff / (buff + stacks / attack speed).
    const flurry = spell.DataValues?.find((d) => d.name === 'DamagePerStrike')?.values?.[rank];
    const shots = spell.DataValues?.find((d) => d.name === 'ShotsPerStrike')?.values?.[rank];
    if (flurry && shots) {
      const value = (name: string, fallback: number) => spell.DataValues?.find((d) => d.name === name)?.values?.[rank] || fallback;
      const buff = value('BuffDuration', 6), bonusAs = value('BonusAS', 0) / 100;
      const uptime = buff / (buff + value('MaxStacks', 4) / Math.min(ATTACK_SPEED_CAP, as0 + asRatio * (s.bonusAttackSpeed + bonusAs)));
      ops.push({ op: 'damage_amp', scope: 'attacks', factor: 1 + (flurry - 1) * uptime });
      ops.push({ op: 'timed', trigger: 'always', stat: 'attack_speed', value: bonusAs * uptime, mode: 'add', duration: Infinity, decays: false, stacks_max: 1, refresh: false, internal_cooldown: null });
      return;
    }
    const names = Object.keys(spell.mSpellCalculations ?? {});
    // shortcut: a stated cooldown of a second or less is a toggle (Jinx's Q, Karthus's E); upgrade with a per-champion list if a real spell has one.
    // An ability whose calculation reads crit damage (stat 9) crits like an attack: Yasuo and Yone's Q, Garen's E, Talon's Q, and 40 more.
    const crits = JSON.stringify((spell as { mSpellCalculations?: unknown }).mSpellCalculations ?? {}).includes('"mStat":9');
    // A cost that rises with each cast inside a window (Kog'Maw's R: +40 a shot for 8 s, up to 400) makes a spell cast as often as mana allows, not a toggle (knowledge/fight-rules.md, casts).
    const dv = (n: string) => spell.DataValues?.find((d) => d.name === n)?.values?.[rank];
    const rising = dv('BaseCost') && dv('ManaCostDuration') ? { step: dv('BaseCost')! * manaCost, window: dv('ManaCostDuration')!, cap: (dv('ManaCostCap') ?? Infinity) * manaCost, casts: [] as number[] } : undefined;
    slots.push({ rising, crits, path, key, spell, rank, ranks, cooldown: stated || 1, cost: (spell.mana?.[rank - 1] ?? sibling?.mana?.[rank - 1] ?? 0) * manaCost, perSecond: names.some((n) => /dps/i.test(n)), overTime: names.some((n) => /dps|persecond/i.test(n)), toggle: !rising && stated > 0 && stated <= 1, ready: o.cooldowns?.[key] ?? 0, on: false, recast: key === 'R' && ops.some((x) => x.op === 'recast' && x.key === 'R') });
  });
  // A toggle is switched on first: a cheaper cooldown elsewhere kept Karthus's E off until 8.6 s with Lich Bane (the owner's case 17).
  slots.sort((a, b) => Number(b.toggle) - Number(a.toggle));

  const dt = 0.05;
  const targetHp = o.enemy?.hp ?? FIGHT.target.hp;
  const stateOf = new Map<CardOp, { stacks: number; until: number; start: number }>();
  const dots: { op: Extract<CardOp, { op: 'dot' }>; until: number; stacks: number; fromAbility: boolean }[] = [];
  let nasusQBuff: { until: number; factor: number } | undefined;
  let nasusDefenseUntil = 0, nasusDefenseSeconds = 0;
  const lastProc = new Map<CardOp, number>();
  const landing: { op: Extract<CardOp, { op: 'delayed_dot' }>; at: number; each: number; ticks: number; done: number; landed: boolean }[] = [];
  const echoes: { at: number; dealt: number; hits: number; events: boolean; onHit: boolean }[] = [];
  const kitHeals = ops.some((x) => (x.op === 'heal' || x.op === 'shield') && x.kit);
  // A mage whose own passive works on his attacks (Diana's third hit, Tahm Kench's, Orianna's, Lux's mark) attacks between casts as a physical non-attacker does (knowledge/fight-rules.md, kits).
  const passiveOnAttack = (o.passive ?? []).some((x) => 'trigger' in x && ON_ATTACK.has(x.trigger ?? ''));
  let abilityHealingOnly = 0;
  let abilityInstances = 0, armed = false, repeatCarry = 0, abilityHealing = 0, fromAbilities = 0, fromAttacks = 0, fromCards = 0, attacks = 0, nextAttack = o.kit.attacks || o.kit.damage !== 'magic' || passiveOnAttack ? 0 : Infinity, nextCast = 0, peakMs = 0, peakAs = 0, critCarry = 0;
  let critRepeatCarry = 0;
  const casts: Record<string, number> = {}, perCast: Record<string, number> = {};
  const ccEvents: CcEvent[] = [];
  const unreadCc = new Set<string>();
  const kills = [...FIGHT.killTimes];
  const abilityOnHit = ops.find((x) => x.op === 'abilities_on_hit');
  let nextAbilityOnHit = 0;
  const damageBySecond: number[] = [], ownBySecond: number[] = [];
  const current = (t: number) => {
    const c: BuildStats = { ...s };
    for (const x of waits) if (t >= waitOf(x)) applyWait(c, x, fullShare(x));
    let flatMs = 0, pctMs = 0;
    for (const [x, st] of stateOf) {
      if (x.op !== 'timed' || t > st.until || t < st.start) continue;
      const fade = x.decays && x.duration ? Math.max(0, 1 - (t - st.start) / x.duration) : 1;
      const v = scaled(x.value, o.level) * st.stacks * fade;
      if (x.stat === 'move_speed') { if (x.mode === 'percent') pctMs += v; else flatMs += v; }
      else if (x.mode === 'percent' && x.stat !== 'attack_speed') multiply(c, x.stat, 1 + v);
      else add(c, x.stat, v);
    }
    const ms = softSpeed((c.moveSpeed + flatMs) * (1 + pctMs));
    const baseMs = Number((record as { baseMoveSpeedModifiable?: { baseValue?: number } }).baseMoveSpeedModifiable?.baseValue) || ms;
    for (const x of ops) if (x.op === 'convert' && /move_speed/.test(x.from)) add(c, x.to, (x.from === 'bonus_move_speed' ? Math.max(0, ms - baseMs) : ms) * scaled(x.ratio, o.level));
    c.attackSpeed = Math.min(ATTACK_SPEED_CAP, as0 + asRatio * c.bonusAttackSpeed);
    c.moveSpeed = ms;
    return c;
  };
  const takenBy = (c: BuildStats) => {
    const armor = Math.max(0, (o.enemy?.armor ?? FIGHT.target.armor) * (1 - c.armorPenPercent) - c.lethality), mr = Math.max(0, (o.enemy?.mr ?? FIGHT.target.mr) * (1 - c.magicPenPercent) - c.magicPen);
    return { physical: 100 / (100 + armor), magic: 100 / (100 + mr), true: 1, adaptive: c.ap > c.bonusAd ? 100 / (100 + mr) : 100 / (100 + armor) };
  };
  // The ability just cast, for a refund measured on its cooldown (Archmage: 30% of it off another random ability).
  let lastCast = -Infinity;
  let castNow: { key: string; cooldown: number } | null = null;
  const reduce = (scope: string, amount: Amount, unit: string, t: number) => {
    // A share of the cast ability's cooldown taken off another ability at random: each other ability gets its expected part.
    if (unit === 'cast_share') {
      const cast = castNow, others = cast ? slots.filter((sl) => sl.key !== cast.key) : [];
      for (const sl of others) { const left = sl.ready - t; if (left > 0) sl.ready -= Math.min(left, (scaled(amount, o.level) * cast!.cooldown) / others.length); }
      return;
    }
    for (const sl of slots) {
      if (scope !== 'all' && scope !== 'one_ability' && (scope === 'ult') !== (sl.key === 'R')) continue;
      const left = sl.ready - t;
      if (left > 0) sl.ready -= unit === 'fraction' ? left * Math.min(1, scaled(amount, o.level)) : scaled(amount, o.level);
    }
  };
  // Heal and shield power (items' PercentHealingAmountMod, cards' heal_shield_power) raises the heals and shields items and cards give too, not only his abilities' (knowledge/fight-rules.md, heal).
  const healShieldPower = healPower + ops.reduce((m, x) => (x.op === 'add' && x.stat === 'heal_shield_power' ? m + scaled(x.value, o.level) : m), 0);
  let healed = 0, shielded = 0, fromAllies = 0, fromAttackProcs = 0;
  const fire = (trigger: string, t: number, c: BuildStats, hitSlot?: Slot) => {
    const taken = takenBy(c);
    for (const x of ops) {
      if (!('trigger' in x) || (x.trigger !== trigger && !(trigger === 'ability_hit' && (x.trigger === 'spell_hit' || x.trigger === 'burn')))) continue;
      if ('afterCastWindow' in x && x.afterCastWindow !== undefined && t - lastCast > x.afterCastWindow) continue;
      // A card's summoner spell or chosen spell comes once in a fight, whatever the abilities do.
      const icd = x.trigger === 'spell_hit' ? (('internal_cooldown' in x ? x.internal_cooldown : 0) || FIGHT.seconds) : 'internal_cooldown' in x ? (x.internal_cooldown ?? 0) : 0;
      if (icd && t - (lastProc.get(x) ?? -Infinity) < icd) continue;
      if (t < lowHealthAt(x)) continue; // an effect on falling below a share of his health waits until the enemies' damage takes him there
      if (t < combatSeconds(x)) continue; // it waits its seconds of fighting before the first time (knowledge/fight-rules.md, conditions)
      // A shield that blocks one kind of damage (Kaenic Rookern: magic only) counts for the share of the enemy's damage of that kind (knowledge/fight-rules.md, shields).
      if (x.op === 'heal' || x.op === 'shield') { const only = x.op === 'shield' ? /blocks (magic|physical) damage only/i.exec(String((x as { needs?: string }).needs ?? ''))?.[1]?.toLowerCase() : undefined; const physicalShare = o.enemy?.physicalShare ?? 0.5; const amount = formula(x.amount, c, o.level, targetHp) * (only === 'magic' ? 1 - physicalShare : only === 'physical' ? physicalShare : 1) * (1 + healShieldPower); healed += amount; if (x.op === 'shield') shielded += amount; lastProc.set(x, t); }
      // An extra on-hit on the attack after an ability (Dusk and Dawn), not on every attack.
      if (x.op === 'on_hit_repeat' && trigger === 'next_attack') { for (let k = 0; k < x.extra_hits; k++) fire('on_hit', t, c); lastProc.set(x, t); }
      if (x.op === 'proc') {
        const dealt = formula(x.damage, c, o.level, targetHp) * (taken[x.type as keyof typeof taken] ?? taken.adaptive) * amp('all', t);
        fromCards += dealt;
        if (ON_ATTACK.has(trigger)) fromAttackProcs += dealt; // life steal heals from on-hit damage too (Typhoon's bolt, Blade of the Ruined King)
        lastProc.set(x, t);
      }
      // Its damage is read from his stats when it is sent; the ticks land later (the loop below).
      if (x.op === 'delayed_dot' && t - (lastProc.get(x) ?? -Infinity) >= scaled(x.cooldown, o.level)) {
        const ticks = Math.max(1, Math.round(x.duration * x.ticksPerSecond));
        landing.push({ op: x, at: t + x.delay, each: (formula(x.damage, c, o.level, targetHp) * (taken[x.type as keyof typeof taken] ?? taken.adaptive)) / ticks, ticks, done: 0, landed: false });
        lastProc.set(x, t);
      }
      if (x.op === 'refund') {
        if (x.scope === 'hit_basic') {
          if (!hitSlot || hitSlot.key === 'R' || spellReach(hitSlot.path, hitSlot.rank) <= (x.minHitRange ?? 0) || hitSlot.ready <= t) continue;
          const amount = hitSlot.overTime ? x.periodicAmount ?? x.amount : x.amount;
          hitSlot.ready -= (hitSlot.ready - t) * scaled(amount, o.level);
        } else reduce(x.scope, x.amount, x.unit, t);
        lastProc.set(x, t);
      }
      if (x.op === 'mana_restore' && Number.isFinite(fullMana)) { mana = Math.min(fullMana, mana + formula(x.amount, c, o.level, targetHp)); lastProc.set(x, t); }
      // A burn applied again while it lasts adds a stack and refreshes; one that has ended starts again at one stack (knowledge/fight-rules.md).
      if (x.op === 'dot') { const d = dots.find((y) => y.op === x); if (d) { d.stacks = t > d.until ? 1 : Math.min(x.stacks_max ?? 1, d.stacks + 1); d.until = t + (x.duration ?? FIGHT.seconds); } else dots.push({ op: x, until: t + (x.duration ?? FIGHT.seconds), stacks: 1, fromAbility: false }); }
      if (x.op === 'timed') {
        const st = stateOf.get(x);
        const live = st && t <= st.until;
        if (live && !x.refresh && (x.stacks_max ?? 1) <= 1) continue;
        stateOf.set(x, { stacks: live ? Math.min(x.stacks_max ?? Infinity, st.stacks + 1) : 1, until: t + (x.duration ?? FIGHT.seconds), start: t }); // a card that names no end lasts the fight
        lastProc.set(x, t);
      }
    }
  };
  // On-hit applied by something other than an attack (BEES!!!): only on-hit damage, at a share; no stacks, heals, mana, refunds or spellblade, no life steal,
  // and no further events, so nothing it sets off can set it off again.
  const onHitShare = (share: number, t: number, c: BuildStats) => {
    const taken = takenBy(c);
    for (const x of ops) {
      if (x.op !== 'proc' || x.trigger !== 'on_hit' || t < lowHealthAt(x) || t < combatSeconds(x)) continue;
      if (x.internal_cooldown && t - (lastProc.get(x) ?? -Infinity) < x.internal_cooldown) continue;
      fromCards += formula(x.damage, c, o.level, targetHp) * (taken[x.type as keyof typeof taken] ?? taken.adaptive) * amp('all', t) * share;
      lastProc.set(x, t);
    }
  };
  for (const x of ops) if (x.op === 'timed' && x.trigger === 'always') { const at = lowHealthAt(x); stateOf.set(x, at > 0 ? { stacks: 1, until: at + (x.duration ?? FIGHT.seconds), start: at } : { stacks: 1, until: Infinity, start: 0 }); }
  // Bolts at other enemies: their damage in shares of an attack's, and their on-hits, both counted as damage dealt.
  const boltHits = ops.reduce((n, x) => (x.op === 'bolts' ? n + (melee ? x.melee : x.ranged) * FIGHT.boltHitShare : n), 0);
  const boltAd = ops.reduce((n, x) => (x.op === 'bolts' ? n + (melee ? x.melee : x.ranged) * FIGHT.boltHitShare * x.ad : n), 0);
  const repeatOnAttack = ops.reduce((n, x) => x.op === 'on_hit_repeat' && x.trigger !== 'next_attack' && x.trigger !== 'crit' ? n + x.extra_hits : n, 0);
  const repeatOnCrit = ops.reduce((n, x) => x.op === 'on_hit_repeat' && x.trigger === 'crit' ? n + x.extra_hits : n, 0);
  const stackedRepeats = ops.filter((x): x is Extract<CardOp, { op: 'timed' }> => x.op === 'timed' && x.trigger === 'attack' && (x.repeatOnHitEvery ?? 0) > 0);
  const stackedRepeatCounts = new Map<CardOp, number>();
  if (stackedRepeats.length) notModelled.push("Guinsoo's Rageblade: تفترض المحاكاة أن عدّ الضربات الإضافية يبدأ بعد اكتمال التراكمات، ويُصفّر عند انتهائها؛ توقيت الضربة الأولى يحتاج تحققًا في اللعبة");

  for (let t = 0; t < FIGHT.seconds; t += dt) {
    const c = current(t);
    mana = Math.min(fullMana, mana + manaRegen * dt);
    peakMs = Math.max(peakMs, c.moveSpeed);
    peakAs = Math.max(peakAs, c.attackSpeed);
    const taken = takenBy(c);
    // At each kill he turns to a new target: burns his items and cards left on the dead one end, so their stacks build again (knowledge/fight-rules.md, target switching).
    // The kill times stand for it: stored games show a champion death every 9.9 s of game time, about every 5 s of fighting if half the game is fighting.
    while (kills.length && t >= kills[0]!) {
      kills.shift();
      nextAbilityOnHit = t;
      fromAbilities += executeShare * targetHp;
      for (let i = dots.length - 1; i >= 0; i--) if (!dots[i]!.fromAbility) dots.splice(i, 1);
      fire('takedown', t, c);
      fire('kill', t, c);
    }
    // A mage or support who doesn't fight with attacks makes none (the owner: Ahri, Soraka); a physical non-attacker attacks between casts only, an assumption.
    if (t >= nextAttack) {
      attacks++;
      nextAttack = t + 1 / (c.attackSpeed * (o.kit.attackPace ?? (o.kit.attacks ? 1 : o.kit.damage === 'magic' && !passiveOnAttack ? 0 : 0.25)) * (melee ? FIGHT.attackUptime.melee : FIGHT.attackUptime.ranged));
      fromAttacks += c.ad * (1 + c.crit * (c.critDamage - 1)) * amp('attacks', t) * taken.physical * (1 + boltAd);
      critCarry += c.crit;
      const critical = critCarry >= 1;
      if (critical) {
        critCarry -= 1;
        critRepeatCarry += repeatOnCrit;
      }
      repeatCarry += repeatOnAttack + boltHits;
      fire('on_hit', t, c);
      for (; repeatCarry >= 1; repeatCarry--) fire('on_hit', t, c); // a share of attacks hits twice
      for (; critRepeatCarry >= 1; critRepeatCarry--) fire('on_hit', t, c);
      for (const x of stackedRepeats) {
        const st = stateOf.get(x);
        if (!st || t > st.until || st.stacks !== x.stacks_max) {
          stackedRepeatCounts.delete(x);
          continue;
        }
        const count = (stackedRepeatCounts.get(x) ?? 0) + 1;
        if (count === x.repeatOnHitEvery) {
          fire('on_hit', t, c);
          stackedRepeatCounts.delete(x);
        } else stackedRepeatCounts.set(x, count);
      }
      fire('attack', t, c);
      lastCast = -Infinity; // A basic attack consumes any charge from a previous cast.
      if (armed) { armed = false; fire('next_attack', t, c); } // an attack after an ability: it comes no faster than his attacks
      if (critical) fire('crit', t, c);
    }
    if (t >= nextCast) {
      // One Hit Wonder: its chosen ability gets no ability haste on its cooldown and turns that haste into damage instead (T028). Haste given to the
      // ability alone (Bread) or to basic/ult abilities stays on the cooldown and is not turned into damage: an estimate, flagged in notModelled above.
      const hasteToDamage = (key: string) => ops.reduce((m, x) => (x.op === 'haste_to_damage' && x.key === key ? m + x.per100 : m), 0);
      const haste = (scope: string, key: string) => (hasteToDamage(key) > 0 ? 0 : c.haste) + ops.reduce((n, x) => (x.op === 'add' && (x.stat === `${scope}_haste` || x.stat === `${key}_haste`) ? n + scaled(x.value, o.level) : n), 0);
      for (const sl of slots) {
        const cost = sl.rising ? Math.min(sl.rising.cap, sl.cost + sl.rising.step * sl.rising.casts.filter((x) => t - x < sl.rising!.window).length) : sl.cost;
        if (t < sl.ready || sl.on || mana < cost || (sl.key !== 'R' && mana < startMana && mana - cost < manaFloor)) continue;
        const scope = sl.key === 'R' ? 'ult' : 'basic';
        const read = calculationsAt(sl.spell, { ranks: sl.ranks, rank: sl.rank, level: o.level, statOf: statReader(c), spellRef, stacks });
        // A passive that adds damage to this ability per stack (Smolder: Passive_QDamageIncrease) adds it to the cast.
        const fromPassive = stacks === undefined ? [] : passiveSpells.flatMap((p) => calculationsAt(p, { ranks: sl.ranks, rank: sl.rank, level: o.level, statOf: statReader(c), spellRef, stacks }).filter((v) => v.name === `Passive_${sl.key}DamageIncrease`));
        // A spell's crit version (Nasus's CritDamage, Yasuo's TotalDamageCrit) is the hit when it crits, not its damage: read as damage it crit every cast, then crit again.
        const named = read.filter((v) => DAMAGE_NAME.test(v.name) && !NOT_DAMAGE.test(v.name) && !CRIT_VARIANT(v.name));
        // A spell whose only damage is named as bonus or secondary still deals it; a share of the target's health counts on the target.
        const reading = SPELL_HITS[sl.path];
        const chosen = reading?.calc ? read.filter((v) => v.name === reading.calc) : [];
        const values = chosen.length ? chosen : named.length ? named : read.filter((v) => DAMAGE_NAME.test(v.name) && !NOT_ANY_DAMAGE.test(v.name) && !CRIT_VARIANT(v.name));
        const critHit = Math.max(0, ...read.filter((v) => CRIT_VARIANT(v.name) && DAMAGE_NAME.test(v.name) && !NOT_ANY_DAMAGE.test(v.name) && !/mod|mult|scaling|current/i.test(v.name)).map((v) => v.value));
        // Jayce's tooltip adds a fraction stored as a raw rank value, outside the FlatDamage calculation.
        const jayceMeleeE = sl.path === JAYCE_MELEE_E;
        const percHp = jayceMeleeE ? sl.spell.DataValues?.find((v) => v.name === 'PercHPDamage')?.values?.[sl.rank] ?? 0 : 0;
        const validPercHp = percHp > 0 && percHp <= 1;
        if (jayceMeleeE && sl.last === undefined) {
          notModelled.push('Jayce E: الإطاحة وتغيير موضع الهدف غير محسوبين');
          if (!validPercHp) notModelled.push('Jayce E: نسبة ضرر الصحة القصوى غير متاحة من ملف اللعبة');
        }
        const healthShare = jayceMeleeE ? (validPercHp ? percHp : 0) : Math.max(0, ...read.filter((v) => HEALTH_SHARE_NAME.test(v.name) && !NOT_HEALTH_SHARE.test(v.name)).map((v) => (v.value <= 1 ? v.value : v.value <= 100 ? v.value / 100 : 0)));
        const healing = Math.max(0, ...read.filter((v) => HEALING_NAME.test(v.name) && !/monster|minion/i.test(v.name)).map((v) => v.value));
        if (!kitHeals) abilityHealing += healing; // read per ability as his own healing instead (knowledge/champion-heal-*.jsonl)
        if (!kitHeals) abilityHealingOnly += Math.max(0, ...read.filter((v) => /heal/i.test(v.name) && !/shield|monster|minion/i.test(v.name)).map((v) => v.value));
        if (healing > 0) for (const b of allyBuffs) b.until = t + b.seconds;
        const each = (values.length ? Math.max(...values.map((v) => v.value)) : 0) + (chosen.length ? 0 : healthShare * targetHp * (reading?.targetBonusHealth ? TARGET_BONUS_SHARE : 1)) + fromPassive.reduce((t, v) => t + v.value, 0);
        const nasusStorm = sl.path === NASUS_STORM;
        const one = nasusStorm ? 0 : each * (sl.toggle && sl.perSecond ? 1 : reading?.hits ?? 1); // a damage-per-second toggle already counts its seconds
        // A cast that deals damage over time (Miss Fortune's E: TotalDamagePerSecond for 2 s) is dealt at once here, so a card that crits damage over time crits it here; a toggle's goes through the dots.
        const overTime = sl.overTime && !sl.toggle ? 1 + c.crit * dotCrit : 1;
        // The game's own crit version says what a crit adds (Nasus: crit damage on his AD part, his stacks uncritted); without one, a crit raises the whole hit.
        const base = values.length ? Math.max(...values.map((v) => v.value)) : 0;
        const critGain = !sl.crits ? 0 : critHit > base && each > 0 ? (critHit - base) / each : c.critDamage - 1;
        // One Hit Wonder's gain on the chosen ability, used once on every damage path this cast builds: the hit, and Nasus R's storm built apart from it (T032).
        const hasteGain = 1 + (hasteToDamage(sl.key) * c.haste) / 100;
        const hit = one * amp('abilities', t) * amp(scope, t, false) * hasteGain * overTime * (1 + c.crit * (critExtra + critGain)); // shortcut without a crit version: a crit raises the whole hit, not only its AD part
        perCast[sl.key] = Math.round(hit);
        casts[sl.key] = (casts[sl.key] ?? 0) + 1;
        if (one > 0) abilityInstances += sl.toggle && sl.perSecond ? 1 : reading?.hits ?? 1;
        // The type its tooltip marks around the value cast (src/texts/damageTypes.ts), a share each when it names more than one (Ahri's Q: magic out, true back);
        // a value the text doesn't mark takes all the spell's marked types; no tooltip read: the kit's type, as before.
        const marked = (sl.spell as { __damageTypes?: SpellDamageTypes }).__damageTypes;
        const mainName = values.length ? values.reduce((a, b) => (b.value > a.value ? b : a)).name.toLowerCase() : '';
        const kinds = marked ? (marked.byName[mainName]?.length ? marked.byName[mainName]! : marked.all) : [];
        const abilityTaken = kinds.length ? kinds.reduce((m, k) => m + taken[k], 0) / kinds.length : o.kit.damage === 'physical' ? taken.physical : o.kit.damage === 'magic' ? taken.magic : (taken.physical + taken.magic) / 2;
        const mostly = kinds.length ? (['physical', 'magic', 'true'] as const).reduce((a, b) => (kinds.filter((k) => k === b).length > kinds.filter((k) => k === a).length ? b : a)) : o.kit.damage === 'physical' ? 'physical' : 'magic';
        mana -= cost;
        sl.rising?.casts.push(t);
        if (sl.toggle) {
          sl.on = true;
          if (sl.perSecond) dots.push({ op: { op: 'dot', per_second: { flat: hit }, duration: FIGHT.seconds, type: mostly }, until: FIGHT.seconds, stacks: 1, fromAbility: true });
          else fromAbilities += hit * abilityTaken;
        } else {
          fromAbilities += hit * abilityTaken;
          if (nasusStorm) {
            const duration = sl.spell.DataValues?.find((v) => v.name === 'Duration')?.values?.[sl.rank] ?? 0;
            const qReduction = sl.spell.DataValues?.find((v) => v.name === 'QCDR')?.values?.[sl.rank] ?? 0;
            const ratio = chosen.find((v) => !v.partial)?.value ?? 0;
            const validDuration = duration > 0 && Number.isFinite(duration);
            const validStorm = validDuration && ratio > 0 && ratio <= 1;
            nasusQBuff = validDuration && qReduction > 0 && qReduction < 1 ? { until: t + duration, factor: 1 - qReduction } : undefined;
            if (nasusDefense.length && validDuration) {
              const end = Math.min(FIGHT.seconds, t + duration);
              nasusDefenseSeconds += end - Math.max(t, nasusDefenseUntil);
              nasusDefenseUntil = end;
            }
            if (sl.last === undefined) {
              notModelled.push('Nasus R: يفترض بقاء الهدف قرب Nasus؛ توقيت النبضات وتفعيل آثار الإصابة غير محسوبين');
              if (nasusDefense.length) notModelled.push('Nasus R: الصحة والمقاومات المؤقتة محسوبة بمتوسط مدة نشاطها؛ مسار الصحة الفعلي عند البدء والانتهاء غير محسوب');
              if (!validStorm) notModelled.push('Nasus R: نسبة الضرر أو مدة العاصفة غير متاحة من ملف اللعبة');
              notModelled.push(nasusQBuff
                ? 'Nasus R: خفض تبريد Q يُحسب للإلقاءات الجديدة أثناء R؛ تغيير تبريد بدأ قبل R غير محسوب'
                : 'Nasus R: خفض تبريد Q أو مدة تأثيره غير متاح من ملف اللعبة');
            }
            if (validStorm) {
              const dps = ratio * targetHp * amp('abilities', t) * amp(scope, t, false) * hasteGain;
              const storm = { op: { op: 'dot' as const, trigger: 'nasus_storm', per_second: { flat: dps }, duration, type: 'magic' }, until: t + duration, stacks: 1, fromAbility: true };
              const previous = dots.findIndex((d) => d.op.trigger === 'nasus_storm');
              if (previous < 0) dots.push(storm);
              else dots[previous] = storm;
              perCast[sl.key] = Math.round(dps * Math.min(duration, FIGHT.seconds - t));
            }
          }
          const qFactor = sl.path === NASUS_SIPHONING_STRIKE && nasusQBuff && t < nasusQBuff.until ? nasusQBuff.factor : 1;
          sl.ready = t + Math.max(0.5, (sl.cooldown * qFactor * cdFactor(scope) * 100) / (100 + haste(scope, sl.key)));
          if (sl.path === GRAGAS_BODY_SLAM) {
            const refund = sl.spell.DataValues?.find((v) => v.name === 'CooldownRefund')?.values?.[sl.rank] ?? 0;
            const validRefund = refund > 0 && refund < 1;
            if (sl.last === undefined) notModelled.push(validRefund
              ? 'Gragas E: استرداد التبريد يفترض اصطدامًا؛ احتمال الإخفاق والتمركز غير محسوبين'
              : 'Gragas E: نسبة استرداد التبريد غير متاحة من ملف اللعبة');
            if (one > 0 && validRefund) sl.ready = t + Math.max(0.5, (sl.ready - t) * (1 - refund));
          }
          sl.last = t;
          sl.dealt = hit * abilityTaken;
          if (sl.recast) { sl.ready = t + CAST_SECONDS; sl.recast = false; }
        }
        const refund = REFUND_ON_HIT[sl.path] && sl.spell.DataValues?.find((v) => v.name === REFUND_ON_HIT[sl.path])?.values?.[sl.rank];
        if (one > 0 && refund) reduce('all', refund, 'seconds', t);
        // The file's flag for an ability that hits as an attack (Ezreal's Q): on-hit effects, and the spellblade an earlier ability armed.
        const asAttack = (sl.spell as { mApplyAttackEffect?: boolean }).mApplyAttackEffect === true;
        if (one > 0 && asAttack && armed) { armed = false; fire('next_attack', t, c); }
        // Abilities that apply on-hit (Ethereal Weapon) also set off spellblade, its own cooldown kept: the owner's Karthus with Lich Bane (2026-11-06), seen on screen.
        const etherealHit = one > 0 && !asAttack && abilityOnHit !== undefined && t + 1e-9 >= nextAbilityOnHit;
        if (etherealHit) nextAbilityOnHit = t + (abilityOnHit.internal_cooldown ?? 0);
        // Echo Cast: the same hit again after its delay, read from his stats now; no mana, no cooldown, no healing (knowledge/math-generation.md).
        if (one > 0 && !sl.toggle) for (const x of ops) if (x.op === 'echo' && x.key === sl.key) echoes.push({ at: t + x.delay, dealt: hit * abilityTaken * x.ratio, hits: reading?.hits ?? 1, events: !!x.events, onHit: asAttack || etherealHit });
        if (one > 0) { fire('ability_hit', t, c, sl); if (asAttack || etherealHit) fire('on_hit', t, c); if (etherealHit && !asAttack) fire('next_attack', t, c); }
        // A landed hit of a checked immobilizing ability roots the fight target: one event per cast on him, its duration from the file at this rank.
        const cc = IMMOBILIZE_ON_HIT[sl.path];
        const ccFor = cc && ((o.bin as Bin)[sl.path]?.mSpell?.DataValues ?? sl.spell.DataValues)?.find((v) => v.name === cc.field)?.values?.[sl.rank];
        // A known 0 is no root at this rank. No field, no value at this rank, or a value that isn't a number: the duration is unknown, so no
        // event is guessed and the limit is said (unreadCc, below) when a card waits on it.
        if (one > 0 && !sl.toggle && cc && !(typeof ccFor === 'number' && Number.isFinite(ccFor) && ccFor >= 0)) unreadCc.add(sl.key);
        if (one > 0 && !sl.toggle && cc && typeof ccFor === 'number' && Number.isFinite(ccFor) && ccFor > 0) { ccEvents.push({ source: 'ability', key: sl.key, path: sl.path, target: 'main', at: t, kind: cc.kind, duration: ccFor }); fire('immobilize_hit', t, c, sl); }
        armed = true;
        lastCast = t;
        castNow = { key: sl.key, cooldown: Math.max(0, sl.ready - t) };
        fire('ability_cast', t, c);
        castNow = null;
        fire(`cast_${sl.key}`, t, c); // one ability's own effects (a kit's self healing, knowledge/champion-heal-*.jsonl)
        if (sl.key === 'R') fire('ult_cast', t, c);
        nextCast = t + CAST_SECONDS;
        break;
      }
    }
    for (const x of ops) if ((x.op === 'proc' || x.op === 'heal' || x.op === 'shield') && x.trigger === 'periodic' && t - (lastProc.get(x) ?? -Infinity) >= (x.internal_cooldown || FIGHT.seconds)) fire('periodic', t, c);
    for (const d of dots) {
      if (t > d.until) continue;
      // An item's burn that area abilities apply (Liandry's, Blackfire Torch) burns every enemy they reach: the creators' burn builds on poke mages.
      const spread = o.kit.aoe && !d.fromAbility && d.op.trigger === 'ability_hit' ? FIGHT.areaTargets : 1;
      const each = formula(d.op.per_second, c, o.level, targetHp) * dt * d.stacks * spread * (taken[d.op.type as keyof typeof taken] ?? taken.adaptive) * (1 + c.crit * dotCrit);
      if (d.fromAbility) fromAbilities += each;
      else fromCards += each;
      if (each > 0 && (d.fromAbility || d.op.trigger === 'ability_hit')) abilityInstances += (dt / 0.5) * d.stacks * spread;
    }
    for (const e of echoes) {
      if (e.at < 0 || t < e.at - 1e-9) continue;
      e.at = -1; // done
      fromAbilities += e.dealt;
      if (e.events) { abilityInstances += e.hits; fire('ability_hit', t, c); if (e.onHit) fire('on_hit', t, c); }
    }
    for (const h of landing) {
      if (!h.landed && t >= h.at - 1e-9) { h.landed = true; if (h.op.onHitEfficacy) onHitShare(h.op.onHitEfficacy, t, c); }
      for (; h.done < h.ticks && t >= h.at + (h.done + 1) / h.op.ticksPerSecond - 1e-9; h.done++) fromCards += h.each * amp('all', t);
    }
    for (const b of allyBuffs) if (t < b.until) fromAllies += b.perSecond * dt;
    if (t + dt >= damageBySecond.length + 1) { damageBySecond.push(fromAbilities + fromAttacks + fromCards + fromAllies); ownBySecond.push(fromAbilities + fromAttacks + fromCards); }
  }
  // Whole casts make a cooldown cut count only when it fits one more in 15 s (25 haste added nothing for 46 champions); the share of the
  // next cast already waited out counts instead, when the mana for it is there. Off: tried 2026-11-04, owner cases 11 of 13 either way, first
  // item changed for 20 of 172, DeepSeek's core items in the first three 268 -> 261, its "never" items 4 -> 2; no proven gain, the owner decides.
  if (FIGHT.partialLastCast) for (const sl of slots) if (sl.dealt && sl.last !== undefined && sl.ready > FIGHT.seconds && mana >= sl.cost) {
    const part = (sl.dealt * (FIGHT.seconds - sl.last)) / (sl.ready - sl.last);
    fromAbilities += part;
    if (damageBySecond.length) damageBySecond[damageBySecond.length - 1]! += part;
  }
  // Heals only: shields are in healed too, and the card turns healing into damage, not shields (T034).
  fromCards += (healed - shielded) * ops.reduce((m, x) => (x.op === 'heal_damage' ? m + x.ratio : m), 0) * takenBy(s).magic;
  // An anti-heal item prevents healing; this is not damage and cannot generate omnivamp.
  // Includes healing on allies and assumes the healing is reached; per-enemy hit and debuff uptime remain unmodelled. Shields are excluded in enemyTeam.
  const grievous = Math.max(0, ...o.items.map((id) => o.shop[id]?.DataValues?.find((d) => d.name === 'GrievousAmount')?.values?.[0] ?? 0));
  const healingDenied = grievous * Math.max(0, o.enemy?.healPerSecond ?? 0) * FIGHT.seconds;
  for (const sl of slots) perCast[sl.key] ??= 0;
  // What he receives (Spirit Visage: HealingIncrease and ShieldIncrease 0.25) raises the heals, shields and vamp on himself, not what he gives allies (abilityHealing).
  const receives = (name: string) => 1 + owned.reduce((t, it) => t + (it.DataValues?.find((d) => d.name === name)?.values?.[0] ?? 0), 0);
  const receivedHeal = receives('HealingIncrease'), receivedShield = receives('ShieldIncrease');
  const selfHeal = (healed - shielded) * receivedHeal + shielded * receivedShield;
  for (const x of nasusDefense) add(sAvg, x.stat, scaled(x.value, o.level) * nasusDefenseSeconds / FIGHT.seconds);
  // Health gained from each immobilize in this fight (Soul Eater) lasts from that root to the fight's end: effective health takes its share of the fight.
  for (const x of ops) if (x.op === 'timed' && x.permanent && x.trigger === 'immobilize_hit' && x.stat === 'hp' && x.mode === 'add') add(sAvg, 'hp', ccEvents.reduce((m, e) => m + scaled(x.value, o.level) * Math.max(0, FIGHT.seconds - e.at), 0) / FIGHT.seconds);
  // What this fight's permanent gains add for the next one: each stack in full, from its start.
  const gainedHere = ops.reduce((m, x) => (x.op === 'timed' && x.permanent && x.stat === 'hp' && x.mode === 'add' ? m + scaled(x.value, o.level) * (stateOf.get(x)?.stacks ?? 0) : m), 0);
  const physical = sAvg.hp * (1 + Math.max(0, sAvg.armor) / 100), magic = sAvg.hp * (1 + Math.max(0, sAvg.mr) / 100);
  // Omnivamp that waits seconds of combat (Riftmaker) heals from the damage he deals after them: his own damage at that time, read off the seconds.
  const own = fromAbilities + fromAttacks + fromCards;
  const ownAt = (w: number) => { const k = Math.floor(w), lo = k ? ownBySecond[k - 1] ?? own : 0, hi = ownBySecond[k] ?? own; return lo + (hi - lo) * (w - k); };
  const vamp = s.omnivamp * own + waits.reduce((m, x) => (x.op === 'add' && x.stat === 'omnivamp' ? m + scaled(x.value, o.level) * fullShare(x) * Math.max(0, own - ownAt(waitOf(x))) : m), 0);
  // shortcut: a cut on incoming attacks only (Plated Steelcaps) counts for the enemy's physical share, physical abilities included; upgrade when the enemy's attacks are split out.
  const attacksOnly = (x: CardOp) => /incoming attacks only/i.test(String((x as { needs?: string }).needs ?? ''));
  const reduction = ops.reduce((m, x) => (x.op === 'add' && x.stat === 'damage_reduction' ? m * (1 - scaled(x.value, o.level) * (attacksOnly(x) ? o.enemy?.physicalShare ?? 0.5 : 1)) : m), 1);
  // The next fight starts with what is left plus what comes back between them; it is the same fight while that covers what this one spent.
  const left = mana, next = Math.min(fullMana, left + manaRegen * FIGHT.gapSeconds);
  const short = Number.isFinite(left) && next < startMana - left;
  const waiting = FIGHT.carryCooldowns ? Object.fromEntries(slots.flatMap((sl) => (sl.ready > FIGHT.seconds + FIGHT.gapSeconds ? [[sl.key, sl.ready - FIGHT.seconds - FIGHT.gapSeconds]] : []))) : {};
  const abilityHealPower = 1 + healPower + chainHeal + ops.reduce((m, x) => (x.op === 'add' && x.stat === 'heal_shield_power' ? m + scaled(x.value, o.level) : x.op === 'mana_amp' && x.scope === 'heal_shield' && Number.isFinite(fullMana) ? m + (x.per100 * fullMana) / 100 : m), 0);
  // A card waiting on an immobilize counts nothing from his abilities that weren't checked: say so rather than read that as "no CC".
  const unchecked = slots.filter((sl) => !IMMOBILIZE_ON_HIT[sl.path] && ((sl.spell as { mSpellTags?: string[] }).mSpellTags ?? []).includes('Trait_ImmobilizingCCSpell')).map((sl) => sl.key);
  if (unchecked.length && ops.some((x) => 'trigger' in x && x.trigger === 'immobilize_hit')) notModelled.push(`شل الحركة: قدرات ${unchecked.join('، ')} تحمل وسم شل الحركة لكن إصابتها لم تُفحص، فآثار التعزيزات المشروطة به منها غير محسوبة`);
  if (unreadCc.size && ops.some((x) => 'trigger' in x && x.trigger === 'immobilize_hit')) notModelled.push(`شل الحركة: مدة التثبيت لقدرات ${[...unreadCc].join('، ')} غير مقروءة من ملف اللعبة في هذه الرتبة، فلم يُحسب حدث ولا آثار التعزيزات المشروطة به`);
  const result: FightResult = {
    again: () => (short || Object.keys(waiting).length || gainedHere > 0 ? fight({ ...o, mana: short ? next : o.mana, cooldowns: waiting, gainedHp: (o.gainedHp ?? 0) + gainedHere }) : result),
    damage: fromAbilities + fromAttacks + fromCards + fromAllies,
    healingDenied,
    damageBySecond,
    fromAbilities,
    fromAttacks,
    fromCards,
    fromAllies,
    abilityHealing: abilityHealing * abilityHealPower,
    abilityHealingOnly: abilityHealingOnly * abilityHealPower,
    healParts: { ops: selfHeal, shields: shielded * receivedShield, omnivamp: vamp * receivedHeal, lifeSteal: s.lifeSteal * (fromAttacks + fromAttackProcs) * receivedHeal },
    healedHp: Math.max(0, selfHeal + (vamp + s.lifeSteal * (fromAttacks + fromAttackProcs)) * receivedHeal) * ((o.enemy ? 1 / (o.enemy.physicalShare / physical + (1 - o.enemy.physicalShare) / magic) : (physical + magic) / 2) / sAvg.hp),
    effectiveHp: (o.enemy ? 1 / (o.enemy.physicalShare / physical + (1 - o.enemy.physicalShare) / magic) : (physical + magic) / 2) / reduction,
    attacks,
    peakMoveSpeed: Math.round(peakMs),
    peakAttackSpeed: Math.round(peakAs * 100) / 100,
    casts,
    perCast,
    stats: { ad: sAvg.ad, ap: sAvg.ap, hp: sAvg.hp, armor: sAvg.armor, mr: sAvg.mr, attackSpeed: Math.min(ATTACK_SPEED_CAP, as0 + asRatio * sAvg.bonusAttackSpeed), crit: sAvg.crit, haste: sAvg.haste },
    notModelled,
    abilityInstances,
    ccEvents,
  };
  return result;
}

/** Whether a card's condition holds for this champion and build. "unknown": the card keeps its number but can't be ranked as certain. */
export type CardNeed = { class: string; items?: string[] | null; ability_kind?: string | null };
export function needHolds(need: CardNeed | undefined, o: { owned: string[]; ranged: boolean; traits: string[] }): 'yes' | 'no' | 'unknown' {
  if (!need) return 'yes';
  switch (need.class) {
    case 'always': case 'window': case 'chosen_ability': case 'summoner': return 'yes';
    // Not held yet is not a no: he can buy the item, and the build brings what a held card asks for (Upgrade Infinity Edge, Zwag's picks: 7 left out).
    case 'item': return (need.items ?? []).some((n) => o.owned.includes(n)) ? 'yes' : 'unknown';
    case 'melee': return o.ranged ? 'no' : 'yes';
    case 'ranged': return o.ranged ? 'yes' : 'no';
    case 'ability_kind': return o.traits.includes(need.ability_kind ?? '') ? 'yes' : 'unknown';
    default: return 'unknown';
  }
}

/** What a card adds, given what's already held: the difference it makes in the same fight. */
export function cardGain(o: Parameters<typeof fight>[0], card: CardNumbers): { damage: number; effectiveHp: number; before: FightResult; after: FightResult } {
  const before = fight(o), after = fight({ ...o, cards: [...o.cards, card] });
  return { damage: before.damage ? after.damage / before.damage - 1 : 0, effectiveHp: before.effectiveHp ? after.effectiveHp / before.effectiveHp - 1 : 0, before, after };
}
