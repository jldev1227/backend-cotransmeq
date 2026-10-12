import {
  CATEGORIA_CONDUCTOR_POR_CLAVE,
  DIAS_POR_VENCER,
  ESTADO_NO_APLICA,
  type CategoriaDocumentoConductor,
} from './catalogo'

/**
 * Cálculo de vigencias y umbrales de aviso de los documentos del conductor.
 *
 * Vive aparte del servicio y del cron, sin Prisma ni S3, para que el test lo
 * importe sin levantar nada y para que la pestaña y los avisos no puedan
 * discrepar: los dos deciden con estas mismas funciones.
 */

export type EstadoVigencia = 'vigente' | 'por_vencer' | 'vencido' | 'sin_fecha' | 'no_aplica' | 'faltante' | 'cargado'

/** Lo mínimo de una fila de `documento` para decidir su vigencia. */
export interface FilaVigencia {
  estado: string
  fecha_vencimiento: Date | null
  fecha_vigencia: Date | null
  metadata: unknown
}

/** `YYYY-MM-DD` de una fecha `@db.Date` (llega a medianoche UTC). */
export const isoDia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** Hoy en Colombia, como `YYYY-MM-DD`. */
export function hoyColombia(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora)
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000)
}

/**
 * Vencimiento de una fila. Misma precedencia que en los documentos del
 * vehículo: la carga de 2025 guardó `fecha_vigencia` un día después y dejó el
 * valor bueno en `metadata.fechaVigenciaOriginal`.
 */
export function vencimientoDe(d: Pick<FilaVigencia, 'fecha_vencimiento' | 'fecha_vigencia' | 'metadata'>): string | null {
  const original = (d.metadata as Record<string, unknown> | null)?.fechaVigenciaOriginal
  return (
    isoDia(d.fecha_vencimiento) ??
    (typeof original === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(original) ? original : null) ??
    isoDia(d.fecha_vigencia)
  )
}

/** Días antes del vencimiento en que la categoría pasa a «por vencer». */
export const diasAvisoDe = (cat: Pick<CategoriaDocumentoConductor, 'diasAviso'> | undefined) => cat?.diasAviso ?? DIAS_POR_VENCER

/**
 * Estado de una categoría a partir de su documento actual.
 *
 * `venceFicha` es el vencimiento que trae la ficha del conductor
 * (`conductores.vencimiento_licencia`). Solo lo pasa la licencia, y manda
 * sobre la fecha del documento: es lo que imprime el FUEC y lo que mira el
 * panel de talento humano, y una licencia con fecha en la ficha pero sin
 * archivo sigue siendo una licencia vigente (a la que le falta el soporte).
 */
export function estadoDe(
  clave: string,
  actual: FilaVigencia | null,
  hoy: string,
  venceFicha: string | null = null,
): { estado: EstadoVigencia; dias: number | null; vence: string | null } {
  const cat = CATEGORIA_CONDUCTOR_POR_CLAVE.get(clave)
  if (actual?.estado === ESTADO_NO_APLICA) return { estado: 'no_aplica', dias: null, vence: null }
  if (!cat?.vence) return { estado: actual ? 'cargado' : 'faltante', dias: null, vence: null }
  const vence = venceFicha ?? (actual ? vencimientoDe(actual) : null)
  if (!vence) return { estado: actual ? 'sin_fecha' : 'faltante', dias: null, vence: null }
  const dias = diasEntre(hoy, vence)
  return { estado: dias < 0 ? 'vencido' : dias <= diasAvisoDe(cat) ? 'por_vencer' : 'vigente', dias, vence }
}

// ── Avisos ──

/// Umbrales en días. Una categoría con `diasAviso` corto (la PILA mensual)
/// solo usa los que caben en su ventana: con 30 avisaría el mismo día en que
/// se sube.
export const UMBRALES = [30, 15, 7, 0] as const
/// «Vencido» solo se avisa los primeros días: lo que venció hace meses ya está
/// en rojo en la ficha, y avisarlo todo el primer día serían cientos de
/// notificaciones que nadie leería.
export const DIAS_AVISO_VENCIDO = 3

/**
 * Umbral en que cae un documento, o null si todavía no toca avisar.
 *
 * Es el menor umbral que todavía no se alcanzó (a 12 días → el de 15): si el
 * cron no corre un día, el aviso sale al siguiente en vez de perderse.
 */
export function umbralDe(dias: number, diasAviso: number = DIAS_POR_VENCER): string | null {
  if (dias < 0) return dias >= -DIAS_AVISO_VENCIDO ? 'vencido' : null
  const u = UMBRALES.filter((x) => x <= diasAviso)
    .reverse()
    .find((x) => dias <= x)
  return u === undefined ? null : String(u)
}

/// Prefijo de la huella. `notificacion.referencia_tipo` es VARCHAR(50): el
/// prefijo corto deja sitio a la categoría más larga (ver el test).
export const PREFIJO_AVISO = 'doccond'

/**
 * Huella del aviso: categoría + vencimiento + umbral. Con `referencia_id` =
 * conductor identifica el aviso; una renovación tiene otra fecha, así que su
 * ciclo de avisos empieza de cero.
 */
export function referenciaAviso(categoria: string, vence: string, umbral: string): string {
  return `${PREFIJO_AVISO}:${categoria}:${vence}:${umbral}`
}
