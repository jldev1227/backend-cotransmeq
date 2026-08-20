/**
 * HSEQ-FR-56 — Acta de entrega y/o recibo de vehículo tractocamión.
 *
 * Decisiones de transcripción:
 *
 *  - Las NUEVE observaciones numeradas del original (1) a 9)) se transcriben como
 *    UN grupo repetible, no como nueve campos. En el papel son nueve renglones
 *    porque el papel obliga; una entrega puede tener ninguna observación o quince.
 *  - El inventario del botiquín reutiliza la lista de FR-05 pero con la escala del
 *    original de FR-56 (B / M / C) y SIN fecha de vencimiento: el acta verifica
 *    presencia y estado, no caducidad.
 *  - La caja de herramientas es un grupo repetible: el original deja el espacio en
 *    blanco para «inventariar kit o caja de herramientas o demás elementos no
 *    incluidos en el listado anterior», que es literalmente un repetible.
 *  - Dos firmas independientes: entrega y recibe.
 */

import type { SeedDefinition } from './types'
import {
	contextoVehiculo,
	entero,
	ESCALA_B_M_R,
	evidenciaFotografica,
	fecha,
	firmasEntregaRecibe,
	info,
	itemsBMNA,
	itemInspeccion,
	ordenarSecciones,
	opciones,
	seccion,
	texto,
	textoLargo
} from './factories'
import type { Campo } from './factories'

/** Ítems con escala B/M/R, la del original de este formato. */
function itemsBMR(items: { key: string; label: string }[]): Campo[] {
	return items.flatMap((i) => itemInspeccion(i.key, i.label, ESCALA_B_M_R, { required: true }))
}

const MOTOR = [
	{ key: 'motor_aceite', label: 'Nivel de aceite' },
	{ key: 'motor_refrigerante', label: 'Nivel de refrigerante / agua' },
	{ key: 'motor_liquido_frenos', label: 'Nivel de líquido de frenos' },
	{ key: 'motor_direccion_hidraulica', label: 'Nivel de líquido de dirección hidráulica' },
	{ key: 'motor_agua_bateria', label: 'Nivel de agua de la batería' },
	{ key: 'motor_liquido_clutch', label: 'Nivel de líquido de clutch' },
	{ key: 'motor_agua_parabrisas', label: 'Nivel de agua del parabrisas' },
	{ key: 'motor_fugas', label: 'Fugas de líquidos' },
	{ key: 'motor_cables', label: 'Conexiones de cables' },
	{ key: 'motor_mangueras', label: 'Estado de mangueras y correas' },
	{ key: 'motor_capo', label: 'Capó o tapa de la cabina' }
]

const LUCES = [
	{ key: 'luces_altas', label: 'Luces altas' },
	{ key: 'luces_bajas', label: 'Luces bajas' },
	{ key: 'luces_exploradoras', label: 'Exploradoras' },
	{ key: 'luces_dir_derecha', label: 'Direccionales derechas' },
	{ key: 'luces_dir_izquierda', label: 'Direccionales izquierdas' },
	{ key: 'luces_reversa', label: 'Luces de reversa' },
	{ key: 'luces_freno', label: 'Luces de freno' },
	{ key: 'luces_tercer_stop', label: 'Tercer stop' }
]

const LLANTAS = [
	{ key: 'llantas_delanteras', label: 'Llantas delanteras (estado físico / presión)' },
	{ key: 'llantas_traseras', label: 'Llantas traseras (estado físico / presión)' },
	{ key: 'llantas_pernos', label: 'Pernos completos' },
	{ key: 'llantas_repuesto', label: 'Llanta de repuesto / rin' }
]

const TABLERO = [
	{ key: 'tablero_velocimetro', label: 'Indicador velocímetro' },
	{ key: 'tablero_luces', label: 'Indicadores de luces' },
	{ key: 'tablero_combustible', label: 'Indicador de combustible' },
	{ key: 'tablero_temperatura', label: 'Indicador de temperatura' },
	{ key: 'tablero_cinturones', label: 'Indicador de cinturones de seguridad' },
	{ key: 'tablero_revoluciones', label: 'Indicador de revoluciones' },
	{ key: 'tablero_presion_aire', label: 'Indicador de presión de aire' },
	{ key: 'tablero_odometro', label: 'Odómetro' }
]

const PRUEBAS = [
	{ key: 'prueba_palanca', label: 'Palanca de cambios' },
	{ key: 'prueba_volante', label: 'Volante (dirección)' },
	{ key: 'prueba_frenos', label: 'Frenos: prueba de frenado' },
	{ key: 'prueba_arranque', label: 'Arranque' },
	{ key: 'prueba_clutch', label: 'Clutch' },
	{ key: 'prueba_acelerador', label: 'Acelerador' }
]

const CABINA = [
	{ key: 'cabina_apoyacabezas', label: 'Apoyacabezas para todas las sillas' },
	{ key: 'cabina_espejo_retroceso', label: 'Espejo de retroceso' },
	{ key: 'cabina_alarma_retroceso', label: 'Alarma de retroceso' },
	{ key: 'cabina_vidrios', label: 'Vidrios y ventanas' },
	{ key: 'cabina_freno_ahogo', label: 'Freno de ahogo' },
	{ key: 'cabina_elevavidrios', label: 'Elevavidrios' },
	{ key: 'cabina_seguro_puertas', label: 'Seguro de puertas' },
	{ key: 'cabina_freno_mano', label: 'Freno de mano o de emergencia' },
	{ key: 'cabina_pisos', label: 'Estado de los pisos, libres de obstáculos' },
	{ key: 'cabina_elementos_sujetos', label: 'Presencia de elementos sin sujetar o asegurar' },
	{ key: 'cabina_pito', label: 'Pito' },
	{ key: 'cabina_luz_techo', label: 'Luz de techo' },
	{ key: 'cabina_posicion_asiento', label: 'Posición del asiento del conductor' },
	{ key: 'cabina_alarma', label: 'Alarma' },
	{
		key: 'cabina_cinturones',
		label: 'Cinturones de seguridad para todos los puestos, descubiertos y de fácil acceso'
	}
]

const EXTERIOR = [
	{ key: 'ext_pintura', label: 'Pintura' },
	{ key: 'ext_golpes', label: 'Golpes' },
	{ key: 'ext_espejos', label: 'Espejos' },
	{ key: 'ext_barra_antivuelco', label: 'Barra antivuelco' },
	{ key: 'ext_aviso_velocidad', label: 'Aviso de velocidad máxima' },
	{ key: 'ext_aviso_como_conduzco', label: 'Aviso de «¿Cómo conduzco?»' },
	{ key: 'ext_panoramicos', label: 'Panorámicos' },
	{ key: 'ext_plumillas', label: 'Plumillas' },
	{ key: 'ext_radio', label: 'Radio' },
	{ key: 'ext_logos', label: 'Logos' },
	{ key: 'ext_mandos', label: 'Mandos' },
	{ key: 'ext_pala_antichispas', label: 'Pala antichispas' }
]

/** Botiquín del acta: presencia y estado, sin fecha de vencimiento. */
const BOTIQUIN = [
	{ key: 'bot_gasas', label: 'Gasas estériles (paquete, mínimo 5 und)' },
	{ key: 'bot_apositos', label: 'Apósitos o compresas no estériles (mínimo 2 und)' },
	{ key: 'bot_esparadrapo', label: 'Esparadrapo de tela en rollo (preferible 4″)' },
	{ key: 'bot_micropore', label: 'Micropore' },
	{ key: 'bot_bajalenguas', label: 'Bajalenguas (paquete × 20)' },
	{ key: 'bot_aplicadores', label: 'Aplicadores de algodón (paquete × 20)' },
	{ key: 'bot_curas', label: 'Curas (mínimo 5 und)' },
	{ key: 'bot_parches', label: 'Parches oculares (mínimo 2 und)' },
	{ key: 'bot_venda_el_2', label: 'Venda elástica 2" × 5 yardas' },
	{ key: 'bot_venda_el_3', label: 'Venda elástica 3" × 5 yardas' },
	{ key: 'bot_venda_el_5', label: 'Venda elástica 5" × 5 yardas' },
	{ key: 'bot_venda_alg_3', label: 'Venda de algodón 3" × 5 yardas' },
	{ key: 'bot_venda_alg_5', label: 'Venda de algodón 5" × 5 yardas' },
	{ key: 'bot_venda_triangular', label: 'Venda triangular' },
	{ key: 'bot_clorhexidina', label: 'Clorhexidina o yodopovidona (jabón quirúrgico)' },
	{ key: 'bot_solucion_salina', label: 'Solución salina 250 cc o 500 cc' },
	{ key: 'bot_suero_oral', label: 'Suero oral o sal de rehidratación' },
	{ key: 'bot_alcohol', label: 'Alcohol antiséptico (preferible 275 ml)' },
	{ key: 'bot_guantes', label: 'Guantes de látex para examen (mínimo 3 pares)' },
	{ key: 'bot_tapabocas', label: 'Tapabocas (mínimo 3 und)' },
	{ key: 'bot_termometro', label: 'Termómetro' },
	{ key: 'bot_tijeras', label: 'Tijeras de trauma' },
	{ key: 'bot_collar', label: 'Collar cervical' },
	{ key: 'bot_inmovilizadores', label: 'Inmovilizadores o férula maleable' },
	{ key: 'bot_mascara_rcp', label: 'Elemento de barrera o máscara para RCP' },
	{ key: 'bot_linterna', label: 'Linterna recargable o con pilas de repuesto' },
	{ key: 'bot_pito', label: 'Pito / silbato' },
	{ key: 'bot_libreta', label: 'Libreta y esfero' },
	{ key: 'bot_bolsas_rojas', label: 'Bolsas rojas' },
	{ key: 'bot_manual', label: 'Manual de primeros auxilios' },
	{ key: 'bot_botella_agua', label: 'Botella de agua' },
	{ key: 'bot_gel', label: 'Gel antibacterial (opcional)' },
	{ key: 'bot_maleta', label: 'Estado general e higiene de la maleta del botiquín' }
]

const OBSERVACIONES: Campo = {
	key: 'observaciones_entrega',
	type: 'REPEATABLE_GROUP',
	label: 'Observaciones de la entrega',
	helpText:
		'Agrega una fila por cada observación. El formato impreso deja nueve renglones porque el papel obliga; aquí puedes registrar las que hagan falta.',
	placeholder: null,
	required: false,
	config: {},
	validation: { maxRows: 30 },
	visibilityRule: null,
	defaultValue: null,
	children: [
		textoLargo('observacion_texto', 'Observación', {
			required: true,
			validation: { maxLength: 2000 }
		})
	]
}

const HERRAMIENTAS: Campo = {
	key: 'inventario_herramientas',
	type: 'REPEATABLE_GROUP',
	label: 'Inventario de kit o caja de herramientas y otros elementos',
	helpText:
		'Espacio para inventariar los elementos no incluidos en los listados anteriores. Una fila por elemento.',
	placeholder: null,
	required: false,
	config: {},
	validation: { maxRows: 60 },
	visibilityRule: null,
	defaultValue: null,
	children: [
		texto('herramienta_descripcion', 'Descripción', {
			required: true,
			validation: { maxLength: 200 }
		}),
		entero('herramienta_cantidad', 'Cantidad', { required: true, validation: { min: 1, max: 999 } }),
		opciones(
			'herramienta_estado',
			'Estado',
			[
				{ value: 'B', label: 'Bueno', color: 'emerald' },
				{ value: 'M', label: 'Malo', color: 'red' },
				{ value: 'R', label: 'Regular', color: 'amber' }
			],
			{ required: true }
		)
	]
}

export const hseqFr56: SeedDefinition = {
	code: 'HSEQ-FR-56',
	slug: 'acta-entrega-recibo-tractocamion',
	name: 'Acta de entrega y/o recibo de vehículo tractocamión',
	description:
		'Acta de entrega o recibo con checklists por sistema, inventario de botiquín y herramientas, registro visual y firmas de las dos partes.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'ONCE',
		limitPolicy: 'ONE_PER_CONTEXT',
		context: { vehicleId: { required: true } },
		rationale:
			'Por entrega y vehículo. `ONCE` con `ONE_PER_CONTEXT` y vehículo requerido: cada entrega es un acta, y la asignación se crea para esa entrega concreta.'
	},

	source: {
		sourceFile: 'HSEQ-FR-56, Acta de Entrega de Vehículos Tractocamion.V1.xlsx',
		sourceCode: 'HSEQ-FR-56',
		sourceRevision: '2',
		sourceDate: '2024-07-10',
		sourceSheet: 'Hoja1',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'DISCREPANCIA DE VERSIÓN: el nombre del archivo dice «V1» y el encabezado interno dice «Versión 2 / 2024-07-10». Se conservó la del encabezado.',
		'Las nueve observaciones numeradas del original se transcribieron como UN grupo repetible, no como nueve campos fijos.',
		'El botiquín de este acta usa la escala B/M/C del original y NO pide fecha de vencimiento: el acta verifica presencia y estado, no caducidad. La inspección de caducidad es HSEQ-FR-05.',
		'El original marca «BOTIQUÍN SI__ NO__» y «HERRAMIENTA SI__ NO__» como casillas previas a cada inventario; se transcribieron como preguntas que condicionan el inventario correspondiente.',
		'El extintor del original solo pide capacidad y mes de vencimiento (no un checklist). Se transcribió así; la inspección completa del extintor es HSEQ-FR-04.',
		'Este formulario supera los 150 campos. Probarlo en un teléfono de gama baja antes de publicarlo.'
	],

	version: {
		title: 'Acta de entrega y/o recibo de vehículo tractocamión',
		description: null,
		instructions:
			'El vehículo se revisa por las dos partes a entera satisfacción. Marca el estado de cada elemento, inventaría el botiquín y las herramientas, toma el registro visual y firmen ambas partes.',
		settings: {},
		sections: ordenarSecciones([
			seccion('acta', 'Datos del acta', [
				texto('sede_lugar', 'Sede / lugar', { required: true, validation: { maxLength: 150 } }),
				fecha('fecha_acta', 'Fecha del acta', { required: true }),
				opciones(
					'tipo_acta',
					'Tipo de acta',
					[
						{ value: 'ENTREGA', label: 'Entrega' },
						{ value: 'RECIBO', label: 'Recibo' }
					],
					{ required: true }
				)
			]),

			seccion('vehiculo', 'Datos del vehículo', [
				contextoVehiculo({ required: true, conKilometraje: true }),
				texto('vehiculo_tipo', 'Tipo', { validation: { maxLength: 100 } }),
				texto('vehiculo_color', 'Color', { validation: { maxLength: 60 } }),
				texto('vehiculo_chasis', 'N° de chasis', { validation: { maxLength: 60 } }),
				texto('vehiculo_motor', 'N° de motor', { validation: { maxLength: 60 } }),
				texto('vehiculo_capacidad', 'Capacidad', { validation: { maxLength: 60 } }),
				texto('propietario_nombre', 'Propietario', { validation: { maxLength: 200 } }),
				texto('propietario_documento', 'C.C. / NIT del propietario', { validation: { maxLength: 30 } }),
				fecha('soat_vencimiento', 'Vencimiento del SOAT'),
				fecha('tecnomecanica_vencimiento', 'Vencimiento de tecnomecánica y emisión de gases')
			]),

			seccion('declaracion', 'Declaración', [
				info(
					'declaracion_acta',
					'Condiciones de la entrega',
					'El vehículo será ensayado y revisado por las partes a entera satisfacción. A partir de la fecha quedará bajo la responsabilidad de quien lo recibe, que se compromete a velar por su conservación, buen funcionamiento mecánico y mantenimiento, óptimas condiciones de aseo y presentación, y a hacer uso prudente del mismo exclusivamente en actividades misionales de TRANSMERALDA S.A.S. ZOMAC. Debe ser devuelto en iguales condiciones. El vehículo se entrega con los accesorios y elementos que se relacionan a continuación.'
				)
			]),

			seccion('motor', 'Motor', itemsBMR(MOTOR)),
			seccion('luces', 'Luces', itemsBMR(LUCES)),
			seccion('llantas', 'Llantas', itemsBMR(LLANTAS)),
			seccion('tablero', 'Tablero e indicadores', itemsBMR(TABLERO)),
			seccion('pruebas', 'Pruebas', itemsBMR(PRUEBAS)),
			seccion('cabina', 'Cabina', itemsBMR(CABINA)),
			seccion('exterior', 'Exterior y otros', itemsBMR(EXTERIOR)),

			seccion('limpieza', 'Limpieza, orden y aseo', [
				itemsBMNA([
					{
						key: 'condiciones_limpieza',
						label: 'Condiciones generales de limpieza, orden y aseo'
					}
				])
			]),

			seccion('extintor', 'Extintor', [
				entero('extintor_capacidad', 'Capacidad del extintor (libras)', {
					validation: { min: 1, max: 500 }
				}),
				fecha('extintor_mes_vencimiento', 'Vencimiento del extintor'),
				info(
					'extintor_nota',
					'Alcance de esta verificación',
					'Aquí solo se registran capacidad y vencimiento, como en el formato original. La inspección completa del extintor es el formato HSEQ-FR-04.'
				)
			]),

			seccion(
				'botiquin',
				'Botiquín de primeros auxilios',
				[
					opciones(
						'botiquin_presente',
						'¿El vehículo lleva botiquín?',
						[
							{ value: 'SI', label: 'Sí', color: 'emerald' },
							{ value: 'NO', label: 'No', color: 'red' }
						],
						{ required: true }
					),
					BOTIQUIN.map((b) =>
						itemInspeccion(b.key, b.label, ESCALA_B_M_R, { required: false })
					).flat()
				],
				{ description: 'Presencia y estado de los elementos. La caducidad se revisa en HSEQ-FR-05.' }
			),

			seccion('herramientas', 'Kit o caja de herramientas', [
				opciones(
					'herramientas_presente',
					'¿El vehículo lleva kit o caja de herramientas?',
					[
						{ value: 'SI', label: 'Sí', color: 'emerald' },
						{ value: 'NO', label: 'No', color: 'red' }
					],
					{ required: true }
				),
				HERRAMIENTAS
			]),

			seccion('registro_visual', 'Registro visual del vehículo', [
				evidenciaFotografica('registro_visual', 'Fotografías del vehículo', {
					maxFiles: 12,
					helpText:
						'Documenta el estado del vehículo por los cuatro costados, el interior y cualquier daño existente.'
				})
			]),

			seccion('observaciones', 'Observaciones', [OBSERVACIONES]),

			seccion('firmas', 'Firmas', firmasEntregaRecibe())
		])
	}
}
