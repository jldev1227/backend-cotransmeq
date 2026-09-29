/**
 * Escritura del árbol de una semilla en la base.
 *
 * Se extrajo de `cargar.ts` sin cambiar su comportamiento para que el cargador
 * general (trece semillas, versión 1, siempre `DRAFT`) y el cargador de las
 * versiones por etapas compartan EXACTAMENTE el mismo código de escritura. Dos
 * copias del bucle de `upsert` habrían divergido en el primer arreglo.
 *
 * Aquí no hay decisiones de negocio: ni publica, ni asigna, ni elige el número
 * de versión. Eso lo decide quien llama.
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { seedIds } from './ids'
import type { SeedDefinition } from './types'
import type { FormFieldDraft } from '../../../src/modules/formularios-dinamicos/domain'

/** `Json?` de Prisma no acepta `null`; hay que elegir `DbNull` explícitamente. */
export function jsonOrDbNull(value: unknown) {
	return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue)
}

export interface OpcionesEscritura {
	/**
	 * Número de versión del motor dinámico (no la revisión documental de HSEQ).
	 *
	 * Solo se usa al CREAR la fila: `uq_form_versions_number` hace que cambiarlo
	 * después desplazaría una versión con envíos colgando.
	 */
	versionNumber?: number
	/**
	 * Qué hacer si la versión ya está `PUBLISHED`.
	 *
	 * Por defecto se aborta, que es la garantía del cargador general: sobrescribir
	 * el árbol de una versión publicada rompería los envíos que la referencian.
	 * `'omitir'` existe para los cargadores que publican ellos mismos y necesitan
	 * poder reejecutarse sin deshacer nada.
	 */
	siYaPublicada?: 'abortar' | 'omitir'
}

export interface ResultadoEscritura {
	code: string
	versionId: string
	formId: string
	secciones: number
	campos: number
	opciones: number
	/** `true` cuando la versión ya estaba publicada y no se tocó su árbol. */
	omitida: boolean
}

export async function cargarSemilla(
	prisma: PrismaClient,
	semilla: SeedDefinition,
	userId: string,
	opciones: OpcionesEscritura = {}
): Promise<ResultadoEscritura> {
	const ids = seedIds(semilla.code, semilla.source.sourceRevision)
	const versionNumber = opciones.versionNumber ?? 1
	let campos = 0
	let opcionesEscritas = 0

	/// Se lee ANTES de abrir la transacción: si la versión ya está publicada y el
	/// llamador pidió omitir, no hay nada que escribir y no hace falta pagar una
	/// transacción de diez minutos de plazo para descubrirlo.
	const estadoPrevio = await prisma.form_version.findUnique({
		where: { id: ids.version },
		select: { status: true }
	})
	if (estadoPrevio && estadoPrevio.status !== 'DRAFT') {
		if (opciones.siYaPublicada === 'omitir') {
			return {
				code: semilla.code,
				versionId: ids.version,
				formId: ids.form,
				secciones: semilla.version.sections.length,
				campos: 0,
				opciones: 0,
				omitida: true
			}
		}
		throw new Error(
			`${semilla.code}: la versión ${ids.version} está en ${estadoPrevio.status}. ` +
				'Una versión publicada no se sobrescribe: clónala desde el dashboard.'
		)
	}

	/**
	 * Todo el árbol va en UNA transacción, y con tiempos explícitos.
	 *
	 * El default de Prisma —5 s— no da para esto ni de lejos: FR-08 son ~596
	 * escrituras secuenciales (1 definición + 1 versión + 18 secciones + 241
	 * campos + 334 opciones) y FR-09 pasa de 680. Contra una base remota, cada
	 * `upsert` cuesta un viaje de red completo, así que el bucle tarda decenas de
	 * segundos. Con el default, la transacción se cerraba sola a mitad del bucle de
	 * campos y Prisma respondía «Transaction ID is invalid», que suena a
	 * desconexión pero es simplemente el plazo agotado.
	 *
	 * Se mantiene en una sola transacción a propósito: un árbol de formulario a
	 * medias es peor que ninguno. Si algo falla, no queda una versión con la mitad
	 * de sus campos.
	 *
	 * `timeout` de 10 minutos es holgado adrede — es un seed que se ejecuta a mano
	 * y una vez, y quedarse corto cuesta mucho más que esperar.
	 */
	await prisma.$transaction(
		async (tx) => {
			await tx.form_definition.upsert({
				where: { id: ids.form },
				create: {
					id: ids.form,
					code: semilla.code,
					slug: semilla.slug,
					name: semilla.name,
					description: semilla.description,
					owner_area: semilla.ownerArea,
					created_by_id: userId,
					updated_by_id: userId
				},
				update: {
					name: semilla.name,
					description: semilla.description,
					owner_area: semilla.ownerArea,
					updated_by_id: userId
				}
			})

			await tx.form_version.upsert({
				where: { id: ids.version },
				create: {
					id: ids.version,
					form_id: ids.form,
					/// El versionado del motor dinámico es una línea distinta de la
					/// revisión documental de HSEQ. La revisión del documento va en
					/// `source_metadata_json`.
					version_number: versionNumber,
					status: 'DRAFT',
					title: semilla.version.title,
					description: semilla.version.description ?? null,
					instructions: semilla.version.instructions ?? null,
					settings_json: (semilla.version.settings ?? {}) as Prisma.InputJsonValue,
					source_metadata_json: {
						...semilla.source,
						suggested: semilla.suggested,
						transcriptionWarnings: semilla.warnings
					} as Prisma.InputJsonValue,
					created_by_id: userId
				},
				update: {
					title: semilla.version.title,
					description: semilla.version.description ?? null,
					instructions: semilla.version.instructions ?? null,
					settings_json: (semilla.version.settings ?? {}) as Prisma.InputJsonValue,
					source_metadata_json: {
						...semilla.source,
						suggested: semilla.suggested,
						transcriptionWarnings: semilla.warnings
					} as Prisma.InputJsonValue
				}
			})

			/// Se refuerza bajo transacción: entre la lectura optimista de arriba y
			/// este punto cabe una publicación desde el dashboard.
			const actual = await tx.form_version.findUnique({
				where: { id: ids.version },
				select: { status: true }
			})
			if (actual?.status !== 'DRAFT') {
				throw new Error(
					`${semilla.code}: la versión ${ids.version} está en ${actual?.status}. ` +
						'Una versión publicada no se sobrescribe: clónala desde el dashboard.'
				)
			}

			for (const [si, section] of semilla.version.sections.entries()) {
				const sectionId = ids.section(section.key)
				await tx.form_section.upsert({
					where: { id: sectionId },
					create: {
						id: sectionId,
						version_id: ids.version,
						key: section.key,
						title: section.title,
						description: section.description ?? null,
						sort_order: (si + 1) * 100,
						settings_json: (section.settings ?? {}) as Prisma.InputJsonValue
					},
					update: {
						key: section.key,
						title: section.title,
						description: section.description ?? null,
						sort_order: (si + 1) * 100,
						/// La etapa vive aquí: recargar la semilla tiene que poder
						/// corregirla, igual que corrige etiquetas y ayudas.
						settings_json: (section.settings ?? {}) as Prisma.InputJsonValue
					}
				})

				const escribirCampos = async (
					fields: FormFieldDraft[],
					parentFieldId: string | null
				): Promise<void> => {
					for (const [fi, field] of fields.entries()) {
						const fieldId = ids.field(field.key)
						await tx.form_field.upsert({
							where: { id: fieldId },
							create: {
								id: fieldId,
								version_id: ids.version,
								section_id: sectionId,
								parent_field_id: parentFieldId,
								key: field.key,
								type: field.type,
								label: field.label,
								help_text: field.helpText ?? null,
								placeholder: field.placeholder ?? null,
								required: field.required ?? false,
								sort_order: (fi + 1) * 100,
								config_json: (field.config ?? {}) as Prisma.InputJsonValue,
								validation_json: (field.validation ?? {}) as Prisma.InputJsonValue,
								visibility_rule_json: jsonOrDbNull(field.visibilityRule),
								default_value_json: jsonOrDbNull(field.defaultValue)
							},
							update: {
								section_id: sectionId,
								parent_field_id: parentFieldId,
								key: field.key,
								type: field.type,
								label: field.label,
								help_text: field.helpText ?? null,
								placeholder: field.placeholder ?? null,
								required: field.required ?? false,
								sort_order: (fi + 1) * 100,
								config_json: (field.config ?? {}) as Prisma.InputJsonValue,
								validation_json: (field.validation ?? {}) as Prisma.InputJsonValue,
								visibility_rule_json: jsonOrDbNull(field.visibilityRule),
								default_value_json: jsonOrDbNull(field.defaultValue)
							}
						})
						campos += 1

						for (const [oi, option] of (field.options ?? []).entries()) {
							const optionId = ids.option(field.key, option.value)
							await tx.form_field_option.upsert({
								where: { id: optionId },
								create: {
									id: optionId,
									field_id: fieldId,
									value: option.value,
									label: option.label,
									color: option.color ?? null,
									score: option.score ?? null,
									sort_order: (oi + 1) * 100,
									metadata_json: (option.metadata ?? {}) as Prisma.InputJsonValue
								},
								update: {
									value: option.value,
									label: option.label,
									color: option.color ?? null,
									score: option.score ?? null,
									sort_order: (oi + 1) * 100
								}
							})
							opcionesEscritas += 1
						}

						if (field.children?.length) await escribirCampos(field.children, fieldId)
					}
				}

				await escribirCampos(section.fields, null)

				/// Progreso por sección: sin esto, un formulario de 241 campos son casi
				/// un minuto de silencio y no hay forma de distinguir «va lento» de
				/// «se colgó».
				process.stdout.write(
					`\r    ${semilla.code}: sección ${si + 1}/${semilla.version.sections.length}` +
						` · ${campos} campos · ${opcionesEscritas} opciones   `
				)
			}
			process.stdout.write('\r' + ' '.repeat(78) + '\r')
		},
		{ maxWait: 60_000, timeout: 600_000 }
	)

	return {
		code: semilla.code,
		versionId: ids.version,
		formId: ids.form,
		secciones: semilla.version.sections.length,
		campos,
		opciones: opcionesEscritas,
		omitida: false
	}
}
