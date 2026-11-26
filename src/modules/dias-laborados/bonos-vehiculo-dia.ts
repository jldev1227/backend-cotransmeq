import { prisma } from '../../config/prisma'

export interface DiaBonoSinTramo {
  id: string
  conductor_id: string
  fecha: Date
  tipo: string
  vehiculo_placa?: string | null
  mantenimiento_vehiculo_id?: string | null
  mantenimiento_vehiculo_placa?: string | null
}

export interface VehiculoDelBono {
  id: string
  placa: string
}

interface PlanillaDisponible {
  conductor_id: string
  vehiculo_id: string
  a_o: number
  mes: number
  vehiculos: { placa: string } | null
  dias_laborales_planillas: { dia: number; disponibilidad: boolean | null }[]
}

const fechaISO = (fecha: Date) => fecha.toISOString().slice(0, 10)
const clave = (conductorId: string, fecha: string) => `${conductorId}|${fecha}`

/**
 * Atribuye bonos de día solo cuando hay un vehículo inequívoco. Una planilla
 * del mismo mes no basta: debe participar exactamente en esa fecha y tener
 * marcada la disponibilidad. El mantenimiento usa la placa de su propio día.
 */
export function resolverVehiculosBonosDia(
  dias: DiaBonoSinTramo[],
  planillas: PlanillaDisponible[],
  vehiculos: VehiculoDelBono[] = [],
): Map<string, VehiculoDelBono> {
  const porPlaca = new Map(vehiculos.map((v) => [v.placa.toUpperCase(), v]))
  const porId = new Map(vehiculos.map((v) => [v.id, v]))
  const candidatos = new Map<string, Map<string, VehiculoDelBono>>()

  for (const p of planillas) {
    if (!p.vehiculos?.placa) continue
    for (const d of p.dias_laborales_planillas) {
      if (d.disponibilidad !== true) continue
      const fecha = `${p.a_o}-${String(p.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`
      const k = clave(p.conductor_id, fecha)
      const valores = candidatos.get(k) ?? new Map<string, VehiculoDelBono>()
      valores.set(p.vehiculo_id, { id: p.vehiculo_id, placa: p.vehiculos.placa })
      candidatos.set(k, valores)
    }
  }

  const resultado = new Map<string, VehiculoDelBono>()
  for (const dia of dias) {
    if (dia.tipo === 'DESCANSO') continue
    if (dia.tipo === 'MANTENIMIENTO') {
      const propio = dia.mantenimiento_vehiculo_id
        ? porId.get(dia.mantenimiento_vehiculo_id)
        : porPlaca.get(String(dia.mantenimiento_vehiculo_placa ?? '').toUpperCase())
      if (propio) resultado.set(dia.id, propio)
      continue
    }
    if (dia.tipo !== 'DISPONIBLE') continue
    const direct = porPlaca.get(String(dia.vehiculo_placa ?? '').toUpperCase())
    const valores = candidatos.get(clave(dia.conductor_id, fechaISO(dia.fecha)))
    /// Dos placas distintas el mismo día no autorizan adjudicar el bono a una.
    if (valores && valores.size > 1 && (!direct || !valores.has(direct.id))) continue
    const planilla = valores?.size === 1 ? [...valores.values()][0] : null
    if (direct && planilla && direct.id !== planilla.id) continue
    const elegido = direct ?? planilla
    if (elegido) resultado.set(dia.id, elegido)
  }
  return resultado
}

/** Consulta solo los meses de los días con bono, para compartir la misma regla en canvas, formulario y borradores. */
export async function vehiculosBonosSinTramo(dias: DiaBonoSinTramo[]): Promise<Map<string, VehiculoDelBono>> {
  if (!dias.length) return new Map()
  const disponibles = dias.filter((d) => d.tipo === 'DISPONIBLE')
  const meses = new Map<string, { a_o: number; mes: number }>()
  for (const d of disponibles) {
    const mes = fechaISO(d.fecha).slice(0, 7)
    meses.set(mes, { a_o: Number(mes.slice(0, 4)), mes: Number(mes.slice(5, 7)) })
  }
  const placas = [...new Set(dias.flatMap((d) => [d.vehiculo_placa, d.mantenimiento_vehiculo_placa]).filter((p): p is string => !!p))]
  const ids = [...new Set(dias.map((d) => d.mantenimiento_vehiculo_id).filter((id): id is string => !!id))]
  const [planillas, vehiculos] = await Promise.all([
    meses.size
      ? prisma.recargos_planillas.findMany({
          where: {
            deleted_at: null,
            conductor_id: { in: [...new Set(disponibles.map((d) => d.conductor_id))] },
            OR: [...meses.values()],
            vehiculos: { oculto: false, deleted_at: null },
          },
          select: {
            conductor_id: true, vehiculo_id: true, a_o: true, mes: true,
            vehiculos: { select: { placa: true } },
            dias_laborales_planillas: {
              where: { deleted_at: null, disponibilidad: true },
              select: { dia: true, disponibilidad: true },
            },
          },
        })
      : Promise.resolve([]),
    placas.length || ids.length
      ? prisma.vehiculos.findMany({
          where: { deleted_at: null, oculto: false, OR: [{ placa: { in: placas } }, { id: { in: ids } }] },
          select: { id: true, placa: true },
        })
      : Promise.resolve([]),
  ])
  return resolverVehiculosBonosDia(dias, planillas, vehiculos)
}
