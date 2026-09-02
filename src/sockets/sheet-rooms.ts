/**
 * Claves de room de los canvas colaborativos.
 *
 * Módulo aparte a propósito: `sheet.gateway.ts` importa los services de
 * dominio y esos services necesitan la clave para emitir. Tenerla aquí evita
 * el ciclo service ↔ gateway, que en CommonJS deja uno de los dos
 * `undefined` durante la inicialización.
 *
 * DOS GRANULARIDADES, y la diferencia importa:
 *
 *  · `adicionales` y `ocasional` son libros ANUALES (12 hojas, una por mes),
 *    así que el room es el AÑO: quien tiene el libro abierto está viendo
 *    los doce meses.
 *
 *  · `ingresos` es un libro de PERIODO en pantalla (solo las dos hojas del
 *    mes), pero su room sigue siendo el AÑO: la presencia y los avisos son
 *    los del libro, y el usuario cambia de mes sin salir de él. Su tabla es
 *    derivada, así que del protocolo usa la capa de ANOTACIONES y la
 *    retransmisión de la columna INCLUIR.
 *
 *  · `cierres-finales` es un libro de PERIODO (una hoja por placa), así que
 *    el room es `anio:mes`. Con room por año, cada patch de cualquiera de
 *    los doce meses × N placas se difundiría a todos los conectados del
 *    año — el problema no es de corrección, es de fan-out.
 *
 *  · `nomina` es un libro de PERIODO (una hoja por conductor del mes),
 *    así que el room es `anio:mes`, por la misma razón que
 *    `cierres-finales`.
 *
 *  · `servicios-historial` es el HISTÓRICO COMPLETO de liquidaciones de
 *    servicios: el filtro de año es un filtro de vista, no un libro
 *    distinto. Su room es GLOBAL (ignora `anio`): dos usuarios mirando
 *    años distintos siguen trabajando sobre las mismas filas y deben
 *    verse entre sí. El `anio` del join se acepta (y valida) igual para
 *    no abrir un caso especial en el gateway.
 */

export type SheetScope =
  | 'adicionales'
  | 'ocasional'
  | 'cierres-finales'
  | 'ingresos'
  | 'servicios-historial'
  | 'nomina'

export const SHEET_SCOPES: SheetScope[] = [
  'adicionales',
  'ocasional',
  'cierres-finales',
  'ingresos',
  'servicios-historial',
  'nomina',
]

/** Scopes cuyo libro es un periodo y por tanto exigen `mes`. */
export function requiereMes(scope: SheetScope): boolean {
  // `nomina` es un libro de PERIODO igual que `cierres-finales`: una hoja
  // por conductor del mes, así que el room lleva mes.
  return scope === 'cierres-finales' || scope === 'nomina'
}

/**
 * Clave del room.
 *
 * Para los scopes anuales el `mes` se IGNORA, de modo que la cadena es
 * idéntica a la que se generaba antes de introducir el parámetro. Eso es lo
 * que permite añadir `cierres-finales` sin tocar el comportamiento de los
 * canvas ya desplegados.
 */
export function sheetRoomKey(
  scope: SheetScope,
  anio: number,
  mes?: number | null,
): string {
  if (requiereMes(scope)) {
    if (mes == null) {
      throw new Error(`El scope "${scope}" requiere mes para construir el room`)
    }
    return `sheet:${scope}:${anio}:${mes}`
  }
  // Room global: el histórico es un solo libro compartido, se mire el año
  // que se mire (ver el comentario de cabecera).
  if (scope === 'servicios-historial') {
    return `sheet:${scope}`
  }
  return `sheet:${scope}:${anio}`
}
