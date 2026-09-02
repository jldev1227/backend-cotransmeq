/**
 * Catálogo de operadoras a sembrar.
 *
 * Esta lista es un PUNTO DE PARTIDA, no la verdad: sale de lo que hoy hay
 * escrito en `liquidacion_servicio.operadora`, que es texto libre. Antes de
 * sembrar, córrelo:
 *
 *   npx tsx scripts/operadoras-inventario.ts
 *
 * y añade aquí lo que aparezca y no esté. Si falta algún código, el backfill
 * del SQL aborta con «BACKFILL INCOMPLETO» en vez de dejar filas huérfanas —
 * esa es la red de seguridad, no un estorbo.
 *
 * `codigo` va normalizado (mayúsculas, sin espacios sobrantes) porque es la
 * clave con la que casan el backfill, el CRUD y este seed. `nombre` es la
 * etiqueta visible y se puede editar luego desde la interfaz.
 */

export interface SemillaOperadora {
  codigo: string
  nombre: string
  /// El <select> del editor ordena por esto. Múltiplos de 10 para poder
  /// intercalar una operadora nueva sin reescribir las demás.
  orden: number
}

export const SEMILLAS_OPERADORAS: SemillaOperadora[] = [
  { codigo: 'PAREX', nombre: 'Parex', orden: 10 },
  { codigo: 'GEOPARK', nombre: 'GeoPark', orden: 20 },
  /// 'OTRA' no es una operadora: es el default del editor, y significa «esta
  /// liquidación no se atribuye a ninguna». Va la última a propósito, y no se
  /// puede quitar del catálogo sin decidir antes qué default la sustituye.
  { codigo: 'OTRA', nombre: 'Otra', orden: 999 }
]

/**
 * Normalización del código. La comparten seed, inventario, CRUD y el backfill
 * del SQL (`upper(btrim(...))`); si divergen, el backfill deja huérfanas y las
 * altas nuevas duplican códigos que solo difieren en espacios.
 */
export function normalizarCodigoOperadora(valor: string): string {
  return valor.trim().toUpperCase()
}
