/**
 * Banco de pruebas del canvas de HISTORIAL DE LIQUIDACIONES DE SERVICIOS.
 *
 * Levanta el servidor REAL (Fastify + socket.io + Prisma) en un puerto
 * efímero y conecta N clientes de socket, cada uno con el JWT de un usuario
 * DISTINTO. No hay dobles: lo que se prueba es el contrato entre el canvas y
 * el backend, y un doble del gateway probaría el doble.
 *
 * ── Por qué se firman los JWT en vez de hacer login ──
 *
 * `POST /auth/login` exige la contraseña, y la base de desarrollo es un
 * volcado con usuarios reales cuyas contraseñas no conocemos (ni queremos).
 * El middleware de sockets (`sockets/auth.ts`) y el de HTTP
 * (`middlewares/auth.middleware.ts`) verifican el mismo `JWT_SECRET` con la
 * misma forma de payload (`sub || id`), así que firmar el token es
 * exactamente lo que el login habría producido — sin tocar credenciales.
 *
 * ── Aislamiento de datos ──
 *
 * La base es el entorno de desarrollo del equipo, con datos reales. Todo lo
 * que estos tests crean lleva el prefijo `MARCA_TEST` en el consecutivo y se
 * borra en DURO en el `finally` de cada caso (`limpiarRastro`). Nunca se
 * modifica ni se borra una fila que el test no haya creado.
 */

// El logger arranca en `debug` y vuelca CADA consulta de Prisma. Con el
// histórico completo eso son miles de líneas por caso, y el resultado real de
// la suite queda enterrado. Se baja ANTES de importar nada de la app, porque
// el logger fija su nivel al cargarse el módulo.
process.env.LOG_LEVEL ||= 'warn'

import jwt from 'jsonwebtoken'
import { io as clienteIo, type Socket } from 'socket.io-client'
import type { FastifyInstance } from 'fastify'
import type { AddressInfo } from 'net'

import { buildApp } from '../../src/app'
import { initSockets } from '../../src/sockets'
import { env } from '../../src/config/env'
import { prisma } from '../../src/config/prisma'

/// Prefijo de todo lo que crean los tests. Sirve para el borrado en duro y
/// para reconocer restos si un proceso muere a medias.
export const MARCA_TEST = 'ZZTEST-CANVAS'

export interface UsuarioPrueba {
  id: string
  nombre: string
  correo: string
  areas: string[]
  token: string
}

export interface Banco {
  app: FastifyInstance
  urlBase: string
  /** Conecta un cliente nuevo. El cierre lo gestiona `cerrarBanco`. */
  conectar: (u: UsuarioPrueba) => Promise<Socket>
  /** Petición HTTP autenticada como `u`. */
  pedir: (
    u: UsuarioPrueba,
    metodo: string,
    ruta: string,
    cuerpo?: any,
  ) => Promise<{ status: number; body: any }>
  /**
   * Cierra todos los sockets abiertos y espera a que el servidor procese las
   * bajas.
   *
   * Hay que llamarlo entre casos: el registro de rooms de `sheet.gateway` es
   * estado de MÓDULO y sobrevive al test. Sin esto, los sockets del caso
   * anterior siguen en el room y las aserciones sobre «cuánta gente hay» del
   * siguiente cuentan fantasmas.
   */
  desconectarTodos: () => Promise<void>
  cerrar: () => Promise<void>
}

/** Firma un token con la misma forma que emite `/auth/login`. */
export function firmarToken(u: {
  id: string
  nombre: string
  correo: string
  areas: string[]
}): string {
  return jwt.sign(
    {
      sub: u.id,
      id: u.id,
      nombre: u.nombre,
      name: u.nombre,
      correo: u.correo,
      area: u.areas,
      role: 'admin',
    },
    env.JWT_SECRET,
    { expiresIn: '2h' },
  )
}

/**
 * Busca en la base un usuario REAL que tenga exactamente las áreas pedidas.
 *
 * Se usan usuarios existentes en vez de crearlos porque `usuarios` tiene
 * relaciones vivas (auditorías, historiales) y sembrar uno nuevo para cada
 * ejecución dejaría basura acumulada en la base del equipo.
 *
 * Devuelve `null` si no hay ninguno: el caso se salta con un aviso en vez de
 * fallar, para que la suite siga siendo ejecutable en una base recién
 * migrada y vacía.
 */
export async function usuarioConAreas(areas: string[]): Promise<UsuarioPrueba | null> {
  const candidatos = await prisma.usuarios.findMany({
    select: { id: true, nombre: true, correo: true, area: true },
  })
  const halla = candidatos.find((u) => {
    const suyas = Array.isArray(u.area) ? (u.area as string[]) : []
    return areas.every((a) => suyas.includes(a))
  })
  if (!halla) return null
  const suyas = Array.isArray(halla.area) ? (halla.area as string[]) : []
  return {
    id: halla.id,
    nombre: halla.nombre,
    correo: halla.correo,
    areas: suyas,
    token: firmarToken({
      id: halla.id,
      nombre: halla.nombre,
      correo: halla.correo,
      areas: suyas,
    }),
  }
}

export async function abrirBanco(): Promise<Banco> {
  const app = buildApp()
  await app.ready()
  // Puerto 0 = el sistema elige uno libre. Fijar uno haría que dos suites en
  // paralelo (o un `npm run dev` abierto) chocaran con EADDRINUSE.
  await app.listen({ port: 0, host: '127.0.0.1' })
  initSockets(app.server as any)

  const dir = app.server.address() as AddressInfo
  const urlBase = `http://127.0.0.1:${dir.port}`
  const sockets: Socket[] = []

  const conectar = (u: UsuarioPrueba): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = clienteIo(urlBase, {
        auth: { token: u.token },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      })
      sockets.push(s)
      const fallo = setTimeout(
        () => reject(new Error(`timeout conectando el socket de ${u.correo}`)),
        8000,
      )
      s.on('connect', () => {
        clearTimeout(fallo)
        resolve(s)
      })
      s.on('connect_error', (e) => {
        clearTimeout(fallo)
        reject(e)
      })
    })

  const pedir = async (u: UsuarioPrueba, metodo: string, ruta: string, cuerpo?: any) => {
    const res = await app.inject({
      method: metodo as any,
      url: ruta,
      headers: { authorization: `Bearer ${u.token}` },
      ...(cuerpo === undefined ? {} : { payload: cuerpo }),
    })
    let body: any = null
    try {
      body = res.json()
    } catch {
      body = res.body
    }
    return { status: res.statusCode, body }
  }

  const desconectarTodos = async () => {
    const abiertos = sockets.splice(0, sockets.length)
    for (const s of abiertos) {
      try {
        s.removeAllListeners()
        s.disconnect()
      } catch {
        /* noop */
      }
    }
    if (abiertos.length === 0) return
    // El servidor procesa el `disconnect` en su propio turno del bucle de
    // eventos. Sin esta pausa, el caso siguiente hace `join` antes de que el
    // room se haya vaciado y ve a los del caso anterior.
    await new Promise((r) => setTimeout(r, 250))
  }

  const cerrar = async () => {
    await desconectarTodos()
    try {
      await app.close()
    } catch {
      /* noop */
    }
  }

  return { app, urlBase, conectar, pedir, desconectarTodos, cerrar }
}

/**
 * Espera un evento que cumpla `predicado`.
 *
 * El timeout es OBLIGATORIO y por defecto corto: un test de sockets que se
 * queda esperando para siempre no falla, se cuelga — y en CI eso se lee como
 * «la suite se rompió», no como «el evento no llegó».
 */
export function esperarEvento<T = any>(
  socket: Socket,
  evento: string,
  predicado: (data: T) => boolean = () => true,
  ms = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const alExpirar = setTimeout(() => {
      socket.off(evento, manejador)
      reject(new Error(`timeout esperando "${evento}"`))
    }, ms)

    function manejador(data: T) {
      if (!predicado(data)) return
      clearTimeout(alExpirar)
      socket.off(evento, manejador)
      resolve(data)
    }
    socket.on(evento, manejador)
  })
}

/** Recolecta TODOS los eventos de un tipo durante `ms`. */
export function recolectar<T = any>(socket: Socket, evento: string, ms: number): Promise<T[]> {
  const vistos: T[] = []
  const manejador = (d: T) => vistos.push(d)
  socket.on(evento, manejador)
  return new Promise((resolve) =>
    setTimeout(() => {
      socket.off(evento, manejador)
      resolve(vistos)
    }, ms),
  )
}

/** Espera activa con sondeo. Sin `sleep` a ciegas. */
export async function esperarHasta(
  cond: () => boolean | Promise<boolean>,
  ms = 5000,
  paso = 25,
): Promise<void> {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, paso))
  }
  throw new Error('esperarHasta: no se cumplió la condición a tiempo')
}

/**
 * Crea una liquidación de servicios mínima pero VÁLIDA, con `nItems` ítems.
 *
 * Se crea por el SERVICE y no con un `prisma.create` a pelo para que pase por
 * el mismo cálculo de totales e IVA que la aplicación: una fila insertada a
 * mano tendría totales que no cuadran con sus ítems y el test del pie del
 * canvas pasaría con datos que la app nunca produciría.
 */
export async function crearLiquidacionDePrueba(opts: {
  clienteId: string
  usuarioId: string
  nItems: number
  sufijo: string
}) {
  const { LiquidacionesServiciosService } = await import(
    '../../src/modules/liquidaciones-servicios/liquidaciones-servicios.service'
  )
  const items = Array.from({ length: opts.nItems }, (_, i) => ({
    placa: `TST${String(i + 1).padStart(3, '0')}`,
    fecha_inicial: '2026-01-05',
    fecha_final: '2026-01-05',
    recorrido: `RUTA DE PRUEBA ${i + 1}`,
    tipo_servicio: 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA' as any,
    cantidad: 1,
    valor_unitario: 100000 + i * 1000,
    porcentaje_descuento: 0,
  }))

  return LiquidacionesServiciosService.crear(
    {
      cliente_id: opts.clienteId,
      consecutivo: `${MARCA_TEST}-${opts.sufijo}`,
      mes: 1,
      anio: 2026,
      items,
      porcentaje_iva: 19,
      observaciones: 'Fila creada por la suite del canvas. Se borra al terminar.',
    } as any,
    opts.usuarioId,
  )
}

/**
 * Borrado EN DURO de todo lo que dejó la suite.
 *
 * En duro y no soft-delete a propósito: un soft-delete dejaría las filas de
 * prueba en la base para siempre, y `listar` las oculta pero los agregados
 * globales de otras pantallas no siempre filtran por `deleted_at`.
 *
 * El orden respeta las claves ajenas: primero lo que apunta a la
 * liquidación, después la liquidación. `liquidacion_servicio_item` cae por
 * cascada, pero se borra explícito para no depender de ello.
 */
export async function limpiarRastro(): Promise<void> {
  const liqs = await prisma.liquidacion_servicio.findMany({
    where: { consecutivo: { startsWith: MARCA_TEST } },
    select: { id: true },
  })
  const ids = liqs.map((l) => l.id)

  const facturas = await prisma.factura_liquidacion_servicio.findMany({
    where: { numero_factura: { startsWith: MARCA_TEST } },
    select: { id: true },
  })
  const facturaIds = facturas.map((f) => f.id)

  // El `OR` se arma solo con las ramas que tienen ids. Una rama con una
  // cadena vacía como marcador («{ liquidacion_id: '' }») revienta en
  // Postgres: la columna es `uuid` y '' no es un UUID válido.
  const ramas: any[] = []
  if (ids.length > 0) ramas.push({ liquidacion_id: { in: ids } })
  if (facturaIds.length > 0) ramas.push({ factura_id: { in: facturaIds } })
  if (ramas.length > 0) {
    await prisma.factura_liquidacion_item.deleteMany({ where: { OR: ramas } })
  }
  if (facturaIds.length > 0) {
    await prisma.factura_liquidacion_servicio.deleteMany({ where: { id: { in: facturaIds } } })
  }
  if (ids.length > 0) {
    await prisma.historial_estado_liquidacion.deleteMany({
      where: { liquidacion_id: { in: ids } },
    })
    await prisma.liquidacion_tercero.deleteMany({ where: { liquidacion_id: { in: ids } } })
    await prisma.liquidacion_servicio_item.deleteMany({
      where: { liquidacion_id: { in: ids } },
    })
    await prisma.liquidacion_servicio.deleteMany({ where: { id: { in: ids } } })
  }
}

/** Un cliente cualquiera que exista, para poder crear liquidaciones. */
export async function algunCliente(): Promise<{ id: string; nombre: string } | null> {
  return prisma.clientes.findFirst({ select: { id: true, nombre: true } })
}
