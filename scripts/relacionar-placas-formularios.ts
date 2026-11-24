/**
 * Completa el vehículo de inspecciones HSEQ enviadas que quedaron sin placa.
 *
 * Modo seguro: `npx tsx scripts/relacionar-placas-formularios.ts` solo simula.
 * Para escribir referencias aprobadas por la evidencia: añade `--apply`.
 *
 * Solo toca `form_submissions.vehicle_id`, `context_json.vehicleId` y
 * `context_json.vehiclePlate`. Las respuestas y el formulario no se reescriben.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

type TargetDate = { day: string; source: 'inspección' | 'entrega' | 'fecha de negocio'; priority: number }
type Vehicle = { id: string; placa: string; deleted_at: Date | null }
type Evidence = { vehicleId: string; plate: string; score: number; source: string; dates: Set<string>; notes: string[] }
type Result = {
	status: 'RECOMENDADA' | 'AMBIGUA' | 'SIN_EVIDENCIA' | 'SIN_CONDUCTOR' | 'EXCLUIDA_LAURA'
	code: string
	name: string
	submissionId: string
	conductor: string | null
	inspected: string | null
	submitted: string | null
	vehicleId: string | null
	plate: string | null
	confidence: 'ALTA' | 'MEDIA' | 'BAJA' | null
	source: string | null
	evidence: string[]
	context: unknown
}

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const LAURA_KEY = 'laura valentina soraca'

function normalizar(value: unknown): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}

function placaKey(value: unknown): string {
	return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function nombrePersona(persona: any): string {
	return [persona?.nombre, persona?.apellido].filter(Boolean).join(' ').trim()
}

function esLaura(...values: unknown[]): boolean {
	return values.some((value) => normalizar(value).includes(LAURA_KEY))
}

function dia(value: Date | string | null | undefined): string | null {
	if (!value) return null
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
	const date = value instanceof Date ? value : new Date(value)
	if (Number.isNaN(date.getTime())) return null
	return date.toISOString().slice(0, 10)
}

function diaBogota(value: Date | null | undefined): string | null {
	if (!value) return null
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Bogota',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(value)
	const part = (type: string) => parts.find((item) => item.type === type)?.value
	const year = part('year')
	const month = part('month')
	const dayValue = part('day')
	return year && month && dayValue ? `${year}-${month}-${dayValue}` : null
}

function sumarDias(day: string, offset: number): string {
	const date = new Date(`${day}T00:00:00.000Z`)
	date.setUTCDate(date.getUTCDate() + offset)
	return date.toISOString().slice(0, 10)
}

function answerText(answer: any): string | null {
	if (!answer) return null
	if (typeof answer.value_text === 'string') return answer.value_text
	if (typeof answer.value_json === 'string') return answer.value_json
	return null
}

function answerJsonText(answer: any): string | null {
	if (!answer) return null
	if (typeof answer.value_json === 'string') return answer.value_json
	if (answer.value_json && typeof answer.value_json === 'object') {
		for (const key of ['id', 'vehicleId', 'vehiculoId', 'plate', 'placa', 'value']) {
			const value = answer.value_json[key]
			if (typeof value === 'string' && value.trim()) return value.trim()
		}
	}
	return answerText(answer)
}

function campo(fields: any[], keys: string[], labelParts: string[]): any | null {
	const byKey = fields.find((field) => keys.includes(field.key))
	if (byKey) return byKey
	return fields.find((field) => {
		const label = normalizar(field.label)
		return labelParts.length > 0 && labelParts.every((part) => label.includes(part))
	}) ?? null
}

function answerFor(submission: any, field: any | null): any | null {
	return field ? submission.answers.find((answer: any) => answer.field_id === field.id) ?? null : null
}

function optionValue(answer: any | null): string | null {
	const values = (answer?.options ?? [])
		.map((item: any) => item.option?.value)
		.filter((value: unknown): value is string => typeof value === 'string')
	return values.length === 1 ? values[0] : null
}

function objectContext(context: unknown): Record<string, unknown> {
	return context && typeof context === 'object' && !Array.isArray(context)
		? { ...(context as Record<string, unknown>) }
		: {}
}

function vehicleByReference(value: string | null, vehicles: Map<string, Vehicle>, byPlate: Map<string, Vehicle>): Vehicle | null {
	if (!value) return null
	const byId = vehicles.get(value)
	if (byId) return byId
	return byPlate.get(placaKey(value)) ?? null
}

function fechaInspeccion(answer: any | null): string | null {
	if (!answer) return null
	if (answer.value_date) return dia(answer.value_date)
	return answerJsonText(answer)
}

function contieneNombreCompleto(text: string, fullName: string): boolean {
	const candidate = normalizar(text)
	const name = normalizar(fullName)
	if (candidate === name) return true
	const candidateTokens = candidate.split(' ').filter(Boolean)
	const nameTokens = name.split(' ').filter(Boolean)
	if (candidateTokens.length < 2 || nameTokens.length < 2) return false
	const orderedSubset = (shorter: string[], longer: string[]) => {
		let cursor = 0
		return shorter.every((token) => {
			const found = longer.indexOf(token, cursor)
			if (found < 0) return false
			cursor = found + 1
			return true
		})
	}
	return orderedSubset(candidateTokens, nameTokens) || orderedSubset(nameTokens, candidateTokens)
}

function resolverConductor(submission: any, drivers: any[]): { driver: any | null; excludedLaura: boolean } {
	const inspectorName = answerText(submission.inspectorAnswer)
	const inspectorRole = normalizar(answerText(submission.inspectorRoleAnswer))
	if (esLaura(inspectorName)) return { driver: null, excludedLaura: true }

	if (submission.conductor) {
		const driver = submission.conductor
		if (esLaura(nombrePersona(driver))) return { driver: null, excludedLaura: true }
		return normalizar(driver.cargo).includes('conductor') ? { driver, excludedLaura: false } : { driver: null, excludedLaura: false }
	}

	if (inspectorName) {
		const nameMatches = drivers.filter((driver) => contieneNombreCompleto(inspectorName, nombrePersona(driver)))
		if (nameMatches.length === 1 && (inspectorRole.includes('conductor') || normalizar(inspectorName) === normalizar(nombrePersona(nameMatches[0])))) {
			return { driver: nameMatches[0], excludedLaura: false }
		}
		// El nombre del inspector es distinto del usuario que entregó el formulario;
		// no se debe convertir al usuario administrativo en conductor por su correo.
		return { driver: null, excludedLaura: false }
	}

	const actorDocument = String(submission.usuario?.numero_documento ?? '').replace(/\D/g, '')
	const actorEmail = normalizar(submission.usuario?.correo)
	const byIdentity = drivers.filter((driver) =>
		(actorDocument && String(driver.numero_identificacion ?? '').replace(/\D/g, '') === actorDocument) ||
		(actorEmail && normalizar(driver.email) === actorEmail),
	)
	if (byIdentity.length === 1) return { driver: byIdentity[0], excludedLaura: false }
	if (byIdentity.length > 1) return { driver: null, excludedLaura: false }

	return { driver: null, excludedLaura: false }
}

function addEvidence(
	map: Map<string, Evidence>,
	vehicle: Vehicle,
	score: number,
	source: string,
	dayValue: string,
	note: string,
): void {
	const current = map.get(vehicle.id) ?? {
		vehicleId: vehicle.id,
		plate: vehicle.placa,
		score: 0,
		source,
		dates: new Set<string>(),
		notes: [],
	}
	current.score += score
	current.dates.add(dayValue)
	if (!current.notes.includes(note)) current.notes.push(note)
	map.set(vehicle.id, current)
}

function pickEvidence(map: Map<string, Evidence>, source: string, fallback = false): Pick<Result, 'status' | 'vehicleId' | 'plate' | 'confidence' | 'source' | 'evidence'> {
	const sorted = [...map.values()].sort((a, b) => b.score - a.score || a.plate.localeCompare(b.plate))
	if (!sorted.length) return { status: 'SIN_EVIDENCIA', vehicleId: null, plate: null, confidence: null, source: null, evidence: [] }
	const first = sorted[0]
	const total = sorted.reduce((sum, item) => sum + item.score, 0)
	const share = total > 0 ? first.score / total : 0
	const margin = sorted.length === 1 || first.score >= sorted[1].score * 1.5
	const recommend = sorted.length === 1 || (share >= 0.68 && margin)
	if (!recommend) {
		return {
			status: 'AMBIGUA',
			vehicleId: null,
			plate: first.plate,
			confidence: 'BAJA',
			source,
			evidence: sorted.map((item) => `${item.plate}: ${item.notes.join('; ')}`),
		}
	}
	return {
		status: 'RECOMENDADA',
		vehicleId: first.vehicleId,
		plate: first.plate,
		confidence: fallback ? 'MEDIA' : sorted.length === 1 ? 'ALTA' : 'MEDIA',
		source,
		evidence: first.notes,
	}
}

async function evidenciaRecorridos(prisma: PrismaClient, driverId: string, dates: TargetDate[], vehicles: Map<string, Vehicle>, byPlate: Map<string, Vehicle>) {
	const targetDays = [...new Set(dates.map((item) => item.day))]
	if (!targetDays.length) return new Map<string, Evidence>()
	const rows = await prisma.registro_dia_laboral.findMany({
		where: {
			conductor_id: driverId,
			deleted_at: null,
			OR: targetDays.map((dayValue) => ({ fecha: { gte: new Date(`${sumarDias(dayValue, -2)}T00:00:00.000Z`), lte: new Date(`${dayValue}T00:00:00.000Z`) } })),
		},
		select: {
			fecha: true,
			segmentos: {
				where: { deleted_at: null },
				select: { vehiculo_id: true, vehiculo_placa: true, dias_offset_inicio: true, dias_offset_fin: true, horas_conducidas: true },
			},
		},
	})
	const evidence = new Map<string, Evidence>()
	for (const row of rows) {
		const baseDay = dia(row.fecha)
		if (!baseDay) continue
		for (const segment of row.segmentos) {
			const vehicle = (segment.vehiculo_id ? vehicles.get(segment.vehiculo_id) : null) ?? vehicleByReference(segment.vehiculo_placa, vehicles, byPlate)
			if (!vehicle) continue
			const from = sumarDias(baseDay, segment.dias_offset_inicio ?? 0)
			const to = sumarDias(baseDay, segment.dias_offset_fin ?? segment.dias_offset_inicio ?? 0)
			for (const target of dates) {
				if (target.day < from || target.day > to) continue
				const hours = Math.max(0, Number(segment.horas_conducidas ?? 0))
				const score = target.priority * 100 + Math.max(1, Math.min(hours, 24))
				addEvidence(evidence, vehicle, score, 'Recorridos / días laborados', target.day, `${target.source} ${target.day}; tramo ${from}–${to}; ${hours.toFixed(1)} h`)
			}
		}
	}
	return evidence
}

async function evidenciaServicios(prisma: PrismaClient, driverId: string, dates: TargetDate[], vehicles: Map<string, Vehicle>) {
	const targetDays = [...new Set(dates.map((item) => item.day))]
	if (!targetDays.length) return new Map<string, Evidence>()
	const dateClauses = targetDays.flatMap((dayValue) => {
		const start = new Date(`${dayValue}T00:00:00.000Z`)
		const end = new Date(`${sumarDias(dayValue, 1)}T00:00:00.000Z`)
		return [{ fecha_realizacion: { gte: start, lt: end } }, { fecha_finalizacion: { gte: start, lt: end } }]
	})
	const rows = await prisma.servicio.findMany({
		where: { conductor_id: driverId, vehiculo_id: { not: null }, deleted_at: null, OR: dateClauses },
		select: { vehiculo_id: true, fecha_realizacion: true, fecha_finalizacion: true },
	})
	const evidence = new Map<string, Evidence>()
	for (const row of rows) {
		const vehicle = row.vehiculo_id ? vehicles.get(row.vehiculo_id) : null
		if (!vehicle) continue
		for (const target of dates) {
			const matches = [row.fecha_realizacion, row.fecha_finalizacion].some((dateValue) => diaBogota(dateValue) === target.day)
			if (matches) addEvidence(evidence, vehicle, target.priority * 100 + 1, 'Servicios asignados', target.day, `${target.source} ${target.day}`)
		}
	}
	return evidence
}

async function evidenciaRecargos(prisma: PrismaClient, driverId: string, dates: TargetDate[], vehicles: Map<string, Vehicle>) {
	const nearDays = [...new Set(dates.flatMap((target) => [-3, -2, -1, 0, 1, 2, 3].map((offset) => sumarDias(target.day, offset))))]
	const months = [...new Set(nearDays.map((value) => value.slice(0, 7)))].map((value) => {
		const [year, month] = value.split('-').map(Number)
		return { a_o: year, mes: month }
	})
	if (!months.length) return new Map<string, Evidence>()
	const planillas = await prisma.recargos_planillas.findMany({
		where: { conductor_id: driverId, deleted_at: null, OR: months },
		select: {
			a_o: true,
			mes: true,
			vehiculo_id: true,
			dias_laborales_planillas: { where: { deleted_at: null }, select: { dia: true } },
		},
	})
	const evidence = new Map<string, Evidence>()
	for (const planilla of planillas) {
		const vehicle = vehicles.get(planilla.vehiculo_id)
		if (!vehicle) continue
		for (const laborDay of planilla.dias_laborales_planillas) {
			const recordDay = new Date(Date.UTC(planilla.a_o, planilla.mes - 1, laborDay.dia)).toISOString().slice(0, 10)
			for (const target of dates) {
				const distance = Math.abs(Math.round((Date.parse(`${recordDay}T00:00:00Z`) - Date.parse(`${target.day}T00:00:00Z`)) / 86_400_000))
				if (distance > 3) continue
				const score = (4 - distance) * target.priority
				addEvidence(evidence, vehicle, score, 'Recargos / planilla de días', recordDay, `día laborado ${recordDay}; a ${distance} día(s) de ${target.source} ${target.day}`)
			}
		}
	}
	return evidence
}

async function main(): Promise<void> {
	if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el .env de este backend.')
	const url = new URL(process.env.DATABASE_URL)
	const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''))
	const vehiclesList = await prisma.vehiculos.findMany({ select: { id: true, placa: true, deleted_at: true } })
	const vehicles = new Map(vehiclesList.map((vehicle) => [vehicle.id, vehicle as Vehicle]))
	const byPlate = new Map(vehiclesList.map((vehicle) => [placaKey(vehicle.placa), vehicle as Vehicle]))
	const drivers = (await prisma.conductores.findMany({ select: { id: true, nombre: true, apellido: true, cargo: true, numero_identificacion: true, email: true } }))
		.filter((driver) => normalizar(driver.cargo).includes('conductor'))
	const candidateVersions = await prisma.form_version.findMany({
		where: {
			fields: {
				some: {
					OR: [
						{ key: { in: ['vehiculo', 'ubicacion_tipo', 'ubicacion_sede'] } },
						{ label: { contains: 'placa', mode: 'insensitive' } },
						{ label: { contains: 'ubicación', mode: 'insensitive' } },
					],
				},
			},
		},
		select: { id: true },
	})
	const submissions = await prisma.form_submission.findMany({
		where: { status: 'SUBMITTED', deleted_at: null, vehicle_id: null, version_id: { in: candidateVersions.map((version) => version.id) } },
		include: {
			version: { include: { form: { select: { code: true, name: true, slug: true } }, fields: { select: { id: true, key: true, label: true, type: true } } } },
			conductor: { select: { id: true, nombre: true, apellido: true, cargo: true, numero_identificacion: true, email: true } },
			usuario: { select: { id: true, nombre: true, correo: true, numero_documento: true } },
			answers: { include: { field: { select: { id: true, key: true, label: true } }, options: { include: { option: { select: { value: true, label: true } } } } } },
		},
	})

	const results: Result[] = []
	let locationRowsSkipped = 0
	let sedeVacíaAsumidaVehiculo = 0
	for (const submission of submissions as any[]) {
		const fields = submission.version.fields
		const lookupField = campo(fields, ['vehiculo'], ['placa', 'vehiculo'])
		const siteField = campo(fields, ['ubicacion_sede'], ['lugar', 'ubicacion'])
		const typeField = campo(fields, ['ubicacion_tipo'], ['elemento', 'inspeccionado', 'esta'])
		const inspectedField = campo(fields, ['fecha_inspeccion'], ['fecha', 'inspeccion'])
		const inspectorField = campo(fields, ['inspector_nombre'], ['inspector', 'nombre'])
		const inspectorRoleField = campo(fields, ['inspector_cargo'], ['inspector', 'cargo'])
		if (!lookupField && !siteField && !typeField) continue
		const siteAnswer = answerFor(submission, siteField)
		const typeAnswer = answerFor(submission, typeField)
		const selectedType = optionValue(typeAnswer)
		if (answerText(siteAnswer)?.trim()) {
			locationRowsSkipped++
			continue
		}
		if (selectedType === 'SEDE') sedeVacíaAsumidaVehiculo++

		const lookupAnswer = answerFor(submission, lookupField)
		const directContext = objectContext(submission.context_json)
		const directVehicle =
			vehicleByReference(typeof directContext.vehicleId === 'string' ? directContext.vehicleId : null, vehicles, byPlate) ??
			vehicleByReference(typeof directContext.vehiclePlate === 'string' ? directContext.vehiclePlate : null, vehicles, byPlate) ??
			vehicleByReference(answerJsonText(lookupAnswer), vehicles, byPlate)
		const inspected = fechaInspeccion(answerFor(submission, inspectedField))
		const submitted = diaBogota(submission.submitted_at)
		const businessDay = dia(submission.business_date)
		const dateMap = new Map<string, TargetDate>()
		if (inspected) dateMap.set(inspected, { day: inspected, source: 'inspección', priority: 3 })
		if (submitted && !dateMap.has(submitted)) dateMap.set(submitted, { day: submitted, source: 'entrega', priority: 2 })
		if (businessDay && !dateMap.has(businessDay)) dateMap.set(businessDay, { day: businessDay, source: 'fecha de negocio', priority: 1 })
		const dates = [...dateMap.values()]
		const inspectorAnswer = answerFor(submission, inspectorField)
		const inspectorRoleAnswer = answerFor(submission, inspectorRoleField)
		const rowBase = {
			code: submission.version.form.code,
			name: submission.version.form.name,
			submissionId: submission.id,
			conductor: null as string | null,
			inspected,
			submitted,
			context: submission.context_json,
		}
		if (directVehicle) {
			results.push({ ...rowBase, status: 'RECOMENDADA', conductor: nombrePersona(submission.conductor) || null, vehicleId: directVehicle.id, plate: directVehicle.placa, confidence: 'ALTA', source: 'Contexto o selector guardado en el envío', evidence: ['La placa ya estaba en context_json o en el valor del selector.'] })
			continue
		}

		const resolved = resolverConductor({ ...submission, inspectorAnswer, inspectorRoleAnswer }, drivers)
		if (resolved.excludedLaura) {
			results.push({ ...rowBase, status: 'EXCLUIDA_LAURA', conductor: null, vehicleId: null, plate: null, confidence: null, source: null, evidence: ['Exclusión solicitada: Laura Valentina Soraca no se considera conductora.'] })
			continue
		}
		if (!resolved.driver) {
			results.push({ ...rowBase, status: 'SIN_CONDUCTOR', conductor: null, vehicleId: null, plate: null, confidence: null, source: null, evidence: ['No hubo una coincidencia única por conductor_id, documento, correo o nombre del inspector.'] })
			continue
		}
		const driver = resolved.driver
		rowBase.conductor = nombrePersona(driver)
		if (esLaura(nombrePersona(driver))) {
			results.push({ ...rowBase, status: 'EXCLUIDA_LAURA', vehicleId: null, plate: null, confidence: null, source: null, evidence: ['Exclusión solicitada: Laura Valentina Soraca no se considera conductora.'] })
			continue
		}
		if (!dates.length) {
			results.push({ ...rowBase, status: 'SIN_EVIDENCIA', vehicleId: null, plate: null, confidence: null, source: null, evidence: ['El envío no tiene fecha de inspección, entrega ni fecha de negocio utilizable.'] })
			continue
		}

		const recorridos = await evidenciaRecorridos(prisma, driver.id, dates, vehicles, byPlate)
		let chosen = pickEvidence(recorridos, 'Recorridos / días laborados')
		if (chosen.status === 'SIN_EVIDENCIA') {
			const servicios = await evidenciaServicios(prisma, driver.id, dates, vehicles)
			chosen = pickEvidence(servicios, 'Servicios asignados')
		}
		if (chosen.status === 'SIN_EVIDENCIA') {
			const recargos = await evidenciaRecargos(prisma, driver.id, dates, vehicles)
			chosen = pickEvidence(recargos, 'Recargos / planilla de días', true)
		}
		results.push({ ...rowBase, ...chosen })
	}

	const applyable = results.filter((result) => result.status === 'RECOMENDADA' && result.vehicleId)
	console.log(`Base local: ${databaseName}`)
	console.log(`Modo: ${APPLY ? 'APLICAR' : 'SIMULACIÓN (sin escrituras)'}`)
	console.log(`Envíos revisados: ${submissions.length} · candidatos por sede vacía: ${results.length}`)
	console.log(`Sede vacía asumida como vehículo: ${sedeVacíaAsumidaVehiculo} · omitidos por ubicación diligenciada: ${locationRowsSkipped}`)
	console.log(`Recomendadas: ${applyable.length} · ambiguas: ${results.filter((r) => r.status === 'AMBIGUA').length} · sin conductor: ${results.filter((r) => r.status === 'SIN_CONDUCTOR').length} · sin evidencia: ${results.filter((r) => r.status === 'SIN_EVIDENCIA').length} · Laura excluida: ${results.filter((r) => r.status === 'EXCLUIDA_LAURA').length}`)
	for (const result of results) {
		const label = result.status === 'RECOMENDADA' ? `${result.plate} (${result.confidence}; ${result.source})` : result.plate ? `posible ${result.plate} (${result.source}; revisar)` : result.status
		console.log(`- ${result.code} · ${result.submissionId.slice(0, 8)} · ${result.conductor ?? 'conductor sin resolver'} · inspección ${result.inspected ?? '—'} · entrega ${result.submitted ?? '—'} → ${label}`)
		for (const note of result.evidence) console.log(`  ${note}`)
	}

	if (!APPLY) {
		console.log('\nNada fue modificado. Ejecuta de nuevo con --apply para guardar únicamente las recomendaciones no ambiguas.')
		return
	}
	if (!applyable.length) {
		console.log('\nNo hay referencias seguras para guardar.')
		return
	}

	await prisma.$transaction(async (tx) => {
		for (const result of applyable) {
			const vehicle = vehicles.get(result.vehicleId!)!
			const context = objectContext(result.context)
			context.vehicleId = vehicle.id
			context.vehiclePlate = vehicle.placa
			const updated = await tx.form_submission.updateMany({
				where: { id: result.submissionId, status: 'SUBMITTED', vehicle_id: null },
				data: { vehicle_id: vehicle.id, context_json: context as any },
			})
			if (updated.count !== 1) throw new Error(`El envío ${result.submissionId} cambió durante la ejecución; se revierte la transacción.`)
			await tx.form_submission_event.create({
				data: {
					submission_id: result.submissionId,
					event_type: 'VEHICLE_BACKFILLED',
					actor_type: 'SYSTEM',
					payload_json: {
						vehicleId: vehicle.id,
						vehiclePlate: vehicle.placa,
						method: result.source,
						confidence: result.confidence,
						evidence: result.evidence,
						windowDays: 3,
					} as any,
				},
			})
		}
	})
	console.log(`\nReferencias guardadas: ${applyable.length}. Se registró el evento VEHICLE_BACKFILLED por envío.`)
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	})
	.finally(async () => prisma.$disconnect())
