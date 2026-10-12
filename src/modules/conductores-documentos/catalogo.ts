/**
 * Documentos de la hoja de vida de un conductor.
 *
 * Es el soporte de lo que piden el PESV (Res. 40595 de 2022: selección,
 * exámenes, formación y seguimiento del conductor) y el Decreto 1079 de 2015
 * para transporte especial (licencia vigente y seguridad social al día).
 *
 * `LICENCIA`, `CEDULA` y `CONTRATO` son las claves que ya usa la tabla
 * `documento` (la carga de agosto de 2025), así que no se renombran. El front
 * recibe este catálogo en la respuesta del listado: no hay una segunda copia.
 *
 * La tabla `documentos_requeridos_conductor` NO se usa: son 32 textos libres
 * sin clave (y vacía en Cotransmeq), y atar el catálogo a ella obligaría a
 * mapear cada texto a mano para ganar lo mismo que esta lista.
 *
 * `vence`: lleva fecha y entra al control de vigencias y a los avisos.
 * `requerido`: sin fecha, pero se lista aunque falte (lo que falta es dato).
 * `puedeNoAplicar`: hay conductores a los que no les corresponde.
 * `cicloMeses`: periodicidad habitual, solo para sugerir la fecha al subir.
 * `diasAviso`: desde cuántos días antes pasa a «por vencer» y empiezan los
 *   avisos (30 por defecto). Lo mensual no puede usar 30: viviría en amarillo.
 * `etiquetaFecha`: una consulta (SIMIT, antecedentes) no «vence»; lo que se
 *   anota es cuándo toca repetirla.
 */
export type GrupoDocumentoConductor = 'vigencias' | 'identificacion' | 'laboral'

export interface CategoriaDocumentoConductor {
  clave: string
  etiqueta: string
  grupo: GrupoDocumentoConductor
  vence: boolean
  requerido?: boolean
  puedeNoAplicar?: boolean
  cicloMeses?: number
  diasAviso?: number
  etiquetaFecha?: string
  /** Al subirla se pide la categoría (C1, C2…) y se copia a la ficha. */
  pideCategoriaLicencia?: boolean
}

export const CATEGORIAS_DOCUMENTO_CONDUCTOR: CategoriaDocumentoConductor[] = [
  // ── Vigencias: semáforo y avisos ──
  { clave: 'LICENCIA', etiqueta: 'Licencia de conducción', grupo: 'vigencias', vence: true, cicloMeses: 36, pideCategoriaLicencia: true },
  { clave: 'EXAMEN_MEDICO', etiqueta: 'Examen médico ocupacional', grupo: 'vigencias', vence: true, cicloMeses: 12 },
  { clave: 'PSICOSENSOMETRICO', etiqueta: 'Examen psicosensométrico', grupo: 'vigencias', vence: true, cicloMeses: 12 },
  { clave: 'MANEJO_DEFENSIVO', etiqueta: 'Curso de manejo defensivo / seguridad vial', grupo: 'vigencias', vence: true, cicloMeses: 12 },
  { clave: 'PRIMEROS_AUXILIOS', etiqueta: 'Curso de primeros auxilios', grupo: 'vigencias', vence: true, cicloMeses: 12 },
  { clave: 'SEGURIDAD_SOCIAL', etiqueta: 'Seguridad social (PILA o certificado de afiliación)', grupo: 'vigencias', vence: true, cicloMeses: 1, diasAviso: 7 },
  { clave: 'SIMIT', etiqueta: 'Consulta SIMIT / comparendos', grupo: 'vigencias', vence: true, cicloMeses: 3, diasAviso: 7, etiquetaFecha: 'Próxima consulta' },
  { clave: 'ANTECEDENTES', etiqueta: 'Antecedentes (Policía, Procuraduría, Contraloría)', grupo: 'vigencias', vence: true, cicloMeses: 12, etiquetaFecha: 'Próxima verificación' },
  // ── Identificación ──
  { clave: 'CEDULA', etiqueta: 'Cédula de ciudadanía', grupo: 'identificacion', vence: false, requerido: true },
  { clave: 'LIBRETA_MILITAR', etiqueta: 'Libreta militar', grupo: 'identificacion', vence: false, puedeNoAplicar: true },
  // ── Laboral: ingreso y vinculación ──
  { clave: 'CONTRATO', etiqueta: 'Contrato laboral', grupo: 'laboral', vence: false, requerido: true },
  { clave: 'HOJA_DE_VIDA', etiqueta: 'Hoja de vida con soportes de estudio y experiencia', grupo: 'laboral', vence: false, requerido: true },
  { clave: 'PRUEBA_CONDUCCION', etiqueta: 'Prueba teórica y práctica de conducción', grupo: 'laboral', vence: false },
  { clave: 'INDUCCION', etiqueta: 'Inducción / reinducción en seguridad vial', grupo: 'laboral', vence: false },
  { clave: 'ENTREGA_DOTACION', etiqueta: 'Entrega de dotación y EPP', grupo: 'laboral', vence: false },
  { clave: 'VACUNAS', etiqueta: 'Carné de vacunas (fiebre amarilla, tétano)', grupo: 'laboral', vence: false, puedeNoAplicar: true },
  { clave: 'CERTIFICADO_BANCARIO', etiqueta: 'Certificación bancaria', grupo: 'laboral', vence: false },
  { clave: 'OTROS_CURSOS', etiqueta: 'Otros cursos y certificados', grupo: 'laboral', vence: false },
]

export const CATEGORIA_CONDUCTOR_POR_CLAVE = new Map(CATEGORIAS_DOCUMENTO_CONDUCTOR.map((c) => [c.clave, c]))

/** Días antes del vencimiento en que un documento pasa a «por vencer», si la categoría no dice otra cosa. */
export const DIAS_POR_VENCER = 30

/// Categorías de licencia del Código Nacional de Tránsito (Ley 769 de 2002).
export const CATEGORIAS_LICENCIA = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'] as const

/// Mismos estados de fila que los documentos del vehículo: `vigente` es el
/// que ya traía la carga de 2025; una versión nueva deja la anterior como
/// `reemplazado`.
export const ESTADO_VIGENTE = 'vigente'
export const ESTADO_REEMPLAZADO = 'reemplazado'
export const ESTADO_NO_APLICA = 'no_aplica'
