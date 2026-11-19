export type TargetAbility = 'Q' | 'W' | 'E' | 'R';

/** Kiwi 16.21: these tooltips use {{SpellName}} and IsAbilityAugment, so the
 * Q/W/E-named value fields alone are not evidence of the selected target.
 * Runtime effects use scope:chosen_ability; this list only exposes the input UI.
 */
export const ABILITY_TARGET_AUGMENTS = [1103, 1150, 1151, 2062, 3060, 2123, 2116, 2100] as const; // 2062 Echo Cast: same {{SpellName}} and IsAbilityAugment; 3060 One Hit Wonder: its text names the chosen ability; 2123 Overloaded: {{SpellName}} and IsAbilityAugment (kiwi 16.23); 2116 Pursuit of Power and 2100 Pursuit of Haste: their quest and reward name the chosen ability (T142)
export const needsAbilityTarget = (ids: number[]) => ABILITY_TARGET_AUGMENTS.some((id) => ids.includes(id));
/** T133: the Bread family's key is fixed by its name (about 23 creator screen reads on 20 named champions, no exception:
 * Butter Q, Jam W, Cheese E), so it is used when no key is given. A key the player sets still wins. The other
 * targeted cards vary by champion and stay unset without one. */
export const FIXED_ABILITY_KEY: Partial<Record<number, TargetAbility>> = { 1103: 'Q', 1150: 'W', 1151: 'E' };
