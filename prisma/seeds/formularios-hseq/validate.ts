/**
 * Validación e inventario de las semillas, SIN base de datos.
 *
 * Es lo que permite revisar los trece artefactos antes de que exista una sola
 * fila en Postgres: se ejecuta el MISMO `validateFormDefinition` que corre el
 * `publish` del backend, así que una semilla que pase aquí pasará allí.
 *
 * NO importa Prisma ni abre ninguna conexión. Si en algún momento necesitara la
 * base, dejaría de servir para su propósito.
 */

import {
	capabilitiesOf,
	isFieldType,
	validateFormDefinition,
	type FormFieldDraft,
	type ValidationIssue
} from '../../../src/modules/formularios-dinamicos/domain'
import { seedIds } from './ids'
import type { SeedDefinition } from './types'

export interface SeedReport {
	code: string
	name: string
	valid: boolean
	errors: ValidationIssue[]
	warnings: ValidationIssue[]
	/** Advertencias de transcripción declaradas en la semilla. */
	transcriptionWarnings: string[]
	counts: {
		sections: number
		fields: number
		answerable: number
		required: number
		options: number
		rules: number
		containers: number
		attachments: number
	}
	ids: { form: string; version: string }
}

function recorrer(fields: FormFieldDraft[]): FormFieldDraft[] {
	return fields.flatMap((f) => [f, ...recorrer(f.children ?? [])])
}

/** Cuenta secciones, campos, opciones y reglas de una semilla. */
export function contar(seed: SeedDefinition): SeedReport['counts'] {
	const todos = seed.version.sections.flatMap((s) => recorrer(s.fields))
	return {
		sections: seed.version.sections.length,
		fields: todos.length,
		answerable: todos.filter((f) => isFieldType(f.type) && capabilitiesOf(f.type).slot !== 'none').length,
		required: todos.filter((f) => f.required).length,
		options: todos.reduce((sum, f) => sum + (f.options?.length ?? 0), 0),
		rules: todos.filter((f) => f.visibilityRule).length,
		containers: todos.filter((f) => isFieldType(f.type) && capabilitiesOf(f.type).children).length,
		attachments: todos.filter((f) => isFieldType(f.type) && capabilitiesOf(f.type).attachment).length
	}
}

export function revisarSemilla(seed: SeedDefinition): SeedReport {
	/// Modo `publish`: se valida con el mismo rigor con el que el backend la
	/// publicaría. Validarla en modo `draft` dejaría pasar semillas que HSEQ no
	/// podría publicar y el problema aparecería al final.
	const resultado = validateFormDefinition(seed.version, { mode: 'publish' })
	const ids = seedIds(seed.code, seed.source.sourceRevision)

	return {
		code: seed.code,
		name: seed.name,
		valid: resultado.valid,
		errors: resultado.errors,
		warnings: resultado.warnings,
		transcriptionWarnings: seed.warnings,
		counts: contar(seed),
		ids: { form: ids.form, version: ids.version }
	}
}

export interface SeedSetReport {
	total: number
	validas: number
	invalidas: number
	reports: SeedReport[]
	/** Problemas del CONJUNTO, no de una semilla suelta. */
	problemas: string[]
}

/**
 * Revisa el conjunto completo.
 *
 * Además de validar cada semilla, comprueba lo que solo se ve mirándolas juntas:
 * códigos y slugs repetidos (que la base rechazaría con `uq_form_definitions_code`
 * dejando la carga a medias) y colisiones de id determinístico.
 */
export function revisarConjunto(semillas: SeedDefinition[]): SeedSetReport {
	const reports = semillas.map(revisarSemilla)
	const problemas: string[] = []

	const porCodigo = new Map<string, number>()
	const porSlug = new Map<string, number>()
	const porFormId = new Map<string, string[]>()
	const porVersionId = new Map<string, string[]>()

	for (const seed of semillas) {
		porCodigo.set(seed.code, (porCodigo.get(seed.code) ?? 0) + 1)
		porSlug.set(seed.slug, (porSlug.get(seed.slug) ?? 0) + 1)
	}
	for (const report of reports) {
		porFormId.set(report.ids.form, [...(porFormId.get(report.ids.form) ?? []), report.code])
		porVersionId.set(report.ids.version, [...(porVersionId.get(report.ids.version) ?? []), report.code])
	}

	for (const [code, n] of porCodigo) {
		if (n > 1) problemas.push(`El código ${code} aparece ${n} veces.`)
	}
	for (const [slug, n] of porSlug) {
		if (n > 1) problemas.push(`El slug ${slug} aparece ${n} veces.`)
	}
	for (const [id, codes] of porFormId) {
		if (codes.length > 1) problemas.push(`Colisión de id de formulario ${id}: ${codes.join(', ')}.`)
	}
	for (const [id, codes] of porVersionId) {
		if (codes.length > 1) problemas.push(`Colisión de id de versión ${id}: ${codes.join(', ')}.`)
	}

	/// Ninguna semilla debe declarar estado publicado ni assignments: eso lo
	/// decide HSEQ. Las semillas no tienen campo para ello por construcción, así
	/// que aquí solo se comprueba lo que sí podrían traer por error.
	for (const seed of semillas) {
		if (seed.source.importStatus !== 'DRAFT_REQUIRES_HSEQ_REVIEW') {
			problemas.push(`${seed.code} no está marcada como DRAFT_REQUIRES_HSEQ_REVIEW.`)
		}
	}

	return {
		total: reports.length,
		validas: reports.filter((r) => r.valid).length,
		invalidas: reports.filter((r) => !r.valid).length,
		reports,
		problemas
	}
}

/**
 * Informe legible para la revisión de HSEQ.
 *
 * Texto plano y no JSON: quien lo revisa es HSEQ, no un programa, y el documento
 * pide «un inventario final de secciones, fields, options y reglas por código
 * para revisión».
 */
export function informeLegible(reporte: SeedSetReport): string {
	const lineas: string[] = []
	const sep = '─'.repeat(78)

	lineas.push(sep)
	lineas.push('INVENTARIO DE SEMILLAS HSEQ — FORMULARIOS DINÁMICOS')
	lineas.push(`${reporte.total} semillas · ${reporte.validas} válidas · ${reporte.invalidas} con errores`)
	lineas.push('Todas quedan en DRAFT. Ninguna crea asignaciones ni se publica.')
	lineas.push(sep)

	if (reporte.problemas.length) {
		lineas.push('')
		lineas.push('PROBLEMAS DEL CONJUNTO')
		for (const p of reporte.problemas) lineas.push(`  ✗ ${p}`)
	}

	lineas.push('')
	lineas.push('RESUMEN')
	lineas.push(
		'  CÓDIGO        SEC  CAMPOS  RESP  OBLIG  OPC  REGLAS  GRUPOS  ADJ  ESTADO'
	)
	for (const r of reporte.reports) {
		const c = r.counts
		lineas.push(
			`  ${r.code.padEnd(13)} ${String(c.sections).padStart(3)}  ${String(c.fields).padStart(6)}  ` +
				`${String(c.answerable).padStart(4)}  ${String(c.required).padStart(5)}  ` +
				`${String(c.options).padStart(3)}  ${String(c.rules).padStart(6)}  ` +
				`${String(c.containers).padStart(6)}  ${String(c.attachments).padStart(3)}  ` +
				`${r.valid ? 'OK' : `${r.errors.length} ERROR(ES)`}`
		)
	}

	const totales = reporte.reports.reduce(
		(acc, r) => ({
			sections: acc.sections + r.counts.sections,
			fields: acc.fields + r.counts.fields,
			options: acc.options + r.counts.options,
			rules: acc.rules + r.counts.rules
		}),
		{ sections: 0, fields: 0, options: 0, rules: 0 }
	)
	lineas.push(
		`  TOTAL          ${String(totales.sections).padStart(3)}  ${String(totales.fields).padStart(6)}` +
			`                    ${String(totales.options).padStart(3)}  ${String(totales.rules).padStart(6)}`
	)

	for (const r of reporte.reports) {
		lineas.push('')
		lineas.push(sep)
		lineas.push(`${r.code} — ${r.name}`)
		lineas.push(`  id formulario : ${r.ids.form}`)
		lineas.push(`  id versión    : ${r.ids.version}`)

		if (r.errors.length) {
			lineas.push('  ERRORES (bloquean la publicación):')
			for (const e of r.errors) lineas.push(`    ✗ [${e.code}] ${e.path} — ${e.message}`)
		}
		if (r.warnings.length) {
			lineas.push('  ADVERTENCIAS DEL VALIDADOR:')
			for (const w of r.warnings) lineas.push(`    ! [${w.code}] ${w.path} — ${w.message}`)
		}
		if (r.transcriptionWarnings.length) {
			lineas.push('  NOTAS DE TRANSCRIPCIÓN (revisar con HSEQ):')
			for (const t of r.transcriptionWarnings) lineas.push(`    • ${t}`)
		}
		if (!r.errors.length && !r.warnings.length && !r.transcriptionWarnings.length) {
			lineas.push('  Sin observaciones.')
		}
	}

	lineas.push('')
	lineas.push(sep)
	lineas.push('CHECKLIST HSEQ ANTES DE PUBLICAR')
	for (const item of [
		'Confirmar código, revisión y fecha contra el encabezado del archivo original.',
		'Corregir ortografía sin cambiar el sentido normativo.',
		'Definir required, NA permitido y observaciones obligatorias por estado negativo.',
		'Confirmar frecuencia, target, vehículo/sede y ventana de vigencia.',
		'Revisar datos personales, firma, fotos y política de retención.',
		'Verificar límites y mensajes de criticidad.',
		'Probar en un teléfono pequeño (320 px) y en modo avión.',
		'Firmar la aprobación funcional fuera del sistema antes de activar assignments.'
	]) {
		lineas.push(`  [ ] ${item}`)
	}
	lineas.push(sep)

	return lineas.join('\n')
}
