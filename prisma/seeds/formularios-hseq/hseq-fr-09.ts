/**
 * HSEQ-FR-09 — Preoperacional de microbuses, busetas y buses.
 *
 * Misma base que el FR-08 más lo propio del transporte de pasajeros: sección de
 * zona y puestos de pasajeros, freno de ahogo, televisor, indicador de presión de
 * aire, luces de bodega y licuadora de emergencia, dos extintores y bodegas de
 * equipaje.
 */

import type { SeedDefinition } from './types'
import { itemsBMNA, itemsSiNoNa, ordenarSecciones, seccion } from './factories'
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

/** Cabina del FR-09: cinturón solo del conductor, más freno de ahogo y televisor. */
const CABINA_FR09 = [
	CABINA_COMUN[0],
	CABINA_COMUN[1],
	{
		key: 'cinturon_conductor',
		label:
			'Cinturón de seguridad del puesto del conductor (fácil acceso, se retrae, abrocha y desabrocha)'
	},
	CABINA_COMUN[2],
	{ key: 'freno_ahogo', label: 'Freno de ahogo' },
	...CABINA_COMUN.slice(3, 13),
	{ key: 'televisor', label: 'Televisor (funcionamiento, bien asegurado)' },
	CABINA_COMUN[13]
]

/** Tablero del FR-09: añade el indicador de presión de aire. */
const TABLERO_FR09 = [
	...TABLERO_COMUN.slice(0, 8),
	{ key: 'indicador_presion_aire', label: 'Indicador de presión de aire' },
	...TABLERO_COMUN.slice(8)
]

/** Luces del FR-09: añade reversa adicional, licuadora de emergencia y bodegas. */
const LUCES_FR09 = [
	...LUCES_COMUN.slice(0, 9),
	{ key: 'luz_reversa_adicional', label: 'Luz de reversa adicional (cuando aplique, funcionamiento)' },
	LUCES_COMUN[9],
	{
		key: 'licuadora_emergencia',
		label: 'Licuadora de emergencia (cuando aplique, funcionamiento)'
	},
	{ key: 'luces_bodegas', label: 'Luces de bodegas (cuando aplique, funcionamiento)' },
	LUCES_COMUN[10]
]

const PASAJEROS_FR09 = [
	{ key: 'pas_puerta', label: 'Puerta (apertura, cierre y seguro) (cuando aplique)' },
	{
		key: 'pas_vidrios',
		label:
			'Vidrios, ventanales y ventanas manuales o corredizas (sin grietas ni fisuras, sin rayado, limpios, se desplazan sin dificultad)'
	},
	{
		key: 'pas_pasillo',
		label: 'Pasillo de acceso despejado y antideslizante (limpio, libre de objetos que obstruyan)'
	},
	{ key: 'pas_luces_lectura', label: 'Luces de lectura (cuando aplique, funcionamiento)' },
	{
		key: 'pas_rejillas_aire',
		label:
			'Rejillas de aire acondicionado o ventilación individual (cuando aplique, sin obstrucciones y funcionales)'
	},
	{ key: 'pas_cortina', label: 'Cortina o visor (cuando aplique, limpio, funcional y en buen estado)' },
	{ key: 'pas_ventanas_emergencia', label: 'Ventanas de emergencia (identificadas)' },
	{
		key: 'pas_escotilla',
		label: 'Sistema de apertura de emergencia de techo / escotilla (cuando aplique)'
	},
	{ key: 'pas_silleteria', label: 'Silletería en perfectas condiciones' },
	{
		key: 'pas_cinturones',
		label:
			'Cinturones de seguridad en todos los puestos (fácil acceso, se retraen, abrochan y desabrochan)'
	}
]

const LIMPIEZA_FR09 = [
	{
		key: 'aseo_cabina',
		label:
			'Orden, aseo y limpieza interior del vehículo: cabina, techos, tapizados y tapetes (cuando aplique; sin residuos, sin grasa, sin daños ni suciedad excesiva)'
	},
	{
		key: 'aseo_pasajeros',
		label:
			'Orden, aseo y limpieza de la zona y puestos de pasajeros y portaequipaje (cuando aplique; sin residuos, sin grasa, sin daños ni suciedad excesiva)'
	},
	{
		key: 'aseo_bodegas',
		label:
			'Orden, aseo y limpieza de bodegas de equipaje laterales y traseras (cuando aplique; sin residuos, sin daños ni suciedad excesiva)'
	},
	{ key: 'bayetilla', label: 'Cuenta con bayetilla y/o elementos de aseo / ambientador' },
	{ key: 'canastilla_residuos', label: 'Canastilla para residuos con bolsas' }
]

const HERRAMIENTAS_FR09 = [
	...HERRAMIENTAS_COMUN.slice(0, 8),
	{ key: 'tacos_madera', label: 'Tacos de madera (mínimo 4; microbús mínimo 2)' },
	...HERRAMIENTAS_COMUN.slice(8),
	{
		key: 'extintores',
		label:
			'2 extintores de 20 libras (fecha vigente, presión, manguera, boquilla, seguro, portaextintor o asegurado)'
	}
]

const DESPLAZAMIENTO_FR09 = [
	{
		key: 'desp_llantas',
		label:
			'Verificación del estado y desgaste de llantas: sin piedras, sin pinchadas, pernos completos'
	},
	{
		key: 'desp_bodegas',
		label: 'Aseguramiento de las puertas de la bodega de equipaje externo'
	},
	{ key: 'desp_sonidos', label: 'Sin vibraciones ni sonidos anormales' }
]

export const hseqFr09: SeedDefinition = {
	code: 'HSEQ-FR-09',
	slug: 'preoperacional-microbuses-busetas-buses',
	name: 'Preoperacional de vehículos: microbuses, busetas y buses',
	description:
		'Lista de verificación diaria previa al uso del vehículo de pasajeros, con zona de pasajeros, bodegas de equipaje y dos extintores.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'DAILY',
		limitPolicy: 'ONE_PER_CONTEXT',
		context: { vehicleId: { required: true } },
		rationale:
			'Diario, uno por conductor + vehículo + fecha. `ONE_PER_CONTEXT` con vehículo REQUERIDO, igual que el FR-08.'
	},

	source: {
		sourceFile: 'HSEQ-FR-09, Preoperacional Vehiculos Buses Busetas. V3.xlsx',
		sourceCode: 'HSEQ-FR-09',
		sourceRevision: '3',
		sourceDate: '2025-07-16',
		sourceSheet: 'FR',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'LAS SIETE COLUMNAS DE FECHA DEL EXCEL NO SE TRANSCRIBIERON como siete campos: cada día es un envío con su fecha de negocio.',
		'La hoja «Hoja1» del libro repite la zona de pasajeros y el kit de carretera como lista de apoyo; no aporta campos nuevos y no se transcribió.',
		'El original escribe «TABLERO Y TESTICOS» (errata por «TESTIGOS»). Se corrigió.',
		'«Licuadora de Emergencia» aparece así en el original; parece referirse a la luz intermitente de emergencia. Se transcribió literalmente y HSEQ debería aclarar el término.',
		'La instrucción «si un ítem sale MALO, diligencie el Reporte de Falla» no se automatiza entre formularios distintos; se recuerda en la sección de firma.',
		'El control de cambios solo registra la emisión inicial (2022-04-18, versión 1) pero el encabezado dice «Versión 3 / 2025-07-16». HSEQ debe confirmar qué cambió.',
		'Este formulario supera los 280 campos. Probarlo en un teléfono de gama baja y en modo avión antes de publicarlo.'
	],

	version: {
		title: 'Preoperacional de vehículos: microbuses, busetas y buses',
		description: null,
		instructions: INSTRUCCIONES_PREOPERACIONAL,
		settings: {},
		sections: ordenarSecciones([
			seccionDocumentos(),
			seccion('motor', 'Motor, nivel y estado de fluidos, batería', itemsBMNA(MOTOR_FLUIDOS)),
			seccion('llantas', 'Llantas y rines', itemsBMNA(LLANTAS_RINES)),
			seccion('exterior', 'Exterior', itemsBMNA(EXTERIOR_COMUN)),
			seccion('cabina', 'Cabina', itemsBMNA(CABINA_FR09)),
			seccion('tablero', 'Tablero y testigos', itemsBMNA(TABLERO_FR09)),
			seccion('luces', 'Luces y farolas', itemsBMNA(LUCES_FR09)),
			seccion('pasajeros', 'Zona y puestos de pasajeros', itemsBMNA(PASAJEROS_FR09)),
			seccion('pruebas', 'Pruebas', itemsBMNA(PRUEBAS_COMUN)),
			seccion('limpieza', 'Limpieza y aseo del vehículo', itemsBMNA(LIMPIEZA_FR09)),
			seccion('herramientas', 'Caja de herramientas y kit de carretera', itemsBMNA(HERRAMIENTAS_FR09)),
			seccion('epp', 'Verificación de dotación y EPP para la labor', itemsBMNA(EPP_COMUN)),
			seccionSaludFatiga(),
			seccionCombustible(),
			seccion(
				'desplazamiento',
				'Verificación durante el desplazamiento o en paradas seguras',
				[
					...itemsBMNA(DESPLAZAMIENTO_FR09),
					...itemsSiNoNa([{ key: 'desp_porta_placa', label: 'Porta la placa' }])
				],
				{
					description:
						'Se diligencia durante el recorrido. Guarda el borrador y complétalo en la primera parada segura.'
				}
			),
			seccionPropiedadCliente({
				platonLabel: '¿Se llevan herramientas, equipaje o pertenencias en la bodega de equipaje?'
			}),
			...seccionesCierre({
				placaFinalLabel: '¿Porta la placa y la carpa al finalizar el desplazamiento?'
			})
		])
	}
}
