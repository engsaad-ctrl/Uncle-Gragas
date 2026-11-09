export type TargetAbility = 'Q' | 'W' | 'E' | 'R';

/** Kiwi 16.21: these tooltips use {{SpellName}} and IsAbilityAugment, so the
 * Q/W/E-named value fields alone are not evidence of the selected target.
 * Runtime effects use scope:chosen_ability; this list only exposes the input UI.
 */
export const ABILITY_TARGET_AUGMENTS = [1103, 1150, 1151, 2062] as const; // 2062 Echo Cast: same {{SpellName}} and IsAbilityAugment
export const needsAbilityTarget = (ids: number[]) => ABILITY_TARGET_AUGMENTS.some((id) => ids.includes(id));
