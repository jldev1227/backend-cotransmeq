/**
 * Asignaciones.
 *
 * Una asignación es lo que hace visible un formulario para un conductor. Dos
 * invariantes la sostienen y las dos son de negocio, no de esquema:
 *
 *  1. **Solo apunta a una versión PUBLICADA.** Asignar un borrador dejaría a
 *     los conductores diligenciando algo que HSEQ todavía está editando.
 *  2. **Cambiar la audiencia no toca los envíos.** Quitar a un conductor del
 *     target no borra lo que ya entregó; solo deja de aparecerle.
 *
 * Pausar/cerrar existe en vez de borrar porque el rollback funcional del módulo
 * es exactamente esto: pausar la asignación y archivar la versión, conservando
 * el histórico.
 */

import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { FormError, type AssignmentStatus } from './domain'
import { toAssignmentDto } from './formularios-dinamicos.mapper'
import type {
  ActualizarAsignacionInput,
  CrearAsignacionInput,
  ListarAsignacionesQuery,
} from './formularios-dinamicos.schema'
import type { AdminActor } from './formularios-dinamicos.service'

const assignmentInclude = {
  targets: {
    include: {
      conductor: { select: { id: true, nombre: true, apellido: true } },
      vehiculo: { select: { id: true, placa: true } },
    },
    orderBy: { created_at: 'asc' },
  },
  version: {
    select: {
      id: true,
      form_id: true,
      version_number: true,
      status: true,
      title: true,
      form: { select: { code: true, name: true } },
    },
  },
  _count: { select: { submissions: true } },
} satisfies Prisma.form_assignmentInclude

export async function listarAsignaciones(query: ListarAsignacionesQuery) {
  const where: Prisma.form_assignmentWhereInput = {
    deleted_at: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.versionId ? { version_id: query.versionId } : {}),
    ...(query.formId ? { version: { form_id: query.formId } } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  }

  const [total, rows] = await Promise.all([
    prisma.form_assignment.count({ where }),
    prisma.form_assignment.findMany({
      where,
      include: assignmentInclude,
      orderBy: { created_at: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ])

  return {
    data: rows.map(toAssignmentDto),
    meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) || 1 },
  }
}

export async function obtenerAsignacion(id: string) {
  const row = await prisma.form_assignment.findFirst({
    where: { id, deleted_at: null },
    include: assignmentInclude,
  })
  if (!row) throw new FormError('ASSIGNMENT_NOT_FOUND', 'La asignación no existe.')
  return toAssignmentDto(row)
}

/**
 * Comprueba que los targets apunten a entidades que existen.
 *
 * Sin esto, un `conductorId` inventado se rechazaría con un error de FK
 * ilegible; y un `CONDUCTOR` que apunta a un conductor borrado crearía una
 * asignación que nunca le aparecerá a nadie y que nadie sabría por qué no
 * funciona.
 */
async function verificarTargets(targets: CrearAsignacionInput['targets']): Promise<void> {
  const conductorIds = [...new Set(targets.map((t) => t.conductorId).filter(Boolean))] as string[]
  const vehicleIds = [...new Set(targets.map((t) => t.vehicleId).filter(Boolean))] as string[]

  if (conductorIds.length) {
    const encontrados = await prisma.conductores.findMany({
      where: { id: { in: conductorIds }, deleted_at: null },
      select: { id: true },
    })
    const vistos = new Set(encontrados.map((c) => c.id))
    const faltan = conductorIds.filter((id) => !vistos.has(id))
    if (faltan.length) {
      throw new FormError('ASSIGNMENT_NOT_AVAILABLE', 'Hay conductores del target que no existen o están borrados.', {
        conductorIds: faltan,
      })
    }
  }

  if (vehicleIds.length) {
    const encontrados = await prisma.vehiculos.findMany({
      where: { id: { in: vehicleIds }, deleted_at: null },
      select: { id: true },
    })
    const vistos = new Set(encontrados.map((v) => v.id))
    const faltan = vehicleIds.filter((id) => !vistos.has(id))
    if (faltan.length) {
      throw new FormError('ASSIGNMENT_NOT_AVAILABLE', 'Hay vehículos del target que no existen o están borrados.', {
        vehicleIds: faltan,
      })
    }
  }
}

/**
 * Avisa cuando la política de límite pide un contexto que nadie va a exigir.
 *
 * `ONE_PER_CONTEXT` calcula la unicidad con el contexto del envío (conductor +
 * vehículo + período). Si el `contextSchema` no marca `vehicleId` como
 * requerido, el runner puede enviar sin vehículo y la unicidad degenera a
 * "uno por conductor y período", que no es lo que HSEQ configuró.
 */
function contextoCoherente(input: {
  limitPolicy?: string
  contextSchema?: Record<string, { required?: boolean }>
}): string[] {
  if (input.limitPolicy !== 'ONE_PER_CONTEXT') return []
  const schema = input.contextSchema ?? {}
  const claves = Object.entries(schema)
    .filter(([, v]) => v?.required)
    .map(([k]) => k)
  if (claves.length === 0) {
    return [
      'La política ONE_PER_CONTEXT no tendrá efecto: ningún campo de `contextSchema` está marcado como requerido.',
    ]
  }
  return []
}

export async function crearAsignacion(input: CrearAsignacionInput, actor: AdminActor) {
  const version = await prisma.form_version.findUnique({
    where: { id: input.versionId },
    select: { id: true, status: true, form_id: true, form: { select: { deleted_at: true } } },
  })
  if (!version) throw new FormError('VERSION_NOT_FOUND', 'La versión no existe.')
  if (version.form.deleted_at) {
    throw new FormError('FORM_NOT_FOUND', 'El formulario está archivado.')
  }
  if (version.status !== 'PUBLISHED') {
    throw new FormError(
      'VERSION_NOT_PUBLISHED',
      'Solo se puede asignar una versión publicada. Publícala primero.',
      { status: version.status },
    )
  }

  await verificarTargets(input.targets)

  const id = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.form_assignment.create({
      data: {
        id,
        version_id: input.versionId,
        name: input.name,
        status: 'ACTIVE',
        frequency: input.frequency,
        limit_policy: input.limitPolicy,
        timezone: input.timezone ?? 'America/Bogota',
        starts_at: input.startsAt ? new Date(input.startsAt) : null,
        ends_at: input.endsAt ? new Date(input.endsAt) : null,
        context_schema_json: (input.contextSchema ?? {}) as Prisma.InputJsonValue,
        settings_json: (input.settings ?? {}) as Prisma.InputJsonValue,
        created_by_id: actor.id,
      },
    })
    await tx.form_assignment_target.createMany({
      data: input.targets.map((t) => ({
        id: randomUUID(),
        assignment_id: id,
        target_type: t.type,
        conductor_id: t.conductorId ?? null,
        vehicle_id: t.vehicleId ?? null,
        sede: t.sede ?? null,
        group_key: t.groupKey ?? null,
      })),
    })
  })

  return { assignment: await obtenerAsignacion(id), warnings: contextoCoherente(input) }
}

/**
 * Actualiza audiencia, vigencia o metadatos.
 *
 * `version_id` NO se puede cambiar: los envíos ya hechos apuntan a la versión
 * de la asignación, y moverla haría que un envío contra la v2 pareciera hecho
 * contra la v3, con campos que no existían. Para cambiar de versión se crea
 * otra asignación y se cierra esta.
 */
export async function actualizarAsignacion(id: string, input: ActualizarAsignacionInput, _actor: AdminActor) {
  const actual = await prisma.form_assignment.findFirst({
    where: { id, deleted_at: null },
    select: { id: true, status: true, starts_at: true, ends_at: true },
  })
  if (!actual) throw new FormError('ASSIGNMENT_NOT_FOUND', 'La asignación no existe.')
  if (actual.status === 'CLOSED') {
    throw new FormError('ASSIGNMENT_NOT_AVAILABLE', 'Una asignación cerrada no se modifica.')
  }

  if (input.targets) await verificarTargets(input.targets)

  /// Las dos fechas se comparan contra el estado FINAL (lo que llega mezclado
  /// con lo que ya había): validar solo el payload dejaría pasar un `endsAt`
  /// anterior al `startsAt` que ya estaba guardado.
  const startsAt = input.startsAt !== undefined ? (input.startsAt ? new Date(input.startsAt) : null) : actual.starts_at
  const endsAt = input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : actual.ends_at
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new FormError('ASSIGNMENT_NOT_AVAILABLE', 'La fecha de fin debe ser posterior a la de inicio.')
  }

  await prisma.$transaction(async (tx) => {
    await tx.form_assignment.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.frequency ? { frequency: input.frequency } : {}),
        ...(input.limitPolicy ? { limit_policy: input.limitPolicy } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.startsAt !== undefined ? { starts_at: startsAt } : {}),
        ...(input.endsAt !== undefined ? { ends_at: endsAt } : {}),
        ...(input.contextSchema ? { context_schema_json: input.contextSchema as Prisma.InputJsonValue } : {}),
        ...(input.settings ? { settings_json: input.settings as Prisma.InputJsonValue } : {}),
      },
    })

    if (input.targets) {
      /// Reemplazo completo: la UI del asignador manda la lista entera, y un
      /// diff parcial obligaría a inventar ids de target en el cliente.
      await tx.form_assignment_target.deleteMany({ where: { assignment_id: id } })
      await tx.form_assignment_target.createMany({
        data: input.targets.map((t) => ({
          id: randomUUID(),
          assignment_id: id,
          target_type: t.type,
          conductor_id: t.conductorId ?? null,
          vehicle_id: t.vehicleId ?? null,
          sede: t.sede ?? null,
          group_key: t.groupKey ?? null,
        })),
      })
    }
  })

  return { assignment: await obtenerAsignacion(id), warnings: contextoCoherente(input) }
}

const TRANSICIONES: Record<AssignmentStatus, AssignmentStatus[]> = {
  ACTIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  /// `CLOSED` es terminal: reabrir una asignación cerrada haría reaparecer una
  /// tarjeta que los conductores ya no esperan, y con una vigencia vencida.
  CLOSED: [],
}

export async function cambiarEstadoAsignacion(id: string, destino: AssignmentStatus) {
  const actual = await prisma.form_assignment.findFirst({
    where: { id, deleted_at: null },
    select: { id: true, status: true, version_id: true },
  })
  if (!actual) throw new FormError('ASSIGNMENT_NOT_FOUND', 'La asignación no existe.')

  if (actual.status === destino) return obtenerAsignacion(id)

  if (!TRANSICIONES[actual.status as AssignmentStatus].includes(destino)) {
    throw new FormError(
      'ASSIGNMENT_NOT_AVAILABLE',
      `No se puede pasar de ${actual.status} a ${destino}.`,
      { from: actual.status, to: destino },
    )
  }

  await prisma.form_assignment.update({ where: { id }, data: { status: destino } })
  return obtenerAsignacion(id)
}

/**
 * Conductores a los que afecta una asignación, para dirigir los eventos de
 * socket a sus rooms.
 *
 * `ALL_CONDUCTORS` devuelve lista vacía a propósito: emitir a miles de rooms
 * uno a uno en cada cambio no escala. Ese caso lo cubre el room admin más la
 * reconciliación por GET que el portal hace al reconectar.
 */
export async function conductoresAfectados(assignmentId: string): Promise<string[]> {
  const targets = await prisma.form_assignment_target.findMany({
    where: { assignment_id: assignmentId },
    select: { target_type: true, conductor_id: true, vehicle_id: true, sede: true },
  })

  if (targets.some((t) => t.target_type === 'ALL_CONDUCTORS')) return []

  const ids = new Set<string>()
  for (const t of targets) if (t.conductor_id) ids.add(t.conductor_id)

  const vehiculoIds = targets.map((t) => t.vehicle_id).filter(Boolean) as string[]
  if (vehiculoIds.length) {
    const vehiculos = await prisma.vehiculos.findMany({
      where: { id: { in: vehiculoIds }, conductor_id: { not: null } },
      select: { conductor_id: true },
    })
    for (const v of vehiculos) if (v.conductor_id) ids.add(v.conductor_id)
  }

  const sedes = targets.map((t) => t.sede).filter(Boolean) as string[]
  if (sedes.length) {
    const conductores = await prisma.conductores.findMany({
      where: { sede_trabajo: { in: sedes as any }, deleted_at: null },
      select: { id: true },
    })
    for (const c of conductores) ids.add(c.id)
  }

  return [...ids]
}
