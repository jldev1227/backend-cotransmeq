/**
 * HSEQ-FR-05 — Inspección de botiquín.
 *
 * Es la semilla más larga en número de campos: 33 elementos × (cantidad +
 * vencimiento + estado + observación) ronda los 120 campos.
 *
 * Decisiones de transcripción:
 *
 *  - La `FECHA DE VENCIMIENTO` solo se pide en los elementos que caducan.
 *    Pedírsela para unas tijeras de trauma o un pito obliga al inspector a
 *    inventar un dato o a dejar 20 campos vacíos en cada inspección.
 *  - La sección «CAMBIOS O REPOSICIONES» del original repite la misma tabla en
 *    blanco: se transcribe como grupo REPETIBLE, no como 33 campos más. En la
 *    práctica se reponen dos o tres elementos, no treinta y tres.
 *  - La repetición horizontal de seis inspecciones del libro se normaliza como
 *    historial de envíos.
 */

import type { SeedDefinition } from './types'
import {
	declaracionFirma,
	entero,
	ESCALA_B_M_CR,
	evidenciaFotografica,
	fecha,
	identificacionInspector,
	itemInventario,
	ordenarSecciones,
	seccion,
	texto,
	textoLargo,
	ubicacionOVehiculo
} from './factories'
import type { Campo } from './factories'

/** `caduca: true` en los elementos con fecha de vencimiento real. */
const ELEMENTOS: { key: string; label: string; unidad: string; caduca?: boolean }[] = [
	{ key: 'gasas_esteriles', label: 'Gasas estériles', unidad: 'paquete por 6, mínimo 5 unidades', caduca: true },
	{ key: 'apositos', label: 'Apósitos o compresas no estériles', unidad: 'mínimo 2 unidades', caduca: true },
	{ key: 'esparadrapo', label: 'Esparadrapo de tela en rollo', unidad: 'preferible 4″, 1 unidad' },
	{ key: 'micropore', label: 'Micropore', unidad: '1 unidad' },
	{ key: 'bajalenguas', label: 'Bajalenguas', unidad: 'paquete × 20, 1 unidad' },
	{ key: 'aplicadores_algodon', label: 'Aplicadores de algodón', unidad: 'paquete × 20, 1 unidad' },
	{ key: 'curas', label: 'Curas', unidad: 'mínimo 5 unidades', caduca: true },
	{ key: 'parches_oculares', label: 'Parches oculares', unidad: 'mínimo 2 unidades', caduca: true },
	{ key: 'venda_elastica_2', label: 'Venda elástica 2" × 5 yardas', unidad: '1 unidad' },
	{ key: 'venda_elastica_3', label: 'Venda elástica 3" × 5 yardas', unidad: '1 unidad' },
	{ key: 'venda_elastica_5', label: 'Venda elástica 5" × 5 yardas', unidad: '1 unidad' },
	{ key: 'venda_algodon_3', label: 'Venda de algodón 3" × 5 yardas', unidad: '1 unidad' },
	{ key: 'venda_algodon_5', label: 'Venda de algodón 5" × 5 yardas', unidad: '1 unidad' },
	{ key: 'venda_triangular', label: 'Venda triangular', unidad: '1 unidad' },
	{
		key: 'clorhexidina',
		label: 'Clorhexidina o yodopovidona (jabón quirúrgico)',
		unidad: '1 unidad',
		caduca: true
	},
	{ key: 'solucion_salina', label: 'Solución salina 250 cc o 500 cc', unidad: '1 unidad', caduca: true },
	{
		key: 'suero_oral',
		label: 'Suero oral o sal de rehidratación',
		unidad: 'mínimo 1 unidad',
		caduca: true
	},
	{
		key: 'alcohol_antiseptico',
		label: 'Alcohol antiséptico en frasco',
		unidad: 'preferible 275 ml, 1 unidad',
		caduca: true
	},
	{ key: 'guantes_latex', label: 'Guantes de látex para examen', unidad: 'mínimo 3 pares', caduca: true },
	{ key: 'tapabocas', label: 'Tapabocas', unidad: 'mínimo 3 unidades', caduca: true },
	{ key: 'termometro', label: 'Termómetro', unidad: '1 unidad' },
	{ key: 'tijeras_trauma', label: 'Tijeras de trauma', unidad: '1 unidad' },
	{ key: 'collar_cervical', label: 'Collar cervical', unidad: '1 unidad' },
	{
		key: 'inmovilizadores',
		label: 'Inmovilizadores o férula maleable para miembros superiores e inferiores',
		unidad: '1 unidad'
	},
	{
		key: 'mascara_rcp',
		label: 'Elemento de barrera o máscara para RCP',
		unidad: '1 unidad',
		caduca: true
	},
	{
		key: 'linterna',
		label: 'Linterna recargable o con pilas de repuesto',
		unidad: '1 unidad'
	},
	{ key: 'pito', label: 'Pito / silbato', unidad: '1 unidad' },
	{ key: 'libreta_esfero', label: 'Libreta y esfero', unidad: '1 unidad' },
	{ key: 'bolsas_rojas', label: 'Bolsas rojas', unidad: '1 unidad' },
	{ key: 'manual_primeros_auxilios', label: 'Manual de primeros auxilios', unidad: '1 unidad' },
	{ key: 'botella_agua', label: 'Botella de agua', unidad: '1 unidad', caduca: true },
	{ key: 'gel_antibacterial', label: 'Gel antibacterial (opcional)', unidad: '1 unidad', caduca: true }
]

/** Reposiciones como grupo repetible: se reponen dos o tres, no treinta y tres. */
const REPOSICIONES: Campo = {
	key: 'reposiciones',
	type: 'REPEATABLE_GROUP',
	label: 'Cambios o reposiciones realizadas',
	helpText:
		'Agrega una fila por cada elemento que hubo que reponer o cambiar. Si no hubo ninguno, deja el grupo vacío.',
	placeholder: null,
	required: false,
	config: {},
	validation: { maxRows: 40 },
	visibilityRule: null,
	defaultValue: null,
	children: [
		texto('reposicion_elemento', 'Elemento repuesto o cambiado', {
			required: true,
			validation: { maxLength: 200 }
		}),
		entero('reposicion_cantidad', 'Cantidad repuesta', {
			required: true,
			validation: { min: 1, max: 999 }
		}),
		fecha('reposicion_vencimiento', 'Fecha de vencimiento del elemento nuevo'),
		texto('reposicion_responsable', 'Quién lo repuso', { validation: { maxLength: 150 } })
	]
}

export const hseqFr05: SeedDefinition = {
	code: 'HSEQ-FR-05',
	slug: 'inspeccion-de-botiquin',
	name: 'Inspección de botiquín',
	description:
		'Inventario de los 33 elementos del botiquín con cantidad, vencimiento y estado B/M/C-R, más reposiciones realizadas.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'MONTHLY',
		limitPolicy: 'ONE_PER_CONTEXT',
		context: { vehicleId: { required: false } },
		rationale:
			'Mensual por vehículo o sede. El vehículo no se marca requerido porque hay botiquines de instalación fija; el propio formulario pregunta dónde está.'
	},

	source: {
		sourceFile: 'HSEQ-FR-05, Inspección de Botiquin V2.xlsx',
		sourceCode: 'HSEQ-FR-05',
		sourceRevision: '2',
		sourceDate: '2022-04-18',
		sourceSheet: 'Hoja1',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'La fecha de vencimiento solo se pide en los elementos que caducan (gasas, sueros, alcohol, guantes…). El original la pide para los 33, incluidas tijeras y pito. HSEQ debe confirmar la lista de elementos con caducidad.',
		'La sección «Cambios o reposiciones» del original repite la tabla completa en blanco; se transcribió como grupo repetible en vez de 33 campos más.',
		'La escala del original es B / M / C-R (bueno, malo, cambiar-reemplazar). Se conservó tal cual.',
		'El elemento «Estado general e higiene de la maleta del botiquín» del original no es un elemento inventariable; se transcribió como ítem de estado sin cantidad.',
		'La repetición horizontal de seis inspecciones del libro se normaliza como historial de envíos.',
		'Este formulario supera los 100 campos. Conviene probarlo en un teléfono de gama baja antes de publicarlo.'
	],

	version: {
		title: 'Inspección de botiquín',
		description: null,
		instructions:
			'Para cada elemento registra la cantidad existente, la fecha de vencimiento cuando aplique, y marca su estado: Bueno, Malo o Cambiar/Reemplazar. Un estado negativo exige observación.',
		settings: {},
		sections: ordenarSecciones([
			seccion('identificacion', 'Identificación de la inspección', [
				ubicacionOVehiculo(),
				identificacionInspector({ conLugar: true })
			]),

			seccion(
				'inventario',
				'Inventario del botiquín',
				ELEMENTOS.map((e) =>
					itemInventario(e.key, e.label, e.unidad, ESCALA_B_M_CR, {
						conVencimiento: Boolean(e.caduca),
						conCantidad: true
					})
				),
				{ description: 'Cantidad encontrada, vencimiento cuando aplique, y estado.' }
			),

			seccion('maleta', 'Estado de la maleta', [
				/// Sin cantidad: la maleta no se inventaría, se evalúa.
				itemInventario('maleta_botiquin', 'Estado general e higiene de la maleta del botiquín', 'n/a', ESCALA_B_M_CR, {
					conCantidad: false
				})
			]),

			seccion('reposiciones', 'Cambios o reposiciones', [REPOSICIONES]),

			seccion('observaciones', 'Observaciones y registro visual', [
				textoLargo('observaciones_generales', 'Observaciones', { validation: { maxLength: 4000 } }),
				evidenciaFotografica('registro_visual', 'Registro visual del botiquín', { maxFiles: 6 })
			]),

			seccion('cierre', 'Cierre y firma', [
				declaracionFirma({
					declaracion:
						'Certifico que la información registrada corresponde al contenido y estado real del botiquín inspeccionado.',
					conIdentificacion: true
				})
			])
		])
	}
}
