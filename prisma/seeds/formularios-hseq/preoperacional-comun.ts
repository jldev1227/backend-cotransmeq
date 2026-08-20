/**
 * Estructura común de los dos preoperacionales (HSEQ-FR-08 y HSEQ-FR-09).
 *
 * Los dos formatos comparten literalmente el 80 % de los ítems: mismos fluidos,
 * mismas luces, mismo bloque de salud y fatiga, mismo control de propiedad del
 * cliente. Este archivo describe esa base y cada semilla la especializa con lo
 * suyo (barra antivuelco y platón en el FR-08; zona de pasajeros, freno de ahogo y
 * dos extintores en el FR-09).
 *
 * Se comparte código, NO campos: cada semilla llama a estas funciones y obtiene
 * campos materializados con sus propias claves. No hay ningún vínculo entre las dos
 * definiciones resultantes, así que editar el FR-09 no toca el FR-08.
 *
 * **Las siete columnas de fecha del Excel no existen aquí.** En el papel, una hoja
 * cubre una semana con siete columnas; en el motor dinámico cada diligenciamiento
 * es un envío con su `business_date`, y el historial se consulta en la lista de
 * envíos. Transcribirlas como siete campos produciría un formulario que hay que
 * rellenar siete veces el lunes.
 */

import {
	declaracionFirma,
	entero,
	ESCALA_B_M_NA,
	evidenciaFotografica,
	fecha,
	info,
	itemInspeccion,
	itemsBMNA,
	opciones,
	seccion,
	texto,
	textoLargo
} from './factories'
import type { Campo } from './factories'
import type { FormSectionDraft, Rule } from '../../../src/modules/formularios-dinamicos/domain'

export const INSTRUCCIONES_PREOPERACIONAL =
	'Señor conductor: lea cada ítem de la lista de verificación y marque el estado BUENO, MALO o NO APLICA. En los ítems de sí/no responda según corresponda, y en los demás diligencie la información pedida. Si el vehículo presenta un ítem MALO, diligencie el Reporte de Falla (HSEQ-FR-07) y notifique al personal de mantenimiento por los canales habilitados. IMPORTANTE: este documento debe diligenciarse ANTES de usar el vehículo; es un requisito legal y garantiza el aseguramiento de la operación.'

// ─── Bloques compartidos ─────────────────────────────────────────────────────

export const MOTOR_FLUIDOS = [
	{ key: 'aceite_motor', label: 'Aceite de motor (dentro del nivel, color, viscosidad)' },
	{ key: 'refrigerante', label: 'Refrigerante / agua (dentro del nivel, color, sin sedimentos)' },
	{ key: 'liquido_frenos', label: 'Líquido de frenos (dentro del nivel, color)' },
	{
		key: 'direccion_hidraulica',
		label: 'Nivel de líquido de dirección hidráulica (cuando aplique)'
	},
	{ key: 'liquido_limpiaparabrisas', label: 'Líquido / agua de limpiaparabrisas (dentro del nivel)' },
	{ key: 'fugas_liquidos', label: 'Sin fugas de líquidos en el motor o debajo del vehículo' },
	{
		key: 'bateria',
		label: 'Batería (buen estado físico, sujetada, sin deformación, sin corrosión)'
	},
	{ key: 'conexiones_cables', label: 'Conexiones de cables' },
	{ key: 'mangueras_correas', label: 'Estado de mangueras y correas' },
	{ key: 'aseo_motor', label: 'Estado de aseo del motor / suciedad excesiva' },
	{ key: 'filtros', label: 'Estado y limpieza de filtros de motor y aire acondicionado' }
]

export const LLANTAS_RINES = [
	{
		key: 'llantas_delanteras',
		label: 'Llantas delanteras (estado físico / profundidad de labrado 1,6 mm / presión)'
	},
	{
		key: 'llantas_traseras',
		label: 'Llantas traseras (estado físico / profundidad de labrado 1,6 mm / presión)'
	},
	{
		key: 'llanta_repuesto',
		label: 'Llanta de repuesto (estado físico / profundidad de labrado 1,6 mm / presión / asegurada)'
	},
	{ key: 'rin', label: 'Rin (sin golpes, fisuras, óxido o deformaciones)' },
	{ key: 'pernos', label: 'Pernos completos' }
]

export const EXTERIOR_COMUN = [
	{ key: 'carroceria', label: 'Carrocería general (pintura en buen estado)' },
	{ key: 'espejos_laterales', label: 'Espejos laterales (limpios y bien posicionados)' },
	{
		key: 'vidrios_exteriores',
		label: 'Vidrios frontal, lateral, traseros y panorámicos (buen estado)'
	},
	{ key: 'plumillas', label: 'Plumillas (sin desgaste, goma en buen estado, bien fijadas)' },
	{ key: 'aviso_velocidad', label: 'Aviso de velocidad máxima' },
	{ key: 'aviso_como_conduzco', label: 'Aviso de «¿Cómo conduzco?»' },
	{
		key: 'senalizacion_calcomanias',
		label:
			'Señalización / calcomanías (Servicio Especial 15 cm de altura, número y logo de la empresa 10 cm, laterales y traseros)'
	}
]

export const CABINA_COMUN = [
	{
		key: 'vidrios_cabina',
		label:
			'Vidrios y ventanas eléctricos o manuales corredizas de cabina (sin adhesivos, sin grietas ni fisuras, sin rayado, limpios, se desplazan sin dificultad)'
	},
	{
		key: 'silla_conductor',
		label: 'Silla del conductor con apoyacabezas y sistema de posición graduable'
	},
	{ key: 'freno_mano', label: 'Freno de mano o de emergencia' },
	{ key: 'seguro_puertas', label: 'Seguro de puertas / manijas funcionales' },
	{ key: 'luz_techo', label: 'Luz de techo (funcionamiento)' },
	{ key: 'pito', label: 'Pito (funcionamiento)' },
	{ key: 'radio_parlantes', label: 'Radio y parlantes (funcionamiento)' },
	{ key: 'mandos', label: 'Mandos (funcionamiento)' },
	{ key: 'bloqueo_central', label: 'Sistema de bloqueo central (funcionamiento)' },
	{ key: 'alarma_antirrobo', label: 'Alarma antirrobo (cuando aplique, funcionamiento)' },
	{ key: 'alarma_reversa', label: 'Alarma de reversa / retroceso (funcionamiento)' },
	{ key: 'espejo_retrovisor', label: 'Espejo retrovisor interno (bien ajustado y firme)' },
	{ key: 'aire_calefaccion', label: 'Aire acondicionado y calefacción (funcionamiento)' },
	{
		key: 'elementos_asegurados',
		label:
			'Elementos asegurados y sujetados (cabina libre, sin colgantes ni objetos distractores, sin malos olores)'
	}
]

export const LUCES_COMUN = [
	{ key: 'luces_altas', label: 'Luces altas (funcionamiento, dirección, alcance largo)' },
	{ key: 'luces_bajas', label: 'Luces bajas (funcionamiento, dirección)' },
	{
		key: 'luces_exploradoras',
		label: 'Luces exploradoras o neblineras (cuando aplique, funcionamiento)'
	},
	{
		key: 'direccionales_derechas',
		label: 'Direccionales derechas delantera y trasera (funcionamiento, parpadeo constante)'
	},
	{
		key: 'direccionales_izquierdas',
		label: 'Direccionales izquierdas delantera y trasera (funcionamiento, parpadeo constante)'
	},
	{
		key: 'luz_parqueo',
		label: 'Luz de parqueo (posición): visible cuando el vehículo está estacionado'
	},
	{ key: 'luces_reversa', label: 'Luces de reversa (encienden al poner la palanca en reversa)' },
	{ key: 'luces_freno', label: 'Luces de freno (encienden al presionar el pedal del freno)' },
	{
		key: 'tercer_stop',
		label: 'Luz del tercer stop (ubicada en el centro, debe encenderse con los frenos)'
	},
	{ key: 'luz_placa', label: 'Luz de placa (ilumina la matrícula trasera, visible en la oscuridad)' },
	{
		key: 'farolas',
		label: 'Estado de las farolas (adecuado, sin roturas, no amarillento, bien fijado)'
	}
]

export const TABLERO_COMUN = [
	{
		key: 'tacometro',
		label: 'Indicador de revoluciones / tacómetro (indica las revoluciones del motor)'
	},
	{ key: 'velocimetro', label: 'Indicador velocímetro (indica la velocidad)' },
	{
		key: 'indicador_luces',
		label: 'Indicadores de luces (se activan al encender luces principales o de parqueo)'
	},
	{ key: 'indicador_combustible', label: 'Indicador de combustible (indica el nivel)' },
	{ key: 'indicador_temperatura', label: 'Indicador de temperatura (indica la del motor)' },
	{ key: 'indicador_cinturones', label: 'Indicador de cinturones de seguridad' },
	{ key: 'odometro', label: 'Odómetro (registra el kilometraje total)' },
	{ key: 'indicador_freno_mano', label: 'Indicador de freno de mano' },
	{ key: 'indicador_puertas', label: 'Indicador de puertas abiertas' },
	{ key: 'camara_reversa', label: 'Cámara de reversa (cuando aplique)' }
]

export const PRUEBAS_COMUN = [
	{ key: 'palanca_cambios', label: 'Palanca de cambios' },
	{ key: 'arranque', label: 'Arranque / encendido (funcionamiento)' },
	{ key: 'volante', label: 'Volante (dirección)' },
	{
		key: 'pedal_frenos',
		label: 'Pedal de frenos / prueba de frenado (sin ruidos, resistencia adecuada, sin interferencias)'
	},
	{ key: 'pedal_clutch', label: 'Pedal de clutch (sin ruidos, resistencia adecuada, sin interferencias)' },
	{
		key: 'pedal_acelerador',
		label: 'Pedal acelerador (sin ruidos, resistencia adecuada, sin interferencias)'
	},
	{ key: 'limpiaparabrisas', label: 'Funcionamiento de limpiaparabrisas' }
]

export const EPP_COMUN = [
	{ key: 'epp_casco', label: 'Casco de seguridad blanco tipo ingeniero' },
	{ key: 'epp_guantes_vaqueta', label: 'Guantes de vaqueta' },
	{ key: 'epp_guantes_poliuretano', label: 'Guantes de poliuretano' },
	{ key: 'epp_tapaoidos', label: 'Tapaoídos siliconados' },
	{ key: 'epp_gafas_claras', label: 'Gafas de lente claro' },
	{ key: 'epp_gafas_oscuras', label: 'Gafas de lente oscuro' },
	{
		key: 'epp_dotacion',
		label: 'Dotación (camisa manga larga y pantalón jean) y botas de seguridad'
	}
]

export const HERRAMIENTAS_COMUN = [
	{ key: 'gato', label: 'Gato con capacidad para elevar el vehículo' },
	{ key: 'cruceta', label: 'Cruceta o llave de dos copas y palanca' },
	{ key: 'conos', label: '4 conos reflectivos o equivalentes (mínimo 50 cm de altura)' },
	{ key: 'alicate', label: 'Alicate' },
	{ key: 'destornillador_estrella', label: 'Destornillador de estrella' },
	{ key: 'destornillador_pala', label: 'Destornillador de pala' },
	{ key: 'llaves_fijas', label: 'Llaves fijas' },
	{ key: 'llave_expansion', label: 'Llave de expansión' },
	{ key: 'botiquin', label: 'Botiquín de primeros auxilios (con botella de agua)' },
	{ key: 'linterna', label: 'Linterna (enciende, con pilas de repuesto)' },
	{ key: 'chaleco', label: 'Chaleco reflectivo' },
	{ key: 'cinta_peligro', label: 'Cinta de señalización «PELIGRO»' },
	{ key: 'kit_derrames', label: 'Kit de derrames' },
	{ key: 'paleta_pare_siga', label: 'Paleta de PARE / SIGA' },
	{ key: 'pala_antichispa', label: 'Pala antichispa' }
]

// ─── Secciones compartidas ───────────────────────────────────────────────────

/** Documentos del vehículo con sus fechas de vencimiento. */
export function seccionDocumentos(): FormSectionDraft {
	return seccion(
		'documentos',
		'Información y documentos del vehículo',
		[
			{
				key: 'vehiculo',
				type: 'LOOKUP',
				label: 'Vehículo',
				helpText: 'Selecciona la placa. Se guardan marca, clase y modelo junto al envío.',
				placeholder: null,
				required: true,
				config: { source: 'VEHICLE', snapshot: ['placa', 'marca', 'clase_vehiculo', 'modelo'] },
				validation: {},
				visibilityRule: null,
				defaultValue: null
			},
			fecha('doc_tarjeta_operaciones', 'Vencimiento de la tarjeta de operaciones'),
			fecha('doc_soat', 'Vencimiento del SOAT', { required: true }),
			fecha('doc_poliza_extracontractual', 'Vencimiento de la póliza de responsabilidad civil extracontractual'),
			fecha('doc_tecnomecanica', 'Vencimiento de la revisión tecnicomecánica y de gases', {
				required: true
			}),
			fecha('doc_poliza_contractual', 'Vencimiento de la póliza de responsabilidad civil contractual'),
			fecha('doc_revision_preventiva', 'Vencimiento de la revisión preventiva'),
			fecha('doc_poliza_todo_riesgo', 'Vencimiento de la póliza todo riesgo'),
			opciones(
				'doc_licencia_transito',
				'¿Porta la licencia de tránsito?',
				[
					{ value: 'SI', label: 'Sí', color: 'emerald' },
					{ value: 'NO', label: 'No', color: 'red' }
				],
				{ required: true }
			)
		],
		{ description: 'Los vencimientos se registran como fecha para poder alertar antes de que ocurran.' }
	)
}

/**
 * Salud y gestión de fatiga.
 *
 * Las horas de sueño se piden como número con rango: un texto libre admite
 * «poquito» y «casi nada», que no sirven para nada. El umbral de 6 horas activa la
 * alerta de fatiga, que es el dato por el que existe la sección.
 */
export function seccionSaludFatiga(): FormSectionDraft {
	return seccion(
		'salud_fatiga',
		'Condiciones de salud y gestión de fatiga',
		[
			decimalHoras('horas_sueno', 'Horas que durmió antes de conducir'),
			decimalHoras('horas_descanso', 'Horas de descanso total antes de conducir'),
			textoLargo('estado_salud', '¿Cuál es su estado de salud? Escriba BIEN o enuncie el síntoma', {
				required: true,
				validation: { maxLength: 1000 }
			}),
			opciones(
				'consume_medicamentos',
				'¿Consume medicamentos?',
				[
					{ value: 'NO', label: 'No', color: 'emerald' },
					{ value: 'SI', label: 'Sí', color: 'amber' }
				],
				{
					required: true,
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'consume_medicamentos', operator: 'equals', value: 'SI' }],
						effect: { action: 'require', targetFieldKey: 'medicamentos_cuales' }
					} satisfies Rule
				}
			),
			texto('medicamentos_cuales', '¿Cuáles medicamentos?', {
				validation: { maxLength: 500 },
				visibilityRule: {
					version: 1,
					all: [{ fieldKey: 'consume_medicamentos', operator: 'equals', value: 'SI' }],
					effect: { action: 'show', targetFieldKey: 'medicamentos_cuales' }
				} satisfies Rule
			}),
			opciones(
				'es_alergico',
				'¿Es alérgico?',
				[
					{ value: 'NO', label: 'No', color: 'emerald' },
					{ value: 'SI', label: 'Sí', color: 'amber' }
				],
				{
					required: true,
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'es_alergico', operator: 'equals', value: 'SI' }],
						effect: { action: 'require', targetFieldKey: 'alergico_a_que' }
					} satisfies Rule
				}
			),
			texto('alergico_a_que', '¿A qué es alérgico?', {
				validation: { maxLength: 500 },
				visibilityRule: {
					version: 1,
					all: [{ fieldKey: 'es_alergico', operator: 'equals', value: 'SI' }],
					effect: { action: 'show', targetFieldKey: 'alergico_a_que' }
				} satisfies Rule
			}),
			opciones(
				'pausas_activas',
				'¿Sabe y realiza pausas activas de 15 minutos cada dos o tres horas de conducción consecutiva?',
				[
					{ value: 'SI', label: 'Sí', color: 'emerald' },
					{ value: 'NO', label: 'No', color: 'red' }
				],
				{ required: true }
			)
		],
		{
			description:
				'Datos de salud: se tratan de forma confidencial y solo los consulta el personal autorizado.'
		}
	)
}

/** Horas con un decimal y rango realista. */
function decimalHoras(key: string, label: string): Campo {
	return {
		key,
		type: 'DECIMAL',
		label,
		helpText: 'En horas. Ejemplo: 7,5',
		placeholder: null,
		required: true,
		config: {},
		validation: { min: 0, max: 24, precision: 1 },
		visibilityRule: null,
		defaultValue: null
	}
}

/** Combustible, kilometraje y FUEC. */
export function seccionCombustible(): FormSectionDraft {
	return seccion('combustible', 'Combustible, kilometraje y FUEC', [
		opciones(
			'tipo_combustible',
			'Tipo de combustible',
			[
				{ value: 'DIESEL', label: 'Diésel / ACPM' },
				{ value: 'GASOLINA', label: 'Gasolina' },
				{ value: 'GAS', label: 'Gas' },
				{ value: 'HIBRIDO', label: 'Híbrido' },
				{ value: 'ELECTRICO', label: 'Eléctrico' }
			],
			{ required: true }
		),
		opciones(
			'nivel_combustible',
			'Nivel aproximado de combustible',
			[
				{ value: 'RESERVA', label: 'Reserva', color: 'red' },
				{ value: 'UN_CUARTO', label: '1/4' },
				{ value: 'MEDIO', label: '1/2' },
				{ value: 'TRES_CUARTOS', label: '3/4' },
				{ value: 'LLENO', label: 'Lleno', color: 'emerald' }
			],
			{ required: true }
		),
		...itemsBMNA([{ key: 'nivel_urea', label: 'Nivel de UREA (cuando aplique)', required: false }]),
		fecha('fuec_vencimiento', 'Vencimiento del extracto de contrato (FUEC)'),
		entero('km_inicial', 'Kilometraje inicial', {
			required: true,
			validation: { min: 0, max: 5_000_000 }
		}),
		entero('km_final', 'Kilometraje final', {
			validation: { min: 0, max: 5_000_000 },
			helpText: 'Se diligencia al terminar el desplazamiento.'
		})
	])
}

/** Propiedad del cliente / usuarios. */
export function seccionPropiedadCliente(config: { platonLabel: string }): FormSectionDraft {
	return seccion(
		'propiedad_cliente',
		'Propiedad del cliente / usuarios',
		[
			opciones(
				'usuario_maletas',
				'¿El usuario lleva maletas?',
				[
					{ value: 'NO', label: 'No' },
					{ value: 'SI', label: 'Sí' }
				],
				{
					required: true,
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'usuario_maletas', operator: 'equals', value: 'SI' }],
						effect: { action: 'require', targetFieldKey: 'usuario_maletas_numero' }
					} satisfies Rule
				}
			),
			entero('usuario_maletas_numero', 'Número de maletas', {
				validation: { min: 1, max: 99 },
				visibilityRule: {
					version: 1,
					all: [{ fieldKey: 'usuario_maletas', operator: 'equals', value: 'SI' }],
					effect: { action: 'show', targetFieldKey: 'usuario_maletas_numero' }
				} satisfies Rule
			}),
			opciones(
				'equipaje_cabina',
				'¿El usuario lleva herramientas o equipaje de mano en cabina?',
				[
					{ value: 'NO', label: 'No' },
					{ value: 'SI', label: 'Sí' }
				],
				{ required: true }
			),
			opciones(
				'equipaje_platon',
				config.platonLabel,
				[
					{ value: 'NO', label: 'No' },
					{ value: 'SI', label: 'Sí' }
				],
				{ required: true }
			),
			opciones(
				'recomendaciones_equipaje',
				'¿Se asegura y se dan recomendaciones para resguardar el equipaje, herramientas o pertenencias?',
				[
					{ value: 'SI', label: 'Sí', color: 'emerald' },
					{ value: 'NO', label: 'No', color: 'red' }
				],
				{ required: true }
			),
			opciones(
				'novedades_equipaje',
				'¿Se presentan novedades por daño o pérdida de equipaje, herramientas o pertenencias?',
				[
					{ value: 'NO', label: 'No', color: 'emerald' },
					{ value: 'SI', label: 'Sí', color: 'red' }
				],
				{
					required: true,
					helpText: 'Si la respuesta es SÍ, informa a operaciones además de registrarlo aquí.',
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'novedades_equipaje', operator: 'equals', value: 'SI' }],
						effect: { action: 'require', targetFieldKey: 'novedades_equipaje_detalle' }
					} satisfies Rule
				}
			),
			textoLargo('novedades_equipaje_detalle', 'Detalle de la novedad de equipaje', {
				validation: { maxLength: 2000 },
				visibilityRule: {
					version: 1,
					all: [{ fieldKey: 'novedades_equipaje', operator: 'equals', value: 'SI' }],
					effect: { action: 'show', targetFieldKey: 'novedades_equipaje_detalle' }
				} satisfies Rule
			})
		],
		{ description: 'Control de la propiedad del cliente durante el servicio.' }
	)
}

/** Verificación al finalizar el desplazamiento + novedades + firma. */
export function seccionesCierre(config: { placaFinalLabel: string }): FormSectionDraft[] {
	return [
		seccion('novedades', 'Novedades', [
			opciones(
				'presenta_novedad',
				'¿Se presenta alguna observación o novedad?',
				[
					{ value: 'NO', label: 'No', color: 'emerald' },
					{ value: 'SI', label: 'Sí', color: 'amber' }
				],
				{
					required: true,
					helpText: 'Si la respuesta es SÍ, informa a operaciones además de registrarlo aquí.',
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'presenta_novedad', operator: 'equals', value: 'SI' }],
						effect: { action: 'require', targetFieldKey: 'novedad_detalle' }
					} satisfies Rule
				}
			),
			textoLargo('novedad_detalle', 'Detalle de la novedad', {
				validation: { maxLength: 4000 },
				visibilityRule: {
					version: 1,
					all: [{ fieldKey: 'presenta_novedad', operator: 'equals', value: 'SI' }],
					effect: { action: 'show', targetFieldKey: 'novedad_detalle' }
				} satisfies Rule
			}),
			...evidenciaFotografica('registro_visual', 'Registro visual del vehículo', {
				maxFiles: 8,
				helpText:
					'Documenta el estado del vehículo, especialmente cualquier daño o anomalía que hayas marcado como MALO.'
			})
		]),

		seccion(
			'cierre_desplazamiento',
			'Verificación al finalizar el desplazamiento',
			[
				...itemsBMNA([
					{
						key: 'final_vehiculo_condiciones',
						label: 'Vehículo en buenas condiciones (estado general, sin golpes, sin anomalías)'
					}
				]),
				opciones(
					'final_porta_placa',
					config.placaFinalLabel,
					[
						{ value: 'SI', label: 'Sí', color: 'emerald' },
						{ value: 'NO', label: 'No', color: 'red' }
					],
					{ required: true }
				),
				opciones(
					'final_equipaje_olvidado',
					'¿Se identifica equipaje u objetos de usuarios olvidados en el vehículo?',
					[
						{ value: 'NO', label: 'No', color: 'emerald' },
						{ value: 'SI', label: 'Sí', color: 'red' }
					],
					{
						required: true,
						helpText: 'Si la respuesta es SÍ, informa a operaciones.',
						visibilityRule: {
							version: 1,
							all: [{ fieldKey: 'final_equipaje_olvidado', operator: 'equals', value: 'SI' }],
							effect: { action: 'require', targetFieldKey: 'final_equipaje_detalle' }
						} satisfies Rule
					}
				),
				textoLargo('final_equipaje_detalle', 'Detalle de lo encontrado', {
					validation: { maxLength: 2000 },
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'final_equipaje_olvidado', operator: 'equals', value: 'SI' }],
						effect: { action: 'show', targetFieldKey: 'final_equipaje_detalle' }
					} satisfies Rule
				})
			],
			{
				description:
					'Se diligencia al terminar el recorrido. Si aún no has terminado, guarda el borrador y complétalo al final.'
			}
		),

		seccion('firma', 'Firma del conductor', [
			info(
				'firma_recordatorio',
				'Antes de firmar',
				'Si algún ítem quedó marcado como MALO, diligencia también el Reporte de Falla (HSEQ-FR-07) y notifica a mantenimiento por los canales habilitados.'
			),
			...declaracionFirma({
				declaracion:
					'Con mi firma doy fe de que he verificado la lista anterior y certifico que es seguro trabajar con este vehículo.',
				label: 'Firma del conductor',
				conIdentificacion: true
			})
		])
	]
}

export { ESCALA_B_M_NA, itemInspeccion, itemsBMNA }
