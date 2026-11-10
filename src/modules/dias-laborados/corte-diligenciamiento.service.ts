import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'

const CLAVE = 'dias_laborados_inicio_corte_nomina'
export const DIA_INICIO_DEFECTO = 21

export function fechaHoyColombia(): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date())
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? ''
  return `${valor('year')}-${valor('month')}-${valor('day')}`
}

export function fechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  const fechaDate = new Date(`${fecha}T00:00:00.000Z`)
  return !Number.isNaN(fechaDate.getTime()) && fechaDate.toISOString().slice(0, 10) === fecha
}

export async function leerInicioCorte(): Promise<number> {
  const fila = await prisma.configuracion_empresa.findUnique({ where: { clave: CLAVE } })
  const valor = (fila?.valor ?? {}) as { diaInicio?: unknown }
  const dia = Number(valor.diaInicio)
  return Number.isInteger(dia) && dia >= 1 && dia <= 28 ? dia : DIA_INICIO_DEFECTO
}

export async function guardarInicioCorte(diaInicio: number, usuarioId: string | null): Promise<number> {
  const valor = { diaInicio } as Prisma.InputJsonValue
  await prisma.configuracion_empresa.upsert({
    where: { clave: CLAVE },
    create: { clave: CLAVE, valor, actualizado_por_id: usuarioId },
    update: { valor, actualizado_por_id: usuarioId }
  })
  return diaInicio
}

export function periodoDeFecha(fecha: string, diaInicio: number) {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const inicio = dia >= diaInicio
    ? new Date(Date.UTC(anio, mes - 1, diaInicio))
    : new Date(Date.UTC(anio, mes - 2, diaInicio))
  const fin = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, diaInicio - 1))
  return { desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) }
}

/** Días sin registro hasta la fecha consultada, dentro de su propio corte. */
export async function pendientesDelCorte(conductorId: string, fecha: string, diaInicio: number) {
  const periodo = periodoDeFecha(fecha, diaInicio)
  const conductor = await prisma.conductores.findUnique({
    where: { id: conductorId }, select: { fecha_ingreso: true }
  })
  /// Un ingreso a mitad del corte no debe exigir días anteriores al contrato.
  const ingreso = conductor?.fecha_ingreso?.toISOString().slice(0, 10)
  const inicioExigible = ingreso && ingreso > periodo.desde ? ingreso : periodo.desde
  if (inicioExigible > fecha) return { ...periodo, inicioExigible, pendientes: [] as string[] }

  const registros = await prisma.registro_dia_laboral.findMany({
    where: {
      conductor_id: conductorId, deleted_at: null,
      fecha: { gte: new Date(`${inicioExigible}T00:00:00.000Z`), lte: new Date(`${fecha}T00:00:00.000Z`) }
    },
    select: { fecha: true }
  })
  const registrados = new Set(registros.map((r) => r.fecha.toISOString().slice(0, 10)))
  const pendientes: string[] = []
  const cursor = new Date(`${inicioExigible}T00:00:00.000Z`)
  while (cursor.toISOString().slice(0, 10) <= fecha) {
    const dia = cursor.toISOString().slice(0, 10)
    if (!registrados.has(dia)) pendientes.push(dia)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return { ...periodo, inicioExigible, pendientes }
}
