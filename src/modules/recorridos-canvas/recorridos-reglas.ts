/**
 * Reglas puras del canvas de recorridos: qué campos se pueden editar, cómo se
 * interpreta lo que llega de una celda y qué combinaciones rechaza el dominio.
 *
 * Aparte del service a propósito: aquí no hay Prisma ni sockets, así que se
 * puede probar sin base de datos. Todo lo que decide si un valor entra o no
 * vive en este archivo.
 */

/** Tipo de coerción de cada campo. */
export type Coercion = 'texto' | 'hora' | 'decimal' | 'entero' | 'flag' | 'tipo_dia'

/** Campos editables de una fila de RECORRIDO. Lista blanca: default-deny. */
export const CAMPOS_SEGMENTO: Record<string, Coercion> = {
  cliente_nombre: 'texto',
  vehiculo_placa: 'texto',
  hora_inicio: 'hora',
  hora_fin: 'hora',
  inicio_dia_siguiente: 'flag',
  fin_dia_siguiente: 'flag',
  horas_conducidas: 'decimal',
  km_inicial: 'entero',
  km_final: 'entero',
  pernocte: 'flag',
  observaciones: 'texto',
}

/**
 * Campos editables de una fila de DÍA (sin recorridos).
 *
 * `tipo_dia` no está en `CAMPOS_SEGMENTO`: el tipo es del día, no del tramo, y
 * editarlo desde un recorrido cambiaría también los demás recorridos de esa
 * jornada sin que el usuario lo vea.
 */
export const CAMPOS_DIA: Record<string, Coercion> = {
  tipo_dia: 'tipo_dia',
  observaciones: 'texto',
}

export const TIPOS_DIA_VALIDOS = new Set([
  'LABORADO',
  'DISPONIBLE',
  'DESCANSO',
  'MANTENIMIENTO',
])

export const PREFIJO_BONO = 'bono:'

export class ValorInvalido extends Error {
  constructor(
    message: string,
    readonly code: 'VALOR_INVALIDO' | 'CAMPO_NO_EDITABLE' | 'REGLA_NEGOCIO',
  ) {
    super(message)
    this.name = 'ValorInvalido'
  }
}

export function aTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null
  return String(valor).trim()
}

/**
 * Lector tolerante del valor de una casilla.
 *
 * Univer guarda la casilla como la CADENA «SÍ»/«NO», pero por el socket también
 * pueden llegar booleanos (patch programático) o «1»/«X» de un pegado desde
 * Excel. Se normalizan los acentos para que «SI» y «SÍ» valgan lo mismo.
 */
export function aBooleano(valor: unknown): boolean {
  if (typeof valor === 'boolean') return valor
  if (typeof valor === 'number') return valor !== 0
  const t = String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
  return t === 'SI' || t === 'TRUE' || t === '1' || t === 'X' || t === 'VERDADERO'
}

export function normalizar(campo: string, valor: unknown, tipo: Coercion): unknown {
  switch (tipo) {
    case 'flag':
      return aBooleano(valor)

    case 'texto': {
      const t = aTexto(valor)
      return t === '' ? null : t
    }

    case 'tipo_dia': {
      const t = (aTexto(valor) ?? '').toUpperCase()
      if (!TIPOS_DIA_VALIDOS.has(t)) {
        throw new ValorInvalido(
          `"${t}" no es un tipo de día válido. Usa ${[...TIPOS_DIA_VALIDOS].join(', ')}.`,
          'VALOR_INVALIDO',
        )
      }
      return t
    }

    case 'hora': {
      const t = aTexto(valor)
      if (!t) return null
      // Se acepta `H:MM` y se normaliza a `HH:MM`. No es cosmético: la CHECK de
      // la tabla compara las horas como TEXTO, y en esa comparación «9:00» es
      // MAYOR que «10:00», así que un turno normal se rechazaría.
      const m = /^(\d{1,2}):(\d{2})$/.exec(t)
      if (!m) {
        throw new ValorInvalido(
          `"${t}" no es una hora válida. Usa el formato HH:MM (por ejemplo 07:30).`,
          'VALOR_INVALIDO',
        )
      }
      const h = Number(m[1])
      const min = Number(m[2])
      if (h > 23 || min > 59) {
        throw new ValorInvalido(`"${t}" no es una hora válida.`, 'VALOR_INVALIDO')
      }
      return `${String(h).padStart(2, '0')}:${m[2]}`
    }

    case 'decimal': {
      if (valor === null || valor === '' || valor === undefined) return 0
      const n = Number(valor)
      if (!Number.isFinite(n) || n < 0 || n > 24) {
        throw new ValorInvalido(
          'Las horas conducidas deben ser un número entre 0 y 24.',
          'VALOR_INVALIDO',
        )
      }
      // La columna es Decimal(4,1): un solo decimal.
      return Math.round(n * 10) / 10
    }

    case 'entero': {
      if (valor === null || valor === '' || valor === undefined) return null
      const n = Number(valor)
      if (!Number.isFinite(n) || n < 0) {
        throw new ValorInvalido(
          `"${String(valor)}" no es un kilometraje válido.`,
          'VALOR_INVALIDO',
        )
      }
      return Math.round(n)
    }

    default:
      throw new ValorInvalido(`Campo "${campo}" sin coerción definida.`, 'CAMPO_NO_EDITABLE')
  }
}

/**
 * Campos de un recorrido que NO se pueden dejar en blanco.
 *
 * En el esquema de cotransmeq `vehiculo_placa`, `hora_inicio` y `hora_fin` son
 * NOT NULL, así que vaciarlas reventaría con un error de Postgres. En el de
 * transmeralda son nullables y no reventaría, pero el resultado —un recorrido
 * sin vehículo ni horario— tampoco significa nada: para quitar un tramo está el
 * modal de registro de recorridos, no borrar sus celdas una a una.
 *
 * La regla es la misma en los dos repos a propósito: si dependiera del esquema,
 * el canvas se comportaría distinto en cada empresa.
 */
export const NO_VACIABLES = new Set(['vehiculo_placa', 'hora_inicio', 'hora_fin'])

export function exigirNoVacio(campo: string, valor: unknown): void {
  if (!NO_VACIABLES.has(campo)) return
  if (valor !== null && valor !== undefined && valor !== '') return
  const que =
    campo === 'vehiculo_placa'
      ? 'La placa'
      : campo === 'hora_inicio'
        ? 'La hora de inicio'
        : 'La hora de fin'
  throw new ValorInvalido(
    `${que} no puede quedar vacía en un recorrido. Si el tramo no existió, ` +
      `elimínalo desde «Registrar recorridos» en vez de borrar la celda.`,
    'REGLA_NEGOCIO',
  )
}

/**
 * Comprueba las reglas que también vigilan las CHECK de la tabla.
 *
 * Se hace antes de escribir para poder explicarlas: el error de Postgres
 * («violates check constraint chk_segmento_horas») no le dice nada a quien
 * está corrigiendo una planilla.
 */
export function validarCoherencia(fila: {
  hora_inicio: string | null
  hora_fin: string | null
  pernocte: boolean
  km_inicial: number | null
  km_final: number | null
}): void {
  const { hora_inicio, hora_fin, pernocte, km_inicial, km_final } = fila

  // Con pernocte el turno cruza la medianoche, así que la hora de fin PUEDE ser
  // menor que la de inicio; sin él, no.
  if (!pernocte && hora_inicio && hora_fin && hora_fin <= hora_inicio) {
    throw new ValorInvalido(
      `La hora de fin (${hora_fin}) debe ser posterior a la de inicio (${hora_inicio}), ` +
        `salvo que el recorrido tenga pernocte.`,
      'REGLA_NEGOCIO',
    )
  }

  if (km_inicial != null && km_final != null && km_final < km_inicial) {
    throw new ValorInvalido(
      `El kilometraje final (${km_final}) no puede ser menor que el inicial (${km_inicial}).`,
      'REGLA_NEGOCIO',
    )
  }
}
