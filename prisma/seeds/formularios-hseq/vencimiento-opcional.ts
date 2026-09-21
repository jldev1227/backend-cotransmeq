/**
 * Añade la FECHA DE VENCIMIENTO opcional a los elementos de las inspecciones
 * de inventario.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LO EJECUTA EL USUARIO, NUNCA UN AGENTE.
 *
 *  Por defecto NO ESCRIBE NADA: inspecciona la base y cuenta qué haría. Para
 *  escribir de verdad hay que pasar `--apply` explícitamente.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Por qué existe
 * ──────────────
 * Al transcribir HSEQ-FR-05 se decidió pedir la fecha de vencimiento solo en
 * los elementos que caducan, y la nota de transcripción dejó dicho que HSEQ
 * debía confirmar la lista. Nunca se confirmó: de los 33 elementos del
 * botiquín solo 14 tienen el campo, y en los otros 19 el inspector solo puede
 * marcar B / M / C-R aunque el empaque traiga la fecha impresa.
 *
 * El arreglo no es adivinar mejor la lista —el propio HSEQ reporta insumos que
 * caducan y otros que no— sino ofrecer el campo SIEMPRE y no exigirlo NUNCA:
 * quien tenga la fecha delante la escribe, y quien inspeccione unas tijeras lo
 * deja vacío.
 *
 * Por qué clona en vez de editar
 * ──────────────────────────────
 * Estos formularios ya están publicados y con envíos hechos. Una versión
 * publicada no se muta: sus campos son las columnas de los informes y el
 * esqueleto de los borradores en curso. El motor lo dice en su propio error
 * —«Una versión publicada no se sobrescribe: clónala»— y esto hace justo eso:
 * deja un DRAFT nuevo, hermano de la versión viva, que HSEQ revisa y publica
 * desde el dashboard cuando quiera.
 *
 * Lo que este script NO hace, a propósito:
 *
 *  - no publica: publicar es una decisión de HSEQ, no de un script;
 *  - no toca las asignaciones: mientras el borrador no se publique, los
 *    conductores siguen viendo la versión de siempre y ningún borrador en
 *    curso se altera;
 *  - no borra ni renombra nada: solo añade campos que faltan.
 *
 * Uso:
 *   npm run formularios:vencimiento                        # simulacro
 *   npm run formularios:vencimiento -- --apply --user <uuid>
 *   npm run formularios:vencimiento -- --apply --user <uuid> --only HSEQ-FR-05
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'

/**
 * Dónde se inserta la fecha dentro del bloque de cada elemento.
 *
 *  - `antes-del-estado`: queda entre la cantidad y el estado, que es donde ya
 *    está en los 14 elementos del botiquín que sí la tienen. Meterla en otro
 *    sitio dejaría el formulario con dos criterios distintos según el
 *    elemento.
 *  - `despues-del-bloque`: para el kit de derrames, donde el campo de estado
 *    lleva el nombre del elemento a secas («Guantes de nitrilo») y no hay
 *    cantidad. Poner la fecha delante obligaría a leer «…fecha de
 *    vencimiento» antes de saber de qué elemento se habla.
 */
type Posicion = 'antes-del-estado' | 'despues-del-bloque'

interface Objetivo {
	code: string
	/** Clave de la sección con el inventario. */
	seccion: string
	posicion: Posicion
}

/**
 * Solo las inspecciones con INVENTARIO de insumos.
 *
 * HSEQ-FR-17 (camilla) y HSEQ-FR-21 (productos químicos) se revisaron y se
 * dejaron fuera: no tienen sección de inventario. Sus ítems son criterios de
 * cumplimiento —«Manijas / asas para cargue en buen estado», «Mantener buenas
 * prácticas de orden y aseo»—, no insumos que caduquen, y un campo de fecha de
 * vencimiento ahí no tendría qué contener. Si HSEQ quiere registrar la
 * caducidad de los productos químicos, lo que hace falta es un inventario de
 * productos en FR-21, no una fecha suelta por criterio: es otro trabajo.
 */
const OBJETIVOS: Objetivo[] = [
	{ code: 'HSEQ-FR-05', seccion: 'inventario', posicion: 'antes-del-estado' },
	{ code: 'HSEQ-FR-22', seccion: 'inventario', posicion: 'despues-del-bloque' }
]

const SUFIJO_ESTADO = '_estado'
const SUFIJO_VENCIMIENTO = '_vencimiento'
const AYUDA = 'Opcional: escríbela solo si el empaque la trae.'

interface Opciones {
	apply: boolean
	userId: string | null
	only: string[]
}

function parseArgs(argv: string[]): Opciones {
	const userIndex = argv.indexOf('--user')
	const onlyIndex = argv.indexOf('--only')
	return {
		apply: argv.includes('--apply'),
		userId: userIndex >= 0 ? (argv[userIndex + 1] ?? null) : null,
		only: onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? '').split(',').filter(Boolean) : []
	}
}

/**
 * El nombre del elemento, a partir del campo de estado.
 *
 * El botiquín etiqueta el estado como «Gasas estériles — estado» y el kit de
 * derrames como «Guantes de nitrilo» a secas. Se quita el sufijo cuando está,
 * para que la fecha se llame igual que el resto del bloque.
 */
function nombreDelElemento(labelDelEstado: string): string {
	return labelDelEstado.replace(/\s+—\s+estado$/u, '')
}

type Campo = {
	id: string
	key: string
	label: string
	sort_order: number
	parent_field_id: string | null
}

interface Plan {
	code: string
	formId: string
	/** Versión de la que se parte. */
	origenId: string
	origenNumero: number
	origenEstado: string
	seccionId: string
	/** Campos a crear. Su posición la fija `ordenFinal`. */
	nuevos: { key: string; label: string }[]
	/** Orden final completo de la sección: keys en secuencia. */
	ordenFinal: string[]
	/** Elementos que ya tenían la fecha; no se tocan. */
	yaTenian: number
}

/** Lee la base y decide qué campos faltan. No escribe. */
async function planificar(prisma: PrismaClient, objetivo: Objetivo): Promise<Plan | string> {
	const form = await prisma.form_definition.findFirst({
		where: { code: objetivo.code },
		select: { id: true }
	})
	if (!form) return `${objetivo.code}: no existe en esta base.`

	/// Se parte de la versión PUBLICADA, que es la que están diligenciando los
	/// conductores. Si la más reciente es un DRAFT, se trabaja sobre ella: no
	/// tiene sentido clonar un borrador para editar el clon.
	const versiones = await prisma.form_version.findMany({
		where: { form_id: form.id },
		orderBy: { version_number: 'desc' },
		select: { id: true, version_number: true, status: true }
	})
	const origen = versiones.find((v) => v.status === 'DRAFT') ?? versiones.find((v) => v.status === 'PUBLISHED')
	if (!origen) return `${objetivo.code}: no tiene ninguna versión en DRAFT ni PUBLISHED.`

	const seccion = await prisma.form_section.findFirst({
		where: { version_id: origen.id, key: objetivo.seccion },
		select: { id: true }
	})
	if (!seccion) return `${objetivo.code}: la versión ${origen.version_number} no tiene sección «${objetivo.seccion}».`

	const campos = (await prisma.form_field.findMany({
		where: { version_id: origen.id, section_id: seccion.id, parent_field_id: null },
		orderBy: { sort_order: 'asc' },
		select: { id: true, key: true, label: true, sort_order: true, parent_field_id: true }
	})) as Campo[]

	const claves = new Set(campos.map((c) => c.key))
	/// Un elemento es un campo `<prefijo>_estado`. Se excluye explícitamente la
	/// observación, que el motor nombra `<prefijo>_estado_observacion` y que
	/// también terminaría en `_estado` si se mirara con menos cuidado.
	const elementos = campos.filter(
		(c) => c.key.endsWith(SUFIJO_ESTADO) && !c.key.endsWith('_estado_observacion')
	)

	const nuevos: Plan['nuevos'] = []
	let yaTenian = 0
	const ordenFinal: string[] = []

	for (const campo of campos) {
		const esEstado = elementos.includes(campo)
		const prefijo = esEstado ? campo.key.slice(0, -SUFIJO_ESTADO.length) : null
		const claveFecha = prefijo ? `${prefijo}${SUFIJO_VENCIMIENTO}` : null

		if (esEstado && claveFecha && claves.has(claveFecha)) yaTenian++

		if (objetivo.posicion === 'antes-del-estado' && esEstado && claveFecha && !claves.has(claveFecha)) {
			nuevos.push({
				key: claveFecha,
				label: `${nombreDelElemento(campo.label)} — fecha de vencimiento`
			})
			ordenFinal.push(claveFecha)
		}

		ordenFinal.push(campo.key)

		if (objetivo.posicion === 'despues-del-bloque' && esEstado && claveFecha && !claves.has(claveFecha)) {
			/// El bloque del elemento son los campos consecutivos que comparten
			/// prefijo (estado, faltante…). La fecha va detrás del último.
			const resto = campos.slice(campos.indexOf(campo) + 1)
			const delBloque: Campo[] = []
			for (const siguiente of resto) {
				if (!siguiente.key.startsWith(`${prefijo}_`)) break
				delBloque.push(siguiente)
			}
			for (const c of delBloque) ordenFinal.push(c.key)
			nuevos.push({
				key: claveFecha,
				label: `${nombreDelElemento(campo.label)} — fecha de vencimiento`
			})
			ordenFinal.push(claveFecha)
		}
	}

	/// `ordenFinal` puede haber recogido dos veces los campos del bloque en el
	/// modo `despues-del-bloque`; se deduplica conservando la primera aparición.
	const vistos = new Set<string>()
	const ordenLimpio = ordenFinal.filter((k) => (vistos.has(k) ? false : (vistos.add(k), true)))

	return {
		code: objetivo.code,
		formId: form.id,
		origenId: origen.id,
		origenNumero: origen.version_number,
		origenEstado: origen.status,
		seccionId: seccion.id,
		nuevos,
		ordenFinal: ordenLimpio,
		yaTenian
	}
}

/**
 * Copia el árbol de una versión a otra con ids nuevos.
 *
 * Es la misma operación que `copyVersionTree` del módulo, reimplementada aquí
 * en vez de importarla para que el script no arrastre la configuración del
 * backend (el repositorio trae consigo el cliente Prisma de la aplicación y su
 * validación de entorno). Nodo a nodo y no `INSERT … SELECT`, porque hay que
 * reasignar `parent_field_id` a los ids nuevos.
 */
async function copiarArbol(tx: Prisma.TransactionClient, origenId: string, destinoId: string) {
	const secciones = await tx.form_section.findMany({
		where: { version_id: origenId },
		orderBy: { sort_order: 'asc' }
	})
	const campos = await tx.form_field.findMany({
		where: { version_id: origenId },
		orderBy: { sort_order: 'asc' },
		include: { options: { orderBy: { sort_order: 'asc' } } }
	})

	const mapaSecciones = new Map<string, string>()
	for (const s of secciones) {
		const id = randomUUID()
		mapaSecciones.set(s.id, id)
		await tx.form_section.create({
			data: {
				id,
				version_id: destinoId,
				key: s.key,
				title: s.title,
				description: s.description,
				sort_order: s.sort_order,
				settings_json: s.settings_json as Prisma.InputJsonValue
			}
		})
	}

	/// Padres antes que hijos: `parent_field_id` es una FK a esta misma tabla.
	const mapaCampos = new Map<string, string>()
	const ordenados = [...campos].sort(
		(a, b) => Number(a.parent_field_id != null) - Number(b.parent_field_id != null)
	)
	for (const campo of ordenados) {
		const id = randomUUID()
		mapaCampos.set(campo.id, id)
		await tx.form_field.create({
			data: {
				id,
				version_id: destinoId,
				section_id: mapaSecciones.get(campo.section_id)!,
				parent_field_id: campo.parent_field_id ? mapaCampos.get(campo.parent_field_id)! : null,
				key: campo.key,
				type: campo.type,
				label: campo.label,
				help_text: campo.help_text,
				placeholder: campo.placeholder,
				required: campo.required,
				sort_order: campo.sort_order,
				config_json: campo.config_json as Prisma.InputJsonValue,
				validation_json: campo.validation_json as Prisma.InputJsonValue,
				visibility_rule_json:
					campo.visibility_rule_json === null
						? Prisma.DbNull
						: (campo.visibility_rule_json as Prisma.InputJsonValue),
				default_value_json:
					campo.default_value_json === null
						? Prisma.DbNull
						: (campo.default_value_json as Prisma.InputJsonValue)
			}
		})
		for (const opcion of campo.options) {
			await tx.form_field_option.create({
				data: {
					id: randomUUID(),
					field_id: id,
					value: opcion.value,
					label: opcion.label,
					color: opcion.color,
					score: opcion.score,
					sort_order: opcion.sort_order,
					metadata_json: opcion.metadata_json as Prisma.InputJsonValue
				}
			})
		}
	}
	return mapaSecciones
}

/** Aplica un plan: clona si hace falta, crea los campos y reordena. */
async function aplicar(prisma: PrismaClient, plan: Plan, userId: string) {
	return prisma.$transaction(
		async (tx) => {
			let versionId = plan.origenId
			let seccionId = plan.seccionId
			let numero = plan.origenNumero
			let clonada = false

			if (plan.origenEstado === 'PUBLISHED') {
				const maximo = await tx.form_version.aggregate({
					where: { form_id: plan.formId },
					_max: { version_number: true }
				})
				numero = (maximo._max.version_number ?? 0) + 1
				versionId = randomUUID()
				const origen = await tx.form_version.findUniqueOrThrow({
					where: { id: plan.origenId },
					select: {
						title: true,
						description: true,
						instructions: true,
						settings_json: true,
						source_metadata_json: true
					}
				})
				await tx.form_version.create({
					data: {
						id: versionId,
						form_id: plan.formId,
						version_number: numero,
						status: 'DRAFT',
						title: origen.title,
						description: origen.description,
						instructions: origen.instructions,
						settings_json: origen.settings_json as Prisma.InputJsonValue,
						source_metadata_json: origen.source_metadata_json as Prisma.InputJsonValue,
						created_by_id: userId
					}
				})
				const mapaSecciones = await copiarArbol(tx, plan.origenId, versionId)
				seccionId = mapaSecciones.get(plan.seccionId)!
				clonada = true
			}

			/// Los `sort_order` se liberan antes de tocarlos: hay un índice único
			/// `(section_id, parent_field_id, sort_order)` y renumerar en sitio
			/// choca en cuanto dos campos se cruzan. Se suben todos a un rango
			/// alto, se crean los nuevos ya en su posición definitiva y luego se
			/// bajan los viejos uno a uno.
			const OFFSET = 100_000
			await tx.$executeRaw`
				UPDATE form_fields
				SET sort_order = sort_order + ${OFFSET}
				WHERE section_id = ${seccionId}::uuid AND parent_field_id IS NULL
			`

			const posicionFinal = new Map(plan.ordenFinal.map((key, i) => [key, i]))

			for (const nuevo of plan.nuevos) {
				await tx.form_field.create({
					data: {
						id: randomUUID(),
						version_id: versionId,
						section_id: seccionId,
						parent_field_id: null,
						key: nuevo.key,
						type: 'DATE',
						label: nuevo.label,
						help_text: AYUDA,
						required: false,
						sort_order: posicionFinal.get(nuevo.key)!,
						config_json: {},
						validation_json: {}
					}
				})
			}

			const viejos = await tx.form_field.findMany({
				where: { section_id: seccionId, parent_field_id: null, sort_order: { gte: OFFSET } },
				select: { id: true, key: true }
			})
			for (const campo of viejos) {
				const destino = posicionFinal.get(campo.key)
				if (destino === undefined) {
					throw new Error(`${plan.code}: el campo ${campo.key} no aparece en el orden calculado.`)
				}
				await tx.form_field.update({ where: { id: campo.id }, data: { sort_order: destino } })
			}

			return { versionId, numero, clonada, creados: plan.nuevos.length }
		},
		{ maxWait: 60_000, timeout: 600_000 }
	)
}

async function main() {
	const opts = parseArgs(process.argv.slice(2))
	const objetivos = opts.only.length
		? OBJETIVOS.filter((o) => opts.only.includes(o.code))
		: OBJETIVOS

	if (!objetivos.length) {
		console.error(`--only no coincide con ningún objetivo. Disponibles: ${OBJETIVOS.map((o) => o.code).join(', ')}`)
		process.exit(1)
	}

	/// El simulacro SÍ se conecta: sin leer la base no se puede decir qué campos
	/// faltan. Lee y no escribe.
	const prisma = new PrismaClient()
	try {
		const planes: Plan[] = []
		for (const objetivo of objetivos) {
			const resultado = await planificar(prisma, objetivo)
			if (typeof resultado === 'string') {
				console.log(`  – ${resultado}`)
				continue
			}
			planes.push(resultado)
			console.log(
				`\n  ${resultado.code} · versión ${resultado.origenNumero} (${resultado.origenEstado})`
			)
			console.log(
				`    ${resultado.yaTenian} elemento(s) ya tienen fecha · ${resultado.nuevos.length} campo(s) a crear`
			)
			for (const nuevo of resultado.nuevos) {
				console.log(`      + ${nuevo.key.padEnd(38)} ${nuevo.label}`)
			}
		}

		const total = planes.reduce((n, p) => n + p.nuevos.length, 0)
		if (total === 0) {
			console.log('\nNada que hacer: todos los elementos ya tienen su fecha de vencimiento.')
			return
		}

		if (!opts.apply) {
			console.log(`\nSIMULACRO: no se escribió nada. ${total} campo(s) se crearían.`)
			console.log('Para aplicarlo de verdad:')
			console.log('  npm run formularios:vencimiento -- --apply --user <uuid-de-usuario>')
			console.log('\nCada formulario publicado se clona en un DRAFT nuevo. Nada se publica:')
			console.log('revisa el borrador en /dashboard/formularios y publícalo desde ahí.')
			return
		}

		if (!opts.userId) {
			console.error('Falta --user <uuid>: `created_by_id` es NOT NULL y apunta a `users(id)`.')
			process.exit(1)
		}
		const usuario = await prisma.usuarios.findUnique({
			where: { id: opts.userId },
			select: { id: true, correo: true }
		})
		if (!usuario) {
			console.error(`El usuario ${opts.userId} no existe en \`users\`.`)
			process.exit(1)
		}
		console.log(`\nAplicando como ${usuario.correo}.`)

		for (const plan of planes) {
			if (!plan.nuevos.length) continue
			const r = await aplicar(prisma, plan, usuario.id)
			console.log(
				`  ✓ ${plan.code}: ${r.creados} campo(s) en la versión ${r.numero} ` +
					`(${r.clonada ? 'clon nuevo' : 'borrador existente'}, DRAFT) — ${r.versionId}`
			)
		}

		console.log('\nListo. Ninguna versión se publicó y ninguna asignación cambió.')
		console.log('Los conductores siguen viendo la versión de siempre hasta que HSEQ publique.')
	} finally {
		await prisma.$disconnect()
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
})
