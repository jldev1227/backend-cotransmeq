/**
 * HSEQ-FR-08 — Preoperacional de automóviles, camperos y camionetas.
 *
 * Comparte con el FR-09 la base de `preoperacional-comun.ts` y añade lo propio de
 * esta clase de vehículo: barra antivuelco, platón/baúl y un solo extintor.
 *
 * La instrucción del original dice «en caso de que el vehículo presente un ítem
 * MALO, diligencie el Reporte de Falla». Eso NO se puede automatizar desde aquí:
 * son dos formularios distintos. Se recuerda en la sección de firma y queda como
 * advertencia para HSEQ, que quizá quiera un enlace directo en una fase futura.
 */

import type { SeedDefinition } from './types'
import {
	itemsBMNA,
	itemsSiNoNa,
	opciones,
	ordenarSecciones,
	seccion,
	textoLargo
} from './factories'
import {
	CABINA_COMUN,
	EPP_COMUN,
	EXTERIOR_COMUN,
	HERRAMIENTAS_COMUN,
	INSTRUCCIONES_PREOPERACIONAL,
	LLANTAS_RINES,
	LUCES_COMUN,
	MOTOR_FLUIDOS,
	PRUEBAS_COMUN,
	TABLERO_COMUN,
	seccionCombustible,
	seccionDocumentos,
	seccionPropiedadCliente,
	seccionSaludFatiga,
	seccionesCierre
} from './preoperacional-comun'

/** Exterior del FR-08: añade la barra antivuelco, que el FR-09 no tiene. */
const EXTERIOR_FR08 = [
	...EXTERIOR_COMUN.slice(0, 4),
	{ key: 'barra_antivuelco', label: 'Barra antivuelco (anclada al chasis)' },
	...EXTERIOR_COMUN.slice(4)
]

/** Cabina del FR-08: cinturones para TODAS las sillas (conductor y pasajeros). */
const CABINA_FR08 = [
	CABINA_COMUN[0],
	CABINA_COMUN[1],
	{
		key: 'cinturones_todas_sillas',
		label:
			'Cinturones de seguridad para todas las sillas de conductor y pasajeros (fácil acceso, se retraen, abrochan y desabrochan)'
	},
	...CABINA_COMUN.slice(2)
]

const LIMPIEZA_FR08 = [
	{
		key: 'aseo_interior',
		label:
			'Aseo y limpieza del vehículo: cabina, tapizados, tapetes y platón (sin residuos, derrames ni herramientas sueltas)'
	},
	{ key: 'bayetilla', label: 'Cuenta con bayetilla y/o elementos de aseo / ambientador' },
	{ key: 'techos_tapiceria', label: 'Techos y tapicería (sin presencia de grasa)' }
]

const HERRAMIENTAS_FR08 = [
	...HERRAMIENTAS_COMUN.slice(0, 8),
	{ key: 'tacos_madera', label: '2 tacos de madera' },
	...HERRAMIENTAS_COMUN.slice(8),
	{
		key: 'extintor',
		label:
			'1 extintor de 20 libras (fecha vigente, presión, manguera, boquilla, seguro, portaextintor o asegurado)'
	}
]

const DESPLAZAMIENTO_FR08 = [
	{
		key: 'desp_llantas',
		label:
			'Verificación del estado y desgaste de llantas: sin piedras, sin pinchadas, pernos completos'
	},
	{ key: 'desp_carga', label: 'Aseguramiento de la carga' },
	{ key: 'desp_sonidos', label: 'Sin vibraciones ni sonidos anormales' }
]

export const hseqFr08: SeedDefinition = {
	code: 'HSEQ-FR-08',
	slug: 'preoperacional-automoviles-camperos-camionetas',
	name: 'Preoperacional de vehículos: automóviles, camperos y camionetas',
	description:
		'Lista de verificación diaria previa al uso del vehículo: motor y fluidos, llantas, exterior, cabina, luces, tablero, pruebas, dotación, salud y fatiga, combustible y propiedad del cliente.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'DAILY',
		limitPolicy: 'ONE_PER_CONTEXT',
		context: { vehicleId: { required: true } },
		rationale:
			'Diario, uno por conductor + vehículo + fecha. `ONE_PER_CONTEXT` con vehículo REQUERIDO: un conductor que cambia de vehículo a mitad del día debe poder diligenciar el preoperacional del segundo.'
	},

	source: {
		sourceFile: 'HSEQ-FR-08 Preoperacional de Vehiculos_V6.xlsx',
		sourceCode: 'HSEQ-FR-08',
		sourceRevision: '6',
		sourceDate: '2025-07-16',
		sourceSheet: 'Hoja3',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'LAS SIETE COLUMNAS DE FECHA DEL EXCEL NO SE TRANSCRIBIERON como siete campos. En el papel una hoja cubre una semana; aquí cada día es un envío con su fecha de negocio y el historial se consulta en la lista de envíos.',
		'La instrucción «si un ítem sale MALO, diligencie el Reporte de Falla» no se puede automatizar entre dos formularios distintos. Se recuerda en la sección de firma; HSEQ puede querer un enlace directo en una fase futura.',
		'El original escribe «TABLERO Y TESTICOS» (errata por «TESTIGOS») y «EXTRATO CONTRATO» (por «EXTRACTO»). Se corrigieron en la transcripción.',
		'El original tiene el ítem «Fugas de Líquidos en el motor o debajo del vehículo» redactado en positivo o negativo según el formato; se unificó como «Sin fugas de líquidos…» para que BUENO signifique siempre «está bien».',
		'Los ítems marcados «***» en el original (KM final, novedades de equipaje, equipaje olvidado) son los que se diligencian al FINAL del recorrido. Se agruparon en la sección de cierre.',
		'El control de cambios del original registra hasta la versión 4 (2024-08-09) pero el encabezado dice «Versión 6 / 2025-07-16». HSEQ debe confirmar qué cambió en la 5 y la 6.',
		'Este formulario supera los 250 campos. Probarlo en un teléfono de gama baja y en modo avión antes de publicarlo.'
	],

	version: {
		title: 'Preoperacional de vehículos: automóviles, camperos y camionetas',
		description: null,
		instructions: INSTRUCCIONES_PREOPERACIONAL,
		settings: {},
		sections: ordenarSecciones([
			seccionDocumentos(),
			seccion('motor', 'Motor, nivel y estado de fluidos, batería', itemsBMNA(MOTOR_FLUIDOS)),
			seccion('llantas', 'Llantas y rines', itemsBMNA(LLANTAS_RINES)),
			seccion('exterior', 'Exterior', itemsBMNA(EXTERIOR_FR08)),
			seccion('cabina', 'Cabina', itemsBMNA(CABINA_FR08)),
			seccion('luces', 'Luces y farolas', itemsBMNA(LUCES_COMUN)),
			seccion('tablero', 'Tablero y testigos', itemsBMNA(TABLERO_COMUN)),
			seccion('pruebas', 'Pruebas', itemsBMNA(PRUEBAS_COMUN)),
			seccion('limpieza', 'Limpieza y aseo del vehículo', itemsBMNA(LIMPIEZA_FR08)),
			seccion('herramientas', 'Caja de herramientas y kit de carretera', itemsBMNA(HERRAMIENTAS_FR08)),
			seccion('epp', 'Verificación de dotación y EPP para la labor', itemsBMNA(EPP_COMUN)),
			seccionSaludFatiga(),
			seccionCombustible(),
			seccion(
				'desplazamiento',
				'Verificación durante el desplazamiento o en paradas seguras',
				[
					...itemsBMNA(DESPLAZAMIENTO_FR08),
					...itemsSiNoNa([{ key: 'desp_porta_placa', label: 'Porta la placa' }])
				],
				{
					description:
						'Se diligencia durante el recorrido. Guarda el borrador y complétalo en la primera parada segura.'
				}
			),
			seccionPropiedadCliente({
				platonLabel: '¿Se llevan herramientas, equipaje o pertenencias en el platón o baúl?'
			}),
			...seccionesCierre({ placaFinalLabel: '¿Porta la placa al finalizar el desplazamiento?' })
		])
	}
}
