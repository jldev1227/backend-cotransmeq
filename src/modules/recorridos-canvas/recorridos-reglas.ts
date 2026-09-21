/**
 * Reglas puras del canvas de recorridos: qué campos se pueden editar, cómo se
 * interpreta lo que llega de una celda y qué combinaciones rechaza el dominio.
 *
 * Aparte del service a propósito: aquí no hay Prisma ni sockets, así que se
 * puede probar sin base de datos. Todo lo que decide si un valor entra o no
 * vive en este archivo.
 */

/** Tipo de coerción de cada campo. */
export type Coercion = 'texto' | 'hora' | 'decimal' | 'entero' | 'flag' | 'tipo_dia' | 'fecha'

/** Campos editables de una fila de RECORRIDO. Lista blanca: default-deny. */
export const CAMPOS_SEGMENTO: Record<string, Coercion> = {
  /// La FECHA es del DÍA, no del tramo: cambiarla en un recorrido mueve la
  /// jornada entera, con todos sus tramos. Se admite aquí porque corregir una
  /// fecha mal tecleada es la edición más común al revisar una planilla, y
  /// obligar a borrar la fila y volver a crearla perdía los bonos marcados.
  fecha: 'fecha',
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
  fecha: 'fecha',
  tipo_dia: 'tipo_dia',
  observaciones: 'texto',
  /// El pernocte de un día sin recorridos va en su propia columna del día.
  /// Ver la nota del modelo en `schema.prisma`.
  pernocte: 'flag',
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

    case 'fecha': {
      const t = aTexto(valor) ?? ''
      if (!esFechaISO(t)) {
        throw new ValorInvalido(
          `"${t}" no es una fecha válida. Usa el formato AAAA-MM-DD (por ejemplo 2026-09-03).`,
          'VALOR_INVALIDO',
        )
      }
      return t
    }

    case 'decimal': {
      if (valor === null || valor === '' || valor === undefined) return 0
      // La celda muestra «6 horas» —es un formato numérico, el valor sigue
      // siendo 6—, pero quien lo ve tiende a teclearlo igual. Se acepta el
      // número con o sin la palabra, y con coma decimal, que es la del teclado
      // colombiano.
      const n = typeof valor === 'number' ? valor : numeroDeHoras(String(valor))
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
      `elimina la fila (clic derecho sobre su número → Eliminar fila) en vez de borrar la celda.`,
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

/** `6`, `6,5`, `6 horas`, `6.5h` → número. `NaN` si no se entiende. */
export function numeroDeHoras(texto: string): number {
  const m = /^\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:h|hr|hrs|hora|horas)?\.?\s*$/i.exec(texto)
  return m ? Number(m[1].replace(',', '.')) : Number.NaN
}

/** ¿Es un `YYYY-MM-DD` que existe en el calendario? */
export function esFechaISO(v: string | null | undefined): boolean {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [a, m, d] = v.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const f = new Date(Date.UTC(a, m - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
}

/**
 * Comprueba que una fecha cabe en el corte que el usuario tiene abierto.
 *
 * Una fila con fecha fuera del corte se guardaría bien y DESAPARECERÍA del
 * libro en la siguiente recarga: el usuario la vería esfumarse sin explicación.
 * Mejor rechazarla con la fecha y el corte en el mensaje.
 */
export function exigirDentroDelCorte(
  fecha: string,
  corte: { desde: string; hasta: string },
): void {
  if (fecha >= corte.desde && fecha <= corte.hasta) return
  throw new ValorInvalido(
    `La fecha ${fecha} queda fuera del corte abierto (${corte.desde} a ${corte.hasta}). ` +
      `Corrígela, o cambia de corte en la barra superior.`,
    'REGLA_NEGOCIO',
  )
}

/**
 * Los días futuros no se registran, ni desde el portal ni desde el canvas.
 *
 * `hoy` se pasa por parámetro para poder probarlo; en producción es la fecha
 * del servidor, en la zona horaria de Colombia.
 */
export function exigirNoFutura(fecha: string, hoy: string): void {
  if (fecha <= hoy) return
  throw new ValorInvalido(
    `La fecha ${fecha} es futura. Solo se registran días ya trabajados.`,
    'REGLA_NEGOCIO',
  )
}

/** `YYYY-MM-DD` de hoy en Colombia, que es donde se trabaja la planilla. */
export function hoyISO(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora)
}

/** Lo que llega de una fila insertada en el canvas, tal cual se tecleó. */
export interface FilaNuevaEntrada {
  fecha: unknown
  tipo_dia?: unknown
  vehiculo_placa?: unknown
  hora_inicio?: unknown
  hora_fin?: unknown
  horas_conducidas?: unknown
  cliente_nombre?: unknown
  km_inicial?: unknown
  km_final?: unknown
  pernocte?: unknown
  observaciones?: unknown
}

export type FilaNuevaClasificada =
  | {
      clase: 'recorrido'
      fecha: string
      vehiculo_placa: string
      hora_inicio: string
      hora_fin: string
      horas_conducidas: number
      cliente_nombre: string | null
      km_inicial: number | null
      km_final: number | null
      pernocte: boolean
      observaciones: string | null
    }
  | {
      clase: 'dia'
      fecha: string
      tipo_dia: string
      /// Solo para MANTENIMIENTO: el vehículo intervenido.
      vehiculo_placa: string | null
      pernocte: boolean
      observaciones: string | null
    }

/**
 * Decide qué es una fila insertada en el canvas: un RECORRIDO o un DÍA sin
 * recorridos, y valida lo mínimo de cada una.
 *
 * La regla es la misma que sigue el portal del conductor: con placa y horario
 * es un recorrido —y el día pasa a ser LABORADO—; sin ellos es un día de
 * disponibilidad, descanso o mantenimiento, que no lleva tramo. Un día
 * LABORADO sin recorrido no existe: no dice qué se trabajó.
 *
 * Todo o nada en el trío placa/inicio/fin: en el esquema de cotransmeq los tres
 * son NOT NULL, y en el de transmeralda un recorrido sin horario tampoco vale
 * para liquidar.
 */
export function clasificarFilaNueva(entrada: FilaNuevaEntrada): FilaNuevaClasificada {
  const fecha = normalizar('fecha', entrada.fecha, 'fecha') as string
  const placa = aTexto(entrada.vehiculo_placa)?.toUpperCase().replace(/\s+/g, '') || null
  const horaIni = normalizar('hora_inicio', entrada.hora_inicio, 'hora') as string | null
  const horaFin = normalizar('hora_fin', entrada.hora_fin, 'hora') as string | null
  const pernocte = aBooleano(entrada.pernocte)
  const observaciones = normalizar('observaciones', entrada.observaciones, 'texto') as
    | string
    | null
  const tipoCrudo = (aTexto(entrada.tipo_dia) ?? '').toUpperCase()

  const esRecorrido = !!(placa || horaIni || horaFin) && tipoCrudo !== 'MANTENIMIENTO'

  if (esRecorrido) {
    const faltan = [
      !placa && 'la placa',
      !horaIni && 'la hora inicial',
      !horaFin && 'la hora final',
    ].filter(Boolean)
    if (faltan.length) {
      throw new ValorInvalido(
        `A un recorrido le falta ${faltan.join(' y ')}. Completa la fila para guardarla.`,
        'REGLA_NEGOCIO',
      )
    }
    if (tipoCrudo && tipoCrudo !== 'LABORADO') {
      throw new ValorInvalido(
        `Una fila con placa y horario es un recorrido, y un recorrido es un día LABORADO, ` +
          `no ${tipoCrudo}. Quita el tipo o deja la placa y el horario en blanco.`,
        'REGLA_NEGOCIO',
      )
    }
    const fila = {
      clase: 'recorrido' as const,
      fecha,
      vehiculo_placa: placa!,
      hora_inicio: horaIni!,
      hora_fin: horaFin!,
      horas_conducidas: normalizar('horas_conducidas', entrada.horas_conducidas, 'decimal') as number,
      cliente_nombre: normalizar('cliente_nombre', entrada.cliente_nombre, 'texto') as string | null,
      km_inicial: normalizar('km_inicial', entrada.km_inicial, 'entero') as number | null,
      km_final: normalizar('km_final', entrada.km_final, 'entero') as number | null,
      pernocte,
      observaciones,
    }
    validarCoherencia(fila)
    return fila
  }

  if (!tipoCrudo) {
    throw new ValorInvalido(
      'Indica qué es la fila: escribe la placa y el horario si es un recorrido, o el TIPO DE DÍA ' +
        '(DISPONIBLE, DESCANSO o MANTENIMIENTO) si no lo es.',
      'REGLA_NEGOCIO',
    )
  }
  const tipo = normalizar('tipo_dia', tipoCrudo, 'tipo_dia') as string
  if (tipo === 'LABORADO') {
    throw new ValorInvalido(
      'Un día LABORADO necesita al menos un recorrido: escribe la placa y el horario en la misma fila.',
      'REGLA_NEGOCIO',
    )
  }
  if (tipo === 'MANTENIMIENTO' && !placa) {
    throw new ValorInvalido(
      'Un día de MANTENIMIENTO necesita la placa del vehículo intervenido.',
      'REGLA_NEGOCIO',
    )
  }
  return {
    clase: 'dia',
    fecha,
    tipo_dia: tipo,
    vehiculo_placa: tipo === 'MANTENIMIENTO' ? placa : null,
    pernocte,
    observaciones,
  }
}
