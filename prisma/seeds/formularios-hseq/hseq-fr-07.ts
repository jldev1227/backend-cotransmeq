/**
 * HSEQ-FR-07 — Reporte de falla.
 *
 * Decisiones de transcripción:
 *
 *  - El original imprime DOS copias idénticas del formato en la misma hoja (filas
 *    2-32 y 35-65). Es un duplicado de impresión, no dos formularios: se
 *    transcribe UNA vez.
 *  - Los tres textos largos del criterio de criticidad (Alto / Moderado / Leve)
 *    NO se pierden: van como `helpText` del campo de criticidad, porque son la
 *    definición normativa de cada nivel y sin ellos el conductor elige al azar.
 *  - Las secciones de análisis y firmas del `JEFE / COORDINADOR` y de
 *    `Administración / Compras` son administrativas: se modelan con
 *    `config.editableBy: ['USER']` y quedan fuera del runner del conductor. El
 *    documento lo prevé explícitamente para la v1.
 *  - El consecutivo (`No. REPORTE`) NO se pide: lo asigna el servidor. Pedírselo
 *    al conductor produce duplicados y huecos.
 */

import type { SeedDefinition } from './types'
import {
	declaracionFirma,
	evidenciaFotografica,
	fecha,
	hora,
	info,
	opciones,
	ordenarSecciones,
	seccion,
	texto,
	textoLargo
} from './factories'
import type { Campo } from './factories'
import type { Rule } from '../../../src/modules/formularios-dinamicos/domain'

const CRITICIDAD_AYUDA = [
	'ALTO — Activo altamente prioritario en la operatividad. La falla o avería crítica de frenos, dirección, llantas lisas, luces inoperantes o fundidas puede generar pérdidas significativas en la prestación del servicio, no cuenta con repuesto o puede dar origen a un accidente de trabajo. Se debe reportar de inmediato al personal de mantenimiento y asegurar instrucciones; debe ser atendido lo más rápido posible. Si la falla es crítica, inmovilizar el vehículo y esperar instrucciones.',
	'MODERADO — Activo levemente prioritario en la operatividad. La falla o avería NO genera pérdidas significativas en el proceso misional, no cuenta con repuesto, o puede dar origen a una condición de riesgo considerable. Se debe contar con plan de mantenimiento preventivo; el correctivo debe programarse en un término no mayor a 45 días después de detectada la falla.',
	'LEVE — Activo que no interfiere en la operatividad de la empresa; se puede sustituir o minimizar el riesgo con una intervención oportuna. Efectuar plan de mantenimiento preventivo en un término no mayor de 180 días luego de identificar y evaluar el nivel de criticidad; el mantenimiento puede programarse en seis meses o prorrogarse hasta que se cuente con recursos (preferiblemente no más de un año).'
].join('\n\n')

/** Campo administrativo: lo diligencia un usuario del dashboard, no el conductor. */
function administrativo(campo: Campo): Campo {
	return {
		...campo,
		/// `editableBy` lo lee el runner para no mostrar el campo al conductor. En
		/// v1 el runner simplemente los omite; el tratamiento administrativo llega
		/// en una fase posterior, tal como plantea el documento.
		config: { ...(campo.config ?? {}), editableBy: ['USER'] },
		/// Nunca obligatorios para el conductor: si lo fueran, no podría enviar.
		required: false
	}
}

export const hseqFr07: SeedDefinition = {
	code: 'HSEQ-FR-07',
	slug: 'reporte-de-falla',
	name: 'Reporte de falla',
	description:
		'Reporte de falla o avería de un activo (vehículo, equipo, herramienta o infraestructura) con evaluación de criticidad.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'ON_DEMAND',
		limitPolicy: 'UNLIMITED',
		context: {},
		rationale:
			'A demanda y sin límite: una falla se reporta cuando ocurre, y un mismo vehículo puede tener varias en un día.'
	},

	source: {
		sourceFile: 'HSEQ-FR-07, Reporte de Falla. V2.xlsx',
		sourceCode: 'HSEQ-FR-07',
		sourceRevision: '2',
		sourceDate: '2025-11-28',
		sourceSheet: 'FORMATO',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'El original imprime DOS copias idénticas del formato en la misma hoja. Se transcribió UNA vez, tal como indica el documento de especificación.',
		'El consecutivo «No. REPORTE» no se pide al conductor: lo asigna el servidor. Pedírselo produce duplicados y huecos.',
		'Las secciones de análisis de causas, posibles soluciones y las firmas de líder de proceso y Administración/Compras se marcaron como `editableBy: [USER]`. El runner del conductor las omite; el tratamiento administrativo se implementa en una fase posterior.',
		'La fecha del encabezado interno (2025-11-28) es POSTERIOR a la fecha de inspección del ZIP (2026-08-19 según la especificación, pero el archivo se descargó el 2026-08-19). HSEQ debe confirmar que la revisión 2 es la vigente.',
		'El campo «MAQUINA OTRO ¿Cuál?» del original mezcla dos opciones en una celda; se separó en la opción «Máquina» y la opción «Otro» con su campo de texto.'
	],

	version: {
		title: 'Reporte de falla',
		description: null,
		instructions:
			'Reporta la falla en cuanto la detectes. Si es crítica (frenos, dirección, llantas lisas, luces inoperantes), inmoviliza el vehículo y espera instrucciones antes de continuar.',
		settings: {},
		sections: ordenarSecciones([
			seccion('reporte', 'Datos del reporte', [
				fecha('fecha_reporte', 'Fecha del reporte', { required: true }),
				hora('hora_reporte', 'Hora', { required: true }),
				opciones(
					'recurso_propiedad',
					'El activo o recurso es',
					[
						{ value: 'PROPIO', label: 'Propio' },
						{ value: 'ALQUILADO', label: 'Alquilado' }
					],
					{ required: true }
				)
			]),

			seccion('activo', 'Activo o recurso', [
				opciones(
					'clase_activo',
					'Clase de activo',
					[
						{ value: 'VEHICULO', label: 'Vehículo' },
						{ value: 'EQUIPO', label: 'Equipo' },
						{ value: 'HERRAMIENTA', label: 'Herramienta' },
						{ value: 'INFRAESTRUCTURA', label: 'Infraestructura' },
						{ value: 'MAQUINA', label: 'Máquina' },
						{ value: 'OTRO', label: 'Otro' }
					],
					{
						required: true,
						/// «Otro ¿cuál?» solo se pide —y se exige— si se eligió Otro.
						visibilityRule: {
							version: 1,
							all: [{ fieldKey: 'clase_activo', operator: 'equals', value: 'OTRO' }],
							effect: { action: 'require', targetFieldKey: 'clase_activo_otro' }
						} satisfies Rule
					}
				),
				texto('clase_activo_otro', '¿Cuál?', {
					validation: { maxLength: 150 },
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'clase_activo', operator: 'equals', value: 'OTRO' }],
						effect: { action: 'show', targetFieldKey: 'clase_activo_otro' }
					} satisfies Rule
				}),
				texto('activo_nombre', 'Nombre del activo o recurso', {
					required: true,
					validation: { maxLength: 200 }
				}),
				texto('activo_marca', 'Marca', { validation: { maxLength: 100 } }),
				texto('activo_serie', 'Serie / código', { validation: { maxLength: 100 } }),
				{
					key: 'vehiculo',
					type: 'LOOKUP',
					label: 'Vehículo (si la falla es de un vehículo)',
					helpText: 'Selecciona la placa para que el reporte quede asociado al vehículo.',
					placeholder: null,
					required: false,
					config: { source: 'VEHICLE', snapshot: ['placa', 'marca', 'clase_vehiculo'] },
					validation: {},
					defaultValue: null,
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'clase_activo', operator: 'equals', value: 'VEHICULO' }],
						effect: { action: 'show', targetFieldKey: 'vehiculo' }
					} satisfies Rule
				}
			]),

			seccion('falla', 'Descripción de la falla', [
				textoLargo('falla_descripcion', 'Descripción de la falla', {
					required: true,
					validation: { minLength: 20, maxLength: 4000 },
					helpText:
						'Describe qué falla, desde cuándo y en qué condiciones se manifiesta. Mínimo 20 caracteres.'
				}),
				evidenciaFotografica('falla_evidencia', 'Evidencia de la falla', {
					maxFiles: 6,
					conDescripcion: false
				})
			]),

			seccion('criticidad', 'Evaluación de la criticidad', [
				info('criticidad_criterios', 'Criterios de evaluación de la falla', CRITICIDAD_AYUDA),
				opciones(
					'criticidad',
					'Nivel de criticidad',
					[
						{ value: 'ALTO', label: 'Alto', color: 'red' },
						{ value: 'MODERADO', label: 'Moderado', color: 'amber' },
						{ value: 'LEVE', label: 'Leve', color: 'emerald' }
					],
					{
						required: true,
						helpText: 'Lee los criterios de arriba antes de elegir.',
						visibilityRule: {
							version: 1,
							all: [{ fieldKey: 'criticidad', operator: 'equals', value: 'ALTO' }],
							effect: { action: 'require', targetFieldKey: 'criticidad_accion_inmediata' }
						} satisfies Rule
					}
				),
				textoLargo(
					'criticidad_accion_inmediata',
					'¿Qué acción inmediata tomaste? (obligatorio si la criticidad es Alta)',
					{
						validation: { maxLength: 2000 },
						helpText: 'Ej.: vehículo inmovilizado en el kilómetro 12, se notificó a mantenimiento.',
						visibilityRule: {
							version: 1,
							all: [{ fieldKey: 'criticidad', operator: 'equals', value: 'ALTO' }],
							effect: { action: 'show', targetFieldKey: 'criticidad_accion_inmediata' }
						} satisfies Rule
					}
				)
			]),

			seccion(
				'tratamiento',
				'Análisis y solución (uso administrativo)',
				[
					administrativo(
						textoLargo(
							'analisis_causas',
							'Análisis de las fallas reportadas: ¿por qué y cuáles fueron las causas?',
							{ validation: { maxLength: 4000 } }
						)
					),
					administrativo(
						textoLargo('posibles_soluciones', 'Posibles soluciones / recursos', {
							validation: { maxLength: 4000 }
						})
					),
					administrativo(texto('lider_nombre', 'Líder de proceso / área', { validation: { maxLength: 150 } })),
					administrativo(fecha('lider_fecha', 'Fecha de revisión del líder')),
					administrativo(
						texto('administracion_nombre', 'Recibido por Administración / Compras', {
							validation: { maxLength: 150 }
						})
					),
					administrativo(fecha('administracion_fecha', 'Fecha de recepción en Administración'))
				],
				{
					description:
						'Esta sección la diligencia el área responsable, no quien reporta. No es visible en el portal del conductor.'
				}
			),

			seccion('firma', 'Firma de quien reporta', [
				declaracionFirma({
					key: 'firma_reporta',
					declaracion:
						'Con mi firma doy fe de que la información consignada en este reporte corresponde a la falla observada.',
					label: 'Firma de quien reporta',
					conIdentificacion: true
				})
			])
		])
	}
}
