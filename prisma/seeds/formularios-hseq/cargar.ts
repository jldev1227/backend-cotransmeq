/**
 * Cargador de las semillas HSEQ.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LO EJECUTA EL USUARIO, NUNCA UN AGENTE, Y SOLO DESPUÉS DE:
 *
 *   1. haber aplicado a mano el SQL de
 *      `prisma/migrations/19-08-2026-formularios-dinamicos/migration.sql`;
 *   2. haber revisado el inventario (`npm run seeds:formularios:inventario`)
 *      y las notas de transcripción con HSEQ.
 *
 *  Por defecto NO ESCRIBE NADA: es un simulacro. Para escribir de verdad hay
 *  que pasar `--apply` explícitamente.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Idempotente por diseño:
 *
 *  - Los ids son UUID v5 derivados de `code` + `revisión` + ruta del nodo, así
 *    que cargar dos veces la misma semilla apunta a las mismas filas.
 *  - Cada nodo se escribe con `upsert`. Volver a cargar actualiza etiquetas y
 *    ayuda, y no duplica nada.
 *  - Todas las versiones se crean en `DRAFT` y NO se crea ningún assignment: eso
 *    lo decide HSEQ desde el dashboard, tras la aprobación funcional.
 *
 * Uso:
 *   npm run seeds:formularios:cargar                       # simulacro
 *   npm run seeds:formularios:cargar -- --apply --user <uuid>
 *   npm run seeds:formularios:cargar -- --apply --user <uuid> --only HSEQ-FR-22
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { SEMILLAS_HSEQ, semillaPorCodigo } from './index'
import { seedIds } from './ids'
import { revisarConjunto } from './validate'
import type { SeedDefinition } from './types'
import type { FormFieldDraft } from '../../../src/modules/formularios-dinamicos/domain'

interface Opciones {
	apply: boolean
	userId: string | null
	only: string[]
}

function parseArgs(argv: string[]): Opciones {
	const apply = argv.includes('--apply')
	const userIndex = argv.indexOf('--user')
	const onlyIndex = argv.indexOf('--only')
	return {
		apply,
		userId: userIndex >= 0 ? (argv[userIndex + 1] ?? null) : null,
		only: onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? '').split(',').filter(Boolean) : []
	}
}

/** `Json?` de Prisma no acepta `null`; hay que elegir `DbNull` explícitamente. */
function jsonOrDbNull(value: unknown) {
	return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue)
}

async function cargarSemilla(
	prisma: PrismaClient,
	semilla: SeedDefinition,
	userId: string
): Promise<{ code: string; secciones: number; campos: number; opciones: number }> {
	const ids = seedIds(semilla.code, semilla.source.sourceRevision)
	let campos = 0
	let opciones = 0

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
				/// `version_number` 1 porque el versionado del motor dinámico es una
				/// línea distinta de la revisión documental de HSEQ. La revisión del
				/// documento va en `source_metadata_json`.
				version_number: 1,
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
				source_metadata_json: {
					...semilla.source,
					suggested: semilla.suggested,
					transcriptionWarnings: semilla.warnings
				} as Prisma.InputJsonValue
			}
		})

		/// Se refuerza que la versión siga en DRAFT: si alguien la publicó y se
		/// recarga la semilla, sobrescribir su árbol rompería los envíos existentes.
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
					sort_order: (si + 1) * 100
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
						opciones += 1
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
					` · ${campos} campos · ${opciones} opciones   `
			)
		}
		process.stdout.write('\r' + ' '.repeat(78) + '\r')
		},
		{ maxWait: 60_000, timeout: 600_000 }
	)

	return { code: semilla.code, secciones: semilla.version.sections.length, campos, opciones }
}

async function main() {
	const opts = parseArgs(process.argv.slice(2))

	const seleccionadas = opts.only.length
		? opts.only.map((code) => {
				const s = semillaPorCodigo(code)
				if (!s) throw new Error(`No existe la semilla ${code}.`)
				return s
			})
		: SEMILLAS_HSEQ

	/// Se valida ANTES de escribir. Cargar una semilla con errores dejaría en la
	/// base un formulario que el publish rechazaría después.
	const reporte = revisarConjunto(seleccionadas)
	if (reporte.invalidas > 0 || reporte.problemas.length > 0) {
		console.error('Hay semillas con errores. Ejecuta el inventario y corrígelas antes de cargar.')
		for (const r of reporte.reports.filter((x) => !x.valid)) {
			console.error(`  ${r.code}: ${r.errors.map((e) => `[${e.code}] ${e.path}`).join(', ')}`)
		}
		for (const p of reporte.problemas) console.error(`  ${p}`)
		process.exit(1)
	}

	console.log(`${seleccionadas.length} semilla(s) validada(s) sin errores.`)

	if (!opts.apply) {
		console.log('\nSIMULACRO: no se escribió nada en la base.')
		console.log('Para cargar de verdad:')
		console.log('  npm run seeds:formularios:cargar -- --apply --user <uuid-de-usuario>')
		console.log('\nAntes de eso, asegúrate de haber aplicado a mano el SQL de')
		console.log('  prisma/migrations/19-08-2026-formularios-dinamicos/migration.sql')
		for (const semilla of seleccionadas) {
			const ids = seedIds(semilla.code, semilla.source.sourceRevision)
			console.log(`\n  ${semilla.code}`)
			console.log(`    form_definitions.id : ${ids.form}`)
			console.log(`    form_versions.id    : ${ids.version} (DRAFT, version_number 1)`)
		}
		return
	}

	if (!opts.userId) {
		console.error('Falta --user <uuid>: `created_by_id` es NOT NULL y apunta a `users(id)`.')
		process.exit(1)
	}

	const prisma = new PrismaClient()
	try {
		const usuario = await prisma.usuarios.findUnique({
			where: { id: opts.userId },
			select: { id: true, correo: true }
		})
		if (!usuario) {
			console.error(`El usuario ${opts.userId} no existe en \`users\`.`)
			process.exit(1)
		}
		console.log(`Cargando como ${usuario.correo}.\n`)

		for (const semilla of seleccionadas) {
			const resultado = await cargarSemilla(prisma, semilla, usuario.id)
			console.log(
				`  ✓ ${resultado.code}: ${resultado.secciones} secciones, ` +
					`${resultado.campos} campos, ${resultado.opciones} opciones`
			)
		}

		console.log('\nListo. Todas las versiones quedaron en DRAFT y SIN asignaciones.')
		console.log('Revisa cada formulario en /dashboard/formularios antes de publicarlo.')
	} finally {
		await prisma.$disconnect()
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
})
