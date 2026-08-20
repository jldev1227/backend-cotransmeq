/**
 * HSEQ-FR-04 — Inspección de extintores.
 *
 * El original pide primero los datos del extintor (ubicación, capacidad, carga,
 * vencimiento, anillo, número) y luego catorce estándares de seguridad C/NC/NA.
 *
 * Decisiones de transcripción:
 *
 *  - El extintor se identifica con su NÚMERO y su ubicación, no con la placa: la
 *    misma placa puede llevar dos extintores y hay extintores de sede. El
 *    `ubicacionOVehiculo()` cubre los dos casos.
 *  - La `Fecha Vencimiento de carga` es un `DATE` y no texto: es lo que permite
 *    después listar extintores por vencer, que es la razón de recoger el dato.
 *  - La hoja «Hoja1» del libro es una lista de apoyo (los mismos elementos en
 *    forma de recordatorio) y no aporta campos nuevos; no se transcribe.
 */

import type { SeedDefinition } from './types'
import {
	declaracionFirma,
	entero,
	evidenciaFotografica,
	fecha,
	hallazgoPlanAccion,
	identificacionInspector,
	itemsCNCNA,
	opciones,
	ordenarSecciones,
	seccion,
	texto,
	ubicacionOVehiculo
} from './factories'

const ESTANDARES = [
	{
		key: 'cilindro_estado',
		label:
			'¿La botella o cilindro se encuentra en buen estado, no presenta golpes, abolladuras, no está oxidado y en buenas condiciones de pintura?'
	},
	{ key: 'manometro', label: '¿El manómetro se encuentra en buen estado y funcionamiento?' },
	{
		key: 'presion',
		label:
			'¿El extintor cuenta con la presión adecuada? (verificar que la aguja que indica carga esté en zona verde)'
	},
	{ key: 'sello_seguridad', label: '¿El extintor cuenta con el sello de seguridad?' },
	{
		key: 'manguera',
		label: '¿El extintor cuenta con manguera y/o corneta y se encuentra en buen estado?'
	},
	{
		key: 'pasador',
		label: '¿El extintor cuenta con el prensillo / precinto / pasador de seguridad?'
	},
	{ key: 'manija_sujecion', label: '¿La manija de sujeción y transporte se encuentra en buen estado?' },
	{ key: 'palanca', label: '¿La palanca de accionamiento del extintor se encuentra en buen estado?' },
	{
		key: 'ubicacion_adecuada',
		label:
			'¿La ubicación del extintor es la adecuada, permite y facilita su acceso por parte de cualquier trabajador o persona calificada?'
	},
	{ key: 'senalizacion', label: '¿Se cuenta con la señalización en buen estado?' },
	{
		key: 'etiqueta_pictogramas',
		label:
			'¿Cuenta con etiqueta de pictogramas de clase de fuego, pictogramas de uso legible y agente extintor?'
	},
	{ key: 'etiqueta_carga', label: '¿Cuenta con etiqueta de carga legible?' },
	{
		key: 'area_demarcada',
		label: '¿El área donde se encuentra ubicado el extintor está demarcada (piso-pared)?'
	},
	{
		key: 'soporte',
		label:
			'¿Se cuenta con soporte en buen estado o se encuentra bien sujetado al vehículo con mariposa / candado / abrazadera?'
	}
]

export const hseqFr04: SeedDefinition = {
	code: 'HSEQ-FR-04',
	slug: 'inspeccion-extintores',
	name: 'Inspección de extintores',
	description:
		'Datos del extintor y verificación de los catorce estándares de seguridad, con hallazgos y plan de control.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'MONTHLY',
		limitPolicy: 'UNLIMITED',
		context: {},
		rationale:
			'Mensual, sin límite: un vehículo o una sede puede tener varios extintores y cada uno se inspecciona por separado. El número de extintor lo distingue dentro del envío.'
	},

	source: {
		sourceFile: 'HSEQ-FR-04, Inspección Extintores. V3.xlsx',
		sourceCode: 'HSEQ-FR-04',
		sourceRevision: '3',
		sourceDate: '2025-03-04',
		sourceSheet: ' Insp extintores',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'El encabezado interno dice «Versión 3 / 2025-03-04», pero el control de cambios solo registra hasta la versión 2 (2024-04-01). HSEQ debe confirmar qué cambió en la 3.',
		'La hoja «Hoja1» del libro es una lista de apoyo con los mismos elementos y no se transcribió como campos.',
		'El límite sugerido es UNLIMITED porque un mismo vehículo puede tener dos extintores; si HSEQ prefiere uno por extintor y mes, hará falta un identificador de activo en el contexto.'
	],

	version: {
		title: 'Inspección de extintores',
		description: null,
		instructions:
			'Diligencia los datos del extintor a inspeccionar y luego marca cada estándar de seguridad. Ante un «No cumple», la observación es obligatoria y debes registrar la condición en el plan de control.',
		settings: {},
		sections: ordenarSecciones([
			seccion('identificacion', 'Identificación de la inspección', [
				ubicacionOVehiculo(),
				identificacionInspector({ conLugar: true })
			]),

			seccion(
				'datos_extintor',
				'Información del extintor',
				[
					texto('extintor_numero', 'Número del extintor', {
						required: true,
						validation: { maxLength: 40 },
						helpText: 'Identificador del activo. Distingue los extintores del mismo vehículo o sede.'
					}),
					texto('extintor_ubicacion', 'Ubicación', {
						required: true,
						validation: { maxLength: 150 }
					}),
					entero('extintor_capacidad_lb', 'Capacidad en libras', {
						required: true,
						validation: { min: 1, max: 500 }
					}),
					opciones(
						'extintor_tipo_carga',
						'Tipo de carga',
						[
							{ value: 'PQS_ABC', label: 'Polvo químico seco ABC' },
							{ value: 'CO2', label: 'CO₂' },
							{ value: 'AGUA', label: 'Agua' },
							{ value: 'ESPUMA', label: 'Espuma' },
							{ value: 'SOLKAFLAM', label: 'Solkaflam' },
							{ value: 'OTRO', label: 'Otro' }
						],
						{ required: true }
					),
					fecha('extintor_vencimiento_carga', 'Fecha de vencimiento de la carga', {
						required: true,
						helpText: 'Se registra como fecha para poder listar después los extintores por vencer.'
					}),
					texto('extintor_lugar_carga', 'Lugar de carga', { validation: { maxLength: 150 } }),
					texto('extintor_color_anillo', 'Color del anillo', { validation: { maxLength: 40 } })
				],
				{ description: 'Datos del activo inspeccionado.' }
			),

			seccion('estandares', 'Estándares de seguridad', itemsCNCNA(ESTANDARES), {
				description: 'Marca Cumple, No cumple o No aplica. Un «No cumple» exige observación.'
			}),

			seccion('evidencia', 'Registro visual', [
				evidenciaFotografica('registro_visual', 'Fotografías del extintor', { maxFiles: 6 })
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
