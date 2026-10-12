/**
 * Lista blanca de lo que `POST /` y `PUT /:id` escriben en la cabecera de una
 * acción correctiva.
 *
 * Hasta oct-2026 el servicio pasaba el body casi entero a Prisma (solo
 * apartaba las listas anidadas y convertía fechas), y el `POST` declara
 * `additionalProperties: true`. Con `acciones-correctivas:full` bastaba mandar
 * `estado_aprobacion: 'APROBADO'` para dar por aprobado el plan sin pasar por
 * `aprobar` —que es donde se comprueba el cargo—, o `estado_global`,
 * `registrado_por_id`, `creado_por_id`, `hallazgo_tipo` o `deleted_at`.
 *
 * Está en un archivo aparte, sin Prisma, para que su prueba no necesite base.
 */

/**
 * Columnas que edita el formulario (`FormularioAccion.svelte` y
 * `ModalFormularioAccion.svelte` en los dos frontends), más
 * `accion_origen_reapertura`, que pone la reapertura. Las listas anidadas
 * (`causas`, `seguimientos_correccion`, `ciclos_eficacia`,
 * `evidencias_eficacia`) no van aquí: el servicio las construye campo a campo
 * con sus `build*Create`.
 *
 * Fuera a propósito, porque cada una tiene su propia puerta:
 * - `estado_aprobacion` → `aprobaciones/aprobar|rechazar|reset` (validan cargo).
 * - `estado_global`, `fecha_actualizacion_estado`, `observaciones`,
 *   `registrado_por_id` → `estado-global` y `calcular-estado`.
 * - `hallazgo_tipo` → decide QUIÉN aprueba (manda sobre la etiqueta
 *   `tipo_hallazgo_detectado`); cambiarlo por aquí era otra forma de elegir
 *   aprobador.
 * - `creado_por_id` → sale del token (o del llamador interno en `crear`).
 * - `deleted_at` → papelera (`DELETE /:id`, `restaurar`).
 * - `pesv_*`, `origen_pesv` → vínculo con el ciclo PESV, no los edita nadie.
 * - `estado_accion`, `fecha_seguimiento`, `responsable_ejecucion`,
 *   `fecha_limite_cierre_accion` → columnas heredadas de cuando la acción
 *   tenía un solo plan; hoy viven en cada causa.
 *
 * `replanteo_correccion` lo manda el formulario, pero no es una columna: antes
 * hacía fallar el guardado con el error de Prisma; ahora se descarta.
 */
export const CAMPOS_EDITABLES_ACCION = [
  'accion_numero',
  'lugar_sede',
  'proceso_origen_hallazgo',
  'componente_elemento_referencia',
  'fuente_genero_hallazgo',
  'fuente_genero_hallazgo_otros',
  'marco_legal_normativo',
  'fecha_identificacion_hallazgo',
  'descripcion_hallazgo',
  'tipo_hallazgo_detectado',
  'tipo_hallazgo_otros',
  'variable_categoria_analisis',
  'aplica_correccion_inmediata',
  'justificacion_no_correccion',
  'responsable_correccion',
  'correccion_solucion_inmediata',
  'fecha_implementacion',
  'valoracion_riesgo',
  'requiere_actualizar_matriz',
  'matriz_a_actualizar',
  'tipo_accion_ejecutar',
  'fecha_limite_evaluacion_eficacia',
  'criterio_evaluacion_eficacia',
  'evaluaciones_eficacia',
  'fecha_evaluacion_eficacia',
  'analisis_evidencias_cierre',
  'evaluacion_cierre_eficaz',
  'soporte_cierre_eficaz',
  'fecha_cierre_definitivo',
  'responsable_cierre',
  'cargo_responsable_cierre',
  'observaciones_cierre',
  'aplica_reapertura',
  'fecha_reapertura',
  'razon_reapertura',
  'accion_origen_reapertura',
  /// El formulario deja fijar la fecha de creación para registrar hallazgos
  /// antiguos; no es un campo de control.
  'created_at',
] as const

export type CampoEditableAccion = (typeof CAMPOS_EDITABLES_ACCION)[number]

const PERMITIDOS = new Set<string>(CAMPOS_EDITABLES_ACCION)

/**
 * Copia de `data` con solo los campos editables que llegaron (los `undefined`
 * se quedan fuera, igual que antes: en el `PUT` significan «no tocar»).
 */
export function camposEditablesAccion(
  data: Record<string, unknown> | null | undefined,
): Partial<Record<CampoEditableAccion, unknown>> {
  const resultado: Record<string, unknown> = {}
  if (!data || typeof data !== 'object') return resultado
  for (const [clave, valor] of Object.entries(data)) {
    if (PERMITIDOS.has(clave) && valor !== undefined) resultado[clave] = valor
  }
  return resultado
}
