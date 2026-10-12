/**
 * Extractos (FUEC) y documentos del vehículo en el portal del conductor.
 *
 * Lo que importa probar es la PROPIEDAD: el conductor ve sus extractos y los
 * papeles del vehículo que maneja, y nada de otro conductor aunque adivine el
 * id. Un 404 para lo ajeno (no un 403) para no confirmar que el id existe.
 *
 * Se levanta la app real (`buildApp`) y se firma el token del portal con el
 * secreto de la suite, que es lo mismo que emite el enlace mágico. Todo lo que
 * se crea lleva la marca `ZZTEST-FUEC` y se borra en duro al terminar.
 */
process.env.LOG_LEVEL ||= 'warn'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { FastifyInstance } from 'fastify'

/// `liquidaciones.service` le asigna `vfs` al build de NAVEGADOR de pdfmake al
/// importarse, y bajo vitest ese namespace es de solo lectura (mismo arreglo
/// que `sockets-dominio-integracion.test.ts`). El PDF del extracto usa el
/// pdfmake de Node (`require('pdfmake')`), que estos mocks no tocan.
vi.mock('pdfmake/build/pdfmake', () => ({ default: {}, createPdf: () => ({}) }))
vi.mock('pdfmake/build/vfs_fonts', () => ({ default: { vfs: {} }, vfs: {} }))

import { buildApp } from '../src/app'
import { env } from '../src/config/env'
import { prisma } from '../src/config/prisma'
import { getEmailFrontendUrl } from '../src/services/email.service'
import { firmarSnapshot, type SnapshotFuec } from '../src/modules/extractos/fuec-firma'
import { FUEC } from '../src/modules/extractos/fuec.config'

const MARCA = 'ZZTEST-FUEC'
const hoy = new Date()
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const dias = (n: number) => new Date(Date.now() + n * 86_400_000)

let app: FastifyInstance
const yo = randomUUID()
const otro = randomUUID()
const vehiculoMio = randomUUID()
const vehiculoViejo = randomUUID()
const vehiculoAjeno = randomUUID()
const extractoVigente = randomUUID()
const extractoVencido = randomUUID()
const extractoAjeno = randomUUID()
const soatMio = randomUUID()
const rutPropietario = randomUUID()
const soatViejo = randomUUID()
const soatAjeno = randomUUID()
let consecutivoBase = 0

/// La guarda del portal exige que el token siga registrado en
/// `conductor_token` (así se puede revocar): se registra uno por conductor.
const tokensPortal = new Map<string, string>()
async function tokenPortal(conductorId: string) {
  const previo = tokensPortal.get(conductorId)
  if (previo) return previo
  const token = jwt.sign({ tipo: 'conductor_portal', cedula: `${MARCA}-${conductorId.slice(0, 4)}`, nombre: 'Prueba' }, env.JWT_SECRET, {
    subject: conductorId,
    expiresIn: 600
  })
  await prisma.conductor_token.create({
    data: { conductor_id: conductorId, token, expires_at: new Date(Date.now() + 600_000) }
  })
  tokensPortal.set(conductorId, token)
  return token
}

async function pedir(conductorId: string | null, ruta: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api${ruta}`,
    headers: conductorId ? { authorization: `Bearer ${await tokenPortal(conductorId)}` } : {}
  })
  const json = res.headers['content-type']?.toString().includes('json') ? res.json() : null
  return { status: res.statusCode, body: json, raw: res.rawPayload, headers: res.headers }
}

async function limpiar() {
  const extractos = await prisma.fuec_extract.findMany({ where: { numero_completo: { startsWith: MARCA } }, select: { id: true } })
  const ids = extractos.map((e) => e.id)
  if (ids.length) {
    await prisma.fuec_extract_driver.deleteMany({ where: { fuec_id: { in: ids } } })
    await prisma.fuec_extract.deleteMany({ where: { id: { in: ids } } })
  }
  await prisma.documento.deleteMany({ where: { nombre_original: { startsWith: MARCA } } })
  await prisma.vehiculos.deleteMany({ where: { placa: { startsWith: 'ZZT' } } })
  await prisma.conductores.deleteMany({ where: { numero_identificacion: { startsWith: MARCA } } })
}

async function crearConductor(id: string, sufijo: string) {
  await prisma.conductores.create({
    data: {
      id,
      nombre: 'PRUEBA',
      apellido: sufijo,
      tipo_identificacion: 'CC',
      numero_identificacion: `${MARCA}-${sufijo}`,
      created_at: hoy,
      updated_at: hoy
    } as any
  })
}

async function crearVehiculo(id: string, placa: string) {
  await prisma.vehiculos.create({ data: { id, placa, clase_vehiculo: 'CAMIONETA', marca: 'TOYOTA', modelo: '2025', created_at: hoy, updated_at: hoy } as any })
}

async function crearExtracto(o: { id: string; conductorId: string; vehiculoId: string; placa: string; desde: Date; hasta: Date; anulado?: boolean }) {
  const consecutivo = ++consecutivoBase
  const numero = `${MARCA}-${consecutivo}`
  const snapshot: SnapshotFuec = {
    numero,
    consecutivo,
    empresa: { razon_social: FUEC.razon_social, nit: FUEC.nit },
    contrato_numero: '0003',
    contratante: { nombre: 'CONTRATANTE PRUEBA', nit: '900123456-7' },
    objeto_contrato: 'CONTRATO PARA TRANSPORTE DE PERSONAL',
    origen_destino: 'YOPAL - TAURAMENA',
    convenio: 'N/A',
    vigencia_desde: ymd(o.desde),
    vigencia_hasta: ymd(o.hasta),
    vehiculo: { placa: o.placa, modelo: '2025', marca: 'TOYOTA', clase: 'CAMIONETA', numero_interno: '01', tarjeta_operacion: '123' },
    conductores: [{ nombre: 'PRUEBA CONDUCTOR', cedula: '123456', licencia_vigencia: null }],
    responsable: { nombre: null, cedula: null, telefono: null, direccion: null },
    emitido_at: hoy.toISOString()
  }
  await prisma.fuec_extract.create({
    data: {
      id: o.id,
      consecutivo: 900_000 + consecutivo,
      numero_completo: numero,
      contrato_numero: '3',
      contratante_nombre: 'CONTRATANTE PRUEBA',
      objeto_contrato: snapshot.objeto_contrato,
      origen_destino: snapshot.origen_destino,
      convenio: 'N/A',
      vehiculo_id: o.vehiculoId,
      vehiculo_placa: o.placa,
      vigencia_desde: new Date(`${ymd(o.desde)}T00:00:00Z`),
      vigencia_hasta: new Date(`${ymd(o.hasta)}T00:00:00Z`),
      estado: o.anulado ? 'ANULADO' : 'VIGENTE',
      anulado_at: o.anulado ? hoy : null,
      motivo_anulacion: o.anulado ? 'Prueba' : null,
      snapshot_json: snapshot as any,
      firma_sha512: firmarSnapshot(snapshot),
      codigo_verificacion: `ZZT${consecutivo}`.padEnd(12, 'A'),
      emitido_at: hoy,
      conductores: { create: [{ conductor_id: o.conductorId, nombre: 'PRUEBA CONDUCTOR', identificacion: '123456', orden: 1 }] }
    }
  })
}

async function crearDocumento(id: string, vehiculoId: string, categoria: string, vence: Date | null) {
  await prisma.documento.create({
    data: {
      id,
      vehiculo_id: vehiculoId,
      categoria,
      tipo_documento: categoria,
      nombre_original: `${MARCA}-${categoria}.pdf`,
      nombre_archivo: `${id}.pdf`,
      ruta_archivo: `vehiculos/${vehiculoId}/documentos/${categoria}/${id}.pdf`,
      s3_key: `vehiculos/${vehiculoId}/documentos/${categoria}/${id}.pdf`,
      mimetype: 'application/pdf',
      size: 1234,
      estado: 'vigente',
      fecha_vencimiento: vence,
      fecha_vigencia: vence,
      upload_date: hoy,
      created_at: hoy,
      updated_at: hoy,
      metadata: { origen: 'test' }
    }
  })
}

beforeAll(async () => {
  await limpiar()
  await crearConductor(yo, 'YO')
  await crearConductor(otro, 'OTRO')
  await crearVehiculo(vehiculoMio, 'ZZT001')
  await crearVehiculo(vehiculoViejo, 'ZZT002')
  await crearVehiculo(vehiculoAjeno, 'ZZT003')
  await crearExtracto({ id: extractoVigente, conductorId: yo, vehiculoId: vehiculoMio, placa: 'ZZT001', desde: dias(-3), hasta: dias(20) })
  await crearExtracto({ id: extractoVencido, conductorId: yo, vehiculoId: vehiculoViejo, placa: 'ZZT002', desde: dias(-60), hasta: dias(-30) })
  await crearExtracto({ id: extractoAjeno, conductorId: otro, vehiculoId: vehiculoAjeno, placa: 'ZZT003', desde: dias(-3), hasta: dias(20) })
  await crearDocumento(soatMio, vehiculoMio, 'SOAT', dias(200))
  /// Del mismo vehículo pero NO es para el conductor (`paraConductor` falso).
  await crearDocumento(rutPropietario, vehiculoMio, 'RUT_PROPIETARIO', null)
  await crearDocumento(soatViejo, vehiculoViejo, 'SOAT', dias(200))
  await crearDocumento(soatAjeno, vehiculoAjeno, 'SOAT', dias(200))
  app = buildApp()
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await limpiar()
})

describe('portal del conductor · extractos', () => {
  it('sin token no entra', async () => {
    expect((await pedir(null, '/conductor-portal/extractos')).status).toBe(401)
  })

  it('lista solo los suyos, vigentes primero, con la URL pública del QR', async () => {
    const r = await pedir(yo, '/conductor-portal/extractos')
    expect(r.status).toBe(200)
    const ids = r.body.data.extractos.map((e: any) => e.id)
    expect(ids).toEqual([extractoVigente, extractoVencido])
    const [vigente, vencido] = r.body.data.extractos
    expect(vigente.estado).toBe('VIGENTE')
    expect(vencido.estado).toBe('VENCIDO')
    expect(vigente.url_publica).toBe(`${getEmailFrontendUrl()}/public/extracto/${vigente.codigo_verificacion}`)
    expect(vigente.conductores[0].soy_yo).toBe(true)
    /// Lo impreso sale del snapshot firmado (contrato con ceros), no de la columna.
    expect(vigente.contrato_numero).toBe('0003')
  })

  it('el detalle y el PDF de un extracto ajeno responden 404', async () => {
    expect((await pedir(yo, `/conductor-portal/extractos/${extractoAjeno}`)).status).toBe(404)
    expect((await pedir(yo, `/conductor-portal/extractos/${extractoAjeno}/pdf`)).status).toBe(404)
    expect((await pedir(yo, '/conductor-portal/extractos/no-es-uuid')).status).toBe(400)
  })

  it('entrega el PDF de su extracto', async () => {
    const r = await pedir(yo, `/conductor-portal/extractos/${extractoVigente}/pdf`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toContain('application/pdf')
    expect(r.raw.subarray(0, 5).toString()).toBe('%PDF-')
    expect(r.raw.toString('latin1')).toMatch(/\/Count 2\b/)
  })
})

describe('portal del conductor · documentos del vehículo', () => {
  it('muestra el vehículo de su extracto VIGENTE y solo las categorías para el conductor', async () => {
    const r = await pedir(yo, '/conductor-portal/vehiculos/documentos')
    expect(r.status).toBe(200)
    const placas = r.body.data.vehiculos.map((v: any) => v.placa)
    /// El del extracto vencido no: daría acceso a los papeles de cada
    /// vehículo que alguna vez manejó.
    expect(placas).toEqual(['ZZT001'])
    const v = r.body.data.vehiculos[0]
    expect(v.motivo).toBe('extracto')
    const claves = v.documentos.map((d: any) => d.clave)
    expect(claves).toContain('SOAT')
    expect(claves).not.toContain('RUT_PROPIETARIO')
    const soat = v.documentos.find((d: any) => d.clave === 'SOAT')
    expect(soat.estado).toBe('vigente')
    expect(soat.actual.id).toBe(soatMio)
  })

  it('firma la URL de su documento y rechaza el ajeno, el de un vehículo viejo y el interno', async () => {
    const ok = await pedir(yo, `/conductor-portal/vehiculos/${vehiculoMio}/documentos/${soatMio}/url`)
    expect(ok.status).toBe(200)
    expect(ok.body.data.url).toContain(`vehiculos/${vehiculoMio}/documentos/SOAT/${soatMio}.pdf`)
    expect(ok.body.data.url).toContain('X-Amz-Expires=300')

    expect((await pedir(yo, `/conductor-portal/vehiculos/${vehiculoAjeno}/documentos/${soatAjeno}/url`)).status).toBe(404)
    expect((await pedir(yo, `/conductor-portal/vehiculos/${vehiculoViejo}/documentos/${soatViejo}/url`)).status).toBe(404)
    expect((await pedir(yo, `/conductor-portal/vehiculos/${vehiculoMio}/documentos/${rutPropietario}/url`)).status).toBe(404)
    /// El id de un documento ajeno pasado con MI vehículo tampoco abre nada.
    expect((await pedir(yo, `/conductor-portal/vehiculos/${vehiculoMio}/documentos/${soatAjeno}/url`)).status).toBe(404)
  })

  it('el otro conductor ve su vehículo y no el mío', async () => {
    const r = await pedir(otro, '/conductor-portal/vehiculos/documentos')
    expect(r.body.data.vehiculos.map((v: any) => v.placa)).toEqual(['ZZT003'])
  })
})
