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

import { PrismaClient } from '@prisma/client'
import { cargarSemilla } from './escribir'
import { SEMILLAS_HSEQ, semillaPorCodigo } from './index'
import { seedIds } from './ids'
import { revisarConjunto } from './validate'

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
