/**
 * «No aplica» y fecha de vencimiento solo en lo que caduca, para las
 * inspecciones de inventario: HSEQ-FR-05 (botiquín) y HSEQ-FR-22 (kit de
 * derrames).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LO EJECUTA EL USUARIO, NUNCA UN AGENTE.
 *
 *  Por defecto NO ESCRIBE NADA: lee la base y cuenta qué haría. Para escribir
 *  de verdad hay que pasar `--apply` explícitamente.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Qué cambia
 * ──────────
 *  - El estado de cada elemento suma la opción «No aplica» (NA): el vehículo o
 *    la sede no lleva ese elemento. Con NA no se exige ni la cantidad ni la
 *    fecha, y el elemento se puede enviar vacío.
 *  - La fecha de vencimiento queda solo en los elementos que caducan (estériles,
 *    adhesivos, soluciones, antisépticos, guantes, tapabocas, mascarilla RCP,
 *    absorbentes, filtros). Es obligatoria si el estado es Bueno/Malo (o
 *    Completo/Incompleto en el kit); con Cambiar/Reemplazar o No tiene es
 *    opcional, porque el elemento puede no estar y no hay empaque que leer.
 *  - En el botiquín el estado pasa a ir primero en cada bloque: elegir NA antes
 *    evita llenar una cantidad que luego no se pide.
 *
 * Por qué una versión nueva
 * ─────────────────────────
 * Una versión publicada no se muta: sus campos son las columnas de los
 * informes y el esqueleto de los borradores en curso. El script usa el mismo
 * camino que el dashboard: `clonarVersion` (borrador nuevo, ids nuevos),
 * modifica el borrador, `publicarVersion` (que valida y rechaza si algo está
 * mal) y, como `version_id` de una asignación no se cambia, crea una asignación
 * nueva igual a la vigente contra la versión nueva y cierra la vieja. Los
 * envíos hechos se quedan en la versión 1 y se siguen consultando igual; los
 * borradores sin enviar de la versión 1 quedan sin asignación activa.
 *
 * Idempotente: marca la versión nueva en `source_metadata_json.revision`; si ya
 * existe, la reutiliza (y si ya está publicada, solo reconcilia asignaciones).
 *
 * Uso:
 *   npm run formularios:no-aplica                                # simulacro
 *   npm run formularios:no-aplica -- --apply --user <uuid>
 *   npm run formularios:no-aplica -- --apply --user <uuid> --only HSEQ-FR-05
 */

import { Prisma } from '@prisma/client'
import { prisma } from '../../../src/config/prisma'
import { clonarVersion, publicarVersion } from '../../../src/modules/formularios-dinamicos/formularios-dinamicos.service'
import {
  cambiarEstadoAsignacion,
  crearAsignacion,
} from '../../../src/modules/formularios-dinamicos/formularios-asignaciones.service'
import type { CrearAsignacionInput } from '../../../src/modules/formularios-dinamicos/formularios-dinamicos.schema'

const REVISION = 'inventario-no-aplica-2026-10'
const NA = { value: 'NA', label: 'No aplica', color: 'gray' }

interface Objetivo {
  code: string
  seccion: string
  /** Estados con los que la fecha es obligatoria (si el elemento caduca). */
  exigenFecha: string[]
  /** Elementos (prefijo de la clave) que caducan. */
  caducan: string[]
  /** El botiquín pone el estado primero; el kit ya lo tiene primero. */
  estadoPrimero: boolean
  /** Clave del campo de cantidad que deja de ser obligatorio con NA. */
  sufijoCantidad?: string
  /** Tras qué campo del bloque va la fecha cuando hay que crearla. */
  fechaDespuesDe: string
}

const OBJETIVOS: Objetivo[] = [
  {
    code: 'HSEQ-FR-05',
    seccion: 'inventario',
    exigenFecha: ['B', 'M'],
    caducan: [
      'gasas_esteriles', 'apositos', 'esparadrapo', 'micropore', 'curas', 'parches_oculares',
      'clorhexidina', 'solucion_salina', 'suero_oral', 'alcohol_antiseptico', 'guantes_latex',
      'tapabocas', 'mascara_rcp', 'botella_agua', 'gel_antibacterial',
    ],
    estadoPrimero: true,
    sufijoCantidad: '_cantidad',
    fechaDespuesDe: '_cantidad',
  },
  {
    code: 'HSEQ-FR-22',
    seccion: 'inventario',
    exigenFecha: ['COMPLETO', 'INCOMPLETO'],
    caducan: ['granulado', 'barra_absorbente', 'pano_oleofilico', 'guantes_nitrilo', 'mascarilla_vapores'],
    estadoPrimero: false,
    fechaDespuesDe: '_faltante',
  },
]

interface Opciones {
  apply: boolean
  userId: string | null
  only: string[]
}

function parseArgs(argv: string[]): Opciones {
  const valor = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? (argv[i + 1] ?? null) : null
  }
  return {
    apply: argv.includes('--apply'),
    userId: valor('--user'),
    only: (valor('--only') ?? '').split(',').filter(Boolean),
  }
}

const regla = (estadoKey: string, operador: 'in' | 'notIn', valores: string[], destino: string) => ({
  version: 1,
  all: [{ fieldKey: estadoKey, operator: operador, value: valores }],
  effect: { action: 'require', targetFieldKey: destino },
})

/** Nombre del elemento a partir del label del estado («Gasas estériles — estado» → «Gasas estériles»). */
const nombreDelElemento = (label: string) => label.replace(/\s+—\s+estado$/u, '')

type Campo = Awaited<ReturnType<typeof camposDe>>[number]

function camposDe(versionId: string, seccionId: string) {
  return prisma.form_field.findMany({
    where: { version_id: versionId, section_id: seccionId, parent_field_id: null },
    orderBy: { sort_order: 'asc' },
    include: { options: { orderBy: { sort_order: 'asc' } } },
  })
}

/** Elementos del inventario: un bloque por cada campo `<elemento>_estado`. */
function elementos(campos: Campo[]): string[] {
  return campos.filter((c) => c.key.endsWith('_estado') && c.type === 'SINGLE_CHOICE').map((c) => c.key.slice(0, -'_estado'.length))
}

/** Lo que se le hará al borrador, en palabras. Sirve igual para el simulacro y para el registro. */
function plan(obj: Objetivo, campos: Campo[]) {
  const porKey = new Map(campos.map((c) => [c.key, c]))
  const lineas: string[] = []
  for (const el of elementos(campos)) {
    const tieneFecha = porKey.has(`${el}_vencimiento`)
    const caduca = obj.caducan.includes(el)
    const fecha = caduca ? (tieneFecha ? 'fecha: se conserva y se exige con ' : 'fecha: SE AÑADE, exigida con ') + obj.exigenFecha.join('/') : tieneFecha ? 'fecha: SE QUITA (no caduca)' : 'sin fecha (no caduca)'
    lineas.push(`${el.padEnd(34)} + NA · ${obj.sufijoCantidad ? 'cantidad solo si no es NA · ' : ''}${fecha}`)
  }
  const sobran = obj.caducan.filter((el) => !porKey.has(`${el}_estado`))
  if (sobran.length) throw new Error(`${obj.code}: elementos en "caducan" que no existen en la versión: ${sobran.join(', ')}`)
  return lineas
}

async function modificarBorrador(obj: Objetivo, versionId: string) {
  const seccion = await prisma.form_section.findFirstOrThrow({ where: { version_id: versionId, key: obj.seccion } })
  const campos = await camposDe(versionId, seccion.id)
  const porKey = new Map(campos.map((c) => [c.key, c]))

  await prisma.$transaction(async (tx) => {
    for (const el of elementos(campos)) {
      const estado = porKey.get(`${el}_estado`)!
      // 1. Opción «No aplica».
      if (!estado.options.some((o) => o.value === NA.value)) {
        await tx.form_field_option.create({
          data: {
            field_id: estado.id,
            value: NA.value,
            label: NA.label,
            color: NA.color,
            sort_order: Math.max(...estado.options.map((o) => o.sort_order)) + 100,
          },
        })
      }
      // 2. Cantidad exigida solo si no es NA.
      const cantidad = obj.sufijoCantidad ? porKey.get(`${el}${obj.sufijoCantidad}`) : undefined
      if (cantidad) {
        await tx.form_field.update({
          where: { id: cantidad.id },
          data: { required: false, visibility_rule_json: regla(estado.key, 'notIn', [NA.value], cantidad.key) },
        })
      }
      // 3. Fecha de vencimiento solo en lo que caduca.
      const fecha = porKey.get(`${el}_vencimiento`)
      const reglaFecha = regla(estado.key, 'in', obj.exigenFecha, `${el}_vencimiento`)
      const ayuda = `Obligatoria si el estado es ${obj.exigenFecha.map((v) => estado.options.find((o) => o.value === v)?.label ?? v).join(' o ')}.`
      if (obj.caducan.includes(el)) {
        if (fecha) {
          await tx.form_field.update({ where: { id: fecha.id }, data: { required: false, help_text: ayuda, visibility_rule_json: reglaFecha } })
        } else {
          await tx.form_field.create({
            data: {
              version_id: versionId,
              section_id: seccion.id,
              key: `${el}_vencimiento`,
              type: 'DATE',
              label: `${nombreDelElemento(estado.label)} — fecha de vencimiento`,
              help_text: ayuda,
              required: false,
              // Se reordena abajo; un valor alto y único evita chocar con el índice de orden.
              sort_order: 900000 + campos.length + elementos(campos).indexOf(el),
              visibility_rule_json: reglaFecha,
            },
          })
        }
      } else if (fecha) {
        await tx.form_field.delete({ where: { id: fecha.id } })
      }
    }

    // 4. Orden de cada bloque: estado (si va primero), cantidad/faltante, fecha, observación.
    const actuales = await tx.form_field.findMany({
      where: { version_id: versionId, section_id: seccion.id, parent_field_id: null },
      orderBy: { sort_order: 'asc' },
    })
    const sufijos = obj.estadoPrimero
      ? ['_estado', obj.sufijoCantidad!, '_vencimiento', '_estado_obs']
      : ['_estado', obj.fechaDespuesDe, '_vencimiento', '_estado_obs']
    const orden: typeof actuales = []
    for (const el of elementos(campos)) {
      for (const s of sufijos) {
        const c = actuales.find((a) => a.key === `${el}${s}`)
        if (c) orden.push(c)
      }
    }
    // Lo que no pertenece a un bloque conserva su posición relativa al final.
    for (const c of actuales) if (!orden.includes(c)) orden.push(c)
    // Dos pasadas: primero fuera del rango, luego el definitivo (índice único por orden).
    for (const [i, c] of orden.entries()) await tx.form_field.update({ where: { id: c.id }, data: { sort_order: 1_000_000 + i } })
    for (const [i, c] of orden.entries()) await tx.form_field.update({ where: { id: c.id }, data: { sort_order: (i + 1) * 100 } })
  })
}

async function main() {
  const opciones = parseArgs(process.argv.slice(2))
  if (opciones.apply && !opciones.userId) throw new Error('--apply necesita --user <uuid> (quien publica y asigna).')
  const actor = { id: opciones.userId ?? '00000000-0000-0000-0000-000000000000' }
  console.log(opciones.apply ? '== APLICANDO ==' : '== SIMULACRO (no escribe; pasa --apply para escribir) ==')

  for (const obj of OBJETIVOS.filter((o) => !opciones.only.length || opciones.only.includes(o.code))) {
    const form = await prisma.form_definition.findFirstOrThrow({ where: { code: obj.code, deleted_at: null } })
    const versiones = await prisma.form_version.findMany({ where: { form_id: form.id }, orderBy: { version_number: 'asc' } })
    const yaHecha = versiones.find((v) => (v.source_metadata_json as Record<string, unknown>)?.revision === REVISION)
    const origen = [...versiones].reverse().find((v) => v.status === 'PUBLISHED' && v.id !== yaHecha?.id)
    if (!origen) throw new Error(`${obj.code}: no hay versión publicada de origen.`)

    console.log(`\n${obj.code} — ${form.name}`)
    console.log(`  origen: v${origen.version_number} (${origen.id})`)
    const seccionOrigen = await prisma.form_section.findFirstOrThrow({ where: { version_id: origen.id, key: obj.seccion } })
    for (const l of plan(obj, await camposDe(origen.id, seccionOrigen.id))) console.log(`    ${l}`)

    const asignaciones = await prisma.form_assignment.findMany({
      where: { version_id: origen.id, status: 'ACTIVE', deleted_at: null },
      include: { targets: true },
    })
    console.log(`  asignaciones activas en v${origen.version_number}: ${asignaciones.length} → se recrean contra la versión nueva y se cierran`)
    const borradores = await prisma.form_submission.count({ where: { version_id: origen.id, status: 'DRAFT' } })
    console.log(`  borradores sin enviar en v${origen.version_number}: ${borradores} (quedan sin asignación activa)`)

    if (!opciones.apply) {
      console.log(yaHecha ? `  (ya existe la versión nueva v${yaHecha.version_number}, ${yaHecha.status})` : '  se crearía la versión nueva y se publicaría')
      continue
    }

    // Borrador nuevo (o el que dejó una ejecución anterior) y publicación.
    let nueva = yaHecha
    if (!nueva) {
      const clon = await clonarVersion(form.id, origen.id, actor)
      nueva = await prisma.form_version.update({
        where: { id: clon.id },
        data: { source_metadata_json: { ...(origen.source_metadata_json as object), revision: REVISION } as Prisma.InputJsonValue },
      })
      await modificarBorrador(obj, nueva.id)
      console.log(`  borrador v${nueva.version_number} creado (${nueva.id})`)
    }
    if (nueva.status === 'DRAFT') {
      const r = await publicarVersion(form.id, nueva.id, actor)
      console.log(`  v${nueva.version_number} publicada · ${r.validation.warnings.length} advertencia(s)`)
      for (const w of r.validation.warnings) console.log(`    ⚠ ${w.message}`)
    }

    // Asignaciones: una nueva igual a cada vigente, y la vieja se cierra.
    for (const a of asignaciones) {
      const input = {
        versionId: nueva.id,
        name: a.name,
        frequency: a.frequency,
        limitPolicy: a.limit_policy,
        timezone: a.timezone,
        startsAt: a.starts_at?.toISOString(),
        endsAt: a.ends_at?.toISOString(),
        contextSchema: a.context_schema_json,
        settings: { ...(a.settings_json as object), reemplaza: a.id },
        targets: a.targets.map((t) => ({
          type: t.target_type,
          conductorId: t.conductor_id ?? undefined,
          vehicleId: t.vehicle_id ?? undefined,
          sede: t.sede ?? undefined,
          groupKey: t.group_key ?? undefined,
          usuarioId: t.usuario_id ?? undefined,
          area: t.area ?? undefined,
          cargo: t.cargo ?? undefined,
        })),
      } as unknown as CrearAsignacionInput
      const { assignment } = await crearAsignacion(input, actor)
      await cambiarEstadoAsignacion(a.id, 'CLOSED')
      console.log(`  asignación ${a.id} cerrada → nueva ${assignment.id} (${a.targets.length} destinatario(s))`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    if (e && typeof e === 'object' && 'details' in e) console.error(JSON.stringify((e as { details: unknown }).details, null, 2))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
