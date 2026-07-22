import { prisma } from '../../config/prisma'

export type ServicioEstado =
  | 'solicitado'
  | 'planificado'
  | 'en_curso'
  | 'pendiente'
  | 'realizado'
  | 'planilla_asignada'
  | 'liquidado'
  | 'cancelado'

export type ConductorEstado =
  | 'activo'
  | 'inactivo'
  | 'suspendido'
  | 'retirado'
  | 'disponible'
  | 'programado'
  | 'servicio'
  | 'descanso'
  | 'vacaciones'
  | 'incapacidad'
  | 'desvinculado'

export type VehiculoEstado =
  | 'disponible'
  | 'programado'
  | 'servicio'
  | 'mantenimiento'
  | 'inactivo'
  | 'desvinculado'

export const TRANSICIONES_VALIDAS: Record<ServicioEstado, ServicioEstado[]> = {
  solicitado: ['planificado', 'en_curso', 'cancelado'],
  planificado: ['en_curso', 'cancelado', 'realizado'],
  en_curso: ['realizado', 'cancelado'],
  pendiente: ['solicitado', 'planificado', 'cancelado'],
  realizado: ['planilla_asignada', 'liquidado'],
  planilla_asignada: ['liquidado'],
  liquidado: [],
  cancelado: []
}

export const ESTADOS_OPERATIVOS_CONDUCTOR: ConductorEstado[] = [
  'programado',
  'servicio'
]

export const ESTADOS_OPERATIVOS_VEHICULO: VehiculoEstado[] = [
  'programado',
  'servicio',
  'mantenimiento'
]

export const ESTADOS_QUE_BLOQUEAN_RECURSO: ServicioEstado[] = [
  'planificado',
  'en_curso',
  'planilla_asignada'
]

export const ESTADOS_QUE_LIBERAN_RECURSO: ServicioEstado[] = [
  'realizado',
  'cancelado',
  'liquidado'
]

export const ESTADOS_TERMINALES: ServicioEstado[] = ['liquidado', 'cancelado']

function esEstadoValido(origen: ServicioEstado, destino: ServicioEstado): boolean {
  if (origen === destino) return true
  const permitidos = TRANSICIONES_VALIDAS[origen] || []
  return permitidos.includes(destino)
}

async function recursoTieneOtrosServiciosActivos(
  recurso: 'conductor_id' | 'vehiculo_id',
  recursoId: string,
  servicioActualId: string
): Promise<boolean> {
  const count = await prisma.servicio.count({
    where: {
      [recurso]: recursoId,
      id: { not: servicioActualId },
      estado: { in: ESTADOS_QUE_BLOQUEAN_RECURSO as any }
    }
  })
  return count > 0
}

async function aplicarEfectoAsignacion(
  tx: any,
  servicioId: string,
  conductorId: string | null,
  vehiculoId: string | null,
  nuevoEstadoServicio: ServicioEstado
): Promise<void> {
  if (ESTADOS_TERMINALES.includes(nuevoEstadoServicio)) return

  if (conductorId) {
    const estadoConductor =
      nuevoEstadoServicio === 'en_curso' ? 'servicio' : 'programado'
    // Solo pisar si el conductor está en estado administrativo (no operativo).
    // Si ya está 'programado' o 'servicio' (operativo), no hacer nada.
    const actual = await tx.conductores.findUnique({
      where: { id: conductorId },
      select: { estado: true }
    })
    if (actual && !ESTADOS_OPERATIVOS_CONDUCTOR.includes(actual.estado as ConductorEstado)) {
      await tx.conductores.update({
        where: { id: conductorId },
        data: { estado: estadoConductor as any }
      })
    } else if (actual && nuevoEstadoServicio === 'en_curso') {
      // Promover de 'programado' a 'servicio'
      await tx.conductores.update({
        where: { id: conductorId },
        data: { estado: 'servicio' as any }
      })
    }
  }

  if (vehiculoId) {
    const estadoVehiculo =
      nuevoEstadoServicio === 'en_curso' ? 'servicio' : 'programado'
    const actual = await tx.vehiculos.findUnique({
      where: { id: vehiculoId },
      select: { estado: true }
    })
    if (actual && !ESTADOS_OPERATIVOS_VEHICULO.includes(actual.estado as VehiculoEstado)) {
      await tx.vehiculos.update({
        where: { id: vehiculoId },
        data: { estado: estadoVehiculo as any }
      })
    } else if (actual && nuevoEstadoServicio === 'en_curso') {
      await tx.vehiculos.update({
        where: { id: vehiculoId },
        data: { estado: 'servicio' as any }
      })
    }
  }
}

async function liberarRecursos(
  tx: any,
  servicioId: string,
  conductorIdAnterior: string | null,
  vehiculoIdAnterior: string | null
): Promise<void> {
  if (conductorIdAnterior) {
    const tieneOtros = await tx.servicio.count({
      where: {
        conductor_id: conductorIdAnterior,
        id: { not: servicioId },
        estado: { in: ESTADOS_QUE_BLOQUEAN_RECURSO as any }
      }
    })
    if (tieneOtros === 0) {
      // Solo cambiar a 'disponible' si está en estado operativo (programado/servicio).
      // Si está en estado administrativo (activo/inactivo/etc), mantener.
      const actual = await tx.conductores.findUnique({
        where: { id: conductorIdAnterior },
        select: { estado: true }
      })
      if (actual && ESTADOS_OPERATIVOS_CONDUCTOR.includes(actual.estado as ConductorEstado)) {
        await tx.conductores.update({
          where: { id: conductorIdAnterior },
          data: { estado: 'disponible' as any }
        })
      }
    }
  }

  if (vehiculoIdAnterior) {
    const tieneOtros = await tx.servicio.count({
      where: {
        vehiculo_id: vehiculoIdAnterior,
        id: { not: servicioId },
        estado: { in: ESTADOS_QUE_BLOQUEAN_RECURSO as any }
      }
    })
    if (tieneOtros === 0) {
      const actual = await tx.vehiculos.findUnique({
        where: { id: vehiculoIdAnterior },
        select: { estado: true }
      })
      if (actual && ESTADOS_OPERATIVOS_VEHICULO.includes(actual.estado as VehiculoEstado)) {
        // Si estaba en mantenimiento, restaurar; si no, a disponible
        const nuevoEstado =
          actual.estado === 'mantenimiento' ? 'mantenimiento' : 'disponible'
        await tx.vehiculos.update({
          where: { id: vehiculoIdAnterior },
          data: { estado: nuevoEstado as any }
        })
      }
    }
  }
}

export interface EfectosColateralesParams {
  servicioId: string
  estadoAnterior: ServicioEstado
  estadoNuevo: ServicioEstado
  conductorIdAnterior: string | null
  conductorIdNuevo: string | null
  vehiculoIdAnterior: string | null
  vehiculoIdNuevo: string | null
  tx: any
}

export async function aplicarEfectosColaterales(
  params: EfectosColateralesParams
): Promise<void> {
  const {
    servicioId,
    estadoAnterior,
    estadoNuevo,
    conductorIdAnterior,
    conductorIdNuevo,
    vehiculoIdAnterior,
    vehiculoIdNuevo,
    tx
  } = params

  if (estadoAnterior === estadoNuevo) {
    if (conductorIdAnterior !== conductorIdNuevo) {
      if (conductorIdAnterior) {
        await liberarRecursos(tx, servicioId, conductorIdAnterior, null)
      }
      if (conductorIdNuevo && !ESTADOS_TERMINALES.includes(estadoNuevo)) {
        const tieneOtros = await tx.servicio.count({
          where: {
            conductor_id: conductorIdNuevo,
            id: { not: servicioId },
            estado: { in: ESTADOS_QUE_BLOQUEAN_RECURSO as any }
          }
        })
        if (tieneOtros === 0) {
          const estadoConductor =
            estadoNuevo === 'en_curso' ? 'servicio' : 'programado'
          await tx.conductores.update({
            where: { id: conductorIdNuevo },
            data: { estado: estadoConductor as any }
          })
        }
      }
    }
    if (vehiculoIdAnterior !== vehiculoIdNuevo) {
      if (vehiculoIdAnterior) {
        await liberarRecursos(tx, servicioId, null, vehiculoIdAnterior)
      }
      if (vehiculoIdNuevo && !ESTADOS_TERMINALES.includes(estadoNuevo)) {
        const tieneOtros = await tx.servicio.count({
          where: {
            vehiculo_id: vehiculoIdNuevo,
            id: { not: servicioId },
            estado: { in: ESTADOS_QUE_BLOQUEAN_RECURSO as any }
          }
        })
        if (tieneOtros === 0) {
          const estadoVehiculo =
            estadoNuevo === 'en_curso' ? 'servicio' : 'programado'
          await tx.vehiculos.update({
            where: { id: vehiculoIdNuevo },
            data: { estado: estadoVehiculo as any }
          })
        }
      }
    }
    return
  }

  if (!esEstadoValido(estadoAnterior, estadoNuevo)) {
    throw new Error(
      `Transición inválida: ${estadoAnterior} -> ${estadoNuevo}. ` +
        `Transiciones válidas desde ${estadoAnterior}: ${TRANSICIONES_VALIDAS[estadoAnterior].join(', ') || '(ninguna, estado terminal)'}`
    )
  }

  if (ESTADOS_QUE_LIBERAN_RECURSO.includes(estadoNuevo)) {
    await liberarRecursos(tx, servicioId, conductorIdAnterior, vehiculoIdAnterior)
    return
  }

  if (conductorIdAnterior && conductorIdAnterior !== conductorIdNuevo) {
    await liberarRecursos(tx, servicioId, conductorIdAnterior, null)
  }
  if (vehiculoIdAnterior && vehiculoIdAnterior !== vehiculoIdNuevo) {
    await liberarRecursos(tx, servicioId, null, vehiculoIdAnterior)
  }

  const conductorEfectivo = conductorIdNuevo || conductorIdAnterior
  const vehiculoEfectivo = vehiculoIdNuevo || vehiculoIdAnterior
  await aplicarEfectoAsignacion(
    tx,
    servicioId,
    conductorEfectivo,
    vehiculoEfectivo,
    estadoNuevo
  )
}

export function _internals() {
  return { esEstadoValido, recursoTieneOtrosServiciosActivos }
}
