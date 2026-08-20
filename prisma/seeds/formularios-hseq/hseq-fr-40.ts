/**
 * HSEQ-FR-40 — Inspección de residuos.
 *
 * Diez parámetros SÍ/NO/NA sobre aprovechamiento, energía, agua y residuos.
 *
 * Decisiones de transcripción:
 *
 *  - La instrucción del original es explícita: «si se presenta algún estándar de
 *    respuesta negativa (NO), debe generarse el plan de acción pertinente». Eso se
 *    modela con la observación obligatoria por ítem MÁS un plan de acción cuyo
 *    primer renglón se exige cuando algo falla. Como una regla admite hasta veinte
 *    condiciones y aquí hay diez parámetros, el `any` cabe de sobra.
 *  - El original mezcla parámetros de energía y agua bajo el título «Inspección de
 *    residuos». Se conservan en una sola sección con el título del documento y
 *    queda como warning.
 */

import type { SeedDefinition } from './types'
import {
	declaracionFirma,
	evidenciaFotografica,
	hallazgoPlanAccion,
	identificacionInspector,
	itemsSiNoNa,
	ordenarSecciones,
	seccion,
	textoLargo
} from './factories'
import type { Rule } from '../../../src/modules/formularios-dinamicos/domain'

const PARAMETROS = [
	{
		key: 'papel_carton',
		label:
			'Se hace disposición de papel y cartón usado a un proveedor que garantice su aprovechamiento'
	},
	{
		key: 'avisos_energia',
		label: 'Existen avisos de uso eficiente y ahorro de energía dentro de las instalaciones'
	},
	{
		key: 'mantenimiento_redes',
		label:
			'Se realiza mantenimiento y revisión de redes eléctricas de las instalaciones por personal competente por lo menos una vez al año'
	},
	{
		key: 'apagado_luces',
		label: 'Al final de la jornada de trabajo se apagan todas las luces de las instalaciones'
	},
	{
		key: 'avisos_agua',
		label: 'Existen avisos de uso eficiente y ahorro de agua dentro de las instalaciones'
	},
	{ key: 'lavado_tanques', label: 'Se realiza lavado de tanques de agua para su desinfección' },
	{
		key: 'puntos_ecologicos',
		label: 'Cuentan con puntos ecológicos para residuos aprovechables y no aprovechables'
	},
	{
		key: 'senalizacion_residuos',
		label: 'Señalización para clasificación de residuos (en canecas o en el punto ecológico)'
	},
	{
		key: 'contenedores_peligrosos',
		label: 'Cuentan con contenedores para el almacenamiento de residuos peligrosos'
	},
	{
		key: 'raee',
		label:
			'Disposición de residuos de aparatos eléctricos y electrónicos para ser enviados a su disposición final'
	}
]

/**
 * Regla que exige el plan de acción cuando CUALQUIER parámetro sale «NO».
 *
 * `any` con las diez condiciones: el original lo pide explícitamente y la regla
 * cabe en el tope de veinte condiciones. Sin esta regla, la instrucción del
 * documento quedaría como texto que nadie hace cumplir.
 */
const REGLA_PLAN_ACCION: Rule = {
	version: 1,
	any: PARAMETROS.map((p) => ({ fieldKey: p.key, operator: 'equals' as const, value: 'NO' })),
	effect: { action: 'require', targetFieldKey: 'plan_accion' }
}

export const hseqFr40: SeedDefinition = {
	code: 'HSEQ-FR-40',
	slug: 'inspeccion-de-residuos',
	name: 'Inspección de residuos',
	description:
		'Diez parámetros de aprovechamiento, energía, agua y residuos. Un «No» obliga a generar plan de acción.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'MONTHLY',
		limitPolicy: 'ONE_PER_PERIOD',
		context: {},
		rationale: 'Mensual por sede; la sede se deriva del target de la asignación.'
	},

	source: {
		sourceFile: 'HSEQ-FR-40,_Inspección_de_Residuos._V1.xlsx',
		sourceCode: 'HSEQ-FR-40',
		sourceRevision: '1',
		sourceDate: '2022-07-17',
		sourceSheet: 'FR',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'DISCREPANCIA: el encabezado interno dice «Versión 1 / 2022-07-17» pero el control de cambios registra una versión 2 del 2025-03-12. El encabezado parece desactualizado; HSEQ debe confirmar cuál es la vigente antes de publicar.',
		'El formato mezcla parámetros de energía y de agua bajo el título «Inspección de residuos». Se conservó el título del documento.',
		'El original registra al inspector con líneas de subrayado en una celda de texto («INSPECCIONADO POR: ____ CARGO: ____ LUGAR/SEDE: ____»). Se transcribió como tres campos independientes.',
		'La regla que exige el plan de acción se implementó con `any` sobre los diez parámetros. Si HSEQ añade parámetros habrá que ampliarla (tope de 20 condiciones por regla).'
	],

	version: {
		title: 'Inspección de residuos',
		description: null,
		instructions:
			'Determina si cada parámetro se cumple: SÍ, NO o No aplica. Si algún parámetro sale NO, la observación de ese ítem y el plan de acción son obligatorios.',
		settings: {},
		sections: ordenarSecciones([
			seccion('identificacion', 'Identificación de la inspección', [
				identificacionInspector({ conLugar: true })
			]),

			seccion(
				'parametros',
				'Parámetros para la inspección',
				[
					/// La regla del plan de acción se cuelga del PRIMER parámetro: cada
					/// campo lleva una sola `visibilityRule`, y los demás ya usan la suya
					/// para exigir su propia observación.
					itemsSiNoNa(PARAMETROS).map((campo, index) =>
						index === 0 ? { ...campo, visibilityRule: REGLA_PLAN_ACCION } : campo
					)
				],
				{
					description:
						'Marca SÍ, NO o No aplica. Un «NO» exige observación y activa el plan de acción.'
				}
			),

			seccion('observaciones', 'Observaciones', [
				textoLargo('observaciones_generales', 'Observaciones', { validation: { maxLength: 4000 } }),
				evidenciaFotografica('registro_visual', 'Registro visual', { maxFiles: 8 })
			]),

			seccion('plan', 'Plan de acción', [
				hallazgoPlanAccion('plan_accion', 'Plan de acción', {
					conFecha: true,
					conRecursos: true
				})
			]),

			seccion('cierre', 'Cierre y firma', [
				declaracionFirma({
					declaracion:
						'Yo, como autoridad ejecutante, he verificado la lista anterior y certifico que se puede realizar la actividad y es seguro trabajar en estas condiciones.',
					conIdentificacion: true
				})
			])
		])
	}
}
