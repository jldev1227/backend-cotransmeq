/**
 * HSEQ-FR-42 — PQRSAF.
 *
 * El libro tiene DOS hojas de formato: «Formato Quejas» (más antigua) y «Formato»
 * (más completa: añade Felicitaciones, los requirentes Trabajador y Otro, y el
 * valor NA en el cierre). Se transcribe la hoja «Formato», tal como indica la
 * especificación.
 *
 * Decisiones de transcripción:
 *
 *  - El tratamiento y el concepto de cierre son administrativos: van con
 *    `editableBy: ['USER']` y el runner del conductor los omite. El documento lo
 *    prevé explícitamente para la v1.
 *  - El consecutivo («No.») lo asigna el servidor; no se pide.
 *  - Este formulario recoge datos personales de terceros (nombre, documento,
 *    celular, correo, dirección). Queda como advertencia destacada: hay que
 *    definir retención y quién puede consultarlos antes de publicar.
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

const AVISO_LEGAL = [
	'Con el objetivo de brindarle un buen servicio y atención, ponemos a su disposición el presente formato para atender y solucionar toda PQRSAF (petición, queja, reclamo, sugerencia, apelación y/o felicitación) que requiera exponer. Tenga en cuenta lo siguiente:',
	'• Todos los datos que usted informe serán tratados de manera confidencial.',
	'• Deberá llenar todos los campos para que su PQRSAF sea tratada de manera eficiente.',
	'• El organismo evaluador de la conformidad se compromete a no dar lugar a ninguna acción discriminatoria dentro del proceso de análisis, seguimiento y conclusión del aspecto asentado en el presente formato.',
	'• Adjunte las fotos o documentos, si aplica, que respalden el asunto a tratar.',
	'• Una vez recibido este documento diligenciado se procederá con su revisión y análisis.',
	'• Se dará respuesta en 15 días hábiles, contados a partir de la fecha de recepción del presente formato.'
].join('\n')

function administrativo(campo: Campo): Campo {
	return {
		...campo,
		config: { ...(campo.config ?? {}), editableBy: ['USER'] },
		required: false
	}
}

export const hseqFr42: SeedDefinition = {
	code: 'HSEQ-FR-42',
	slug: 'pqrsaf',
	name: 'PQRSAF — petición, queja, reclamo, sugerencia, apelación y felicitación',
	description:
		'Recepción de PQRSAF y de servicio no conforme, con datos del requirente, descripción, tratamiento y concepto de cierre.',
	ownerArea: 'hseq',

	suggested: {
		frequency: 'ON_DEMAND',
		limitPolicy: 'UNLIMITED',
		context: {},
		rationale: 'A demanda y sin límite: se recibe cuando alguien la presenta.'
	},

	source: {
		sourceFile: 'HSEQ-FR-42, PQRSAF. V1.xlsx',
		sourceCode: 'HSEQ-FR-42',
		sourceRevision: '1',
		sourceDate: '2022-07-17',
		sourceSheet: 'Formato',
		importedAt: '2026-08-19',
		importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
	},

	warnings: [
		'El libro tiene DOS hojas de formato. Se transcribió «Formato» (la más completa: incluye Felicitaciones, requirentes Trabajador y Otro, y el valor NA en el cierre) y se ignoró «Formato Quejas», que es la versión anterior.',
		'DATOS PERSONALES DE TERCEROS: este formulario recoge nombre, documento, celular, correo y dirección de personas que no son empleados. Definir retención, base legal del tratamiento y quién puede consultarlos ANTES de publicar.',
		'El tratamiento y el concepto de cierre se marcaron como `editableBy: [USER]`: el runner del conductor los omite. El flujo administrativo se implementa en una fase posterior.',
		'El consecutivo «No.» no se pide: lo asigna el servidor.',
		'La hoja «Formato» tiene la errata «TRATAMINETO» por «TRATAMIENTO» en dos títulos. Se corrigió en la transcripción.',
		'El original pide «Documento de Identidad ___ de ___» (número y lugar de expedición). Se transcribió como dos campos.'
	],

	version: {
		title: 'PQRSAF — petición, queja, reclamo, sugerencia, apelación y felicitación',
		description: null,
		instructions:
			'Diligencia todos los campos para que tu solicitud pueda tratarse. Recibirás respuesta en 15 días hábiles contados desde la fecha de recepción.',
		settings: {},
		sections: ordenarSecciones([
			seccion('aviso', 'Antes de empezar', [
				info('aviso_legal', 'Condiciones de tratamiento', AVISO_LEGAL)
			]),

			seccion('asunto', 'Tipo de solicitud', [
				fecha('fecha_solicitud', 'Fecha', { required: true }),
				hora('hora_solicitud', 'Hora'),
				opciones(
					'tipo_solicitud',
					'Tipo de solicitud',
					[
						{ value: 'SERVICIO_NO_CONFORME', label: 'Servicio no conforme', color: 'red' },
						{ value: 'PETICION', label: 'Petición' },
						{ value: 'QUEJA', label: 'Queja', color: 'amber' },
						{ value: 'RECLAMO', label: 'Reclamo', color: 'red' },
						{ value: 'SUGERENCIA', label: 'Sugerencia' },
						{ value: 'APELACION', label: 'Apelación' },
						{ value: 'FELICITACION', label: 'Felicitación', color: 'emerald' }
					],
					{ required: true }
				)
			]),

			seccion(
				'requirente',
				'1. Datos del requirente',
				[
					opciones(
						'requirente_tipo',
						'El requirente es',
						[
							{ value: 'CLIENTE', label: 'Cliente' },
							{ value: 'PROVEEDOR', label: 'Proveedor' },
							{ value: 'CONTRATISTA', label: 'Contratista' },
							{ value: 'TERCERO', label: 'Tercero' },
							{ value: 'COMUNIDAD', label: 'Comunidad' },
							{ value: 'TRABAJADOR', label: 'Trabajador' },
							{ value: 'OTRO', label: 'Otro' }
						],
						{ required: true }
					),
					texto('requirente_empresa', 'Empresa', { validation: { maxLength: 200 } }),
					texto('requirente_nit', 'NIT', { validation: { maxLength: 30 } }),
					texto('requirente_nombre', 'Nombre completo', {
						required: true,
						validation: { maxLength: 200 }
					}),
					texto('requirente_documento', 'Documento de identidad', {
						required: true,
						validation: { maxLength: 30 }
					}),
					texto('requirente_documento_lugar', 'Expedido en', { validation: { maxLength: 100 } }),
					texto('requirente_celular', 'Celular', { required: true, validation: { maxLength: 30 } }),
					texto('requirente_correo', 'Correo electrónico', {
						validation: { maxLength: 150, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
						helpText: 'Se usa para enviarte la respuesta.'
					}),
					texto('requirente_direccion', 'Dirección', { validation: { maxLength: 200 } })
				],
				{ description: 'Estos datos se tratan de manera confidencial.' }
			),

			seccion('detalle', '2. Información sobre el asunto', [
				opciones(
					'categoria',
					'El asunto se relaciona con',
					[
						{ value: 'CALIDAD_SERVICIO', label: 'Calidad del servicio' },
						{ value: 'PERSONAL', label: 'Personal' },
						{ value: 'OTROS', label: 'Otros' }
					],
					{
						required: true,
						visibilityRule: {
							version: 1,
							all: [{ fieldKey: 'categoria', operator: 'equals', value: 'OTROS' }],
							effect: { action: 'require', targetFieldKey: 'categoria_otro' }
						} satisfies Rule
					}
				),
				texto('categoria_otro', '¿Cuál?', {
					validation: { maxLength: 200 },
					visibilityRule: {
						version: 1,
						all: [{ fieldKey: 'categoria', operator: 'equals', value: 'OTROS' }],
						effect: { action: 'show', targetFieldKey: 'categoria_otro' }
					} satisfies Rule
				}),
				texto('personas_involucradas', 'Nombre del trabajador o personas involucradas', {
					validation: { maxLength: 300 }
				}),
				textoLargo('descripcion', 'Descripción a detalle de la situación', {
					required: true,
					validation: { minLength: 30, maxLength: 8000 },
					helpText: 'Cuenta qué pasó, cuándo y dónde. Mínimo 30 caracteres.'
				}),
				evidenciaFotografica('soportes', 'Fotos o documentos de soporte', {
					maxFiles: 6,
					conDescripcion: false,
					helpText: 'Adjunta lo que respalde el asunto, si aplica.'
				})
			]),

			seccion(
				'tratamiento',
				'3. Tratamiento (uso administrativo)',
				[
					administrativo(
						textoLargo('tratamiento_descripcion', 'Descripción del tratamiento dado', {
							validation: { maxLength: 8000 }
						})
					),
					administrativo(texto('tratamiento_responsable', 'Responsable del tratamiento', {
						validation: { maxLength: 150 }
					})),
					administrativo(fecha('tratamiento_fecha', 'Fecha del tratamiento'))
				],
				{
					description:
						'Esta sección la diligencia el área responsable. No es visible en el portal del conductor.'
				}
			),

			seccion(
				'cierre_concepto',
				'4. Concepto de cierre por el requirente',
				[
					administrativo(
						opciones('cierre_dado', '¿Se dio cierre al asunto tratado?', [
							{ value: 'SI', label: 'Sí', color: 'emerald' },
							{ value: 'NO', label: 'No', color: 'red' },
							{ value: 'NA', label: 'No aplica', color: 'gray' }
						])
					),
					administrativo(fecha('cierre_fecha', 'Fecha de cierre'))
				],
				{ description: 'Uso administrativo.' }
			),

			seccion('firma', 'Firma del requirente', [
				declaracionFirma({
					key: 'firma_requirente',
					declaracion:
						'Si el asunto quedó solucionado o tratado a satisfacción, firma a continuación con tu número de cédula.',
					label: 'Firma del requirente',
					conIdentificacion: true,
					/// No obligatoria: el original la pide solo si el asunto quedó
					/// solucionado, y quien radica una queja no puede firmar la
					/// conformidad en el mismo momento.
					required: false
				})
			])
		])
	}
}
