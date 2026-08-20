/**
 * Reglas condicionales declarativas.
 *
 * Formato canónico (el mismo que evalúa el runner del portal):
 *
 * ```json
 * {
 *   "version": 1,
 *   "all": [{ "fieldKey": "estado", "operator": "equals", "value": "NC" }],
 *   "effect": { "action": "require", "targetFieldKey": "observacion" }
 * }
 * ```
 *
 * Nunca se guarda ni se evalúa JavaScript: `config_json`/`visibility_rule_json`
 * son datos, no código. Una regla mal formada es un error de publicación, no
 * una excepción en tiempo de diligenciamiento.
 */

export const RULE_OPERATORS = [
  'equals',
  'notEquals',
  'in',
  'notIn',
  'exists',
  'gt',
  'gte',
  'lt',
  'lte',
] as const

export type RuleOperator = (typeof RULE_OPERATORS)[number]

export const RULE_ACTIONS = ['show', 'hide', 'require', 'disable'] as const
export type RuleAction = (typeof RULE_ACTIONS)[number]

/** Operadores cuyo `value` debe ser un array. */
export const ARRAY_OPERATORS: readonly RuleOperator[] = ['in', 'notIn']

/** Operadores cuyo `value` debe ser numérico. */
export const NUMERIC_OPERATORS: readonly RuleOperator[] = ['gt', 'gte', 'lt', 'lte']

/**
 * Operadores que ignoran `value`.
 *
 * `exists` pregunta por presencia, así que un `value` ahí es ruido: se avisa
 * como warning en vez de rechazarlo, porque las semillas transcritas a mano
 * lo traen a veces.
 */
export const VALUELESS_OPERATORS: readonly RuleOperator[] = ['exists']

export interface RuleCondition {
  /** `key` de otro campo de la MISMA versión. Nunca un id. */
  fieldKey: string
  operator: RuleOperator
  value?: unknown
}

export interface RuleEffect {
  action: RuleAction
  /**
   * Campo afectado. Si se omite, el efecto recae sobre el campo que lleva la
   * regla, que es el caso habitual (`show`/`hide` de sí mismo).
   */
  targetFieldKey?: string
}

export interface Rule {
  version: number
  /** Todas las condiciones deben cumplirse. */
  all?: RuleCondition[]
  /** Basta con una. */
  any?: RuleCondition[]
  effect: RuleEffect
}

export function isRuleOperator(value: unknown): value is RuleOperator {
  return typeof value === 'string' && (RULE_OPERATORS as readonly string[]).includes(value)
}

export function isRuleAction(value: unknown): value is RuleAction {
  return typeof value === 'string' && (RULE_ACTIONS as readonly string[]).includes(value)
}

/** Todas las condiciones de la regla, sin importar si están en `all` o `any`. */
export function ruleConditions(rule: Rule): RuleCondition[] {
  return [...(rule.all ?? []), ...(rule.any ?? [])]
}
