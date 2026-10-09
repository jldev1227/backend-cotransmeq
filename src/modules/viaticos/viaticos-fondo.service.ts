/**
 * Fondo de anticipos del área de operaciones, y tercero (propietario) de la placa del anticipo.
 *
 * ── Fondo ──
 * Operaciones recibe un saldo cada cierto tiempo para entregar anticipos y pagar gastos. Es UNO
 * solo, del área: cualquiera de operaciones registra lo que llega y todos descuentan del mismo.
 * Cada movimiento guarda quién lo hizo (`usuario_id`). El saldo es la suma de los movimientos:
 * - RECARGA (+): lo que recibió el área.
 * - ANTICIPO (−): un anticipo entregado.
 * - GASTO_EMPRESA (−): un gasto que asume la empresa (oficina, mantenimiento…) pagado con el fondo.
 * - AJUSTE (±): le cambiaron el valor a un anticipo o gasto ya descontado, o una corrección manual.
 * - REVERSO (+): se eliminó un anticipo o gasto; el dinero vuelve al fondo.
 * - CIERRE (0): marca el fin de un corte. No mueve plata: lo que quedaba sigue en el fondo y
 *   pasa como «arrastre» al corte siguiente, donde se suma al próximo saldo recibido. Un saldo
 *   recibido NO cierra el corte por sí solo: a veces llega plata a mitad de corte.
 * Sin saldo no se puede dar un anticipo, ni uno mayor a lo que hay. Se considera bajo cuando queda
 * en el 15 % (el mismo umbral del saldo de un anticipo) o menos de lo que había justo después de la
 * última recarga.
 *
 * Descuentan del fondo los de operaciones sin administración. Administración entrega sin fondo,
 * como hasta ahora, pero puede ver el saldo, registrar lo que le entrega al área y corregirlo.
 *
 * ── Tercero ──
 * El vehículo no tiene llave al tercero: lo enlaza `propietario_identificacion` (= `terceros.
 * identificacion`) y, si falta, `propietario_nombre`. Crear el tercero desde un anticipo llena
 * esos dos campos del vehículo para que quede asociado a la placa.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { logger } from '../../utils/logger'
import { prisma } from '../../config/prisma'
import { emitNotificacion } from '../../sockets'
import { parsear, UMBRAL_SALDO_BAJO, ViaticosError } from './viaticos.service'

type Tx = Prisma.TransactionClient

/** El único fondo que existe hoy: el del área de operaciones. */
const FONDO = 'OPERACIONES'

export type TipoMovimiento = 'RECARGA' | 'ANTICIPO' | 'GASTO_EMPRESA' | 'AJUSTE' | 'REVERSO' | 'CIERRE'

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v))
const redondear = (v: number) => Math.round(v * 100) / 100
const moneda = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`

/** ¿Lo que entrega este usuario sale del fondo del área? Operaciones sin administración. */
export async function requiereFondo(usuarioId: string, tx: Tx | typeof prisma = prisma): Promise<boolean> {
  const u = await tx.usuarios.findUnique({ where: { id: usuarioId }, select: { area: true } })
  const areas = u?.area ?? []
  return areas.includes('operaciones') && !areas.includes('administracion')
}

async function saldo(tx: Tx | typeof prisma = prisma): Promise<number> {
  const r = await tx.viatico_fondo_movimiento.aggregate({ where: { fondo: FONDO }, _sum: { valor: true } })
  return redondear(num(r._sum.valor))
}

/// Serializa los movimientos del fondo: dos anticipos simultáneos (de dos personas de operaciones)
/// no pueden gastar el mismo saldo. El candado se suelta al terminar la transacción.
async function bloquearFondo(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`viatico_fondo:${FONDO}`}))`
}

export interface Corte {
  /** Desde cuándo corre (fecha del cierre anterior o del primer movimiento). */
  desde: string | null
  /** Lo que quedaba al cerrar el corte anterior: entra a este como saldo inicial. */
  arrastre: number
  recibido: number
  anticipos: number
  gastos: number
  ajustes: number
  reversos: number
  /** Saldo al cerrar (o el actual, si el corte sigue abierto). */
  restante: number
  movimientos: number
  cerrado: { id: string; fecha: string; por: string | null; observaciones: string | null } | null
}

function nuevoCorte(desde: Date | null, arrastre: number): Corte {
  return { desde: desde ? desde.toISOString() : null, arrastre, recibido: 0, anticipos: 0, gastos: 0, ajustes: 0, reversos: 0, restante: arrastre, movimientos: 0, cerrado: null }
}

/** Estado del fondo del área para la app y el panel: saldo, base de la última recarga y si está bajo. */
export async function estadoFondo(usuarioId: string) {
  const [requiere, movimientos] = await Promise.all([
    requiereFondo(usuarioId),
    prisma.viatico_fondo_movimiento.findMany({
      where: { fondo: FONDO },
      orderBy: { created_at: 'asc' },
      include: {
        anticipo: { select: { id: true, concepto: true, conductor: { select: { nombre: true, apellido: true } }, vehiculo: { select: { placa: true } } } },
        gasto_empresa: { select: { id: true, categoria: true, descripcion: true } },
        usuario: { select: { nombre: true } }
      }
    })
  ])
  let acumulado = 0
  let base = 0
  let ultimaRecarga: { valor: number; fecha: string; por: string | null } | null = null
  /// Cortes: cada CIERRE termina uno. El corte abierto va acumulando desde el último cierre.
  const cortes: Corte[] = []
  let corte = nuevoCorte(movimientos[0]?.created_at ?? null, 0)
  for (const m of movimientos) {
    const valor = num(m.valor)
    acumulado = redondear(acumulado + valor)
    if (m.tipo === 'RECARGA') {
      base = acumulado
      ultimaRecarga = { valor, fecha: m.created_at.toISOString(), por: m.usuario?.nombre ?? null }
      corte.recibido = redondear(corte.recibido + valor)
    } else if (m.tipo === 'ANTICIPO') corte.anticipos = redondear(corte.anticipos - valor)
    else if (m.tipo === 'GASTO_EMPRESA') corte.gastos = redondear(corte.gastos - valor)
    else if (m.tipo === 'AJUSTE') corte.ajustes = redondear(corte.ajustes + valor)
    else if (m.tipo === 'REVERSO') corte.reversos = redondear(corte.reversos + valor)
    if (m.tipo !== 'CIERRE') corte.movimientos += 1
    if (m.tipo === 'CIERRE') {
      corte.cerrado = { id: m.id, fecha: m.created_at.toISOString(), por: m.usuario?.nombre ?? null, observaciones: m.observaciones }
      corte.restante = acumulado
      cortes.push(corte)
      corte = nuevoCorte(m.created_at, acumulado)
    }
  }
  corte.restante = acumulado
  const porcentaje = base > 0 ? Math.round((acumulado / base) * 1000) / 10 : 0
  return {
    fondo: FONDO,
    /// Si lo que entrega ESTE usuario descuenta del fondo (operaciones); administración no.
    requiere_fondo: requiere,
    saldo: acumulado,
    /// Lo que había justo después de la última recarga: la referencia del 15 %.
    base_ultima_recarga: base,
    porcentaje_restante: porcentaje,
    saldo_bajo: base > 0 ? acumulado <= base * UMBRAL_SALDO_BAJO : acumulado <= 0,
    sin_saldo: acumulado <= 0,
    ultima_recarga: ultimaRecarga,
    /// El corte abierto: lo que arrastró del anterior, lo recibido y lo gastado desde entonces.
    corte_actual: corte,
    /// Cortes cerrados, el más reciente primero.
    cortes: cortes.reverse().slice(0, 12),
    movimientos: movimientos
      .slice(-60)
      .reverse()
      .map((m) => ({
        id: m.id,
        tipo: m.tipo as TipoMovimiento,
        valor: num(m.valor),
        observaciones: m.observaciones,
        fecha: m.created_at.toISOString(),
        registrado_por: m.usuario?.nombre ?? null,
        /// Lo que se registra a mano (el saldo recibido, una corrección) se puede editar; lo de un
        /// anticipo o gasto se corrige editando ese anticipo o gasto.
        editable: esManual(m),
        anticipo: m.anticipo
          ? {
              id: m.anticipo.id,
              concepto: m.anticipo.concepto,
              conductor: `${m.anticipo.conductor.nombre} ${m.anticipo.conductor.apellido}`.trim(),
              placa: m.anticipo.vehiculo.placa
            }
          : null,
        gasto_empresa: m.gasto_empresa ? { id: m.gasto_empresa.id, categoria: m.gasto_empresa.categoria, descripcion: m.gasto_empresa.descripcion } : null
      }))
  }
}

const recargaSchema = z.object({
  valor: z.coerce.number().positive('debe ser mayor que cero').max(9_999_999_999, 'es demasiado grande'),
  observaciones: z.string().trim().max(500).optional().nullable()
})

/** Se registra el saldo que recibió el área (el inicial o uno nuevo). */
export async function registrarRecarga(usuarioId: string, body: unknown) {
  const input = parsear(recargaSchema, body)
  await prisma.$transaction(async (tx) => {
    await bloquearFondo(tx)
    await tx.viatico_fondo_movimiento.create({
      data: { fondo: FONDO, usuario_id: usuarioId, tipo: 'RECARGA', valor: input.valor, observaciones: input.observaciones || null, creado_por_id: usuarioId }
    })
  })
  return estadoFondo(usuarioId)
}

const ajusteSchema = z.object({
  /// Con signo: positivo suma al saldo, negativo resta.
  valor: z.coerce
    .number()
    .refine((v) => v !== 0, 'no puede ser cero')
    .refine((v) => Math.abs(v) <= 9_999_999_999, 'es demasiado grande'),
  observaciones: z.string().trim().min(5, 'explica el motivo de la corrección').max(500)
})

/**
 * Corrección manual del saldo (un error al registrar, plata que se devolvió en efectivo…). Siempre
 * con motivo. Restar no puede dejar el saldo negativo.
 */
export async function ajustarSaldo(usuarioId: string, body: unknown) {
  const input = parsear(ajusteSchema, body)
  await prisma.$transaction(async (tx) => {
    await bloquearFondo(tx)
    if (input.valor < 0) {
      const disponible = await saldo(tx)
      if (-input.valor > disponible) {
        throw new ViaticosError(`No se puede restar ${moneda(-input.valor)}: el saldo es ${moneda(disponible)}.`, 409, 'FONDO_INSUFICIENTE')
      }
    }
    await tx.viatico_fondo_movimiento.create({
      data: { fondo: FONDO, usuario_id: usuarioId, tipo: 'AJUSTE', valor: input.valor, observaciones: input.observaciones, creado_por_id: usuarioId }
    })
  })
  return estadoFondo(usuarioId)
}

/** Movimiento registrado a mano: una recarga o una corrección sin anticipo ni gasto detrás. */
function esManual(m: { tipo: string; anticipo_id: string | null; gasto_empresa_id: string | null }) {
  return (m.tipo === 'RECARGA' || m.tipo === 'AJUSTE') && !m.anticipo_id && !m.gasto_empresa_id
}

/**
 * Corrige un movimiento registrado a mano: el valor o el concepto de un saldo recibido, o de una
 * corrección. La recarga sigue siendo positiva y la corrección con signo y motivo. El cambio no
 * puede dejar el saldo negativo (ya se entregó lo que había).
 */
export async function editarMovimiento(usuarioId: string, id: string, body: unknown) {
  if (!z.string().uuid().safeParse(id).success) throw new ViaticosError('El movimiento no existe.', 404, 'NO_ENCONTRADO')
  await prisma.$transaction(async (tx) => {
    await bloquearFondo(tx)
    const actual = await tx.viatico_fondo_movimiento.findFirst({ where: { id, fondo: FONDO } })
    if (!actual) throw new ViaticosError('El movimiento no existe.', 404, 'NO_ENCONTRADO')
    if (!esManual(actual)) {
      throw new ViaticosError('Este movimiento viene de un anticipo o un gasto: corrígelo editando ese anticipo o gasto.', 409, 'MOVIMIENTO_NO_EDITABLE')
    }
    const input = actual.tipo === 'RECARGA' ? parsear(recargaSchema, body) : parsear(ajusteSchema, body)
    const diferencia = redondear(input.valor - num(actual.valor))
    if (diferencia < 0) {
      const disponible = await saldo(tx)
      if (-diferencia > disponible) {
        throw new ViaticosError(
          `No se puede bajar ${moneda(-diferencia)}: el saldo del área es ${moneda(disponible)} y ya se entregó el resto.`,
          409,
          'FONDO_INSUFICIENTE'
        )
      }
    }
    await tx.viatico_fondo_movimiento.update({ where: { id }, data: { valor: input.valor, observaciones: input.observaciones || null } })
    logger.info(
      { type: 'viatico-fondo-movimiento-editado', id, usuarioId, antes: { valor: num(actual.valor), observaciones: actual.observaciones }, despues: input },
      '[viaticos] movimiento del fondo editado'
    )
  })
  return estadoFondo(usuarioId)
}

const cierreSchema = z.object({ observaciones: z.string().trim().max(500).optional().nullable() })

/**
 * Cierra el corte en curso. No mueve plata: deja la marca con el saldo que quedaba, que pasa
 * como arrastre al corte siguiente y se sumará al próximo saldo recibido. No se puede cerrar
 * dos veces seguidas sin que haya pasado nada en medio.
 */
export async function cerrarCorte(usuarioId: string, body: unknown) {
  const input = parsear(cierreSchema, body)
  await prisma.$transaction(async (tx) => {
    await bloquearFondo(tx)
    const ultimo = await tx.viatico_fondo_movimiento.findFirst({ where: { fondo: FONDO }, orderBy: { created_at: 'desc' }, select: { tipo: true } })
    if (!ultimo) throw new ViaticosError('Todavía no hay movimientos en el saldo del área: no hay nada que cerrar.', 409, 'CORTE_VACIO')
    if (ultimo.tipo === 'CIERRE') throw new ViaticosError('El corte ya está cerrado: no ha pasado nada desde el último cierre.', 409, 'CORTE_YA_CERRADO')
    const restante = await saldo(tx)
    await tx.viatico_fondo_movimiento.create({
      data: {
        fondo: FONDO,
        usuario_id: usuarioId,
        tipo: 'CIERRE',
        valor: 0,
        observaciones: input.observaciones || `Cierre de corte · quedaron ${moneda(restante)} que pasan al siguiente`,
        creado_por_id: usuarioId
      }
    })
    logger.info({ type: 'viatico-fondo-cierre', usuarioId, restante }, '[viaticos] corte del fondo cerrado')
  })
  return estadoFondo(usuarioId)
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Consolidado del fondo en un periodo, para el PDF: cada movimiento con el saldo que había en ese
 * momento (antes y después), el saldo con que arrancó el periodo, los totales y los cierres (con
 * cuánto quedó en cada uno). Las fechas van en día de Colombia.
 */
export async function consolidadoFondo(desde: unknown, hasta: unknown) {
  if (typeof desde !== 'string' || !FECHA.test(desde) || typeof hasta !== 'string' || !FECHA.test(hasta)) {
    throw new ViaticosError('Indica el periodo como desde y hasta (AAAA-MM-DD).', 400, 'DATOS_INVALIDOS')
  }
  const inicio = new Date(`${desde}T00:00:00-05:00`)
  const fin = new Date(`${hasta}T23:59:59.999-05:00`)
  if (fin < inicio) throw new ViaticosError('La fecha final es anterior a la inicial.', 400, 'DATOS_INVALIDOS')
  const movimientos = await prisma.viatico_fondo_movimiento.findMany({
    where: { fondo: FONDO, created_at: { lte: fin } },
    orderBy: { created_at: 'asc' },
    include: {
      anticipo: { select: { id: true, concepto: true, conductor: { select: { nombre: true, apellido: true } }, vehiculo: { select: { placa: true } } } },
      gasto_empresa: { select: { id: true, categoria: true, descripcion: true, beneficiario: true } },
      usuario: { select: { nombre: true } }
    }
  })
  let acumulado = 0
  let saldoInicial = 0
  const filas: Array<{
    id: string
    tipo: TipoMovimiento
    fecha: string
    detalle: string
    entra: number
    sale: number
    saldo_antes: number
    saldo_despues: number
    registrado_por: string | null
    observaciones: string | null
  }> = []
  const totales = { recibido: 0, anticipos: 0, gastos: 0, ajustes: 0, reversos: 0, cierres: 0 }
  const cierres: Array<{ id: string; fecha: string; restante: number; por: string | null; observaciones: string | null }> = []
  for (const m of movimientos) {
    const valor = num(m.valor)
    const antes = acumulado
    acumulado = redondear(acumulado + valor)
    if (m.created_at < inicio) {
      saldoInicial = acumulado
      continue
    }
    const tipo = m.tipo as TipoMovimiento
    if (tipo === 'RECARGA') totales.recibido = redondear(totales.recibido + valor)
    else if (tipo === 'ANTICIPO') totales.anticipos = redondear(totales.anticipos - valor)
    else if (tipo === 'GASTO_EMPRESA') totales.gastos = redondear(totales.gastos - valor)
    else if (tipo === 'AJUSTE') totales.ajustes = redondear(totales.ajustes + valor)
    else if (tipo === 'REVERSO') totales.reversos = redondear(totales.reversos + valor)
    else if (tipo === 'CIERRE') {
      totales.cierres += 1
      cierres.push({ id: m.id, fecha: m.created_at.toISOString(), restante: acumulado, por: m.usuario?.nombre ?? null, observaciones: m.observaciones })
    }
    const detalle = m.anticipo
      ? `${m.anticipo.conductor.nombre} ${m.anticipo.conductor.apellido}`.trim() + ` · ${m.anticipo.vehiculo.placa} · ${m.anticipo.concepto}`
      : m.gasto_empresa
        ? `${m.gasto_empresa.categoria} · ${m.gasto_empresa.descripcion}${m.gasto_empresa.beneficiario ? ` · ${m.gasto_empresa.beneficiario}` : ''}`
        : tipo === 'CIERRE'
          ? `Cierre de corte · quedaron ${moneda(acumulado)}`
          : (m.observaciones ?? '')
    filas.push({
      id: m.id,
      tipo,
      fecha: m.created_at.toISOString(),
      detalle,
      entra: valor > 0 ? valor : 0,
      sale: valor < 0 ? -valor : 0,
      saldo_antes: antes,
      saldo_despues: acumulado,
      registrado_por: m.usuario?.nombre ?? null,
      observaciones: m.observaciones
    })
  }
  return { fondo: FONDO, desde, hasta, saldo_inicial: saldoInicial, saldo_final: acumulado, totales, cierres, movimientos: filas }
}

/** A qué se refiere un movimiento: un anticipo o un gasto de la empresa. */
type Referencia = { anticipo_id: string } | { gasto_empresa_id: string }

const QUE: Record<'anticipo' | 'gasto', string> = { anticipo: 'El anticipo', gasto: 'El gasto' }

async function descontar(tx: Tx, usuarioId: string, ref: Referencia, valor: number, tipo: 'ANTICIPO' | 'GASTO_EMPRESA') {
  if (!(await requiereFondo(usuarioId, tx))) return null
  await bloquearFondo(tx)
  const antes = await saldo(tx)
  const que = tipo === 'ANTICIPO' ? 'anticipos' : 'gastos'
  if (antes <= 0) {
    throw new ViaticosError(`El área de operaciones no tiene saldo para ${que}. Registra primero el saldo que recibió.`, 409, 'FONDO_SIN_SALDO')
  }
  if (valor > antes) {
    throw new ViaticosError(`${QUE[tipo === 'ANTICIPO' ? 'anticipo' : 'gasto']} (${moneda(valor)}) supera el saldo del área (${moneda(antes)}).`, 409, 'FONDO_INSUFICIENTE')
  }
  await tx.viatico_fondo_movimiento.create({ data: { fondo: FONDO, usuario_id: usuarioId, tipo, valor: -valor, ...ref, creado_por_id: usuarioId } })
  return { antes, despues: redondear(antes - valor) }
}

/** ¿Salió del fondo? (lo entregó o pagó alguien de operaciones). */
async function salioDelFondo(tx: Tx | typeof prisma, ref: Referencia) {
  return Boolean(await tx.viatico_fondo_movimiento.findFirst({ where: { ...ref, fondo: FONDO, tipo: { in: ['ANTICIPO', 'GASTO_EMPRESA'] } }, select: { id: true } }))
}

async function ajustar(tx: Tx, editorId: string, ref: Referencia, valorAnterior: number, valorNuevo: number, que: string) {
  const diferencia = redondear(valorNuevo - valorAnterior)
  if (!diferencia || !(await salioDelFondo(tx, ref))) return
  await bloquearFondo(tx)
  if (diferencia > 0) {
    const disponible = await saldo(tx)
    if (diferencia > disponible) {
      throw new ViaticosError(`Subir ${que} ${moneda(diferencia)} supera el saldo del área (${moneda(disponible)}).`, 409, 'FONDO_INSUFICIENTE')
    }
  }
  await tx.viatico_fondo_movimiento.create({
    data: { fondo: FONDO, usuario_id: editorId, tipo: 'AJUSTE', valor: -diferencia, ...ref, creado_por_id: editorId, observaciones: `Valor de ${que} de ${moneda(valorAnterior)} a ${moneda(valorNuevo)}` }
  })
}

async function reversar(tx: Tx, editorId: string, ref: Referencia, observaciones: string) {
  if (!(await salioDelFondo(tx, ref))) return
  const salido = await tx.viatico_fondo_movimiento.aggregate({ where: { ...ref, fondo: FONDO }, _sum: { valor: true } })
  const devolver = redondear(-num(salido._sum.valor))
  if (devolver <= 0) return
  await tx.viatico_fondo_movimiento.create({ data: { fondo: FONDO, usuario_id: editorId, tipo: 'REVERSO', valor: devolver, ...ref, creado_por_id: editorId, observaciones } })
}

/**
 * Descuenta un anticipo nuevo del fondo del área, dentro de la transacción que lo crea. Devuelve el
 * saldo antes y después (para el aviso del 15 %), o `null` si quien lo entrega no usa el fondo.
 */
export const descontarAnticipo = (tx: Tx, usuarioId: string, anticipoId: string, valor: number) =>
  descontar(tx, usuarioId, { anticipo_id: anticipoId }, valor, 'ANTICIPO')

/** Le cambiaron el valor a un anticipo: el fondo devuelve o descuenta la diferencia. */
export const ajustarAnticipo = (tx: Tx, editorId: string, anticipoId: string, anterior: number, nuevo: number) =>
  ajustar(tx, editorId, { anticipo_id: anticipoId }, anterior, nuevo, 'el anticipo')

/** Se eliminó un anticipo: lo que salió del fondo (anticipo más ajustes) vuelve. */
export const reversarAnticipo = (tx: Tx, editorId: string, anticipoId: string) =>
  reversar(tx, editorId, { anticipo_id: anticipoId }, 'Anticipo eliminado')

/** Gasto de la empresa pagado por alguien de operaciones: sale del fondo del área. */
export const descontarGastoEmpresa = (tx: Tx, usuarioId: string, gastoId: string, valor: number) =>
  descontar(tx, usuarioId, { gasto_empresa_id: gastoId }, valor, 'GASTO_EMPRESA')

export const ajustarGastoEmpresa = (tx: Tx, editorId: string, gastoId: string, anterior: number, nuevo: number) =>
  ajustar(tx, editorId, { gasto_empresa_id: gastoId }, anterior, nuevo, 'el gasto')

export const reversarGastoEmpresa = (tx: Tx, editorId: string, gastoId: string) =>
  reversar(tx, editorId, { gasto_empresa_id: gastoId }, 'Gasto eliminado')

/**
 * Si un anticipo o gasto dejó el fondo en el 15 % o menos, se avisa una vez a operaciones y a
 * administración (quien entrega el siguiente desembolso).
 */
export async function avisarFondoBajo(_usuarioId: string, cambio: { antes: number; despues: number }) {
  try {
    const estado = await estadoFondo(_usuarioId)
    const umbral = estado.base_ultima_recarga * UMBRAL_SALDO_BAJO
    if (!(estado.base_ultima_recarga > 0 && cambio.despues <= umbral && cambio.antes > umbral)) return
    const destinatarios = await prisma.usuarios.findMany({
      where: { activo: true, OR: [{ area: { has: 'operaciones' } }, { area: { has: 'administracion' } }] },
      select: { id: true }
    })
    if (!destinatarios.length) return
    const creadas = await prisma.notificacion.createManyAndReturn({
      data: destinatarios.map((u) => ({
        usuario_id: u.id,
        tipo: 'GENERAL' as const,
        titulo: 'El saldo de operaciones para anticipos está bajo',
        mensaje: `Quedan ${moneda(cambio.despues)} (${estado.porcentaje_restante}% de lo recibido). Hay que pedir el siguiente desembolso.`,
        referencia_id: u.id,
        referencia_tipo: 'viatico_fondo'
      }))
    })
    for (const n of creadas) emitNotificacion(n)
  } catch {
    // El anticipo ya quedó: el aviso es un extra.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tercero de la placa
// ─────────────────────────────────────────────────────────────────────────────

const terceroSelect = { id: true, nombre_completo: true, identificacion: true, telefono: true } satisfies Prisma.tercerosSelect

/** Tercero (propietario) vinculado a la placa, o `null` con lo que el vehículo dice del propietario. */
export async function terceroDePlaca(vehiculoId: string, tx: Tx | typeof prisma = prisma) {
  const v = await tx.vehiculos.findFirst({
    where: { id: vehiculoId, deleted_at: null },
    select: { id: true, placa: true, propietario_nombre: true, propietario_identificacion: true }
  })
  if (!v) throw new ViaticosError('La placa no existe.', 404, 'VEHICULO_INVALIDO')
  const identificacion = v.propietario_identificacion?.trim()
  const nombre = v.propietario_nombre?.trim()
  const valido = (s: string | undefined) => Boolean(s && s.toUpperCase() !== 'NULL')
  /// El vehículo a veces trae la identificación con prefijo («C.C 93404069»); el tercero, solo los dígitos.
  const identificaciones = valido(identificacion) ? [...new Set([identificacion!, identificacion!.replace(/\D/g, '')])].filter((x) => x.length >= 5) : []
  const tercero =
    (identificaciones.length ? await tx.terceros.findFirst({ where: { identificacion: { in: identificaciones }, deleted_at: null }, select: terceroSelect }) : null) ??
    (valido(nombre) ? await tx.terceros.findFirst({ where: { nombre_completo: { equals: nombre, mode: 'insensitive' }, deleted_at: null }, select: terceroSelect }) : null)
  return {
    placa: v.placa,
    tercero,
    /// Lo que el vehículo tiene escrito aunque no haya tercero: ayuda a llenar el formulario.
    propietario: valido(nombre) || valido(identificacion) ? { nombre: valido(nombre) ? nombre! : null, identificacion: valido(identificacion) ? identificacion! : null } : null
  }
}

const terceroSchema = z.object({
  nombre_completo: z.string().trim().min(3, 'escribe el nombre del propietario').max(255),
  identificacion: z.string().trim().min(5, 'escribe la cédula o NIT').max(50),
  telefono: z.string().trim().max(50).optional().nullable()
})

/**
 * Crea (o reutiliza, si ya existe con esa identificación) el tercero propietario de la placa y lo
 * deja asociado al vehículo.
 */
export async function crearTerceroDePlaca(vehiculoId: string, body: unknown) {
  const input = parsear(terceroSchema, body)
  /// Solo dígitos y el guion del NIT: «C.C 93404069» se guarda «93404069», como el resto de terceros.
  const identificacion = input.identificacion.replace(/[^\d-]/g, '')
  if (identificacion.replace(/\D/g, '').length < 5) {
    throw new ViaticosError('identificacion: escribe la cédula o el NIT (al menos 5 dígitos)', 400, 'DATOS_INVALIDOS')
  }
  const nombre = input.nombre_completo.toUpperCase()
  return prisma.$transaction(async (tx) => {
    const v = await tx.vehiculos.findFirst({ where: { id: vehiculoId, deleted_at: null }, select: { id: true } })
    if (!v) throw new ViaticosError('La placa no existe.', 404, 'VEHICULO_INVALIDO')
    const existente = await tx.terceros.findFirst({ where: { identificacion }, select: { ...terceroSelect, deleted_at: true } })
    const tercero = existente
      ? await tx.terceros.update({
          where: { id: existente.id },
          /// Uno borrado con esa identificación se reactiva en vez de chocar con la llave única.
          data: { deleted_at: null, activo: true, ...(input.telefono && !existente.telefono ? { telefono: input.telefono } : {}) },
          select: terceroSelect
        })
      : await tx.terceros.create({
          data: { nombre_completo: nombre, identificacion, telefono: input.telefono || null, notas: 'Creado desde un anticipo de viáticos' },
          select: terceroSelect
        })
    await tx.vehiculos.update({
      where: { id: vehiculoId },
      data: { propietario_nombre: tercero.nombre_completo, propietario_identificacion: tercero.identificacion }
    })
    return { tercero, reutilizado: Boolean(existente) }
  })
}
