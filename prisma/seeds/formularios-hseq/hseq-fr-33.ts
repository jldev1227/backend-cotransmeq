/**
 * HSEQ-FR-33 — Tarjeta de observación.
 *
 * El original imprime un catálogo jerárquico de 15 grupos con ~45 subcategorías en
 * dos columnas apretadas, con una casilla por cada una.
 *
 * Decisión central: ese catálogo se transcribe como CUATRO campos
 * `MULTIPLE_CHOICE` agrupados por tema, no como cuarenta y cinco booleanos. Con
 * booleanos, el conductor recorre cuarenta y cinco casillas para marcar una, y el
 * informe queda con cuarenta y cuatro `false` que no significan «no ocurrió» sino
 * «no lo miré». Con multiselección, marcar dos condiciones es un gesto y el dato
 * dice exactamente qué se observó.
 *
 * Los grupos se reparten según el propio original:
 *  - Actos y condiciones subestándar → grupos 1 a 12.
 *  - Actos y condiciones seguras → grupo 13.
 *  - Otros → grupo 14.
 *  - Condición de salud → grupo 15.
 */

import type { SeedDefinition } from './types'
import {
	declaracionFirma,
	evidenciaFotografica,
	fecha,
	multiple,
	opciones,
	ordenarSecciones,
	seccion,
	texto,
	textoLargo
} from './factories'
import type { Rule } from '../../../src/modules/formularios-dinamicos/domain'

/** Grupos 1 a 12 del catálogo: actos y condiciones subestándar. */
const SUBESTANDAR = [
	{ value: 'proc_inadecuados', label: '1.1 Ejecución de procedimientos de trabajo inadecuados' },
	{ value: 'proc_omision', label: '1.2 Omisión de procedimientos de trabajo' },
	{ value: 'permiso_trabajo', label: '1.3 Incumplimiento del sistema de permiso de trabajo' },
	{ value: 'doc_personal', label: '1.4 Personal con documentación incompleta o sin ella' },
	{ value: 'conductas', label: '1.5 Personal con conductas inadecuadas' },
	{ value: 'normas_otro', label: '1.6 Otro (normas / procedimientos / actos)' },
	{ value: 'epp_cabeza', label: '2.1 Omisión de EPP: cabeza' },
	{ value: 'epp_auditiva', label: '2.2 Omisión de EPP: auditiva' },
	{ value: 'epp_respiratoria', label: '2.3 Omisión de EPP: respiratoria' },
	{ value: 'epp_manos', label: '2.4 Omisión de EPP: manos' },
	{ value: 'epp_pies', label: '2.5 Omisión de EPP: pies' },
	{ value: 'epp_cara', label: '2.6 Omisión de EPP: cara' },
	{ value: 'epp_ojos', label: '2.7 Omisión de EPP: ojos' },
	{ value: 'epp_caidas', label: '2.8 Omisión de EPP: contra caídas' },
	{ value: 'epp_ropa', label: '2.9 Omisión de EPP: ropa de trabajo' },
	{ value: 'epp_especial', label: '2.10 Omisión de EPP: especial' },
	{ value: 'epp_otro', label: '2.11 Omisión de EPP: otro' },
	{ value: 'emerg_incompleto', label: '3.1 Sin equipo de emergencias del área y/o incompleto' },
	{ value: 'emerg_mal_ubicado', label: '3.2 Equipo de emergencia mal ubicado' },
	{ value: 'emerg_mal_estado', label: '3.3 Equipo de emergencia en mal estado' },
	{ value: 'senal_emergencias', label: '4.1 Áreas sin señalización de emergencias' },
	{
		value: 'senal_almacenamiento',
		label: '4.2 Áreas de almacenamiento sin señalización y/o incompleta'
	},
	{ value: 'senal_operacion', label: '4.3 Áreas de operación sin demarcación y/o incompleta' },
	{ value: 'amb_ruido', label: '5.1 Ruido excesivo' },
	{ value: 'amb_circulacion', label: '5.2 Espacios inadecuados de circulación' },
	{ value: 'amb_ventilacion', label: '5.3 Ventilación general inadecuada' },
	{ value: 'amb_iluminacion', label: '5.4 Iluminación deficiente' },
	{ value: 'eq_inadecuados', label: '6.1 Equipos y/o herramientas inadecuadas para el trabajo' },
	{ value: 'eq_sin_proteccion', label: '6.2 Equipos y/o herramientas sin protecciones adecuadas' },
	{ value: 'eq_uso_inadecuado', label: '6.3 Equipos y/o herramientas utilizadas inadecuadamente' },
	{ value: 'eq_mal_estado', label: '6.4 Equipos y/o herramientas en mal estado' },
	{ value: 'carga_levantamiento', label: '7.1 Levantamiento y/o transporte de cargas inadecuado' },
	{ value: 'carga_traslado', label: '7.2 Traslado de cargas inadecuado' },
	{ value: 'carga_sobredimensionada', label: '7.3 Manipulación de cargas sobredimensionadas' },
	{ value: 'vial_doc_vehiculo', label: '8.1 Vehículos sin documentación o incompleta' },
	{ value: 'vial_equipo_seguridad', label: '8.2 Vehículos sin equipo de seguridad o incompleto' },
	{ value: 'vial_mal_estado', label: '8.3 Vehículos en mal estado' },
	{ value: 'vial_doc_conductor', label: '8.4 Conductores sin documentación o incompleta' },
	{ value: 'vial_cinturon', label: '8.5 No uso del cinturón de seguridad' },
	{ value: 'vial_velocidad', label: '8.6 Desplazamiento de vehículos a velocidades no permitidas' },
	{ value: 'vial_conducta', label: '8.7 Transporte / conducta insegura del personal' },
	{ value: 'quim_almacenamiento', label: '9.1 Áreas de almacenamiento inadecuadas' },
	{ value: 'quim_materiales', label: '9.2 Materiales almacenados inapropiadamente' },
	{ value: 'quim_hojas_seguridad', label: '9.3 Ausencia de hojas de seguridad de productos y materiales' },
	{ value: 'quim_fugas', label: '9.4 Presencia de fugas o derrames (aceites, combustibles)' },
	{ value: 'quim_gases', label: '9.5 Gases comprimidos mal almacenados (sin amarres)' },
	{ value: 'agua_fugas', label: '10.1 Fugas de agua no controladas' },
	{ value: 'agua_vertimientos', label: '10.2 Vertimientos en puntos no autorizados' },
	{ value: 'orden_obstaculizadas', label: '11.1 Áreas de trabajo obstaculizadas' },
	{ value: 'orden_aseo', label: '11.2 Áreas en inadecuadas condiciones de orden y aseo' },
	{ value: 'res_presentes', label: '12.1 Residuos presentes en las áreas de trabajo' },
	{ value: 'res_clasificacion', label: '12.2 Inapropiada clasificación de residuos' },
	{
		value: 'res_almacenamiento',
		label: '12.3 Inadecuadas condiciones del área de almacenamiento temporal'
	}
]

export const hseqFr33: SeedDefinition = {
	code: 'HSEQ-FR-33',
	slug: 'tarjeta-de-observacion',
	name: 'Tarjeta de observación',
	description:
		'Reporte de actos y condiciones subestándar o seguras, con catálogo de categorías, correctivos propuestos y reconocimientos.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'ON_DEMAND',
		limitPolicy: 'UNLIMITED',
		context: {},
		rationale:
			'A demanda y sin límite: se reporta lo que se observa, cuando se observa, y puede haber varias observaciones al día.'
	},

	source: {
		sourceFile: 'HSEQ-FR-33, Tarjeta de Observación. V2.xlsx',
		sourceCode: 'HSEQ-FR-33',
		sourceRevision: '2',
		sourceDate: '2022-08-27',
		sourceSheet: 'CARA 1',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'DECISIÓN IMPORTANTE: el catálogo de ~53 subcategorías del original se transcribió como campos de OPCIÓN MÚLTIPLE agrupados, no como 53 casillas booleanas. Con booleanos, el informe queda lleno de «false» que significan «no lo miré» y no «no ocurrió». HSEQ debe confirmar esta decisión.',
		'Los grupos 1 a 12 del original se fusionaron en un único campo «Actos y condiciones subestándar observadas», y los grupos 13 y 14 en «Actos y condiciones seguras», conservando la numeración en cada etiqueta (1.1, 8.5, 13.1…) para poder cruzarlo con el papel.',
		'El original tiene una hoja llamada «CARA 1» pero no existe una «CARA 2» en el libro. Si el formato impreso tiene reverso, falta transcribirlo.',
		'El campo «1.6 Otro. ¿Cuál?» del catálogo original tenía una casilla de texto asociada; se conservó como campo de texto condicional.',
		'El grupo «15 - Malestar o condición de salud no adecuada» pide describir el malestar: son datos de salud. Revisar retención y quién puede consultarlos antes de publicar.'
	],

	version: {
		title: 'Tarjeta de observación',
		description: null,
		instructions:
			'Reporta lo que observaste: un acto o condición subestándar, una mejora posible, o un reconocimiento. Marca todas las categorías que apliquen y describe la situación.',
		settings: {},
		sections: ordenarSecciones([
			seccion('identificacion', 'Sección I — Identificación', [
				opciones(
					'quien_reporta',
					'Quién reporta',
					[
						{ value: 'EMPLEADO', label: 'Empleado' },
						{ value: 'CLIENTE', label: 'Cliente' },
						{ value: 'CONTRATISTA', label: 'Contratista / proveedor' },
						{ value: 'COMUNIDAD', label: 'Comunidad' },
						{ value: 'VISITANTE', label: 'Visitante' },
						{ value: 'OTRO', label: 'Otro' }
					],
					{ required: true }
				),
				fecha('fecha_reporte', 'Fecha del reporte', { required: true }),
				texto('reportante_nombre', 'Nombre del reportante', {
					required: true,
					validation: { maxLength: 150 }
				}),
				texto('reportante_cargo', 'Cargo', { validation: { maxLength: 100 } }),
				texto('lugar', 'Lugar', { required: true, validation: { maxLength: 150 } }),
				opciones(
					'tipo_hallazgo',
					'Tipo de hallazgo',
					[
						{ value: 'NO_CONFORMIDAD', label: 'No conformidad', color: 'red' },
						{ value: 'POSIBILIDAD_MEJORA', label: 'Posibilidad de mejora', color: 'amber' },
						{ value: 'RECONOCIMIENTO', label: 'Reconocimiento', color: 'emerald' }
					],
					{ required: true }
				)
			]),

			seccion('descripcion', 'Sección II — Descripción', [
				textoLargo('descripcion', 'Descripción de lo observado', {
					required: true,
					validation: { minLength: 20, maxLength: 4000 },
					helpText: 'Qué pasó, dónde y cuándo. Mínimo 20 caracteres.'
				}),
				evidenciaFotografica('evidencia', 'Evidencia fotográfica', {
					maxFiles: 6,
					conDescripcion: false
				})
			]),

			seccion('correctivos', 'Sección III — Correctivos emprendidos o propuestos', [
				textoLargo('correctivos', 'Correctivos emprendidos o propuestos en el área', {
					required: true,
					validation: { maxLength: 4000 }
				})
			]),

			seccion(
				'subestandar',
				'Sección IV — Actos y condiciones subestándar',
				[
					multiple('categorias_subestandar', 'Categorías observadas (marca todas las que apliquen)', SUBESTANDAR, {
						helpText:
							'La numeración corresponde al catálogo del formato impreso, para poder cruzarlo con el papel.',
						visibilityRule: {
							version: 1,
							all: [{ fieldKey: 'categorias_subestandar', operator: 'in', value: ['normas_otro', 'epp_otro'] }],
							effect: { action: 'require', targetFieldKey: 'categoria_otro_detalle' }
						} satisfies Rule
					}),
					texto('categoria_otro_detalle', '¿Cuál? (para las categorías «Otro»)', {
						validation: { maxLength: 300 },
						visibilityRule: {
							version: 1,
							all: [{ fieldKey: 'categorias_subestandar', operator: 'in', value: ['normas_otro', 'epp_otro'] }],
							effect: { action: 'show', targetFieldKey: 'categoria_otro_detalle' }
						} satisfies Rule
					})
				],
				{
					description:
						'Solo si el hallazgo es una no conformidad o una posibilidad de mejora. Corresponde a los grupos 1 a 12 del formato impreso.'
				}
			),

			seccion(
				'seguras',
				'Sección V — Actos y condiciones seguras',
				[
					/// Los grupos 13 y 14 del original tienen UNA subcategoría cada uno.
					/// Se fusionan en un solo campo: dos campos de selección con una
					/// única opción cada uno son dos controles que no dejan elegir nada.
					multiple(
						'categorias_seguras',
						'Actos y condiciones seguras observadas (grupos 13 y 14 del formato)',
						[
							{
								value: 'reconocimiento_proceso',
								label: '13.1 Reconocimiento al acto o condición segura del proceso'
							},
							{ value: 'otros', label: '14.1 Otros' }
						]
					),
					textoLargo('reconocimiento_detalle', 'Detalle del reconocimiento', {
						validation: { maxLength: 2000 }
					})
				]
			),

			seccion(
				'salud',
				'Sección VI — Condición de salud',
				[
					opciones(
						'malestar_presenta',
						'¿Presenta algún malestar o condición de salud no adecuada?',
						[
							{ value: 'NO', label: 'No', color: 'emerald' },
							{ value: 'SI', label: 'Sí', color: 'red' }
						],
						{
							required: true,
							visibilityRule: {
								version: 1,
								all: [{ fieldKey: 'malestar_presenta', operator: 'equals', value: 'SI' }],
								effect: { action: 'require', targetFieldKey: 'malestar_descripcion' }
							} satisfies Rule
						}
					),
					textoLargo('malestar_descripcion', 'Describa qué malestar presenta', {
						validation: { maxLength: 2000 },
						helpText: 'Dato de salud: se trata de forma confidencial.',
						visibilityRule: {
							version: 1,
							all: [{ fieldKey: 'malestar_presenta', operator: 'equals', value: 'SI' }],
							effect: { action: 'show', targetFieldKey: 'malestar_descripcion' }
						} satisfies Rule
					})
				],
				{ description: 'Grupo 15 del formato impreso.' }
			),

			seccion('cierre', 'Firma', [
				declaracionFirma({
					declaracion:
						'Con mi firma doy fe de que la observación reportada corresponde a lo que presencié.',
					conIdentificacion: false
				})
			])
		])
	}
}
