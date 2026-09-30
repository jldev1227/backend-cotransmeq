/**
 * Cargador de las versiones POR ETAPAS de los dos preoperacionales.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LO EJECUTA EL USUARIO, NUNCA UN AGENTE. Por defecto NO ESCRIBE NADA: es un
 *  simulacro; para escribir de verdad hay que pasar `--apply`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hace tres cosas que `cargar.ts` NO hace, y por eso es un cargador aparte en
 * vez de tres flags nuevos en aquel:
 *
 *  1. escribe la versión con `version_number: 2` sobre el mismo formulario;
 *  2. la PUBLICA;
 *  3. crea una asignación dirigida a conductores CONCRETOS.
 *
 * `cargar.ts` garantiza por contrato que todas sus versiones quedan en `DRAFT`
 * y sin asignaciones —publicar y asignar son decisiones de HSEQ—. Meter aquí
 * esas tres cosas habría convertido esa garantía en «depende de los flags», que
 * es exactamente la clase de contrato que se rompe sin que nadie lo note. La
 * escritura del árbol sí es la misma: los dos llaman a `cargarSemilla` de
 * `escribir.ts`.
 *
 * Idempotente: ids determinísticos, `upsert` en todo, y si la versión ya está
 * publicada se omite su árbol (no se reescribe una versión publicada) pero se
 * reconcilian la asignación y sus destinatarios.
 *
 * Uso:
 *   npm run seeds:formularios:etapas                       # simulacro
 *   npm run seeds:formularios:etapas -- --apply --user <uuid> --conductor <uuid>
 *   npm run seeds:formularios:etapas -- --apply --user <uuid> --conductor <uuid1>,<uuid2>
 *   npm run seeds:formularios:etapas -- --apply --user <uuid> --conductor <uuid> --only HSEQ-FR-08
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { cargarSemilla } from './escribir'
import { seedIds, uuidv5 } from './ids'
import { REVISION_ASIGNACION, REVISION_ETAPAS, SEMILLAS_ETAPAS } from './preoperacional-etapas'
import type { SeedDefinition } from './types'
import { revisarConjunto } from './validate'

/**
 * Número de versión del motor dinámico para las semillas por etapas.
 *
 * La versión 1 es la original; cada revisión por etapas es la siguiente: la
 * revisión 1 fue la versión 2, la revisión 2 es la 3. La versión anterior se
 * queda PUBLICADA —no se archiva— para que los borradores empezados contra ella
 * se puedan terminar.
 */
const VERSION_NUMBER = 1 + REVISION_ETAPAS

interface Opciones {
	apply: boolean
	userId: string | null
	conductores: string[]
	only: string[]
}

function valorDe(argv: string[], flag: string): string | null {
	const i = argv.indexOf(flag)
	return i >= 0 ? (argv[i + 1] ?? null) : null
}

function parseArgs(argv: string[]): Opciones {
	return {
		apply: argv.includes('--apply'),
		userId: valorDe(argv, '--user'),
		conductores: (valorDe(argv, '--conductor') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
		only: (valorDe(argv, '--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
	}
}

/**
 * Ids determinísticos de la asignación y de sus destinatarios.
 *
 * Mismo criterio que el resto del módulo: derivados de `code + revisión`, para
 * que reejecutar el cargador apunte a las mismas filas en vez de crear una
 * asignación nueva cada vez —que en el portal se vería como formularios
 * duplicados—.
 */
function idsAsignacion(code: string) {
	/// De la revisión de la PRIMERA versión por etapas, no de la actual: al subir
	/// `REVISION_ETAPAS` las asignaciones piloto son las mismas y se MUEVEN.
	const revision = REVISION_ASIGNACION[code]
	if (!revision) throw new Error(`${code}: no tiene revisión de asignación en \`REVISION_ASIGNACION\`.`)
	const raiz = `${code}@${revision}`
	return {
		assignment: uuidv5(`assignment:${raiz}`),
		target: (conductorId: string) => uuidv5(`target:${raiz}:${conductorId}`)
	}
}

/** Publica la versión. Réplica de `publicarVersion` sin pasar por la API. */
async function publicar(prisma: PrismaClient, versionId: string, userId: string): Promise<'PUBLICADA' | 'YA_ESTABA'> {
	return prisma.$transaction(async (tx) => {
		/// `FOR UPDATE` igual que el servicio: sin el bloqueo, dos ejecuciones
		/// simultáneas podrían publicar dos veces y pisar `published_at`.
		const bloqueada = await tx.$queryRaw<{ status: string }[]>`
			SELECT status FROM form_versions WHERE id = ${versionId}::uuid FOR UPDATE
		`
		if (!bloqueada.length) throw new Error(`La versión ${versionId} no existe.`)
		if (bloqueada[0].status === 'PUBLISHED') return 'YA_ESTABA'
		if (bloqueada[0].status !== 'DRAFT') {
			throw new Error(`La versión ${versionId} está en ${bloqueada[0].status}; no se puede publicar.`)
		}
		await tx.form_version.update({
			where: { id: versionId },
			data: { status: 'PUBLISHED', published_at: new Date(), published_by_id: userId }
		})
		return 'PUBLICADA'
	})
}

/**
 * Crea o reconcilia la asignación de la versión por etapas.
 *
 * Los destinatarios se reconcilian de forma EXACTA: los conductores pedidos
 * quedan como targets y cualquier otro target de ESTA asignación se elimina. Es
 * lo que hace que «solo a estos dos» siga siendo cierto si alguien añade un
 * `ALL_CONDUCTORS` a mano y se vuelve a ejecutar el cargador.
 *
 * No toca ninguna otra asignación. Las de la versión 1 —que sí son
 * `ALL_CONDUCTORS`— siguen exactamente igual.
 */
async function asignar(
	prisma: PrismaClient,
	semilla: SeedDefinition,
	versionId: string,
	conductores: string[],
	userId: string
): Promise<{ assignmentId: string; targets: number; retirados: number }> {
	const ids = idsAsignacion(semilla.code)

	return prisma.$transaction(async (tx) => {
		await tx.form_assignment.upsert({
			where: { id: ids.assignment },
			create: {
				id: ids.assignment,
				version_id: versionId,
				name: `${semilla.name} — por etapas (piloto)`,
				status: 'ACTIVE',
				/// Mismos parámetros que la asignación de la versión 1 en producción:
				/// `ON_DEMAND` + `UNLIMITED`. Con etapas importa todavía más: el envío
				/// vive abierto varias horas y un límite por período podría dejar
				/// fuera el cierre de un recorrido que empezó el día anterior.
				frequency: 'ON_DEMAND',
				limit_policy: 'UNLIMITED',
				timezone: 'America/Bogota',
				context_schema_json: { vehicleId: { required: true } } as Prisma.InputJsonValue,
				settings_json: { allowOffline: true } as Prisma.InputJsonValue,
				created_by_id: userId
			},
			update: {
				version_id: versionId,
				name: `${semilla.name} — por etapas (piloto)`,
				status: 'ACTIVE',
				context_schema_json: { vehicleId: { required: true } } as Prisma.InputJsonValue,
				settings_json: { allowOffline: true } as Prisma.InputJsonValue,
				/// Si se había borrado lógicamente, reejecutar el cargador la revive.
				deleted_at: null
			}
		})

		for (const conductorId of conductores) {
			await tx.form_assignment_target.upsert({
				where: { id: ids.target(conductorId) },
				create: {
					id: ids.target(conductorId),
					assignment_id: ids.assignment,
					target_type: 'CONDUCTOR',
					conductor_id: conductorId
				},
				update: { assignment_id: ids.assignment, target_type: 'CONDUCTOR', conductor_id: conductorId }
			})
		}

		const sobrantes = await tx.form_assignment_target.deleteMany({
			where: { assignment_id: ids.assignment, id: { notIn: conductores.map((c) => ids.target(c)) } }
		})

		return { assignmentId: ids.assignment, targets: conductores.length, retirados: sobrantes.count }
	})
}

async function main() {
	const opts = parseArgs(process.argv.slice(2))

	const seleccionadas = opts.only.length
		? opts.only.map((code) => {
				const s = SEMILLAS_ETAPAS.find((x) => x.code === code.toUpperCase())
				if (!s) throw new Error(`No existe la semilla por etapas ${code}.`)
				return s
			})
		: SEMILLAS_ETAPAS

	/// Mismo validador que el `publish` del backend, y ANTES de escribir: cargar
	/// un árbol que el publish rechazaría dejaría una versión inservible.
	const reporte = revisarConjunto(seleccionadas)
	if (reporte.invalidas > 0 || reporte.problemas.length > 0) {
		console.error('Hay semillas con errores. Corrígelas antes de cargar.')
		for (const r of reporte.reports.filter((x) => !x.valid)) {
			console.error(`  ${r.code}: ${r.errors.map((e) => `[${e.code}] ${e.path}`).join(', ')}`)
		}
		for (const p of reporte.problemas) console.error(`  ${p}`)
		process.exit(1)
	}

	console.log(`${seleccionadas.length} semilla(s) por etapas validada(s) sin errores.\n`)
	for (const r of reporte.reports) {
		const semilla = seleccionadas.find((s) => s.code === r.code)!
		const porEtapa = new Map<number, number>()
		for (const s of semilla.version.sections) {
			const n = Number((s.settings as Record<string, unknown> | undefined)?.etapa ?? 0)
			porEtapa.set(n, (porEtapa.get(n) ?? 0) + 1)
		}
		console.log(
			`  ${r.code}: ${r.counts.sections} secciones (${[...porEtapa.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([etapa, n]) => `etapa ${etapa}: ${n}`)
				.join(' · ')}), ${r.counts.fields} campos, ${r.counts.options} opciones`
		)
	}

	if (!opts.apply) {
		console.log('\nSIMULACRO: no se escribió nada en la base.')
		console.log('Para cargar de verdad:')
		console.log(
			'  npm run seeds:formularios:etapas -- --apply --user <uuid-de-users.id> --conductor <uuid-de-conductores.id>'
		)
		for (const semilla of seleccionadas) {
			const ids = seedIds(semilla.code, semilla.source.sourceRevision)
			const idsA = idsAsignacion(semilla.code)
			console.log(`\n  ${semilla.code}`)
			console.log(`    form_definitions.id  : ${ids.form} (el MISMO de la versión 1)`)
			console.log(`    form_versions.id     : ${ids.version} (version_number ${VERSION_NUMBER}, quedará PUBLISHED)`)
			console.log(`    form_assignments.id  : ${idsA.assignment}`)
		}
		return
	}

	if (!opts.userId) {
		console.error('Falta --user <uuid>: `created_by_id` es NOT NULL y apunta a `users(id)`.')
		process.exit(1)
	}
	if (!opts.conductores.length) {
		console.error(
			'Falta --conductor <uuid>. Esta versión se asigna a conductores CONCRETOS; ' +
				'sin destinatarios la asignación no le llegaría a nadie.'
		)
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

		const conductores = await prisma.conductores.findMany({
			where: { id: { in: opts.conductores } },
			select: { id: true, nombre: true, apellido: true, numero_identificacion: true }
		})
		const faltan = opts.conductores.filter((id) => !conductores.some((c) => c.id === id))
		if (faltan.length) {
			console.error(`Estos conductores no existen: ${faltan.join(', ')}.`)
			process.exit(1)
		}

		console.log(`\nCargando como ${usuario.correo}.`)
		console.log(
			'Destinatarios: ' +
				conductores.map((c) => `${c.nombre} ${c.apellido} (cc ${c.numero_identificacion})`).join(', ')
		)
		console.log('')

		for (const semilla of seleccionadas) {
			const escrito = await cargarSemilla(prisma, semilla, usuario.id, {
				versionNumber: VERSION_NUMBER,
				siYaPublicada: 'omitir'
			})
			if (escrito.omitida) {
				console.log(`  · ${escrito.code}: la versión ya estaba publicada; su árbol no se tocó.`)
			} else {
				console.log(
					`  ✓ ${escrito.code}: ${escrito.secciones} secciones, ${escrito.campos} campos, ` +
						`${escrito.opciones} opciones`
				)
			}

			const publicacion = await publicar(prisma, escrito.versionId, usuario.id)
			console.log(
				`    versión ${escrito.versionId} → ${publicacion === 'PUBLICADA' ? 'PUBLISHED' : 'ya estaba PUBLISHED'}`
			)

			const asignacion = await asignar(prisma, semilla, escrito.versionId, opts.conductores, usuario.id)
			console.log(
				`    asignación ${asignacion.assignmentId} → ${asignacion.targets} destinatario(s)` +
					(asignacion.retirados ? `, ${asignacion.retirados} target(s) sobrante(s) retirado(s)` : '')
			)
		}

		console.log('\nListo. Las asignaciones de la versión 1 NO se tocaron.')
	} finally {
		await prisma.$disconnect()
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
})
