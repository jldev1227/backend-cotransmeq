/**
 * Primas: `PrimasService` y su controlador contra la base desechable.
 *
 * El backend NO calcula la prima. Días trabajados, base de liquidación
 * (básico + auxilio + variable) y el valor de la prima llegan ya calculados
 * desde el formulario y el canvas de primas, y se guardan tal cual. Lo que el
 * servicio sí decide —y es lo que se prueba— es cómo se normaliza lo que
 * llega (números, nulos, estado), qué cuenta la lista (filtros, estadísticas,
 * «firmado»), el borrado lógico y de dónde sale la firma que se imprime.
 *
 * Los tres bugs de borrado lógico que encontró esta suite (consulta, edición
 * y doble eliminación de una prima retirada) se arreglaron el 11-oct-2026 y
 * quedan como regresiones normales.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

/// La firma se incrusta en el PDF como base64 descargado de S3. En la suite no
/// hay S3: se devuelve la propia clave para poder ver CUÁL firma se eligió.
vi.mock('../src/config/aws', () => ({
  getS3ObjectAsBase64: vi.fn(async (clave: string) => `data:image/png;base64,${clave}`),
}))

import { PrimasService } from '../src/modules/primas/primas.service'
import { PrimasController } from '../src/modules/primas/primas.controller'

const prisma = new PrismaClient()

/** Marca para poder limpiar solo lo que crea esta suite. */
const MARCA = 'ZZTEST-PRIMA'

let usuarioId: string
/// Conductor de los casos de creación y edición.
let conductorId: string
/// Conductor exclusivo de la lista: sus estadísticas se comprueban EXACTAS.
let conductorListaId: string
/// Conductor de la firma enriquecida, con sus desprendibles firmados.
let conductorFirmaId: string

const ahora = () => new Date()

async function limpiar() {
  const conductores = await prisma.conductores.findMany({
    where: { numero_identificacion: { startsWith: MARCA } },
    select: { id: true },
  })
  const cIds = conductores.map((c) => c.id)
  if (cIds.length) {
    await prisma.firmas_primas.deleteMany({ where: { conductor_id: { in: cIds } } })
    await prisma.primas.deleteMany({ where: { conductor_id: { in: cIds } } })
    await prisma.firmas_desprendibles.deleteMany({ where: { conductor_id: { in: cIds } } })
    await prisma.liquidaciones.deleteMany({ where: { conductor_id: { in: cIds } } })
    await prisma.conductores.deleteMany({ where: { id: { in: cIds } } })
  }
  await prisma.usuarios.deleteMany({ where: { correo: { startsWith: 'zztest-prima' } } })
}

async function crearConductor(sufijo: string, nombre: string, apellido: string) {
  const id = randomUUID()
  await prisma.conductores.create({
    data: {
      id, nombre, apellido, tipo_identificacion: 'CC',
      numero_identificacion: `${MARCA}-${sufijo}`, fecha_ingreso: ahora(),
      cargo: 'CONDUCTOR', created_at: ahora(), updated_at: ahora(),
    } as any,
  })
  return id
}

/** Una prima sembrada directamente, para los casos de lectura. */
async function sembrarPrima(o: {
  conductor: string
  mes: number
  anio: number
  prima: number
  estado?: 'Pendiente' | 'Pagado'
  eliminada?: boolean
}) {
  const id = randomUUID()
  await prisma.primas.create({
    data: {
      id, conductor_id: o.conductor, mes: o.mes, anio: o.anio, prima: o.prima,
      estado: o.estado ?? 'Pendiente', deleted_at: o.eliminada ? ahora() : null,
      created_at: ahora(), updated_at: ahora(),
    } as any,
  })
  return id
}

async function firmarPrima(primaId: string, conductor: string, url: string, clave = `${MARCA}/prima-${primaId}.png`) {
  await prisma.firmas_primas.create({
    data: {
      id: randomUUID(), prima_id: primaId, conductor_id: conductor, firma_url: url, firma_s3_key: clave,
      fecha_firma: ahora(), created_at: ahora(), updated_at: ahora(),
    } as any,
  })
}

/** Reply de Fastify reducido a lo que usa el controlador. */
function respuesta() {
  const r: any = { statusCode: 200, cuerpo: undefined }
  r.status = (c: number) => {
    r.statusCode = c
    return r
  }
  r.code = r.status
  r.send = (b: unknown) => {
    r.cuerpo = b
    return r
  }
  return r
}

function peticion(o: { body?: any; params?: any; query?: any } = {}): any {
  return {
    body: o.body ?? {},
    params: o.params ?? {},
    query: o.query ?? {},
    user: { id: usuarioId },
    log: { error: () => {}, warn: () => {}, info: () => {} },
  }
}

beforeAll(async () => {
  await limpiar()
  usuarioId = randomUUID()
  await prisma.usuarios.create({
    data: {
      id: usuarioId, nombre: 'Tester Primas', correo: `zztest-prima-${usuarioId.slice(0, 8)}@example.test`,
      password: 'no-se-usa-en-tests', role: 'admin', created_at: ahora(), updated_at: ahora(),
    } as any,
  })
  conductorId = await crearConductor('1', 'Marta', 'Prima')
  conductorListaId = await crearConductor('2', 'Pedro', 'Lista')
  conductorFirmaId = await crearConductor('3', 'Rosa', 'Firma')
}, 60_000)

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Crear: se guarda lo que calculó el formulario, normalizado', () => {
  it('guarda la prima con su base y la devuelve en números', async () => {
    /// El formulario manda mes y año como texto cuando vienen de un <select>:
    /// en la tabla son enteros, y un «6» textual rompería el filtro por mes.
    const p: any = await PrimasService.crear(
      {
        conductor_id: conductorId,
        mes: '6',
        anio: '2026',
        prima: 811_750,
        prima_pendiente: '150000.5',
        tiempo_trabajado_dias: 180,
        sueldo_basico: 1_423_500,
        auxilio_transporte: 200_000,
        sueldo_variable: 0,
        total_base_liquidacion: 1_623_500,
        observaciones: 'Primer semestre',
      },
      usuarioId,
    )
    expect(p).toMatchObject({
      mes: 6,
      anio: 2026,
      prima: 811_750,
      prima_pendiente: 150_000.5,
      tiempo_trabajado_dias: 180,
      sueldo_basico: 1_423_500,
      auxilio_transporte: 200_000,
      /// Un variable en 0 es un dato («no tuvo variable»), no un vacío.
      sueldo_variable: 0,
      total_base_liquidacion: 1_623_500,
      observaciones: 'Primer semestre',
      estado: 'Pendiente',
    })
    expect(p.conductor).toMatchObject({ id: conductorId, nombre: 'Marta', apellido: 'Prima', cedula: `${MARCA}-1` })
    expect(p.creado_por?.id).toBe(usuarioId)
    expect(p.deleted_at).toBeNull()
  })

  it('lo opcional que no llega queda null, no en cero; la prima sin valor es 0', async () => {
    /// null = «sin dato». Guardar 0 haría que el desprendible de la prima
    /// imprimiera una base de liquidación de $0 en vez de omitirla.
    const p: any = await PrimasService.crear({ conductor_id: conductorId, mes: 12, anio: 2026 }, usuarioId)
    expect(p.prima).toBe(0)
    for (const campo of [
      'prima_pendiente', 'tiempo_trabajado_dias', 'sueldo_basico', 'auxilio_transporte',
      'sueldo_variable', 'total_base_liquidacion', 'observaciones',
    ]) {
      expect(p[campo], campo).toBeNull()
    }
  })

  it('solo «Pagado» se respeta como estado inicial; cualquier otro nace Pendiente', async () => {
    const pagada: any = await PrimasService.crear({ conductor_id: conductorId, mes: 6, anio: 2025, estado: 'Pagado' }, usuarioId)
    expect(pagada.estado).toBe('Pagado')
    /// El enum solo tiene dos valores: lo demás reventaría el insert.
    const otra: any = await PrimasService.crear({ conductor_id: conductorId, mes: 6, anio: 2025, estado: 'PAGADA' }, usuarioId)
    expect(otra.estado).toBe('Pendiente')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Lista y búsqueda: filtros, estadísticas y «firmado»', () => {
  let junio26: string
  let diciembre26: string
  let diciembre25: string
  let eliminada: string

  beforeAll(async () => {
    junio26 = await sembrarPrima({ conductor: conductorListaId, mes: 6, anio: 2026, prima: 500_000 })
    diciembre26 = await sembrarPrima({ conductor: conductorListaId, mes: 12, anio: 2026, prima: 700_000, estado: 'Pagado' })
    diciembre25 = await sembrarPrima({ conductor: conductorListaId, mes: 12, anio: 2025, prima: 300_000 })
    eliminada = await sembrarPrima({ conductor: conductorListaId, mes: 6, anio: 2026, prima: 999_000, estado: 'Pagado', eliminada: true })

    /// Solo una firma con imagen real cuenta. «pending» es el marcador de un
    /// enlace de firma enviado y no usado; '' es una firma que falló al subir.
    await firmarPrima(junio26, conductorListaId, 'https://ejemplo/firma.png')
    await firmarPrima(diciembre26, conductorListaId, 'pending')
    await firmarPrima(diciembre25, conductorListaId, '')
    await firmarPrima(eliminada, conductorListaId, 'https://ejemplo/firma-vieja.png')
  })

  it('las estadísticas cuentan solo las vivas', async () => {
    /// Comparten el `where` con la lista: una prima retirada sumada al monto
    /// total es dinero que no se va a pagar.
    const r = await PrimasService.obtenerTodas({ conductor_id: conductorListaId })
    expect(r.primas.map((p: any) => p.id).sort()).toEqual([junio26, diciembre26, diciembre25].sort())
    expect(r.stats).toEqual({ total: 3, totalPendientes: 2, totalPagados: 1, montoTotal: 1_500_000 })
  })

  it('«firmado» solo con una firma real; «pending» y vacía no cuentan', async () => {
    const r = await PrimasService.obtenerTodas({ conductor_id: conductorListaId })
    const porId = Object.fromEntries(r.primas.map((p: any) => [p.id, p]))
    expect(porId[junio26]).toMatchObject({ firmado: true, firmas_primas_count: 1 })
    expect(porId[diciembre26]).toMatchObject({ firmado: false, firmas_primas_count: 0 })
    expect(porId[diciembre25]).toMatchObject({ firmado: false, firmas_primas_count: 0 })
    /// El conteo interno no se filtra al cliente.
    expect(porId[junio26]._count).toBeUndefined()
  })

  it('filtra por mes, año y estado, y busca por cédula', async () => {
    const ids = async (f: Record<string, unknown>) =>
      (await PrimasService.obtenerTodas({ conductor_id: conductorListaId, ...f })).primas.map((p: any) => p.id)
    expect(await ids({ mes: 12 })).toHaveLength(2)
    expect(await ids({ mes: 6, anio: 2026 })).toEqual([junio26])
    expect(await ids({ estado: 'Pagado' })).toEqual([diciembre26])

    const porCedula = await PrimasService.obtenerTodas({ search: `${MARCA}-2` })
    expect(porCedula.primas.map((p: any) => p.id).sort()).toEqual([junio26, diciembre26, diciembre25].sort())
  })

  it('ordena por valor y pagina', async () => {
    const r = await PrimasService.obtenerTodas({ conductor_id: conductorListaId, sortBy: 'prima', sortOrder: 'asc', limit: 2, page: 1 })
    expect(r.primas.map((p: any) => p.prima)).toEqual([300_000, 500_000])
    expect(r.pagination).toMatchObject({ total: 3, page: 1, limit: 2, totalPages: 2, hasNext: true, hasPrev: false })
    const p2 = await PrimasService.obtenerTodas({ conductor_id: conductorListaId, sortBy: 'prima', sortOrder: 'asc', limit: 2, page: 2 })
    expect(p2.primas.map((p: any) => p.prima)).toEqual([700_000])
  })

  it('la búsqueda por conductor y periodo ordena del más reciente al más antiguo', async () => {
    const todas = await PrimasService.buscarPorConductorPeriodo(conductorListaId)
    expect(todas.map((p: any) => `${p.anio}-${p.mes}`)).toEqual(['2026-12', '2026-6', '2025-12'])
    const diciembres = await PrimasService.buscarPorConductorPeriodo(conductorListaId, 12)
    expect(diciembres.map((p: any) => p.id)).toEqual([diciembre26, diciembre25])
    /// La retirada de junio-2026 no aparece aunque coincida en periodo.
    const junio = await PrimasService.buscarPorConductorPeriodo(conductorListaId, 6, 2026)
    expect(junio.map((p: any) => p.id)).toEqual([junio26])
    expect(typeof junio[0].prima).toBe('number')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Actualizar: solo cambia lo que llega', () => {
  it('un guardado parcial no toca lo demás; null limpia un opcional; los textos se convierten', async () => {
    const p: any = await PrimasService.crear(
      {
        conductor_id: conductorId, mes: 6, anio: 2024, prima: 400_000, prima_pendiente: 50_000,
        tiempo_trabajado_dias: 90, sueldo_basico: 1_300_000, observaciones: 'original',
      },
      usuarioId,
    )
    const editada: any = await PrimasService.actualizar(
      p.id,
      { prima: '420000', tiempo_trabajado_dias: '95', prima_pendiente: null },
      usuarioId,
    )
    expect(editada.prima).toBe(420_000)
    expect(editada.tiempo_trabajado_dias).toBe(95)
    expect(editada.prima_pendiente).toBeNull()
    /// Lo que no llegó sigue igual.
    expect(editada.sueldo_basico).toBe(1_300_000)
    expect(editada.observaciones).toBe('original')
    expect(editada).toMatchObject({ mes: 6, anio: 2024, estado: 'Pendiente' })
    expect(editada.actualizado_por?.id).toBe(usuarioId)
  })

  it('el estado pasa a Pagado y puede volver a Pendiente', async () => {
    const p: any = await PrimasService.crear({ conductor_id: conductorId, mes: 12, anio: 2024 }, usuarioId)
    expect((await PrimasService.actualizar(p.id, { estado: 'Pagado' }, usuarioId)).estado).toBe('Pagado')
    /// Editar otra cosa no la «despaga».
    expect((await PrimasService.actualizar(p.id, { observaciones: 'x' }, usuarioId)).estado).toBe('Pagado')
    expect((await PrimasService.actualizar(p.id, { estado: 'Pendiente' }, usuarioId)).estado).toBe('Pendiente')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Eliminar: se marca y deja de leerse', () => {
  let primaId: string

  beforeAll(async () => {
    const p: any = await PrimasService.crear({ conductor_id: conductorId, mes: 6, anio: 2023, prima: 610_000 }, usuarioId)
    primaId = p.id
    await firmarPrima(primaId, conductorId, 'https://ejemplo/firma-2023.png')
  })

  it('eliminar marca deleted_at y conserva la firma del conductor', async () => {
    const r = await PrimasService.eliminar(primaId)
    expect(r.success).toBe(true)
    const fila = await prisma.primas.findUnique({ where: { id: primaId } })
    expect(fila!.deleted_at).toBeInstanceOf(Date)
    /// La firma es la evidencia de que recibió el pago: no se toca.
    expect(await prisma.firmas_primas.count({ where: { prima_id: primaId } })).toBe(1)
  })

  it('la lista, sus estadísticas y la búsqueda por periodo ya no la devuelven', async () => {
    const r = await PrimasService.obtenerTodas({ conductor_id: conductorId, anio: 2023 })
    expect(r.primas).toHaveLength(0)
    expect(r.stats.montoTotal).toBe(0)
    expect(await PrimasService.buscarPorConductorPeriodo(conductorId, 6, 2023)).toHaveLength(0)
  })

  it('la firma enriquecida de una prima retirada es «no encontrada»', async () => {
    await expect(PrimasService.obtenerFirmaEnriquecida(primaId)).rejects.toThrow('Prima no encontrada')
  })

  /// Regresión (arreglado el 11-oct-2026): `obtenerPorId` buscaba con
  /// `findUnique` sin `deleted_at` y `GET /primas/:id` seguía devolviendo la
  /// prima retirada como si estuviera viva.
  it('la consulta directa la trata como inexistente', async () => {
    await expect(PrimasService.obtenerPorId(primaId)).rejects.toThrow('Prima no encontrada')
  })

  /// Regresión: `actualizar` tampoco filtraba y se podía editar —y marcar
  /// Pagada— una prima retirada sin que nadie lo viera en la lista.
  it('no se puede editar una prima retirada', async () => {
    await expect(PrimasService.actualizar(primaId, { estado: 'Pagado' }, usuarioId)).rejects.toThrow('Prima no encontrada')
  })

  /// Regresión: eliminar dos veces respondía «eliminada correctamente» y
  /// volvía a sellar `deleted_at`, borrando la fecha real del retiro.
  it('eliminarla otra vez da error y conserva la fecha del primer retiro', async () => {
    const antes = (await prisma.primas.findUnique({ where: { id: primaId } }))!.deleted_at
    await expect(PrimasService.eliminar(primaId)).rejects.toThrow('Prima no encontrada')
    const despues = (await prisma.primas.findUnique({ where: { id: primaId } }))!.deleted_at
    expect(despues!.getTime()).toBe(antes!.getTime())
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Firma enriquecida: la propia primero, si no la del desprendible del mismo periodo', () => {
  let liqJulio: string
  let liqSeptiembre: string

  beforeAll(async () => {
    const liquidacion = async (fin: string) => {
      const id = randomUUID()
      await prisma.liquidaciones.create({
        data: {
          id, conductor_id: conductorFirmaId, periodo_start: `${fin.slice(0, 8)}01`, periodo_end: fin,
          created_at: ahora(), updated_at: ahora(),
        } as any,
      })
      return id
    }
    liqJulio = await liquidacion('2026-07-31')
    liqSeptiembre = await liquidacion('2026-09-30')
    const firmaDesprendible = async (liq: string, fecha: string) =>
      prisma.firmas_desprendibles.create({
        data: {
          id: randomUUID(), liquidacion_id: liq, conductor_id: conductorFirmaId,
          firma_url: 'https://ejemplo/desprendible.png', firma_s3_key: `${MARCA}/desprendible-${liq}.png`,
          fecha_firma: new Date(fecha), created_at: ahora(), updated_at: ahora(),
        } as any,
      })
    /// La de septiembre es la MÁS RECIENTE, pero cae fuera de la ventana de
    /// una prima de junio (±1 mes): no puede ganar por ser la última.
    await firmaDesprendible(liqSeptiembre, '2026-10-05T12:00:00Z')
    await firmaDesprendible(liqJulio, '2026-08-05T12:00:00Z')
  })

  it('si la prima tiene firma propia, esa es la que se imprime', async () => {
    const id = await sembrarPrima({ conductor: conductorFirmaId, mes: 6, anio: 2026, prima: 500_000 })
    await firmarPrima(id, conductorFirmaId, 'https://ejemplo/propia.png', `${MARCA}/propia.png`)
    const f: any = await PrimasService.obtenerFirmaEnriquecida(id)
    expect(f).toMatchObject({ origen: 'prima', liquidacion_id: null, presignedUrl: `data:image/png;base64,${MARCA}/propia.png` })
  })

  it('sin firma propia usa la del desprendible del mes vecino, no la más reciente', async () => {
    /// Junio admite mayo, junio y julio: la de julio, aunque haya otra más
    /// nueva de septiembre. Una firma «pending» propia no cuenta como firma.
    const id = await sembrarPrima({ conductor: conductorFirmaId, mes: 6, anio: 2026, prima: 500_000 })
    await firmarPrima(id, conductorFirmaId, 'pending')
    const f: any = await PrimasService.obtenerFirmaEnriquecida(id)
    expect(f).toMatchObject({ origen: 'nomina', liquidacion_id: liqJulio })
    expect(f.presignedUrl).toContain(`desprendible-${liqJulio}`)
  })

  it('sin ninguna firma en la ventana devuelve null, no la de otro periodo', async () => {
    const id = await sembrarPrima({ conductor: conductorFirmaId, mes: 12, anio: 2026, prima: 500_000 })
    expect(await PrimasService.obtenerFirmaEnriquecida(id)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Controlador: validación de entrada y códigos HTTP', () => {
  it('crear exige conductor, mes y año (400) y no escribe nada', async () => {
    const antes = await prisma.primas.count({ where: { conductor_id: conductorId } })
    const r1 = respuesta()
    await PrimasController.crear(peticion({ body: { mes: 6, anio: 2026 } }), r1)
    expect(r1.statusCode).toBe(400)
    expect(r1.cuerpo.message).toBe('El conductor es requerido')
    const r2 = respuesta()
    await PrimasController.crear(peticion({ body: { conductor_id: conductorId, mes: 6 } }), r2)
    expect(r2.statusCode).toBe(400)
    expect(r2.cuerpo.message).toBe('El mes y el año son requeridos')
    expect(await prisma.primas.count({ where: { conductor_id: conductorId } })).toBe(antes)
  })

  it('crear responde 201 y el autor sale del token, no del cuerpo', async () => {
    const r = respuesta()
    await PrimasController.crear(
      peticion({ body: { conductor_id: conductorId, mes: 6, anio: 2022, prima: 100_000, creado_por_id: randomUUID() } }),
      r,
    )
    expect(r.statusCode).toBe(201)
    expect(r.cuerpo.data.creado_por.id).toBe(usuarioId)
  })

  it('leer, editar o eliminar una prima que no existe es 404', async () => {
    const id = randomUUID()
    const r1 = respuesta()
    await PrimasController.obtenerPorId(peticion({ params: { id } }), r1)
    expect(r1.statusCode).toBe(404)
    const r2 = respuesta()
    await PrimasController.actualizar(peticion({ params: { id }, body: { prima: 1 } }), r2)
    expect(r2.statusCode).toBe(404)
    const r3 = respuesta()
    await PrimasController.eliminar(peticion({ params: { id } }), r3)
    expect(r3.statusCode).toBe(404)
    const r4 = respuesta()
    await PrimasController.obtenerFirmaEnriquecida(peticion({ params: { id } }), r4)
    expect(r4.statusCode).toBe(404)
  })

  it('la búsqueda por periodo exige conductor y convierte mes y año', async () => {
    const r1 = respuesta()
    await PrimasController.buscarPorConductorPeriodo(peticion({ query: { mes: '6' } }), r1)
    expect(r1.statusCode).toBe(400)
    const r2 = respuesta()
    await PrimasController.buscarPorConductorPeriodo(
      peticion({ query: { conductor_id: conductorListaId, mes: '12', anio: '2026' } }),
      r2,
    )
    expect(r2.statusCode).toBe(200)
    expect(r2.cuerpo.data.map((p: any) => `${p.anio}-${p.mes}`)).toEqual(['2026-12'])
  })

  it('la lista convierte la query y devuelve primas, stats y paginación', async () => {
    const r = respuesta()
    await PrimasController.obtenerTodas(
      peticion({ query: { conductor_id: conductorListaId, mes: '12', page: '1', limit: '10' } }),
      r,
    )
    expect(r.statusCode).toBe(200)
    expect(r.cuerpo.data.primas).toHaveLength(2)
    expect(r.cuerpo.data.stats).toMatchObject({ total: 2, montoTotal: 1_000_000 })
    expect(r.cuerpo.data.pagination).toMatchObject({ page: 1, limit: 10, total: 2 })
  })
})
