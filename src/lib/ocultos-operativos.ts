import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'

export type EntidadesOcultas = {
  conductores: Array<{ id: string; nombre: string; apellido: string; numero_identificacion: string | null }>
  vehiculos: Array<{ id: string; placa: string }>
}

const normalizarPlaca = (placa: string) => placa.toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function cargarEntidadesOcultas(): Promise<EntidadesOcultas> {
  const [conductores, vehiculos] = await Promise.all([
    prisma.conductores.findMany({
      where: { oculto: true },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
    }),
    prisma.vehiculos.findMany({
      where: { oculto: true },
      select: { id: true, placa: true },
    }),
  ])
  return { conductores, vehiculos }
}

function inValues(columna: Prisma.Sql, valores: string[]): Prisma.Sql {
  return valores.length ? Prisma.sql`${columna} IN (${Prisma.join(valores)})` : Prisma.sql`FALSE`
}

function placaNormalizada(columna: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`UPPER(REGEXP_REPLACE(COALESCE(${columna}, ''), '[^A-Za-z0-9]', '', 'g'))`
}

/** Liquidaciones de servicios con al menos un ítem de una placa/conductor oculto. */
export async function idsLiquidacionesServicioOcultas(entidades?: EntidadesOcultas): Promise<string[]> {
  const ocultas = entidades ?? await cargarEntidadesOcultas()
  const conductores = ocultas.conductores.map((c) => c.id)
  const vehiculos = ocultas.vehiculos.map((v) => v.id)
  const placas = [...new Set(ocultas.vehiculos.map((v) => normalizarPlaca(v.placa)).filter(Boolean))]
  if (!conductores.length && !vehiculos.length && !placas.length) return []

  const porConductor = conductores.length
    ? Prisma.sql`(s.conductor_id IN (${Prisma.join(conductores)}) OR rp.conductor_id IN (${Prisma.join(conductores)}))`
    : Prisma.sql`FALSE`
  const porVehiculo = vehiculos.length
    ? Prisma.sql`(s.vehiculo_id IN (${Prisma.join(vehiculos)}) OR rp.vehiculo_id IN (${Prisma.join(vehiculos)}))`
    : Prisma.sql`FALSE`
  const porPlaca = inValues(placaNormalizada(Prisma.sql`i.placa`), placas)

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT i.liquidacion_id::text AS id
    FROM liquidacion_servicio_item i
    LEFT JOIN servicios s ON s.id = i.servicio_id
    LEFT JOIN recargos_planillas rp ON rp.id = i.recargo_planilla_id
    WHERE i.deleted_at IS NULL AND (${porConductor} OR ${porVehiculo} OR ${porPlaca})
  `)
  return rows.map((row) => row.id)
}

/** Cierres finales de terceros: una sola placa oculta excluye toda la hoja agrupada. */
export async function idsCierresTercerosOcultos(entidades?: EntidadesOcultas): Promise<string[]> {
  const ocultas = entidades ?? await cargarEntidadesOcultas()
  const conductores = ocultas.conductores.map((c) => c.id)
  const vehiculos = ocultas.vehiculos.map((v) => v.id)
  const placas = [...new Set(ocultas.vehiculos.map((v) => normalizarPlaca(v.placa)).filter(Boolean))]
  if (!conductores.length && !vehiculos.length && !placas.length) return []
  /// Una liquidación de servicio puede tener cierres para varias placas. El
  /// cierre final completo queda oculto si su origen incluye alguna placa oculta.
  const liquidacionesServicioOcultas = await idsLiquidacionesServicioOcultas(ocultas)

  const byVehicleId = (column: Prisma.Sql) => inValues(column, vehiculos)
  const byPlate = (column: Prisma.Sql) => inValues(placaNormalizada(column), placas)
  const byItemRelations = Prisma.sql`EXISTS (
    SELECT 1
    FROM liquidacion_tercero_final_item fi
    JOIN liquidacion_tercero lt ON lt.id = fi.liquidacion_tercero_id
    LEFT JOIN liquidacion_servicio_item si ON si.id = lt.item_id
    LEFT JOIN servicios s ON s.id = si.servicio_id
    LEFT JOIN recargos_planillas rp ON rp.id = si.recargo_planilla_id
    WHERE fi.liquidacion_tercero_final_id = f.id
      AND fi.deleted_at IS NULL
      AND (
        ${byPlate(Prisma.sql`lt.placa`)}
        OR ${conductores.length ? Prisma.sql`(s.conductor_id IN (${Prisma.join(conductores)}) OR rp.conductor_id IN (${Prisma.join(conductores)}) OR EXISTS (SELECT 1 FROM liquidacion_tercero_concepto tc WHERE tc.liquidacion_tercero_id = lt.id AND tc.conductor_id IN (${Prisma.join(conductores)})))` : Prisma.sql`FALSE`}
        OR ${byVehicleId(Prisma.sql`s.vehiculo_id`)}
        OR ${byVehicleId(Prisma.sql`rp.vehiculo_id`)}
      )
  )`
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT f.id::text AS id
    FROM liquidacion_tercero_final f
    WHERE ${inValues(Prisma.sql`f.liquidacion_servicio_id`, liquidacionesServicioOcultas)}
      OR ${byVehicleId(Prisma.sql`f.vehiculo_id`)}
      OR ${byPlate(Prisma.sql`f.placa`)}
      OR EXISTS (
        SELECT 1 FROM liquidacion_tercero_final_vehiculo g
        WHERE g.liquidacion_tercero_final_id = f.id
          AND (${byVehicleId(Prisma.sql`g.vehiculo_id`)} OR ${byPlate(Prisma.sql`g.placa`)})
      )
      OR ${byItemRelations}
      OR EXISTS (
        SELECT 1 FROM liquidacion_tercero_final_concepto fc
        WHERE fc.liquidacion_tercero_final_id = f.id AND fc.deleted_at IS NULL
          AND ${conductores.length ? Prisma.sql`fc.conductor_id IN (${Prisma.join(conductores)})` : Prisma.sql`FALSE`}
      )
  `)
  return rows.map((row) => row.id)
}

export async function idsServiciosOcultos(entidades?: EntidadesOcultas): Promise<string[]> {
  const ocultas = entidades ?? await cargarEntidadesOcultas()
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT s.id::text AS id FROM servicios s
    WHERE ${inValues(Prisma.sql`s.conductor_id`, ocultas.conductores.map((c) => c.id))}
       OR ${inValues(Prisma.sql`s.vehiculo_id`, ocultas.vehiculos.map((v) => v.id))}
  `)
  return rows.map((row) => row.id)
}

export async function idsRecargosOcultos(entidades?: EntidadesOcultas, servicios: string[] = []): Promise<string[]> {
  const ocultas = entidades ?? await cargarEntidadesOcultas()
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p.id::text AS id FROM recargos_planillas p
    WHERE ${inValues(Prisma.sql`p.conductor_id`, ocultas.conductores.map((c) => c.id))}
       OR ${inValues(Prisma.sql`p.vehiculo_id`, ocultas.vehiculos.map((v) => v.id))}
       OR ${inValues(Prisma.sql`p.servicio_id`, servicios)}
  `)
  return rows.map((row) => row.id)
}

export async function idsDiasLaboralesOcultos(entidades?: EntidadesOcultas): Promise<string[]> {
  const ocultas = entidades ?? await cargarEntidadesOcultas()
  const placas = [...new Set(ocultas.vehiculos.map((v) => normalizarPlaca(v.placa)).filter(Boolean))]
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT r.id::text AS id
    FROM registro_dia_laboral r
    LEFT JOIN registro_dia_laboral_segmento s ON s.registro_dia_id = r.id AND s.deleted_at IS NULL
    WHERE ${inValues(Prisma.sql`r.conductor_id`, ocultas.conductores.map((c) => c.id))}
       OR ${inValues(Prisma.sql`r.mantenimiento_vehiculo_id`, ocultas.vehiculos.map((v) => v.id))}
       OR ${inValues(Prisma.sql`s.vehiculo_id`, ocultas.vehiculos.map((v) => v.id))}
       OR ${inValues(placaNormalizada(Prisma.sql`r.mantenimiento_vehiculo_placa`), placas)}
       OR ${inValues(placaNormalizada(Prisma.sql`s.vehiculo_placa`), placas)}
  `)
  return rows.map((row) => row.id)
}

/** Días copiados dentro de nómina cuya placa actual o impresa está oculta. */
export async function idsDiasNominaOcultos(entidades?: EntidadesOcultas): Promise<string[]> {
  const ocultas = entidades ?? await cargarEntidadesOcultas()
  const placas = [...new Set(ocultas.vehiculos.map((v) => normalizarPlaca(v.placa)).filter(Boolean))]
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT d.id::text AS id
    FROM liquidaciones_dias d
    WHERE d.deleted_at IS NULL
      AND (
        ${inValues(Prisma.sql`d.vehiculo_id`, ocultas.vehiculos.map((v) => v.id))}
        OR ${inValues(placaNormalizada(Prisma.sql`d.placa`), placas)}
      )
  `)
  return rows.map((row) => row.id)
}

export async function idsNominasOcultas(entidades?: EntidadesOcultas): Promise<string[]> {
  const ocultas = entidades ?? await cargarEntidadesOcultas()
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT l.id::text AS id FROM liquidaciones l
    WHERE ${inValues(Prisma.sql`l.conductor_id`, ocultas.conductores.map((c) => c.id))}
  `)
  return rows.map((row) => row.id)
}

export async function idsFacturasConEntidadesOcultas(liquidacionesServicio: string[]): Promise<string[]> {
  if (!liquidacionesServicio.length) return []
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT fi.factura_id::text AS id
    FROM factura_liquidacion_item fi
    WHERE fi.deleted_at IS NULL AND fi.liquidacion_id IN (${Prisma.join(liquidacionesServicio)})
  `)
  return rows.map((row) => row.id)
}

/** Extractos ligados a cualquier conductor o vehículo oculto, incluso por sus datos impresos. */
export async function idsExtractosOcultos(entidades?: EntidadesOcultas): Promise<string[]> {
  const ocultas = entidades ?? await cargarEntidadesOcultas()
  const conductores = ocultas.conductores.map((c) => c.id)
  const documentos = [...new Set(ocultas.conductores.map((c) => (c.numero_identificacion ?? '').replace(/\D/g, '')).filter(Boolean))]
  const vehiculos = ocultas.vehiculos.map((v) => v.id)
  const placas = [...new Set(ocultas.vehiculos.map((v) => normalizarPlaca(v.placa)).filter(Boolean))]
  if (!conductores.length && !documentos.length && !vehiculos.length && !placas.length) return []

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT e.id::text AS id
    FROM fuec_extract e
    WHERE ${inValues(Prisma.sql`e.vehiculo_id`, vehiculos)}
      OR ${inValues(placaNormalizada(Prisma.sql`e.vehiculo_placa`), placas)}
      OR EXISTS (
        SELECT 1 FROM fuec_extract_driver d
        WHERE d.fuec_id = e.id AND (
          ${inValues(Prisma.sql`d.conductor_id`, conductores)}
          OR ${inValues(Prisma.sql`REGEXP_REPLACE(COALESCE(d.identificacion, ''), '[^0-9]', '', 'g')`, documentos)}
        )
      )
  `)
  return rows.map((row) => row.id)
}

/** Feed de actividad: ids por módulo para paginar sin traer eventos ocultos y filtrarlos después. */
export async function idsActividadOculta() {
  const entidades = await cargarEntidadesOcultas()
  const conductores = entidades.conductores.map((c) => c.id)
  const vehiculos = entidades.vehiculos.map((v) => v.id)
  const servicios = await idsServiciosOcultos(entidades)
  const [recargos, liquidacionesServicios, cierresTerceros, extractos, dias, nominas] = await Promise.all([
    idsRecargosOcultos(entidades, servicios),
    idsLiquidacionesServicioOcultas(entidades),
    idsCierresTercerosOcultos(entidades),
    idsExtractosOcultos(entidades),
    idsDiasLaboralesOcultos(entidades),
    idsNominasOcultas(entidades),
  ])
  const idsServicio = await idsFacturasConEntidadesOcultas(liquidacionesServicios)
  const porModulo: Record<string, string[]> = {
    conductores,
    flota: vehiculos,
    vehiculos,
    servicios,
    recargos,
    'liquidaciones-servicios': [...liquidacionesServicios, ...idsServicio],
    'liquidaciones-terceros': cierresTerceros,
    nomina: nominas,
    recorridos: dias,
    extractos,
  }
  const referencias = [
    ...entidades.vehiculos.map((v) => v.placa),
    ...entidades.conductores.flatMap((c) => [
      `${c.nombre} ${c.apellido}`.trim(),
      c.numero_identificacion ?? '',
    ]),
  ].filter((value) => value.length >= 4)
  return { porModulo, referencias }
}
