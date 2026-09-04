/**
 * Catálogo normativo de los 24 pasos de la metodología PESV.
 *
 * Vive en código y no en la base a propósito: es normativa, no configuración
 * del cliente. Un paso no se añade ni se renombra desde la aplicación, y
 * tenerlo aquí permite que un cambio del anexo se revise en un diff y viaje
 * con el despliegue en vez de aplicarse a mano en dos bases.
 *
 * Fuente: Resolución 20223040040595 de 2022 y su metodología, compilada en el
 * Anexo 63 de la Resolución Única 20223040045295. Nivel AVANZADO: aplican los
 * 24 pasos, sin ocultar ninguno por tamaño de la operación.
 */

import type { Area } from '../../../config/permissions'

export type FasePesv = 'PLANIFICACION' | 'IMPLEMENTACION' | 'SEGUIMIENTO' | 'MEJORA'

export const FASES: readonly FasePesv[] = [
  'PLANIFICACION',
  'IMPLEMENTACION',
  'SEGUIMIENTO',
  'MEJORA',
]

export const ETIQUETAS_FASE: Record<FasePesv, string> = {
  PLANIFICACION: 'Fase 1 — Planificación',
  IMPLEMENTACION: 'Fase 2 — Implementación y ejecución',
  SEGUIMIENTO: 'Fase 3 — Seguimiento',
  MEJORA: 'Fase 4 — Mejora',
}

/**
 * Dominio del que puede provenir una evidencia vinculada.
 *
 * Es una lista cerrada porque `pesv_evidence.source_domain` no tiene FK: sin
 * este tipo, cualquier cadena entraría en la columna y el enlace «ver el
 * registro fuente» del panel quedaría roto sin que nada fallara.
 */
export type DominioFuente =
  | 'FORM_SUBMISSION'
  | 'ASISTENCIA'
  | 'EVALUACION'
  | 'ACCION_CORRECTIVA'
  | 'ACTIVIDAD_PESV'
  | 'DOCUMENTO'
  | 'SINIESTRO'
  | 'MANTENIMIENTO'
  | 'CONTRATO'
  | 'FUEC'
  | 'SERVICIO'
  | 'RIESGO'
  | 'META'
  | 'PROGRAMA'
  | 'FORMACION'

export const DOMINIOS_FUENTE: readonly DominioFuente[] = [
  'FORM_SUBMISSION',
  'ASISTENCIA',
  'EVALUACION',
  'ACCION_CORRECTIVA',
  'ACTIVIDAD_PESV',
  'DOCUMENTO',
  'SINIESTRO',
  'MANTENIMIENTO',
  'CONTRATO',
  'FUEC',
  'SERVICIO',
  'RIESGO',
  'META',
  'PROGRAMA',
  'FORMACION',
]

/** Ruta del dashboard donde vive el registro fuente, para el enlace profundo. */
export const RUTA_POR_DOMINIO: Record<DominioFuente, string> = {
  FORM_SUBMISSION: '/dashboard/formularios/envios',
  ASISTENCIA: '/dashboard/asistencias',
  EVALUACION: '/dashboard/evaluaciones',
  ACCION_CORRECTIVA: '/dashboard/acciones-correctivas',
  ACTIVIDAD_PESV: '/dashboard/pesv?vista=plan',
  DOCUMENTO: '/dashboard/flota',
  SINIESTRO: '/dashboard/pesv?vista=operacion&panel=siniestros',
  MANTENIMIENTO: '/dashboard/pesv?vista=operacion&panel=mantenimiento',
  CONTRATO: '/dashboard/extractos',
  FUEC: '/dashboard/extractos',
  SERVICIO: '/dashboard/servicios',
  RIESGO: '/dashboard/pesv?vista=matriz',
  META: '/dashboard/pesv?vista=indicadores',
  PROGRAMA: '/dashboard/pesv?vista=plan',
  FORMACION: '/dashboard/asistencias',
}

export interface SoportePaso {
  /** Clave estable del soporte dentro del paso. */
  clave: string
  etiqueta: string
  /**
   * Un soporte obligatorio bloquea el `CUMPLE` del paso mientras no tenga una
   * evidencia APROBADA y vigente. Los opcionales enriquecen el expediente pero
   * no lo condicionan: marcarlos todos como obligatorios haría que ningún paso
   * llegara nunca a cumplir y la matriz dejaría de servir para nada.
   */
  obligatorio: boolean
  /** Dominios de los que se puede vincular un registro existente. */
  dominios?: readonly DominioFuente[]
}

export interface PasoPesv {
  numero: number
  fase: FasePesv
  nombre: string
  descripcion: string
  /** Área que por defecto responde del paso. Se puede reasignar por ciclo. */
  areaSugerida: Area
  soportes: readonly SoportePaso[]
  /** Códigos de indicador que este paso alimenta o de los que depende. */
  indicadores?: readonly string[]
}

export const PASOS_PESV: readonly PasoPesv[] = [
  {
    numero: 1,
    fase: 'PLANIFICACION',
    nombre: 'Líder del diseño e implementación',
    descripcion:
      'Designación formal del responsable del PESV, con competencia acreditada y aceptación del cargo.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'designacion', etiqueta: 'Acto de designación firmado', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'competencia', etiqueta: 'Soporte de competencia (hoja de vida, certificados)', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'aceptacion', etiqueta: 'Aceptación del cargo', obligatorio: false, dominios: ['DOCUMENTO'] },
    ],
  },
  {
    numero: 2,
    fase: 'PLANIFICACION',
    nombre: 'Comité de Seguridad Vial',
    descripcion:
      'Conformación del comité, miembros, periodicidad de reuniones y decisiones documentadas.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'acto_conformacion', etiqueta: 'Acto de conformación', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'actas', etiqueta: 'Actas de reunión con asistencia', obligatorio: true, dominios: ['ASISTENCIA', 'DOCUMENTO'] },
      { clave: 'decisiones', etiqueta: 'Decisiones y seguimiento', obligatorio: false, dominios: ['ACTIVIDAD_PESV', 'DOCUMENTO'] },
    ],
  },
  {
    numero: 3,
    fase: 'PLANIFICACION',
    nombre: 'Política de seguridad vial',
    descripcion:
      'Documento firmado por la alta dirección, con fecha, versión, socialización y revisión al menos trienal.',
    areaSugerida: 'administracion',
    soportes: [
      { clave: 'politica', etiqueta: 'Política firmada y fechada', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'socializacion', etiqueta: 'Evidencia de socialización', obligatorio: true, dominios: ['ASISTENCIA', 'FORM_SUBMISSION', 'DOCUMENTO'] },
      { clave: 'revision', etiqueta: 'Constancia de revisión vigente', obligatorio: false, dominios: ['DOCUMENTO'] },
    ],
  },
  {
    numero: 4,
    fase: 'PLANIFICACION',
    nombre: 'Liderazgo, compromiso y corresponsabilidad',
    descripcion:
      'Asignación de recursos, revisión por la dirección, responsabilidades definidas y comunicaciones internas.',
    areaSugerida: 'administracion',
    soportes: [
      { clave: 'recursos', etiqueta: 'Asignación de recursos (presupuesto, personal)', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'revision_direccion', etiqueta: 'Acta de revisión por la dirección', obligatorio: true, dominios: ['DOCUMENTO', 'ASISTENCIA'] },
      { clave: 'responsabilidades', etiqueta: 'Matriz de responsabilidades', obligatorio: false, dominios: ['DOCUMENTO'] },
    ],
  },
  {
    numero: 5,
    fase: 'PLANIFICACION',
    nombre: 'Diagnóstico y línea base',
    descripcion:
      'Caracterización de sedes, servicios, actores viales, flota, conductores y contratistas, con línea base medible.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'diagnostico', etiqueta: 'Informe de diagnóstico', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'inventario_flota', etiqueta: 'Inventario de flota vigente', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'inventario_conductores', etiqueta: 'Inventario de conductores y contratistas', obligatorio: true, dominios: ['DOCUMENTO'] },
    ],
  },
  {
    numero: 6,
    fase: 'PLANIFICACION',
    nombre: 'Caracterización y control de riesgos viales',
    descripcion:
      'Matriz de riesgos con valoración inicial y final, controles definidos y responsables asignados.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'matriz', etiqueta: 'Matriz de riesgos viales', obligatorio: true, dominios: ['RIESGO', 'DOCUMENTO'] },
      { clave: 'controles', etiqueta: 'Controles implementados', obligatorio: true, dominios: ['RIESGO', 'ACTIVIDAD_PESV', 'DOCUMENTO'] },
    ],
    indicadores: ['RSVI', 'GRV'],
  },
  {
    numero: 7,
    fase: 'PLANIFICACION',
    nombre: 'Objetivos y metas',
    descripcion:
      'Objetivos con línea base, meta medible, plazo, responsable e indicador asociado.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'metas', etiqueta: 'Metas definidas y aprobadas', obligatorio: true, dominios: ['META', 'DOCUMENTO'] },
    ],
    indicadores: ['CMP'],
  },
  {
    numero: 8,
    fase: 'PLANIFICACION',
    nombre: 'Programas de gestión de riesgos críticos',
    descripcion:
      'Como mínimo velocidad segura, prevención de fatiga, prevención de distracción, cero tolerancia al alcohol y sustancias, y protección de actores viales vulnerables.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'programas', etiqueta: 'Programas documentados con alcance y medición', obligatorio: true, dominios: ['PROGRAMA', 'DOCUMENTO'] },
      { clave: 'cobertura', etiqueta: 'Cobertura de flota y personal', obligatorio: true, dominios: ['PROGRAMA'] },
    ],
    indicadores: ['GVE', 'ELVL'],
  },
  {
    numero: 9,
    fase: 'IMPLEMENTACION',
    nombre: 'Plan anual de trabajo',
    descripcion:
      'Objetivos, metas, actividades, cronograma, recursos y seguimiento de ejecución.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'plan', etiqueta: 'Plan anual aprobado', obligatorio: true, dominios: ['ACTIVIDAD_PESV', 'DOCUMENTO'] },
      { clave: 'seguimiento', etiqueta: 'Seguimiento de ejecución', obligatorio: true, dominios: ['ACTIVIDAD_PESV'] },
    ],
    indicadores: ['CPLAN'],
  },
  {
    numero: 10,
    fase: 'IMPLEMENTACION',
    nombre: 'Competencia, formación y capacitación',
    descripcion:
      'Plan de formación, capacitaciones ejecutadas, asistencia verificable y evaluación de la eficacia.',
    areaSugerida: 'talento_humano',
    soportes: [
      { clave: 'plan_formacion', etiqueta: 'Plan de formación', obligatorio: true, dominios: ['FORMACION', 'DOCUMENTO'] },
      { clave: 'asistencias', etiqueta: 'Registros de asistencia', obligatorio: true, dominios: ['ASISTENCIA'] },
      { clave: 'evaluacion', etiqueta: 'Evaluación de conocimiento', obligatorio: false, dominios: ['EVALUACION'] },
    ],
    indicadores: ['CPFSV', 'CPF'],
  },
  {
    numero: 11,
    fase: 'IMPLEMENTACION',
    nombre: 'Responsabilidad y comportamiento seguro',
    descripcion:
      'Requisitos de contratación de conductores, verificación documental y evaluación anual de desempeño.',
    areaSugerida: 'talento_humano',
    soportes: [
      { clave: 'requisitos', etiqueta: 'Perfil y requisitos de contratación', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'verificacion', etiqueta: 'Verificación documental de conductores', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'evaluacion_anual', etiqueta: 'Evaluación anual de comportamiento', obligatorio: false, dominios: ['EVALUACION'] },
    ],
  },
  {
    numero: 12,
    fase: 'IMPLEMENTACION',
    nombre: 'Preparación y respuesta ante emergencias viales',
    descripcion:
      'Plan de emergencias, simulacros, equipos de atención, directorio de contactos y reportes.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'plan_emergencias', etiqueta: 'Plan de preparación y respuesta', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'simulacros', etiqueta: 'Registro de simulacros', obligatorio: true, dominios: ['ASISTENCIA', 'FORM_SUBMISSION', 'DOCUMENTO'] },
      { clave: 'equipos', etiqueta: 'Verificación de equipos de atención', obligatorio: false, dominios: ['FORM_SUBMISSION'] },
    ],
  },
  {
    numero: 13,
    fase: 'IMPLEMENTACION',
    nombre: 'Investigación interna de siniestros viales',
    descripcion:
      'Reporte, investigación de causas, divulgación de lecciones y acciones derivadas.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'procedimiento', etiqueta: 'Procedimiento de investigación', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'investigaciones', etiqueta: 'Investigaciones realizadas', obligatorio: true, dominios: ['SINIESTRO', 'ACCION_CORRECTIVA'] },
    ],
    indicadores: ['TSV', 'CSV'],
  },
  {
    numero: 14,
    fase: 'IMPLEMENTACION',
    nombre: 'Vías seguras bajo administración',
    descripcion:
      'Inventario de vías propias o administradas, inspecciones, riesgos identificados y tratamiento.',
    areaSugerida: 'operaciones',
    soportes: [
      { clave: 'inventario_vias', etiqueta: 'Inventario de vías administradas', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'inspecciones_via', etiqueta: 'Inspecciones de vía', obligatorio: false, dominios: ['FORM_SUBMISSION', 'DOCUMENTO'] },
    ],
  },
  {
    numero: 15,
    fase: 'IMPLEMENTACION',
    nombre: 'Planificación de desplazamientos',
    descripcion:
      'Ruta, riesgos, horarios, descansos, vehículo, conductor y autorización previa del desplazamiento.',
    areaSugerida: 'operaciones',
    soportes: [
      { clave: 'procedimiento_desplazamiento', etiqueta: 'Procedimiento de planificación', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'registros', etiqueta: 'Registros de desplazamientos planificados', obligatorio: true, dominios: ['SERVICIO', 'DOCUMENTO'] },
    ],
    indicadores: ['EJLC'],
  },
  {
    numero: 16,
    fase: 'IMPLEMENTACION',
    nombre: 'Inspección de vehículos y equipos',
    descripcion:
      'Preoperacional identificable por vehículo y fecha, con hallazgos gestionados. La fuente oficial es un envío válido de Formularios Dinámicos.',
    areaSugerida: 'operaciones',
    soportes: [
      { clave: 'formato', etiqueta: 'Formato de inspección publicado', obligatorio: true, dominios: ['FORM_SUBMISSION', 'DOCUMENTO'] },
      { clave: 'ejecucion', etiqueta: 'Inspecciones ejecutadas', obligatorio: true, dominios: ['FORM_SUBMISSION'] },
      { clave: 'hallazgos', etiqueta: 'Gestión de hallazgos', obligatorio: false, dominios: ['ACCION_CORRECTIVA', 'MANTENIMIENTO'] },
    ],
    indicadores: ['IDP'],
  },
  {
    numero: 17,
    fase: 'IMPLEMENTACION',
    nombre: 'Mantenimiento y control de vehículos',
    descripcion:
      'Plan preventivo, órdenes de trabajo, responsables, repuestos e historial por vehículo.',
    areaSugerida: 'mantenimiento',
    soportes: [
      { clave: 'plan_mantenimiento', etiqueta: 'Plan de mantenimiento preventivo', obligatorio: true, dominios: ['MANTENIMIENTO', 'DOCUMENTO'] },
      { clave: 'ejecucion_mantenimiento', etiqueta: 'Órdenes ejecutadas con soporte', obligatorio: true, dominios: ['MANTENIMIENTO'] },
    ],
    indicadores: ['CPMVH'],
  },
  {
    numero: 18,
    fase: 'IMPLEMENTACION',
    nombre: 'Gestión del cambio y control de contratistas',
    descripcion:
      'Evaluación de cambios que afecten la seguridad vial y control de terceros vinculados a la operación.',
    areaSugerida: 'operaciones',
    soportes: [
      { clave: 'gestion_cambio', etiqueta: 'Procedimiento de gestión del cambio', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'contratistas', etiqueta: 'Evaluación y control de contratistas', obligatorio: true, dominios: ['CONTRATO', 'DOCUMENTO'] },
    ],
  },
  {
    numero: 19,
    fase: 'IMPLEMENTACION',
    nombre: 'Archivo y retención documental',
    descripcion:
      'Tabla de retención, control de versiones, integridad y disponibilidad del expediente.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'tabla_retencion', etiqueta: 'Tabla de retención documental', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'control_versiones', etiqueta: 'Control de versiones del expediente', obligatorio: false, dominios: ['DOCUMENTO'] },
    ],
  },
  {
    numero: 20,
    fase: 'SEGUIMIENTO',
    nombre: 'Indicadores y autogestión',
    descripcion:
      'Fichas de indicador, mediciones periódicas, análisis del comité y reporte anual de autogestión.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'fichas', etiqueta: 'Fichas de los 13 indicadores', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'mediciones', etiqueta: 'Mediciones del periodo', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'analisis', etiqueta: 'Análisis del comité', obligatorio: false, dominios: ['ASISTENCIA', 'DOCUMENTO'] },
    ],
  },
  {
    numero: 21,
    fase: 'SEGUIMIENTO',
    nombre: 'Registro y análisis estadístico de siniestros',
    descripcion:
      'Base estructurada con severidad, tendencias y costos directos e indirectos.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'base_siniestros', etiqueta: 'Registro estructurado de siniestros', obligatorio: true, dominios: ['SINIESTRO'] },
      { clave: 'analisis_tendencias', etiqueta: 'Análisis de tendencias y costos', obligatorio: false, dominios: ['DOCUMENTO'] },
    ],
    indicadores: ['TSV', 'CSV'],
  },
  {
    numero: 22,
    fase: 'SEGUIMIENTO',
    nombre: 'Auditoría anual',
    descripcion:
      'Programa de auditoría, informe, hallazgos clasificados y seguimiento a su cierre.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'programa_auditoria', etiqueta: 'Programa de auditoría', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'informe', etiqueta: 'Informe de auditoría', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'hallazgos', etiqueta: 'Hallazgos con seguimiento', obligatorio: true, dominios: ['ACCION_CORRECTIVA'] },
    ],
    indicadores: ['NCAC'],
  },
  {
    numero: 23,
    fase: 'MEJORA',
    nombre: 'Mejora continua',
    descripcion:
      'Acciones preventivas y correctivas, evaluación de eficacia y cierre documentado.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'acciones', etiqueta: 'Acciones correctivas y preventivas', obligatorio: true, dominios: ['ACCION_CORRECTIVA'] },
      { clave: 'eficacia', etiqueta: 'Evaluación de eficacia', obligatorio: true, dominios: ['ACCION_CORRECTIVA'] },
    ],
    indicadores: ['NCAC'],
  },
  {
    numero: 24,
    fase: 'MEJORA',
    nombre: 'Comunicación y participación',
    descripcion:
      'Plan de comunicación al menos trimestral, piezas divulgadas, asistencia y respuesta a la retroalimentación.',
    areaSugerida: 'hseq',
    soportes: [
      { clave: 'plan_comunicacion', etiqueta: 'Plan trimestral de comunicación', obligatorio: true, dominios: ['ACTIVIDAD_PESV', 'DOCUMENTO'] },
      { clave: 'piezas', etiqueta: 'Piezas divulgadas', obligatorio: true, dominios: ['DOCUMENTO'] },
      { clave: 'retroalimentacion', etiqueta: 'Retroalimentación y respuesta', obligatorio: false, dominios: ['FORM_SUBMISSION', 'ASISTENCIA'] },
    ],
  },
]

export const TOTAL_PASOS = PASOS_PESV.length

/** Los 24 números válidos, para validar entrada sin repetir el literal. */
export const NUMEROS_DE_PASO: readonly number[] = PASOS_PESV.map((p) => p.numero)

export function pasoPorNumero(numero: number): PasoPesv | undefined {
  return PASOS_PESV.find((p) => p.numero === numero)
}

export function pasosDeFase(fase: FasePesv): readonly PasoPesv[] {
  return PASOS_PESV.filter((p) => p.fase === fase)
}

/** Claves de los soportes que bloquean el `CUMPLE` de un paso. */
export function soportesObligatorios(numero: number): readonly SoportePaso[] {
  return pasoPorNumero(numero)?.soportes.filter((s) => s.obligatorio) ?? []
}

/// Comprobación de coherencia del propio catálogo. Corre al importar el
/// módulo, así que un error de edición —dos pasos con el mismo número, un
/// hueco en la numeración— revienta al arrancar y no meses después, cuando la
/// matriz muestre 23 filas y nadie sepa cuál falta.
;(function verificarCatalogo() {
  if (PASOS_PESV.length !== 24) {
    throw new Error(`El catálogo PESV debe tener 24 pasos, tiene ${PASOS_PESV.length}`)
  }
  PASOS_PESV.forEach((paso, i) => {
    if (paso.numero !== i + 1) {
      throw new Error(`Catálogo PESV: se esperaba el paso ${i + 1} y viene el ${paso.numero}`)
    }
    const claves = paso.soportes.map((s) => s.clave)
    if (new Set(claves).size !== claves.length) {
      throw new Error(`Catálogo PESV: el paso ${paso.numero} repite una clave de soporte`)
    }
  })
})()
