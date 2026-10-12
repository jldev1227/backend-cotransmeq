/**
 * Hoja de vida documental del conductor: rutas, sincronía de la licencia con
 * la ficha y avisos de vencimiento.
 *
 * Contra la base desechable y con S3 simulado: el bucket del `.env` es el de
 * producción y un test no debe subir nada allí. Lo que se fija:
 *
 *  - permisos: leer con `conductores` en `read`, escribir solo con `full`;
 *  - la licencia se ve con la fecha de la ficha aunque no haya archivo, y
 *    subirla, corregirla o borrarla mantiene `vencimiento_licencia` al día
 *    (es lo que imprime el FUEC);
 *  - versión nueva → la anterior pasa al historial; borrar la actual revive
 *    la anterior;
 *  - la `FOTO_PERFIL`, que vive en la misma tabla, ni se lista ni se toca;
 *  - el cron avisa una vez por umbral, a las áreas que tocan, y no repite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { env } from '../src/config/env'
import { olvidarSesionesEnCache } from '../src/middlewares/cache-sesiones'
import { registrarSesion } from './helpers/sesion-prueba'
import { conductoresDocumentosRoutes } from '../src/modules/conductores-documentos/conductores-documentos.routes'
import { avisarVencimientosDocumentosConductor } from '../src/jobs/vencimientos-documentos-conductor.cron'
import { hoyColombia } from '../src/modules/conductores-documentos/vigencia'

/// `vi.mock` se iza sobre los imports: lo que use su fábrica tiene que izarse también.
const { subidas } = vi.hoisted(() => ({ subidas: [] as string[] }))
vi.mock('../src/config/aws', () => ({
  uploadToS3: vi.fn(async (key: string) => {
    subidas.push(key)
    return key
  }),
  getS3SignedUrl: vi.fn(async (key: string) => `https://firmada.test/${key}`),
}))

const prisma = new PrismaClient()
const MARCA = 'zztest-docs-conductor'
let app: FastifyInstance

const sumarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const HOY = hoyColombia()

async function crearUsuario(opciones: { role: string; areas: string[]; permisos_rutas?: Record<string, string> }) {
  const id = randomUUID()
  await prisma.usuarios.create({
    data: {
      id,
      nombre: `Prueba ${opciones.areas.join('+')}`,
      correo: `${MARCA}-${id.slice(0, 8)}@example.test`,
      password: 'no-se-usa',
      role: opciones.role,
      area: opciones.areas,
      activo: true,
      permisos_rutas: opciones.permisos_rutas ?? undefined,
      created_at: new Date(),
      updated_at: new Date(),
    } as any,
  })
  const token = jwt.sign({ sub: id, id, role: opciones.role, area: opciones.areas }, env.JWT_SECRET, { expiresIn: '1h' })
  await registrarSesion(id, token)
  return { id, token }
}

async function crearConductor(extra: Record<string, unknown> = {}) {
  const id = randomUUID()
  await prisma.conductores.create({
    data: {
      id,
      nombre: 'PRUEBA',
      apellido: `${MARCA} ${id.slice(0, 6)}`,
      tipo_identificacion: 'CC',
      created_at: new Date(),
      updated_at: new Date(),
      ...extra,
    } as any,
  })
  return id
}

/** Cuerpo multipart a mano: los campos primero y el archivo al final, como el front. */
function multipartBody(campos: Record<string, string>, archivo?: { nombre: string; tipo: string; contenido: Buffer }) {
  const limite = `----limite${randomUUID()}`
  const partes: Buffer[] = []
  for (const [k, v] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  }
  if (archivo) {
    partes.push(
      Buffer.from(
        `--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="${archivo.nombre}"\r\nContent-Type: ${archivo.tipo}\r\n\r\n`,
      ),
      archivo.contenido,
      Buffer.from('\r\n'),
    )
  }
  partes.push(Buffer.from(`--${limite}--\r\n`))
  return { payload: Buffer.concat(partes), headers: { 'content-type': `multipart/form-data; boundary=${limite}` } }
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

async function subir(token: string, conductorId: string, campos: Record<string, string>, archivo: boolean | { tipo: string } = true) {
  const { payload, headers } = multipartBody(
    campos,
    archivo ? { nombre: 'soporte.pdf', tipo: archivo === true ? 'application/pdf' : archivo.tipo, contenido: PDF } : undefined,
  )
  return app.inject({ method: 'POST', url: `/api/conductores/${conductorId}/documentos`, payload, headers: { ...headers, authorization: `Bearer ${token}` } })
}
const get = (url: string, token?: string) =>
  app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} })

let admin: { id: string; token: string }
let soloLectura: { id: string; token: string }

beforeAll(async () => {
  process.env.PERMISSIONS_MODE = 'enforce'
  app = Fastify()
  await app.register(multipart as any)
  await app.register(conductoresDocumentosRoutes, { prefix: '/api' })
  await app.ready()
  admin = await crearUsuario({ role: 'admin', areas: ['talento_humano'] })
  /// La lista blanca por usuario es la forma de tener `read` sobre un módulo
  /// que por área es general.
  soloLectura = await crearUsuario({ role: 'usuario', areas: ['operaciones'], permisos_rutas: { conductores: 'read' } })
})

beforeEach(() => {
  process.env.PERMISSIONS_MODE = 'enforce'
  olvidarSesionesEnCache()
})

afterAll(async () => {
  const conductores = (await prisma.conductores.findMany({ where: { apellido: { contains: MARCA } }, select: { id: true } })).map((c) => c.id)
  const usuarios = (await prisma.usuarios.findMany({ where: { correo: { contains: MARCA } }, select: { id: true } })).map((u) => u.id)
  await prisma.documento.deleteMany({ where: { conductor_id: { in: conductores } } })
  await prisma.notificacion.deleteMany({ where: { usuario_id: { in: usuarios } } })
  await prisma.conductores.deleteMany({ where: { id: { in: conductores } } })
  await prisma.sesiones.deleteMany({ where: { usuario_id: { in: usuarios } } })
  await prisma.usuarios.deleteMany({ where: { id: { in: usuarios } } })
  await app.close()
  await prisma.$disconnect()
})

describe('acceso', () => {
  it('sin sesión 401; id mal formado 400; solo lectura lee pero no escribe', async () => {
    const c = await crearConductor()
    expect((await get(`/api/conductores/${c}/documentos`)).statusCode).toBe(401)
    expect((await get('/api/conductores/no-es-uuid/documentos', admin.token)).statusCode).toBe(400)
    expect((await get(`/api/conductores/${c}/documentos`, soloLectura.token)).statusCode).toBe(200)
    expect((await get('/api/conductores/documentos/catalogo', soloLectura.token)).statusCode).toBe(200)
    const r = await subir(soloLectura.token, c, { categoria: 'CEDULA' })
    expect(r.statusCode).toBe(403)
    expect(subidas).toHaveLength(0)
  })

  it('un conductor que no existe es 404', async () => {
    expect((await get(`/api/conductores/${randomUUID()}/documentos`, admin.token)).statusCode).toBe(404)
  })
})

describe('listado y licencia', () => {
  it('la licencia toma la vigencia de la ficha aunque no haya archivo; la foto de perfil no aparece', async () => {
    const vence = sumarDias(HOY, 10)
    const c = await crearConductor({ vencimiento_licencia: new Date(`${vence}T00:00:00Z`), categoria_licencia: 'C1' })
    await prisma.documento.create({
      data: {
        id: randomUUID(), conductor_id: c, categoria: 'FOTO_PERFIL', nombre_original: 'foto.jpg', nombre_archivo: 'f.jpg',
        ruta_archivo: 'x', s3_key: 'x', mimetype: 'image/jpeg', size: 1, estado: 'vigente',
        upload_date: new Date(), created_at: new Date(), updated_at: new Date(),
      },
    })
    const r = await get(`/api/conductores/${c}/documentos`, admin.token)
    expect(r.statusCode).toBe(200)
    const { categorias, resumen } = r.json().data
    expect(categorias.map((x: any) => x.clave)).not.toContain('FOTO_PERFIL')
    const lic = categorias.find((x: any) => x.clave === 'LICENCIA')
    expect(lic).toMatchObject({ vence: true, estado: 'por_vencer', dias: 10, vencimiento: vence, actual: null, categoria_licencia: 'C1' })
    expect(resumen.por_vencer).toBe(1)
    /// Lo requerido sin fecha también cuenta como faltante (cédula, contrato, hoja de vida).
    expect(categorias.find((x: any) => x.clave === 'CEDULA').estado).toBe('faltante')
  })

  it('subir, corregir y borrar la licencia mantiene la ficha sincronizada', async () => {
    const c = await crearConductor({ vencimiento_licencia: new Date('2025-01-01T00:00:00Z') })

    const r1 = await subir(admin.token, c, { categoria: 'LICENCIA', fecha_vencimiento: '2027-05-01', categoria_licencia: 'C2' })
    expect(r1.statusCode).toBe(200)
    expect(subidas.at(-1)).toMatch(new RegExp(`^conductores/${c}/documentos/LICENCIA/[0-9a-f-]{36}\\.pdf$`))
    let ficha = await prisma.conductores.findUnique({ where: { id: c }, select: { vencimiento_licencia: true, categoria_licencia: true } })
    expect(ficha?.vencimiento_licencia?.toISOString().slice(0, 10)).toBe('2027-05-01')
    expect(ficha?.categoria_licencia).toBe('C2')

    // Versión nueva: la anterior pasa al historial y la ficha toma la nueva fecha.
    const r2 = await subir(admin.token, c, { categoria: 'LICENCIA', fecha_vencimiento: '2030-05-01' })
    expect(r2.statusCode).toBe(200)
    let lista = (await get(`/api/conductores/${c}/documentos`, admin.token)).json().data
    let lic = lista.categorias.find((x: any) => x.clave === 'LICENCIA')
    expect(lic.actual.id).toBe(r2.json().data.id)
    expect(lic.historial.map((h: any) => h.id)).toEqual([r1.json().data.id])
    expect(lic).toMatchObject({ estado: 'vigente', vencimiento: '2030-05-01' })

    // Corregir la fecha de la actual también corrige la ficha…
    const p = await app.inject({
      method: 'PATCH', url: `/api/conductores/${c}/documentos/${r2.json().data.id}`,
      payload: { fecha_vencimiento: '2030-06-15' }, headers: { authorization: `Bearer ${admin.token}` },
    })
    expect(p.statusCode).toBe(200)
    ficha = await prisma.conductores.findUnique({ where: { id: c }, select: { vencimiento_licencia: true, categoria_licencia: true } })
    expect(ficha?.vencimiento_licencia?.toISOString().slice(0, 10)).toBe('2030-06-15')

    // …pero corregir una del historial no.
    await app.inject({
      method: 'PATCH', url: `/api/conductores/${c}/documentos/${r1.json().data.id}`,
      payload: { fecha_vencimiento: '2027-05-02' }, headers: { authorization: `Bearer ${admin.token}` },
    })
    ficha = await prisma.conductores.findUnique({ where: { id: c }, select: { vencimiento_licencia: true, categoria_licencia: true } })
    expect(ficha?.vencimiento_licencia?.toISOString().slice(0, 10)).toBe('2030-06-15')

    // Borrar la actual revive la anterior y la ficha vuelve a su fecha.
    const d = await app.inject({ method: 'DELETE', url: `/api/conductores/${c}/documentos/${r2.json().data.id}`, headers: { authorization: `Bearer ${admin.token}` } })
    expect(d.statusCode).toBe(200)
    lista = (await get(`/api/conductores/${c}/documentos`, admin.token)).json().data
    lic = lista.categorias.find((x: any) => x.clave === 'LICENCIA')
    expect(lic.actual.id).toBe(r1.json().data.id)
    expect(lic.historial).toHaveLength(0)
    ficha = await prisma.conductores.findUnique({ where: { id: c }, select: { vencimiento_licencia: true, categoria_licencia: true } })
    expect(ficha?.vencimiento_licencia?.toISOString().slice(0, 10)).toBe('2027-05-02')
    expect(ficha?.categoria_licencia).toBe('C2')
    /// El borrado es lógico: la fila sigue ahí con `deleted_at`.
    expect((await prisma.documento.findUnique({ where: { id: r2.json().data.id } }))?.deleted_at).not.toBeNull()

    // URL firmada del archivo actual.
    const u = await get(`/api/conductores/${c}/documentos/${r1.json().data.id}/url`, soloLectura.token)
    expect(u.statusCode).toBe(200)
    expect(u.json().data.url).toContain(`conductores/${c}/documentos/LICENCIA/`)
  })

  it('«no aplica» solo donde el catálogo lo admite, y validaciones del cuerpo', async () => {
    const c = await crearConductor()
    expect((await subir(admin.token, c, { categoria: 'CEDULA', no_aplica: 'true' }, false)).statusCode).toBe(400)
    const na = await subir(admin.token, c, { categoria: 'LIBRETA_MILITAR', no_aplica: 'true' }, false)
    expect(na.statusCode).toBe(200)
    const lista = (await get(`/api/conductores/${c}/documentos`, admin.token)).json().data
    expect(lista.categorias.find((x: any) => x.clave === 'LIBRETA_MILITAR').estado).toBe('no_aplica')

    expect((await subir(admin.token, c, { categoria: 'NO_EXISTE' })).statusCode).toBe(400)
    expect((await subir(admin.token, c, { categoria: 'EXAMEN_MEDICO', fecha_vencimiento: '01/05/2027' })).statusCode).toBe(400)
    expect((await subir(admin.token, c, { categoria: 'LICENCIA', categoria_licencia: 'Z9' })).statusCode).toBe(400)
    expect((await subir(admin.token, c, { categoria: 'CEDULA' }, { tipo: 'application/zip' })).statusCode).toBe(400)
    expect((await subir(admin.token, c, { categoria: 'CEDULA' }, false)).statusCode).toBe(400)

    // Un examen sin fecha queda «sin fecha» y se completa con PATCH.
    const ex = await subir(admin.token, c, { categoria: 'EXAMEN_MEDICO' })
    let cat = (await get(`/api/conductores/${c}/documentos`, admin.token)).json().data.categorias.find((x: any) => x.clave === 'EXAMEN_MEDICO')
    expect(cat.estado).toBe('sin_fecha')
    await app.inject({
      method: 'PATCH', url: `/api/conductores/${c}/documentos/${ex.json().data.id}`,
      payload: { fecha_vencimiento: sumarDias(HOY, -2) }, headers: { authorization: `Bearer ${admin.token}` },
    })
    cat = (await get(`/api/conductores/${c}/documentos`, admin.token)).json().data.categorias.find((x: any) => x.clave === 'EXAMEN_MEDICO')
    expect(cat).toMatchObject({ estado: 'vencido', dias: -2 })
  })
})

describe('avisos de vencimiento', () => {
  it('avisa por umbral a talento humano, una sola vez, y solo de conductores vinculados', async () => {
    const vinculado = await crearConductor({ vencimiento_licencia: new Date(`${sumarDias(HOY, 12)}T00:00:00Z`) })
    const retirado = await crearConductor({ estado: 'retirado', vencimiento_licencia: new Date(`${sumarDias(HOY, 12)}T00:00:00Z`) })
    /// La PILA (ventana de 7 días) a 12 días todavía no avisa; un examen sí (umbral 15).
    await subir(admin.token, vinculado, { categoria: 'SEGURIDAD_SOCIAL', fecha_vencimiento: sumarDias(HOY, 12) })
    await subir(admin.token, vinculado, { categoria: 'EXAMEN_MEDICO', fecha_vencimiento: sumarDias(HOY, 7) })

    const r1 = await avisarVencimientosDocumentosConductor()
    expect(r1.avisos).toBeGreaterThan(0)
    const mios = await prisma.notificacion.findMany({
      where: { usuario_id: admin.id, referencia_id: { in: [vinculado, retirado] } },
      select: { referencia_id: true, referencia_tipo: true, titulo: true },
    })
    const refs = mios.map((n) => n.referencia_tipo).sort()
    expect(refs).toEqual([`doccond:EXAMEN_MEDICO:${sumarDias(HOY, 7)}:7`, `doccond:LICENCIA:${sumarDias(HOY, 12)}:15`].sort())
    expect(mios.every((n) => n.referencia_id === vinculado)).toBe(true)
    expect(mios.find((n) => n.referencia_tipo!.includes('LICENCIA'))!.titulo).toContain('Licencia de conducción vence en 12 días')

    // El usuario de solo lectura (operaciones) no está entre los destinatarios.
    expect(await prisma.notificacion.count({ where: { usuario_id: soloLectura.id } })).toBe(0)

    // Segunda corrida el mismo día: nada nuevo para estos conductores.
    await avisarVencimientosDocumentosConductor()
    expect(await prisma.notificacion.count({ where: { usuario_id: admin.id, referencia_id: { in: [vinculado, retirado] } } })).toBe(2)
  })
})
