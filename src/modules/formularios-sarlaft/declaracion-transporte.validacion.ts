/**
 * Reglas de coherencia y mapeo del formato `declaracion_empresa_transporte`.
 *
 * Vive aparte del servicio a propósito: son funciones puras sobre el objeto de
 * respuestas, sin Prisma, S3 ni correo, de modo que los tests las ejercitan
 * directamente. El servicio es quien las aplica; el frontend replica las mismas
 * reglas, pero la autoridad es esta.
 */

/** IDs de pregunta del formato. Estables y compartidos entre marcas: lo que
 *  cambia por empresa es el código documental, no el contrato del payload. */
export const CAMPOS = {
  FECHA: 'DET-ENC-01',
  RAZON_SOCIAL: 'DET-EMP-01',
  NIT: 'DET-EMP-02',
  REPRESENTANTE: 'DET-REP-01',
  CEDULA: 'DET-REP-02',
  TELEFONO: 'DET-REP-03',
  CORREO: 'DET-REP-04',
  /** Solo existe en el navegador. Si llega dentro de `respuestas` se descarta:
   *  la doble digitación viaja fuera del snapshot, en `correo_confirmacion`. */
  CORREO_CONFIRMACION: 'DET-REP-05',
  ACEPTACION: 'DET-ACK-01',
  CNF_VEHICULOS: 'DET-CNF-01',
  CNF_ALERTAS: 'DET-CNF-02',
  CNF_SOPORTES: 'DET-CNF-03',
  OBSERVACIONES: 'DET-OBS-01',
  FIRMA: 'DET-FIR-01'
} as const

export const OPCION_ACEPTACION =
  'Sí, declaro que la información es veraz y acepto los compromisos del formato'

/** Las dos opciones de `DET-CNF-02`. El template las pinta como casillas
 *  independientes, pero son mutuamente excluyentes: el backend rechaza
 *  cualquier intento de marcar ambas. */
export const OPCION_SIN_ALERTAS = 'No existen alertas pendientes'
export const OPCION_CON_ALERTAS = 'Existen alertas informadas en documento anexo'

export const OPCIONES_ALERTAS = [OPCION_SIN_ALERTAS, OPCION_CON_ALERTAS] as const

/** Anexo obligatorio cuando el declarante reporta alertas. */
export const ANEXO_ALERTAS = 'anexo_alertas'
/** Anexo opcional con la relación de vehículos cubiertos por la declaración. */
export const ANEXO_RELACION_VEHICULOS = 'relacion_vehiculos'

/** Tope de la firma en base64. Una firma de canvas normal pesa ~20-60 KB; el
 *  límite corta payloads absurdos antes de que lleguen a memoria del generador. */
export const FIRMA_MAX_BYTES = 2 * 1024 * 1024

/**
 * Longitudes máximas por campo.
 *
 * No son un límite estético: cada valor tiene que caber, con el tamaño mínimo
 * legible, en la celda o la raya que le corresponde en el formato controlado.
 * Los topes se calcularon midiendo con la fuente real (Roboto) contra el ancho
 * útil de cada campo, tomando el más estrecho cuando el mismo dato aparece dos
 * veces — la razón social manda en la celda del encabezado (170 pt) y el
 * nombre del representante en la celda de la tabla de firma (232 pt).
 *
 * La autoridad final sigue siendo el ancho en puntos que verifica el generador:
 * estos topes existen para que el frontend pueda avisar mientras se escribe, en
 * vez de fallar al enviar.
 */
export const LONGITUD_MAXIMA: Record<string, number> = {
  [CAMPOS.RAZON_SOCIAL]: 55,
  [CAMPOS.NIT]: 20,
  [CAMPOS.REPRESENTANTE]: 70,
  [CAMPOS.CEDULA]: 20,
  [CAMPOS.TELEFONO]: 25,
  [CAMPOS.CORREO]: 90,
  [CAMPOS.OBSERVACIONES]: 260
}

export type Respuestas = Record<string, unknown>

function texto(valor: unknown): string {
  if (typeof valor === 'string') return valor.trim()
  if (typeof valor === 'number') return String(valor)
  return ''
}

/** Normaliza un correo para compararlo: minúsculas y sin espacios alrededor. */
export function normalizarCorreo(valor: unknown): string {
  return texto(valor).toLowerCase()
}

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

export function esCorreoValido(valor: unknown): boolean {
  const v = texto(valor)
  return v.length <= 254 && RE_CORREO.test(v)
}

/** `true` si el valor es una data URL de imagen que el generador sabe incrustar.
 *
 *  Solo PNG y JPEG: pdf-lib no incrusta WebP, así que aceptar uno aquí crearía
 *  un radicado cuyo PDF no se puede producir. El FirmaPad de la landing ya
 *  re-dibuja en canvas y entrega PNG incluso cuando el usuario sube otra cosa. */
export function esFirmaValida(valor: unknown): boolean {
  if (typeof valor !== 'string') return false
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(valor)
  if (!m) return false
  const bytes = Math.floor((m[2].replace(/\s/g, '').length * 3) / 4)
  return bytes > 0 && bytes <= FIRMA_MAX_BYTES
}

/** `true` si el declarante reportó alertas y, por tanto, debe anexar el soporte. */
export function tieneAlertas(respuestas: Respuestas): boolean {
  return texto(respuestas[CAMPOS.CNF_ALERTAS]) === OPCION_CON_ALERTAS
}

/**
 * Las observaciones dejan de ser opcionales cuando el declarante responde algo
 * que la empresa necesita entender: reporta alertas, admite que no revisó los
 * vehículos o admite que los soportes no están vigentes.
 */
export function requiereObservaciones(respuestas: Respuestas): boolean {
  return (
    tieneAlertas(respuestas) ||
    texto(respuestas[CAMPOS.CNF_VEHICULOS]) === 'No' ||
    texto(respuestas[CAMPOS.CNF_SOPORTES]) === 'No'
  )
}

/**
 * Documentos que el declarante debe (o puede) anexar, según sus respuestas.
 * A diferencia de los otros formatos, aquí la obligatoriedad no depende del
 * tipo de cliente sino de una respuesta condicional.
 */
export function documentosDeclaracionTransporte(respuestas: Respuestas = {}): Array<{
  id: string
  nombre: string
  descripcion: string
  aplicaA: 'ambos'
  obligatorio: boolean
}> {
  return [
    {
      id: ANEXO_ALERTAS,
      nombre: 'Documento anexo de alertas',
      descripcion:
        'Soporte con el detalle de las alertas informadas. Obligatorio si declaraste que existen alertas.',
      aplicaA: 'ambos',
      obligatorio: tieneAlertas(respuestas)
    },
    {
      id: ANEXO_RELACION_VEHICULOS,
      nombre: 'Relación de vehículos cubiertos',
      descripcion:
        'Listado de placas, propietarios y conductores que cubre esta declaración. Opcional: si no lo anexas, la declaración cubre los vehículos relacionados en el proceso contractual.',
      aplicaA: 'ambos',
      obligatorio: false
    }
  ]
}

export interface ContextoValidacion {
  /** Valor de `correo_confirmacion`, que viaja fuera de `respuestas`. */
  correoConfirmacion?: string | null
  /** IDs de anexo efectivamente recibidos en el multipart. */
  anexosRecibidos?: string[]
}

/**
 * Valida coherencia, formato y anexos condicionales. Devuelve la lista de
 * errores; vacía significa que el envío es aceptable.
 *
 * No valida obligatorios genéricos: de eso ya se encarga `validarObligatorios`
 * recorriendo la definición. Aquí van las reglas que la definición no puede
 * expresar de forma declarativa.
 */
export function validarDeclaracionTransporte(
  respuestas: Respuestas,
  ctx: ContextoValidacion = {}
): string[] {
  const errores: string[] = []

  // ── Longitudes ────────────────────────────────────────────────────────
  for (const [id, max] of Object.entries(LONGITUD_MAXIMA)) {
    const v = texto(respuestas[id])
    if (v.length > max) {
      errores.push(`El campo ${id} supera el máximo de ${max} caracteres.`)
    }
  }

  // ── Correo y doble digitación ─────────────────────────────────────────
  const correo = normalizarCorreo(respuestas[CAMPOS.CORREO])
  if (!esCorreoValido(correo)) {
    errores.push('El correo electrónico del representante legal no tiene un formato válido.')
  }
  // La confirmación se valida también aquí, no solo en el navegador: el PDF se
  // entrega a esa dirección, así que una confirmación que solo existe en el
  // cliente no es una garantía de nada.
  const confirmacion = normalizarCorreo(ctx.correoConfirmacion)
  if (!confirmacion) {
    errores.push('Falta la confirmación del correo electrónico de entrega.')
  } else if (confirmacion !== correo) {
    errores.push('El correo electrónico y su confirmación no coinciden.')
  }

  // ── Aceptación expresa ────────────────────────────────────────────────
  if (texto(respuestas[CAMPOS.ACEPTACION]) !== OPCION_ACEPTACION) {
    errores.push('Debes aceptar expresamente la declaración y los compromisos del formato.')
  }

  // ── Confirmaciones ────────────────────────────────────────────────────
  const cnf01 = texto(respuestas[CAMPOS.CNF_VEHICULOS])
  if (cnf01 !== 'Sí' && cnf01 !== 'No') {
    errores.push(`El campo ${CAMPOS.CNF_VEHICULOS} solo admite "Sí" o "No".`)
  }
  const cnf03 = texto(respuestas[CAMPOS.CNF_SOPORTES])
  if (cnf03 !== 'Sí' && cnf03 !== 'No') {
    errores.push(`El campo ${CAMPOS.CNF_SOPORTES} solo admite "Sí" o "No".`)
  }

  const cnf02 = respuestas[CAMPOS.CNF_ALERTAS]
  if (Array.isArray(cnf02)) {
    // El template dibuja dos casillas sueltas, pero el estado de alertas es uno
    // solo. Un arreglo aquí es un intento de marcar ambas.
    errores.push(
      'El estado de alertas admite una sola opción: no se pueden marcar simultáneamente ' +
        `"${OPCION_SIN_ALERTAS}" y "${OPCION_CON_ALERTAS}".`
    )
  } else if (!OPCIONES_ALERTAS.includes(texto(cnf02) as (typeof OPCIONES_ALERTAS)[number])) {
    errores.push(
      `El campo ${CAMPOS.CNF_ALERTAS} solo admite "${OPCION_SIN_ALERTAS}" o "${OPCION_CON_ALERTAS}".`
    )
  }

  // ── Observaciones condicionales ───────────────────────────────────────
  if (requiereObservaciones(respuestas) && !texto(respuestas[CAMPOS.OBSERVACIONES])) {
    errores.push(
      'Las alertas u observaciones son obligatorias cuando reportas alertas, cuando los ' +
        'vehículos no fueron revisados o cuando los soportes no están vigentes.'
    )
  }

  // ── Anexo condicional ─────────────────────────────────────────────────
  const anexos = new Set(ctx.anexosRecibidos ?? [])
  if (tieneAlertas(respuestas) && !anexos.has(ANEXO_ALERTAS)) {
    errores.push(
      'Declaraste que existen alertas informadas en documento anexo: debes adjuntar ese documento.'
    )
  }

  // ── Firma ─────────────────────────────────────────────────────────────
  if (!esFirmaValida(respuestas[CAMPOS.FIRMA])) {
    errores.push(
      'La firma del representante legal debe ser una imagen PNG o JPG válida y no superar 2 MB.'
    )
  }

  return errores
}

/**
 * Quita del snapshot los campos que no deben persistirse.
 * Hoy solo la confirmación de correo, que es un control de captura y no una
 * respuesta del formato.
 */
export function limpiarRespuestas(respuestas: Respuestas): Respuestas {
  const copia = { ...respuestas }
  delete copia[CAMPOS.CORREO_CONFIRMACION]
  delete copia.correo_confirmacion
  return copia
}

/** Datos clave que se indexan en la tabla del formulario. El titular del
 *  trámite es la empresa de transporte, no la persona que firma. */
export function extraerDatosClaveDeclaracion(respuestas: Respuestas): {
  nombre_completo: string | null
  tipo_documento: string
  numero_documento: string | null
  correo: string | null
  telefono: string | null
} {
  return {
    nombre_completo: texto(respuestas[CAMPOS.RAZON_SOCIAL]) || null,
    tipo_documento: 'NIT',
    numero_documento: texto(respuestas[CAMPOS.NIT]) || null,
    correo: texto(respuestas[CAMPOS.CORREO]) || null,
    telefono: texto(respuestas[CAMPOS.TELEFONO]) || null
  }
}

/** Estados administrativos que emiten una versión evaluada del documento. */
export type EstadoAdministrativo =
  | 'recibido'
  | 'en_revision'
  | 'aprobado'
  | 'condicionado'
  | 'rechazado'
  | 'escalado'

export type MarcaResultado = 'aprobado' | 'condicionado' | 'no_aprobado' | null

/**
 * Traduce el estado administrativo a la casilla que se marca en el PDF.
 *
 * `recibido`, `en_revision` y `escalado` no marcan nada: son etapas, no
 * decisiones. `escalado` en particular NO es sinónimo de condicionado.
 */
export function marcaResultadoDeEstado(estado: string | null | undefined): MarcaResultado {
  switch (estado) {
    case 'aprobado':
      return 'aprobado'
    case 'condicionado':
      return 'condicionado'
    case 'rechazado':
      return 'no_aprobado'
    default:
      return null
  }
}

/** `true` si el estado cierra la evaluación y por tanto emite una versión nueva. */
export function esDecisionFinal(estado: string | null | undefined): boolean {
  return marcaResultadoDeEstado(estado) !== null
}

/** Enmascara un correo para mostrarlo o registrarlo sin exponerlo completo. */
export function enmascararCorreo(correo: string | null | undefined): string {
  const v = texto(correo)
  if (!v) return ''
  const [usuario, dominio] = v.split('@')
  if (!dominio) return '***'
  const visible = usuario.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(1, usuario.length - 2))}@${dominio}`
}
