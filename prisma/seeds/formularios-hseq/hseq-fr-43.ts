/**
 * HSEQ-FR-43 — Inspección ambiental.
 *
 * Cinco bloques de criterios C/NC/NA, cada uno con recomendación cuando el
 * resultado es `NC`.
 *
 * Decisiones de transcripción:
 *
 *  - Los cinco bloques del original se transcriben como CINCO SECCIONES. En el
 *    papel son subtítulos dentro de una tabla; como secciones, el conductor avanza
 *    por bloques en el teléfono en vez de recorrer una lista de treinta ítems.
 *  - El original llama «RECOMENDACIONES» a la columna de texto; se conserva ese
 *    término en la etiqueta de la observación en vez de «Observación».
 *  - Hay dos ítems repetidos literalmente en el original («No se observa goteo de
 *    agua en las llaves» aparece en los bloques 1 y 2). Se conservan los dos con
 *    claves distintas y queda como warning: el validador los reportaría como
 *    etiqueta duplicada, que es exactamente el aviso que HSEQ necesita.
 */

import type { SeedDefinition } from './types'
import {
	declaracionFirma,
	ESCALA_C_NC_NA,
	evidenciaFotografica,
	hallazgoPlanAccion,
	identificacionInspector,
	itemInspeccion,
	ordenarSecciones,
	seccion
} from './factories'

/** Ítem con la observación etiquetada como «Recomendación», como el original. */
function itemAmbiental(key: string, label: string) {
	return itemInspeccion(key, label, ESCALA_C_NC_NA, {
		required: true,
		observacionLabel: `Recomendación — ${label}`
	})
}

const BLOQUE_1 = [
	{
		key: 'aspectos_identificados',
		label:
			'Están identificados todos los aspectos e impactos ambientales de la zona en la Matriz de Aspectos e Impactos Ambientales'
	},
	{
		key: 'aspectos_terceros',
		label:
			'Existen aspectos ambientales significativos que no puedan ser controlados por la empresa y dependan de un tercero (cliente, proveedor, comunidad, etc.)'
	},
	{ key: 'goteo_llaves_generalidades', label: 'No se observa goteo de agua en las llaves' },
	{ key: 'computadores', label: 'Los computadores están encendidos cuando es necesario' },
	{ key: 'luces', label: 'Las luces están prendidas cuando es necesario' },
	{
		key: 'kit_ambiental',
		label:
			'El kit ambiental se encuentra completo: balde, bolsas rojas para residuos, pala plástica, estopa, aserrín, guantes de nitrilo, gafas de seguridad, tapabocas, chaleco reflectivo, cinta de señalizar'
	}
]

const BLOQUE_2 = [
	{
		key: 'zona_lejos_agua',
		label:
			'La zona de almacenamiento de residuos sólidos está lejos de cuerpos de agua, sistemas de alcantarillado o sumideros de aguas lluvias'
	},
	{
		key: 'separacion_correcta',
		label:
			'Los residuos han sido separados y clasificados correctamente acorde al tipo de cesta (de acuerdo a los colores establecidos)'
	},
	{
		key: 'recipientes_proximos',
		label: 'Los recipientes para recolección están próximos y accesibles a los lugares de trabajo'
	},
	{
		key: 'recipientes_estado',
		label:
			'Las canecas, bolsas o recipientes para almacenamiento de residuos están en buen estado, no presentan deterioro y son acordes a los colores establecidos'
	},
	{
		key: 'separacion_fuente',
		label: 'Se hace recolección de los residuos y se aplica una adecuada separación en la fuente en el área'
	},
	{
		key: 'areas_limpias',
		label: 'Las áreas alrededor de los recipientes de recolección están o permanecen limpias'
	},
	{ key: 'goteo_llaves_solidos', label: 'No se observa goteo de agua en las llaves' },
	{
		key: 'personal_consciente_solidos',
		label:
			'El personal es consciente de la clasificación de los residuos y de cómo debe manejarlos y disponerlos parcialmente'
	}
]

const BLOQUE_3 = [
	{
		key: 'liquidos_separados',
		label: 'Están separados los residuos líquidos de los sólidos (no se mezclan)'
	},
	{
		key: 'contenedores_liquidos',
		label: 'Los contenedores de los residuos líquidos están en buen estado, no existen fugas'
	},
	{
		key: 'barrera_contencion',
		label: 'Existe barrera para contención de residuos líquidos y se encuentra en buen estado'
	},
	{
		key: 'personal_capacitado_liquidos',
		label:
			'El personal está capacitado y es consciente del manejo que debe darle a los residuos líquidos'
	},
	{
		key: 'zona_liquidos_sumideros',
		label:
			'La zona de almacenamiento de residuos líquidos está lejos de sumideros de aguas lluvias, o los sumideros tienen las barreras correspondientes'
	},
	{
		key: 'pisos_liquidos',
		label:
			'Los pisos de la zona de almacenamiento parcial de residuos líquidos no presentan grietas o están protegidos de forma que no generen contaminación del suelo'
	}
]

const BLOQUE_4 = [
	{
		key: 'barreras_derrames',
		label:
			'Las actividades donde se generan residuos líquidos poseen barreras de protección que permitan contener derrames'
	},
	{
		key: 'quimicos_almacenados',
		label:
			'Los productos químicos son almacenados correctamente, no existen fugas ni están almacenados cerca de focos de incendio'
	}
]

const BLOQUE_5 = [
	{
		key: 'hojas_seguridad',
		label: 'Se poseen hojas de seguridad de todos los productos químicos que se manejan en el área'
	},
	{
		key: 'personal_conoce_hojas',
		label:
			'El personal conoce las hojas de seguridad y es consciente de la importancia de las mismas'
	},
	{
		key: 'ventilacion_quimicos',
		label:
			'Los productos químicos están almacenados en un lugar con ventilación natural y/o forzada, y existen barreras para su almacenamiento'
	},
	{
		key: 'quimicos_lejos_chispas',
		label: 'Los productos químicos están separados de elementos o equipos que puedan generar chispas'
	},
	{
		key: 'instalaciones_electricas',
		label:
			'Las instalaciones eléctricas de las zonas de almacenamiento de químicos están en buen estado'
	},
	{ key: 'sin_derrames', label: 'No existen derrames de sustancias químicas' },
	{
		key: 'recipientes_rotulados',
		label: 'Los recipientes que contienen productos químicos se encuentran rotulados'
	}
]

export const hseqFr43: SeedDefinition = {
	code: 'HSEQ-FR-43',
	slug: 'inspeccion-ambiental',
	name: 'Inspección ambiental',
	description:
		'Impactos y generalidades, residuos sólidos, residuos líquidos, vertimientos y químicos. Cada «No cumple» exige recomendación.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'MONTHLY',
		limitPolicy: 'ONE_PER_PERIOD',
		context: {},
		rationale: 'Mensual por sede; la sede se deriva del target de la asignación.'
	},

	source: {
		sourceFile: 'HSEQ-FR-43, Inspección Ambiental. V1.xlsx',
		sourceCode: 'HSEQ-FR-43',
		sourceRevision: '1',
		sourceDate: '2022-07-17',
		sourceSheet: 'INS AMBIENTAL ',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'El ítem «No se observa goteo de agua en las llaves» aparece DOS VECES en el original (bloques 1 y 2). Se conservaron los dos con claves distintas; el validador lo reporta como etiqueta duplicada. HSEQ debe decidir si eliminar uno.',
		'El bloque 3 se titula «MANEJO DE RESIDUOS SOLIDOS LIQUIDOS» en el original, que parece una errata por «RESIDUOS LÍQUIDOS». Se transcribió como «Manejo de residuos líquidos».',
		'El bloque 5 se titula «MANEJO DE RESIDUOS SOLIDOS (QUÍMICOS)» pero sus criterios son de almacenamiento de químicos, no de residuos. Se transcribió como «Manejo de productos químicos».',
		'Las seis columnas de inspección en paralelo del Excel se convierten en seis envíos mensuales independientes.',
		'El original no incluye un plan de acción formal; se añadió el grupo repetible de hallazgos para poder registrar las recomendaciones con responsable y fecha. HSEQ debe confirmar si lo quiere.'
	],

	version: {
		title: 'Inspección ambiental',
		description: null,
		instructions:
			'Evalúa cada criterio: Cumple, No cumple o No aplica. Un «No cumple» exige la recomendación correspondiente.',
		settings: {},
		sections: ordenarSecciones([
			seccion('identificacion', 'Identificación de la inspección', [
				identificacionInspector({ conLugar: true })
			]),
			seccion(
				'impactos_generalidades',
				'1. Impactos ambientales / generalidades',
				BLOQUE_1.map((i) => itemAmbiental(i.key, i.label))
			),
			seccion(
				'residuos_solidos',
				'2. Manejo de residuos sólidos',
				BLOQUE_2.map((i) => itemAmbiental(i.key, i.label))
			),
			seccion(
				'residuos_liquidos',
				'3. Manejo de residuos líquidos',
				BLOQUE_3.map((i) => itemAmbiental(i.key, i.label))
			),
			seccion(
				'vertimientos',
				'4. Vertimientos',
				BLOQUE_4.map((i) => itemAmbiental(i.key, i.label))
			),
			seccion(
				'quimicos',
				'5. Manejo de productos químicos',
				BLOQUE_5.map((i) => itemAmbiental(i.key, i.label))
			),
			seccion('evidencia', 'Registro visual', [
				evidenciaFotografica('registro_visual', 'Registro visual', { maxFiles: 8 })
			]),
			seccion('hallazgos', 'Hallazgos y recomendaciones', [
				hallazgoPlanAccion('hallazgos', 'Hallazgos y recomendaciones', {
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
