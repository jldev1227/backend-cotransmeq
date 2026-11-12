/**
 * HSEQ-FR-17 — Inspección de férula espinal larga (FEL) / camilla.
 *
 * Decisiones de transcripción:
 *
 *  - El original imprime diez renglones y solo ocho tienen texto: las filas 9 y 10
 *    están vacías. NO se transcriben como campos sin etiqueta; los hallazgos
 *    adicionales van al grupo repetible del final, que es para lo que sirve.
 *  - Las seis columnas de inspección en paralelo del Excel son seis inspecciones
 *    distintas: cada una es un envío.
 */

import type { SeedDefinition } from './types'
import {
	declaracionFirma,
	evidenciaFotografica,
	hallazgoPlanAccion,
	identificacionInspector,
	itemsCNCNA,
	ordenarSecciones,
	seccion,
	ubicacionOVehiculo
} from './factories'

const ELEMENTOS = [
	{
		key: 'ubicacion_acceso',
		label: 'Ubicación y acceso: instalación (sitio de ubicación) y de fácil acceso'
	},
	{ key: 'senalizacion', label: 'Señalización' },
	{
		key: 'arnes_reflectivo',
		label: 'Arnés / riata ajustable reflectivo con 5 puntos de sujeción'
	},
	{ key: 'arnes_integridad', label: 'Arnés / riata sin roturas ni descosidas' },
	{
		key: 'protector_camilla',
		label: 'Protector de camilla / protección externa para garantizar su vida útil'
	},
	{ key: 'manijas', label: 'Manijas / asas para cargue o sujeción en buen estado' },
	{ key: 'tabla', label: 'Tabla en buen estado de limpieza y sin fisuras' },
	{ key: 'inmovilizador_cabeza', label: 'Inmovilizador de cabeza / tipo bloque' }
]

export const hseqFr17: SeedDefinition = {
	code: 'HSEQ-FR-17',
	slug: 'inspeccion-ferula-espinal-camilla',
	name: 'Inspección férula espinal larga (FEL) / camilla',
	description:
		'Verificación del estado de la camilla y su arnés, con observaciones por ítem y condiciones de seguridad identificadas.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'MONTHLY',
		limitPolicy: 'ONE_PER_CONTEXT',
		context: { vehicleId: { required: false } },
		rationale:
			'Mensual por vehículo o sede. La placa se pide en la rama de vehículo y el campo de sede en la rama de instalación fija; ninguna asignación debe exigir vehículo para todos los envíos.'
	},

	source: {
		sourceFile: 'HSEQ-FR-17, Inspección Férula Espinal Larga - Camilla. V2.xlsx',
		sourceCode: 'HSEQ-FR-17',
		sourceRevision: '2',
		sourceDate: '2024-04-01',
		sourceSheet: ' Ins camilla',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'El original imprime diez renglones de elementos pero solo ocho tienen texto. Las filas 9 y 10 no se transcribieron como campos: los hallazgos adicionales van al grupo repetible.',
		'`ONE_PER_CONTEXT` distingue los vehículos elegidos, pero las camillas de sede comparten el contexto nulo y su límite mensual. Para limitar una por camilla o sede hace falta un identificador de activo o una asignación separada.'
	],

	version: {
		title: 'Inspección férula espinal larga (FEL) / camilla',
		description: null,
		instructions:
			'Lee cada ítem y marca Cumple, No cumple o No aplica. Ante un «No cumple» la observación es obligatoria y debes registrar la condición identificada al final.',
		settings: {},
		sections: ordenarSecciones([
			seccion('identificacion', 'Identificación de la inspección', [
				ubicacionOVehiculo(),
				identificacionInspector({ conLugar: true })
			]),

			seccion('elementos', 'Elementos a inspeccionar', itemsCNCNA(ELEMENTOS)),

			seccion('evidencia', 'Registro visual', [
				evidenciaFotografica('registro_visual', 'Fotografías de la camilla', { maxFiles: 6 })
			]),

			seccion('condiciones', 'Condiciones de seguridad identificadas', [
				hallazgoPlanAccion('condiciones_seguridad', 'Condiciones de seguridad identificadas', {
					conFecha: true
				})
			]),

			seccion('cierre', 'Cierre y firma', [
				declaracionFirma({
					declaracion:
						'Yo, como autoridad ejecutante, he verificado la lista anterior y certifico que se encuentra en óptimas condiciones.',
					conIdentificacion: true
				})
			])
		])
	}
}
