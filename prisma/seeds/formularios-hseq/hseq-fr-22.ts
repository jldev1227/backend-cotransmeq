/**
 * HSEQ-FR-22 — Inspección kit de derrames.
 *
 * Semilla de referencia del módulo: es la más pequeña que ejercita todos los
 * patrones (contexto, inventario con faltantes, observaciones, plan de acción,
 * firma) y por eso el documento la señala como la primera representativa.
 *
 * Decisiones de transcripción:
 *
 *  - Los once elementos son campos FIJOS, no filas de un repetible: la lista la
 *    define el documento y el inspector no debe poder quitar renglones.
 *  - `CANTIDAD FALTANTE` solo se pide —y se exige— cuando el elemento está
 *    incompleto. En el papel es una columna en blanco once veces.
 *  - Se añade `NO_TIENE` a la escala del original (COMPLETO/INCOMPLETO): un
 *    elemento ausente no es «incompleto», y sin ese valor el inspector tenía que
 *    marcar incompleto con faltante = cantidad total.
 */

import type { SeedDefinition } from './types'
import {
	evidenciaFotografica,
	hallazgoPlanAccion,
	identificacionInspector,
	itemKit,
	ordenarSecciones,
	seccion,
	textoLargo,
	ubicacionOVehiculo,
	declaracionFirma
} from './factories'

/** Los once elementos del kit, con la cantidad que exige el documento. */
const ELEMENTOS: { key: string; label: string; cantidad: string }[] = [
	{
		key: 'caneca',
		label: 'Caneca con capacidad acorde al kit, mínimo 5 galones (maletín para almacenamiento)',
		cantidad: '1 unidad'
	},
	{ key: 'granulado', label: 'Material granulado absorbente biodegradable', cantidad: '1 kilogramo' },
	{ key: 'barra_absorbente', label: 'Barra absorbente x 1,20 cm', cantidad: '1 unidad' },
	{ key: 'pano_oleofilico', label: 'Paño tela oleofílica', cantidad: '3 unidades' },
	{ key: 'guantes_nitrilo', label: 'Guantes de nitrilo', cantidad: '1 par' },
	{
		key: 'cinta_senalizacion',
		label: 'Cinta de señalización, rollo 100 metros',
		/// El documento se contradice: el nombre del elemento dice «rollo 100
		/// metros» y la columna de cantidad dice «rollo 50 metros». Se conserva la
		/// columna de cantidad y queda como warning para HSEQ.
		cantidad: 'rollo de 50 metros (revisar: el nombre del elemento dice 100 m)'
	},
	{ key: 'pala_antichispa', label: 'Pala antichispa', cantidad: '1 unidad' },
	{ key: 'bolsas_rojas', label: 'Bolsas rojas', cantidad: '2 unidades' },
	{ key: 'mascarilla_vapores', label: 'Mascarilla con filtro para vapores', cantidad: '1 unidad' },
	{ key: 'monogafas', label: 'Monogafas de seguridad', cantidad: '1 unidad' },
	{ key: 'paleta_pare_siga', label: 'Paleta de PARE / SIGA', cantidad: '1 unidad' }
]

export const hseqFr22: SeedDefinition = {
	code: 'HSEQ-FR-22',
	slug: 'inspeccion-kit-de-derrames',
	name: 'Inspección kit de derrames',
	description:
		'Verificación del inventario del kit de derrames de un vehículo o sede, con registro de faltantes y acciones.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'MONTHLY',
		limitPolicy: 'ONE_PER_CONTEXT',
		context: { vehicleId: { required: true } },
		rationale:
			'Mensual por vehículo o sede. `ONE_PER_CONTEXT` con vehículo requerido para que un conductor que maneja dos vehículos pueda inspeccionar los dos kits en el mismo mes.'
	},

	source: {
		sourceFile: 'HSEQ-FR-22, Inspección Kit Derrames. V3.xlsx',
		sourceCode: 'HSEQ-FR-22',
		sourceRevision: '3',
		sourceDate: '2025-07-03',
		sourceSheet: 'Table 1',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'La cinta de señalización figura como «rollo 100 metros» en el nombre del elemento y como «rollo 50 metros» en la columna de cantidad. Se transcribió la contradicción; HSEQ debe decidir cuál es la correcta.',
		'Se añadió el estado «No tiene» a la escala original COMPLETO/INCOMPLETO: un elemento ausente no es lo mismo que uno incompleto.',
		'Las seis columnas de inspección que el Excel imprime en paralelo NO se transcribieron como columnas: cada diligenciamiento es un envío y el historial vive en la lista de envíos.'
	],

	version: {
		title: 'Inspección kit de derrames',
		description: null,
		instructions:
			'Verifica cada elemento del kit contra la cantidad esperada. Si algo falta o está incompleto, indica cuántas unidades faltan y registra la acción con su responsable y fecha de cumplimiento.',
		settings: {},
		sections: ordenarSecciones([
			seccion('identificacion', 'Identificación de la inspección', [
				ubicacionOVehiculo(),
				identificacionInspector({ conLugar: false, conQuienAtiende: true })
			]),

			seccion(
				'inventario',
				'Inventario del kit',
				ELEMENTOS.map((e) => itemKit(e.key, e.label, e.cantidad)),
				{ description: 'Marca el estado de cada elemento contra la cantidad esperada.' }
			),

			seccion('observaciones', 'Observaciones', [
				textoLargo('observaciones_generales', 'Observaciones', {
					validation: { maxLength: 4000 }
				}),
				evidenciaFotografica('registro_visual', 'Registro visual del kit', { maxFiles: 6 })
			]),

			seccion('acciones', 'Registro de acciones', [
				hallazgoPlanAccion('registro_acciones', 'Acciones registradas', { conFecha: true })
			]),

			seccion('cierre', 'Cierre y firma', [
				declaracionFirma({
					declaracion:
						'Yo, como autoridad ejecutante, he verificado la lista anterior y certifico que la información registrada corresponde al estado real del kit de derrames inspeccionado.',
					conIdentificacion: true
				})
			])
		])
	}
}
