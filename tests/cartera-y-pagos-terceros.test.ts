/**
 * Cartera (abonos, saldo, edades) y pago de cierres de terceros, contra la
 * base de pruebas y por HTTP.
 *
 * Se monta un Fastify mínimo con las dos rutas nuevas. La sesión se simula
 * (la del dashboard exige una fila en `sesiones` y eso es de otra suite): el
 * middleware de auth se sustituye por uno que lee el usuario de una cabecera.
 * Los permisos sí son los reales (`requirePermission` + `checkAccess`), y S3
 * se sustituye para no subir nada al bucket de verdad.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { PrismaClient } from '@prisma/client'

vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))
vi.mock('../src/middlewares/auth.middleware', () => ({
  authMiddleware: async (request: any, reply: any) => {
    const crudo = request.headers['x-test-user']
    if (!crudo) return reply.status(401).send({ error: 'No token' })
    request.user = JSON.parse(String(crudo))
  },
}))
const subidas: string[] = []
vi.mock('../src/config/aws', () => ({
  uploadToS3: async (key: string) => {
    subidas.push(key)
    return key
  },
  getS3SignedUrl: async (key: string) => `https://s3.test/${key}?firmada`,
}))

import { carteraRoutes } from '../src/modules/cartera/cartera.routes'
import { liquidacionesTercerosPagosRoutes } from '../src/modules/liquidaciones-terceros-pagos/liquidaciones-terceros-pagos.routes'
import { FacturacionLiquidacionesService } from '../src/modules/facturacion-liquidaciones/facturacion-liquidaciones.service'
import { CierreEstadoService } from '../src/modules/liquidaciones-terceros-descuentos/cierre-estado.service'
import { hoyColombia, sumarDias } from '../src/lib/pagos/medios'

const prisma = new PrismaClient()
const MARCA = 'ZZTEST-CARTERA'

let app: FastifyInstance
let clienteId: string
let usuarioId: string
let admin: Record<string, unknown>
const operaciones = { id: randomUUID(), nombre: 'Operaciones', role: 'user', area: ['operaciones'] }

const HOY = hoyColombia()

async function crearLiquidacion(total: number) {
  const id = randomUUID()
  await prisma.liquidacion_servicio.create({
    data: {
      id,
      consecutivo: `${MARCA}-${id.slice(0, 8)}`,
      cliente_id: clienteId,
      mes: 9,
      anio: 2026,
      estado: 'APROBADA' as any,
      subtotal: total,
      total,
      creado_por_id: usuarioId,
      actualizado_por_id: usuarioId,
    } as any,
  })
  return id
}

async function limpiar() {
  const liqs = await prisma.liquidacion_servicio.findMany({
    where: { consecutivo: { startsWith: MARCA } },
    select: { id: true },
  })
  const ids = liqs.map((l) => l.id)
  const facturas = await prisma.factura_liquidacion_servicio.findMany({
    where: { numero_factura: { startsWith: MARCA } },
    select: { id: true },
  })
  const fids = facturas.map((f) => f.id)
  await prisma.factura_liquidacion_abono.deleteMany({ where: { factura_id: { in: fids } } })
  await prisma.liquidacion_tercero_final_pago.deleteMany({
    where: { liquidacion_tercero_final: { consecutivo: { startsWith: MARCA } } },
  })
  await prisma.historial_estado_liquidacion_tercero_final.deleteMany({
    where: { liquidacion_tercero_final: { consecutivo: { startsWith: MARCA } } },
  })
  await prisma.liquidacion_tercero_final.deleteMany({ where: { consecutivo: { startsWith: MARCA } } })
  await prisma.historial_estado_liquidacion.deleteMany({ where: { liquidacion_id: { in: ids } } })
  await prisma.factura_liquidacion_item.deleteMany({ where: { liquidacion_id: { in: ids } } })
  await prisma.factura_liquidacion_servicio.deleteMany({ where: { id: { in: fids } } })
  await prisma.liquidacion_servicio.deleteMany({ where: { id: { in: ids } } })
}

const como = (u: Record<string, unknown>) => ({ 'x-test-user': JSON.stringify(u) })

beforeAll(async () => {
  clienteId = randomUUID()
  await prisma.clientes.create({
    data: {
      id: clienteId,
      nombre: `${MARCA} Cliente`,
      nit: `${MARCA}-${clienteId.slice(0, 6)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
  })
  usuarioId = randomUUID()
  await prisma.usuarios.create({
    data: {
      id: usuarioId,
      nombre: `${MARCA} Admin`,
      correo: `${MARCA.toLowerCase()}-${usuarioId.slice(0, 8)}@example.test`,
      password: 'x',
      role: 'usuario',
      area: ['administracion'],
      created_at: new Date(),
      updated_at: new Date(),
    } as any,
  })
  admin = { id: usuarioId, nombre: 'Admin Cartera', role: 'user', area: ['administracion'] }

  app = Fastify()
  await app.register(multipart)
  await app.register(carteraRoutes, { prefix: '/api' })
  await app.register(liquidacionesTercerosPagosRoutes, { prefix: '/api' })
  await app.ready()
}, 30_000)

afterAll(async () => {
  await limpiar()
  await prisma.clientes.deleteMany({ where: { id: clienteId } })
  await prisma.usuarios.deleteMany({ where: { id: usuarioId } })
  await app?.close()
  await prisma.$disconnect()
})

describe('Cartera por HTTP', () => {
  let facturaId: string

  it('facturar con valor y plazo deja las condiciones de cobro', async () => {
    const a = await crearLiquidacion(600_000)
    const b = await crearLiquidacion(400_000)
    const f = await FacturacionLiquidacionesService.crear(
      {
        numero_factura: `${MARCA}-001`,
        liquidacion_ids: [a, b],
        valor_total: 1_190_000,
        fecha_emision: sumarDias(HOY, -40),
        plazo_dias: 30,
      },
      usuarioId,
    )
    facturaId = f.id
    expect(f.valor_total).toBe(1_190_000)
    expect(f.ajuste_valor).toBe(190_000)
    expect(f.fecha_vencimiento).toBe(sumarDias(HOY, -10))
    expect(f.cliente_id).toBe(clienteId)
    expect(f.cartera).toMatchObject({ saldo: 1_190_000, estado: 'vencida', dias_vencida: 10 })
  })

  it('sin sesión 401; id mal formado 400', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/cartera/resumen' })).statusCode).toBe(401)
    const r = await app.inject({ method: 'GET', url: '/api/cartera/facturas/no-es-uuid', headers: como(admin) })
    expect(r.statusCode).toBe(400)
  })

  it('resumen: el cliente aparece en el tramo 1–30 con todo su saldo', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/cartera/resumen', headers: como(admin) })
    expect(r.statusCode).toBe(200)
    const fila = r.json().data.clientes.find((c: any) => c.cliente_id === clienteId)
    expect(fila).toMatchObject({ saldo: 1_190_000, vencido: 1_190_000, facturas: 1, max_dias_vencida: 10 })
    expect(fila.edades.d1_30).toBe(1_190_000)
  })

  it('operaciones (read) consulta pero no registra abonos', async () => {
    const leer = await app.inject({ method: 'GET', url: '/api/cartera/resumen', headers: como(operaciones) })
    expect(leer.statusCode).toBe(200)
    const escribir = await app.inject({
      method: 'POST',
      url: `/api/cartera/facturas/${facturaId}/abonos`,
      headers: como(operaciones),
      payload: { fecha: HOY, valor: 1000, medio: 'TRANSFERENCIA' },
    })
    expect(escribir.statusCode).toBe(403)
  })

  it('abono parcial con retenciones: baja el saldo por lo recibido y lo retenido', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/cartera/facturas/${facturaId}/abonos`,
      headers: como(admin),
      payload: {
        fecha: HOY,
        valor: '500000',
        retefuente: '35000',
        reteica: '',
        reteiva: 0,
        medio: 'TRANSFERENCIA',
        referencia: 'TRX-1',
      },
    })
    expect(r.statusCode).toBe(201)
    const { factura, abonos } = r.json().data
    expect(factura).toMatchObject({ aplicado: 535_000, saldo: 655_000, estado: 'vencida', abonos: 1 })
    expect(abonos[0]).toMatchObject({ valor: 500_000, retefuente: 35_000, medio: 'TRANSFERENCIA', referencia: 'TRX-1' })
    expect(abonos[0].creado_por.id).toBe(usuarioId)
  })

  it('rechaza un abono que supera el saldo, un medio inventado y uno vacío', async () => {
    const supera = await app.inject({
      method: 'POST',
      url: `/api/cartera/facturas/${facturaId}/abonos`,
      headers: como(admin),
      payload: { fecha: HOY, valor: 655_000.01, medio: 'EFECTIVO' },
    })
    expect(supera.statusCode).toBe(409)
    expect(supera.json().code).toBe('SUPERA_SALDO')

    const medio = await app.inject({
      method: 'POST',
      url: `/api/cartera/facturas/${facturaId}/abonos`,
      headers: como(admin),
      payload: { fecha: HOY, valor: 10, medio: 'BITCOIN' },
    })
    expect(medio.statusCode).toBe(400)

    const vacio = await app.inject({
      method: 'POST',
      url: `/api/cartera/facturas/${facturaId}/abonos`,
      headers: como(admin),
      payload: { fecha: HOY, valor: 0, medio: 'EFECTIVO' },
    })
    expect(vacio.statusCode).toBe(400)
  })

  it('el valor no puede bajar de lo ya abonado', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/cartera/facturas/${facturaId}/condiciones`,
      headers: como(admin),
      payload: { valor_total: 500_000 },
    })
    expect(r.statusCode).toBe(409)
    expect(r.json().code).toBe('VALOR_MENOR_QUE_ABONADO')
  })

  it('mover el vencimiento al futuro la saca de vencida', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/cartera/facturas/${facturaId}/condiciones`,
      headers: como(admin),
      payload: { plazo_dias: 60 },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().data.factura).toMatchObject({
      plazo_dias: 60,
      fecha_vencimiento: sumarDias(HOY, 20),
      estado: 'abonada',
      tramo: 'corriente',
    })
  })

  it('con el comprobante (multipart) y el saldo exacto queda pagada y sale de las edades', async () => {
    const limite = '----zzlimite'
    const cuerpo = [
      ...Object.entries({ fecha: HOY, valor: '655000', medio: 'CONSIGNACION' }).flatMap(([k, v]) => [
        `--${limite}`,
        `Content-Disposition: form-data; name="${k}"`,
        '',
        v,
      ]),
      `--${limite}`,
      'Content-Disposition: form-data; name="comprobante"; filename="soporte.pdf"',
      'Content-Type: application/pdf',
      '',
      '%PDF-1.4 prueba',
      `--${limite}--`,
      '',
    ].join('\r\n')
    const r = await app.inject({
      method: 'POST',
      url: `/api/cartera/facturas/${facturaId}/abonos`,
      headers: { ...como(admin), 'content-type': `multipart/form-data; boundary=${limite}` },
      payload: cuerpo,
    })
    expect(r.statusCode).toBe(201)
    const data = r.json().data
    expect(data.factura).toMatchObject({ saldo: 0, estado: 'pagada', tramo: null })
    expect(data.comprobante_s3_key).toMatch(new RegExp(`^cartera/abonos/${facturaId}/[0-9a-f-]{36}\\.pdf$`))
    expect(subidas).toContain(data.comprobante_s3_key)

    const resumen = await app.inject({ method: 'GET', url: '/api/cartera/resumen', headers: como(admin) })
    expect(resumen.json().data.clientes.find((c: any) => c.cliente_id === clienteId)).toBeUndefined()

    const pagadas = await app.inject({
      method: 'GET',
      url: `/api/cartera/facturas?estado=pagada&cliente_id=${clienteId}`,
      headers: como(admin),
    })
    expect(pagadas.json().data.facturas.map((f: any) => f.id)).toEqual([facturaId])

    const conComprobante = data.abonos.find((a: any) => a.tiene_comprobante)
    const url = await app.inject({
      method: 'GET',
      url: `/api/cartera/abonos/${conComprobante.id}/comprobante`,
      headers: como(admin),
    })
    expect(url.json().data.url).toContain('firmada')
  })

  it('una factura con abonos no se anula; retirar el abono devuelve el saldo', async () => {
    await expect(FacturacionLiquidacionesService.anular(facturaId, usuarioId, 'prueba')).rejects.toMatchObject({
      code: 'TIENE_ABONOS',
    })

    const detalle = await app.inject({ method: 'GET', url: `/api/cartera/facturas/${facturaId}`, headers: como(admin) })
    const ultimo = detalle.json().data.abonos.find((a: any) => a.valor === 655_000)
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/cartera/abonos/${ultimo.id}`,
      headers: como(admin),
      payload: { motivo: 'Consignación duplicada' },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().data.factura).toMatchObject({ saldo: 655_000, abonos: 1 })

    /// Retirado no es borrado: la fila sigue con su marca.
    const fila = await prisma.factura_liquidacion_abono.findUnique({ where: { id: ultimo.id } })
    expect(fila?.deleted_at).not.toBeNull()
    expect(fila?.motivo_eliminacion).toBe('Consignación duplicada')
  })

  it('el listado de facturación trae el saldo y el estado de cobro', async () => {
    const r = await FacturacionLiquidacionesService.listar({ busqueda: `${MARCA}-001` })
    expect(r.facturas[0].cartera).toMatchObject({ saldo: 655_000, estado: 'abonada', abonos: 1 })
    expect(r.facturas[0].fecha_emision).toBe(sumarDias(HOY, -40))
  })

  it('quitar una liquidación conserva el ajuste manual del valor', async () => {
    const r = await FacturacionLiquidacionesService.obtenerPorId(facturaId)
    const item = r.items.find((i: any) => Number(i.valor_liquidacion) === 400_000)!
    const q = await FacturacionLiquidacionesService.quitarLiquidacion(facturaId, item.liquidacion_id, usuarioId)
    expect(q.factura.valor_total).toBe(790_000)
  })
})

describe('Pago de cierres de terceros', () => {
  let cierreId: string

  async function crearCierre(estado: string) {
    const liq = await crearLiquidacion(100)
    const c = await prisma.liquidacion_tercero_final.create({
      data: {
        consecutivo: `${MARCA}-LTF-${randomUUID().slice(0, 8)}`,
        liquidacion_servicio_id: liq,
        placa: 'ZZZ999',
        mes: 9,
        anio: 2026,
        estado,
        total_pagar: 2_345_678.9,
      },
      select: { id: true },
    })
    return c.id
  }

  const actor = () => ({ id: usuarioId, name: 'Admin', areas: ['Administracion'] })

  it('no se puede marcar PAGADA sin fecha y medio', async () => {
    cierreId = await crearCierre('APROBADA')
    await expect(CierreEstadoService.cambiar({ id: cierreId, estado: 'PAGADA', actor: actor() })).rejects.toMatchObject({
      code: 'FALTA_PAGO',
      status: 400,
    })
    await expect(
      CierreEstadoService.cambiar({ id: cierreId, estado: 'PAGADA', actor: actor(), pago: { fecha: HOY } }),
    ).rejects.toMatchObject({ code: 'FALTA_PAGO' })
    const c = await prisma.liquidacion_tercero_final.findUnique({ where: { id: cierreId } })
    expect(c?.estado).toBe('APROBADA')
  })

  it('rechaza un comprobante que no salió de la subida del módulo', async () => {
    await expect(
      CierreEstadoService.cambiar({
        id: cierreId,
        estado: 'PAGADA',
        actor: actor(),
        pago: { fecha: HOY, medio: 'TRANSFERENCIA', comprobante_s3_key: 'nomina/desprendibles/ajeno.pdf' },
      }),
    ).rejects.toMatchObject({ code: 'FALTA_PAGO' })
  })

  it('con los datos queda PAGADA y el pago guardado con el valor del cierre', async () => {
    const subida = await app.inject({
      method: 'POST',
      url: '/api/liquidaciones-terceros-pagos/comprobante',
      headers: {
        ...como(admin),
        'content-type': 'multipart/form-data; boundary=zz',
      },
      payload: [
        '--zz',
        'Content-Disposition: form-data; name="comprobante"; filename="pago.png"',
        'Content-Type: image/png',
        '',
        'png',
        '--zz--',
        '',
      ].join('\r\n'),
    })
    expect(subida.statusCode).toBe(201)
    const { s3_key, nombre } = subida.json().data
    expect(s3_key).toMatch(/^liquidaciones-terceros\/pagos\/\d{4}-\d{2}\/[0-9a-f-]{36}\.png$/)

    const r = await CierreEstadoService.cambiar({
      id: cierreId,
      estado: 'PAGADA',
      actor: actor(),
      pago: { fecha: HOY, medio: 'TRANSFERENCIA', referencia: 'BANCO-77', comprobante_s3_key: s3_key, comprobante_nombre: nombre },
    })
    expect(r.estado).toBe('PAGADA')

    const g = await app.inject({ method: 'GET', url: `/api/liquidaciones-terceros-pagos/${cierreId}`, headers: como(admin) })
    expect(g.statusCode).toBe(200)
    expect(g.json().data).toMatchObject({
      sin_registro: false,
      pago: { fecha: HOY, medio: 'TRANSFERENCIA', referencia: 'BANCO-77', valor: 2_345_678.9, tiene_comprobante: true },
    })

    const periodo = await app.inject({
      method: 'GET',
      url: '/api/liquidaciones-terceros-pagos/periodo?anio=2026&mes=9',
      headers: como(admin),
    })
    expect(periodo.json().data[cierreId].referencia).toBe('BANCO-77')
  })

  it('devolverla a APROBADA archiva el pago (no lo borra)', async () => {
    await CierreEstadoService.cambiar({ id: cierreId, estado: 'APROBADA', motivo: 'Se marcó por error', actor: actor() })
    const g = await app.inject({ method: 'GET', url: `/api/liquidaciones-terceros-pagos/${cierreId}`, headers: como(admin) })
    const data = g.json().data
    expect(data.pago).toBeNull()
    expect(data.sin_registro).toBe(false)
    expect(data.historial).toHaveLength(1)
    expect(data.historial[0].motivo_archivo).toContain('Se marcó por error')
  })

  it('una PAGADA histórica sale «sin registro» y se puede completar después', async () => {
    const historica = await crearCierre('PAGADA')
    const antes = await app.inject({ method: 'GET', url: `/api/liquidaciones-terceros-pagos/${historica}`, headers: como(admin) })
    expect(antes.json().data).toMatchObject({ pago: null, sin_registro: true })

    const sinPermiso = await app.inject({
      method: 'PUT',
      url: `/api/liquidaciones-terceros-pagos/${historica}`,
      headers: como({ ...operaciones, area: ['operaciones'] }),
      payload: { fecha: '2026-09-30', medio: 'CHEQUE' },
    })
    expect(sinPermiso.statusCode).toBe(403)

    const r = await app.inject({
      method: 'PUT',
      url: `/api/liquidaciones-terceros-pagos/${historica}`,
      headers: como(admin),
      payload: { fecha: '2026-09-30', medio: 'CHEQUE', referencia: 'CH-0012' },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json().data).toMatchObject({ sin_registro: false, pago: { medio: 'CHEQUE', fecha: '2026-09-30' } })
  })

  it('el lote a PAGADA sin datos falla antes de tocar ninguna hoja', async () => {
    const otro = await crearCierre('APROBADA')
    await expect(
      CierreEstadoService.cambiarLote({ anio: 2026, mes: 9, ids: [otro], hacia: 'PAGADA', actor: actor() }),
    ).rejects.toMatchObject({ code: 'FALTA_PAGO' })
    const r = await CierreEstadoService.cambiarLote({
      anio: 2026,
      mes: 9,
      ids: [otro],
      hacia: 'PAGADA',
      actor: actor(),
      pago: { fecha: HOY, medio: 'EFECTIVO' },
    })
    expect(r.cambiados).toHaveLength(1)
    expect(await prisma.liquidacion_tercero_final_pago.count({ where: { liquidacion_tercero_final_id: otro, deleted_at: null } })).toBe(1)
  })
})
