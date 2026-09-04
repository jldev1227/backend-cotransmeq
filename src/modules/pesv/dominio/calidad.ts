/**
 * Reglas de calidad de datos del centro PESV.
 *
 * La regla que las gobierna todas: **un dato dudoso se excluye y se cuenta**,
 * nunca se arregla por su cuenta ni se ignora en silencio. Cada agregado
 * devuelve una `CoberturaDatos` con lo esperado, lo válido y lo excluido con su
 * motivo, y el panel las convierte en alertas accionables.
 *
 * El PESV se audita: un porcentaje calculado sobre un denominador que se comió
 * la mitad de los registros sin decirlo es peor que no tener el indicador.
 */

/** Motivos por los que un registro queda fuera de un cálculo. */
export const MOTIVOS_EXCLUSION = [
  'SIN_VEHICULO',
  'SIN_CONDUCTOR',
  'SIN_FECHA',
  'KILOMETRAJE_INVALIDO',
  'KILOMETRAJE_AUSENTE',
  'PLACA_NO_NORMALIZABLE',
  'IDENTIFICACION_INVALIDA',
  'DUPLICADO',
  'FUERA_DE_PERIODO',
  'BORRADOR',
  'ANULADO',
  'SUSTITUIDO',
  'SIN_ASIGNACION_PESV',
  'SIN_POLITICA_VIGENTE',
  'HORARIO_INCOHERENTE',
] as const

export type MotivoExclusion = (typeof MOTIVOS_EXCLUSION)[number]

export const ETIQUETAS_EXCLUSION: Record<MotivoExclusion, string> = {
  SIN_VEHICULO: 'El registro no identifica vehículo',
  SIN_CONDUCTOR: 'El registro no identifica conductor',
  SIN_FECHA: 'El registro no tiene fecha utilizable',
  KILOMETRAJE_INVALIDO: 'Kilometraje final menor que el inicial',
  KILOMETRAJE_AUSENTE: 'Recorrido sin kilometraje registrado',
  PLACA_NO_NORMALIZABLE: 'La placa no tiene un formato reconocible',
  IDENTIFICACION_INVALIDA: 'Identificación de conductor no utilizable',
  DUPLICADO: 'Registro repetido para la misma clave',
  FUERA_DE_PERIODO: 'La fecha cae fuera del período consultado',
  BORRADOR: 'Envío en borrador: todavía no fue entregado',
  ANULADO: 'Registro anulado',
  SUSTITUIDO: 'Reemplazado por una corrección posterior',
  SIN_ASIGNACION_PESV: 'La asignación no está etiquetada como preoperacional PESV',
  SIN_POLITICA_VIGENTE: 'No hay política de jornada vigente para esa fecha',
  HORARIO_INCOHERENTE: 'Horario de inicio y fin incoherente',
}

export interface Exclusion {
  motivo: MotivoExclusion
  cantidad: number
  /** Hasta 20 ids, suficientes para ir al registro sin volcar la tabla. */
  ejemplos: string[]
}

export interface CoberturaDatos {
  /** Registros que el período debería haber producido. */
  esperados: number
  /** Los que superaron todas las reglas y entran en el cálculo. */
  validos: number
  /** Los que quedaron fuera. Siempre `esperados - validos`. */
  excluidos: number
  motivos: Exclusion[]
}

/**
 * Acumulador de exclusiones.
 *
 * Existe porque el patrón alternativo —un `if` que hace `continue` y a lo sumo
 * un `console.warn`— es exactamente cómo se pierde la trazabilidad: el registro
 * desaparece del denominador y nadie se entera hasta que alguien compara a
 * mano con la planilla.
 */
export class RegistroCobertura {
  private esperados = 0
  private validos = 0
  private readonly porMotivo = new Map<MotivoExclusion, { cantidad: number; ejemplos: string[] }>()

  contarEsperado(cuantos = 1): void {
    this.esperados += cuantos
  }

  contarValido(cuantos = 1): void {
    this.validos += cuantos
  }

  excluir(motivo: MotivoExclusion, id?: string | null): void {
    const actual = this.porMotivo.get(motivo) ?? { cantidad: 0, ejemplos: [] }
    actual.cantidad += 1
    if (id && actual.ejemplos.length < 20) actual.ejemplos.push(id)
    this.porMotivo.set(motivo, actual)
  }

  /** Cuenta el registro como esperado y lo excluye de una vez. */
  esperadoPeroExcluido(motivo: MotivoExclusion, id?: string | null): void {
    this.contarEsperado()
    this.excluir(motivo, id)
  }

  /** Cuenta el registro como esperado y válido de una vez. */
  esperadoYValido(cuantos = 1): void {
    this.contarEsperado(cuantos)
    this.contarValido(cuantos)
  }

  resultado(): CoberturaDatos {
    const motivos = Array.from(this.porMotivo.entries())
      .map(([motivo, { cantidad, ejemplos }]) => ({ motivo, cantidad, ejemplos }))
      .sort((a, b) => b.cantidad - a.cantidad)
    return {
      esperados: this.esperados,
      validos: this.validos,
      excluidos: Math.max(0, this.esperados - this.validos),
      motivos,
    }
  }
}

/** Cobertura vacía, para el caso «no había nada que evaluar». */
export function coberturaVacia(): CoberturaDatos {
  return { esperados: 0, validos: 0, excluidos: 0, motivos: [] }
}

/** Suma coberturas de varias fuentes en una sola, conservando los motivos. */
export function fusionarCoberturas(...partes: CoberturaDatos[]): CoberturaDatos {
  const acumulado = new Map<MotivoExclusion, { cantidad: number; ejemplos: string[] }>()
  let esperados = 0
  let validos = 0
  for (const parte of partes) {
    esperados += parte.esperados
    validos += parte.validos
    for (const m of parte.motivos) {
      const actual = acumulado.get(m.motivo) ?? { cantidad: 0, ejemplos: [] }
      actual.cantidad += m.cantidad
      actual.ejemplos = actual.ejemplos.concat(m.ejemplos).slice(0, 20)
      acumulado.set(m.motivo, actual)
    }
  }
  return {
    esperados,
    validos,
    excluidos: Math.max(0, esperados - validos),
    motivos: Array.from(acumulado.entries())
      .map(([motivo, v]) => ({ motivo, ...v }))
      .sort((a, b) => b.cantidad - a.cantidad),
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Normalización
// ─────────────────────────────────────────────────────────────────────────

/**
 * Placa comparable: sin espacios, guiones ni minúsculas.
 *
 * Devuelve `null` si lo que llega no puede ser una placa. Es deliberadamente
 * permisivo con la longitud —hay placas de moto, de remolque y formatos
 * antiguos— pero rechaza lo que no tiene ni letras ni dígitos suficientes.
 * Devolver `null` en vez de la cadena original importa: quien llama tiene que
 * decidir explícitamente qué hacer con una placa ilegible, y así queda contada
 * como `PLACA_NO_NORMALIZABLE` en vez de crear un vehículo fantasma.
 */
export function normalizarPlaca(valor: string | null | undefined): string | null {
  if (!valor) return null
  const limpio = valor
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
  if (limpio.length < 5 || limpio.length > 8) return null
  if (!/[A-Z]/.test(limpio) || !/[0-9]/.test(limpio)) return null
  return limpio
}

/**
 * Identificación comparable de una persona: solo dígitos.
 *
 * Las identificaciones llegan con puntos, con guiones y a veces con el tipo
 * pegado delante. Rechaza los `EXT-<timestamp>` que dejó el importador viejo:
 * no son documentos, son la huella de que alguien creó un conductor a partir de
 * una celda mal parseada.
 */
export function normalizarIdentificacion(valor: string | null | undefined): string | null {
  if (!valor) return null
  const soloDigitos = valor.replace(/\D/g, '')
  if (soloDigitos.length < 5 || soloDigitos.length > 15) return null
  /// Un identificador sintético del importador viejo: `EXT-1724...`. El número
  /// que queda tras quitar letras es un timestamp, no una cédula.
  if (/^EXT[-_]/i.test(valor.trim())) return null
  return soloDigitos
}

/** Texto comparable: mayúsculas, sin tildes, sin espacios repetidos. */
export function normalizarTexto(valor: string | null | undefined): string {
  if (!valor) return ''
  return valor
    .toUpperCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * ¿Esto que salió de un archivo parece el nombre de una persona?
 *
 * Misma regla que `extractos.service.ts`, replicada aquí para que el dominio
 * PESV no dependa del módulo de extractos —y para no volver a crear once
 * conductores llamados «0» a partir de celdas vacías del TXT.
 */
export function pareceNombreDePersona(valor: string | null | undefined): boolean {
  if (!valor) return false
  const limpio = valor.trim()
  if (limpio.length < 3) return false
  if (/^#+$/.test(limpio)) return false
  if (!/\p{L}/u.test(limpio)) return false
  if (/^(n\/?a|na|sin|null|none|ninguno|-+)$/i.test(limpio)) return false
  return true
}

/**
 * Kilómetros de un tramo, o `null` si el dato no sirve.
 *
 * `km_final < km_inicial` no se corrige dando la vuelta a la resta: puede ser un
 * cambio de odómetro, un dígito de más o dos tramos cruzados, y elegir uno por
 * el agente sería inventar. Se excluye y se cuenta.
 */
export function kilometrosDeTramo(
  kmInicial: number | null | undefined,
  kmFinal: number | null | undefined,
): { km: number | null; motivo: MotivoExclusion | null } {
  if (kmInicial == null || kmFinal == null) {
    return { km: null, motivo: 'KILOMETRAJE_AUSENTE' }
  }
  if (kmFinal < kmInicial) {
    return { km: null, motivo: 'KILOMETRAJE_INVALIDO' }
  }
  return { km: kmFinal - kmInicial, motivo: null }
}

/**
 * Horas entre `HH:MM` y `HH:MM`, respetando las banderas de día siguiente.
 *
 * No se restan cadenas: un turno de 22:00 a 06:00 con `fin_dia_siguiente`
 * son 8 horas, y restando literales salen −16. Es el error que el propio
 * esquema documenta con esas dos banderas.
 */
export function horasEntre(
  horaInicio: string | null | undefined,
  horaFin: string | null | undefined,
  inicioDiaSiguiente = false,
  finDiaSiguiente = false,
): { horas: number | null; motivo: MotivoExclusion | null } {
  const min = (h: string | null | undefined): number | null => {
    if (!h) return null
    const m = /^(\d{1,2}):(\d{2})/.exec(h.trim())
    if (!m) return null
    const horas = Number(m[1])
    const minutos = Number(m[2])
    if (horas > 23 || minutos > 59) return null
    return horas * 60 + minutos
  }

  const inicio = min(horaInicio)
  const fin = min(horaFin)
  if (inicio == null || fin == null) return { horas: null, motivo: 'SIN_FECHA' }

  const inicioAbs = inicio + (inicioDiaSiguiente ? 1440 : 0)
  const finAbs = fin + (finDiaSiguiente ? 1440 : 0)
  const delta = finAbs - inicioAbs
  if (delta < 0 || delta > 24 * 60) return { horas: null, motivo: 'HORARIO_INCOHERENTE' }
  return { horas: delta / 60, motivo: null }
}

/**
 * Clave de deduplicación vehículo-fecha.
 *
 * Un vehículo cuenta UNA vez por día en el denominador de preoperacionales
 * aunque tenga cuatro segmentos y tres servicios. Sin esta clave, un vehículo
 * muy usado hunde el porcentaje de cobertura de toda la flota.
 */
export function claveVehiculoFecha(vehiculoId: string, fechaYmd: string): string {
  return `${vehiculoId}|${fechaYmd}`
}
