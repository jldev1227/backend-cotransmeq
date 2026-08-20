/**
 * HSEQ-FR-21 — Inspección de productos químicos.
 *
 * Decisiones de transcripción:
 *
 *  - La escala del original es solo C/NC («Especifique si el equipo cumple "C" o
 *    no cumple "NC"»), sin «no aplica». Se respeta: añadir NA cambiaría el
 *    criterio normativo, y doce criterios sobre almacenamiento de químicos
 *    difícilmente «no aplican» en una sede que los almacena.
 *  - Los criterios 6 a 12 del original están redactados como INSTRUCCIONES («Se
 *    debe verificar…», «Usar los elementos…»). Se transcriben literalmente y
 *    queda como warning: HSEQ debería reformularlos como preguntas verificables.
 */

import type { SeedDefinition } from './types'
import {
	declaracionFirma,
	ESCALA_C_NC,
	evidenciaFotografica,
	hallazgoPlanAccion,
	identificacionInspector,
	itemInspeccion,
	ordenarSecciones,
	seccion,
	textoLargo
} from './factories'

const CRITERIOS = [
	{
		key: 'equipos_incendio',
		label:
			'Equipos de control de incendios ubicados en lugares de fácil acceso y de acuerdo al riesgo'
	},
	{ key: 'inventario_productos', label: 'Inventario actualizado de productos' },
	{
		key: 'inventario_msds',
		label:
			'Inventario actualizado de hojas de seguridad MSDS o ficha técnica de datos de seguridad'
	},
	{
		key: 'compatibilidad',
		label: 'Ubicación de productos de acuerdo a su compatibilidad de almacenamiento'
	},
	{ key: 'identificacion_nombre', label: 'Identificados con el nombre del producto almacenado' },
	{
		key: 'personal_conocedor',
		label:
			'El personal involucrado en la manipulación debe ser conocedor de los productos, sus riesgos, forma de manejo y control de una emergencia (Sistema Globalmente Armonizado)'
	},
	{
		key: 'estado_envases',
		label:
			'Se debe verificar el estado de los envases, etiquetas y estado de los productos antes de usarlos'
	},
	{
		key: 'conocer_msds',
		label:
			'Conocer la hoja de seguridad o ficha técnica de datos de seguridad del producto antes de realizar cualquier manipulación'
	},
	{
		key: 'uso_epp',
		label:
			'Usar los elementos de protección personal que se requieran de acuerdo a la labor: protección facial, respiratoria, de ojos, de cabeza, de cuerpo, de manos y de pies'
	},
	{ key: 'disposicion_residuos', label: 'Disponer los residuos en los lugares autorizados' },
	{
		key: 'rotulado_transvase',
		label: 'Rotular cualquier envase adicional que se utilice para transvase o mezclas'
	},
	{ key: 'orden_aseo', label: 'Mantener buenas prácticas de orden y aseo' }
]

export const hseqFr21: SeedDefinition = {
	code: 'HSEQ-FR-21',
	slug: 'inspeccion-productos-quimicos',
	name: 'Inspección de productos químicos',
	description:
		'Verificación de los doce criterios de almacenamiento y manipulación de productos químicos, con plan de acción.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'MONTHLY',
		limitPolicy: 'ONE_PER_PERIOD',
		context: {},
		rationale:
			'Mensual por sede. `ONE_PER_PERIOD` porque es una inspección por sede y mes, y la sede se deriva del target de la asignación.'
	},

	source: {
		sourceFile: 'HSEQ-FR-21, Inspección Productos Químicos. V1.xlsx',
		sourceCode: 'HSEQ-FR-21',
		sourceRevision: '2',
		sourceDate: '2025-01-10',
		sourceSheet: 'Productos Químicos',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'DISCREPANCIA DE VERSIÓN: el nombre del archivo dice «V1» y el encabezado interno dice «Versión 2 / 2025-01-10». Se conservó la del encabezado.',
		'La escala es solo C/NC, sin «No aplica», tal como el original. Si HSEQ necesita NA habrá que añadirlo explícitamente.',
		'Los criterios 6 a 12 están redactados como instrucciones y no como preguntas verificables («Se debe verificar…», «Usar los elementos…»). Se transcribieron literalmente; HSEQ debería reformularlos.'
	],

	version: {
		title: 'Inspección de productos químicos',
		description: null,
		instructions:
			'Especifica si cada aspecto evaluado cumple o no cumple. Ante un «No cumple» la observación es obligatoria y debes registrar la actividad en el plan de acción.',
		settings: {},
		sections: ordenarSecciones([
			seccion('identificacion', 'Identificación de la inspección', [
				identificacionInspector({ conLugar: true })
			]),

			seccion(
				'criterios',
				'Criterios evaluados',
				CRITERIOS.map((c) => itemInspeccion(c.key, c.label, ESCALA_C_NC, { required: true })),
				{ description: 'Marca Cumple o No cumple. Un «No cumple» exige observación.' }
			),

			seccion('observaciones', 'Observaciones generales', [
				textoLargo(
					'observaciones_generales',
					'Observaciones generales (orden y aseo / fugas y/o filtraciones)',
					{ validation: { maxLength: 4000 } }
				),
				evidenciaFotografica('registro_visual', 'Registro visual', { maxFiles: 8 })
			]),

			seccion('plan_accion', 'Plan de acción', [
				hallazgoPlanAccion('plan_accion', 'Plan de acción', { conFecha: true, conRecursos: true })
			]),

			seccion('cierre', 'Cierre y firma', [
				declaracionFirma({
					declaracion:
						'Yo, como autoridad, he verificado la lista anterior y certifico que se encuentra en óptimas condiciones.',
					conIdentificacion: true
				})
			])
		])
	}
}
