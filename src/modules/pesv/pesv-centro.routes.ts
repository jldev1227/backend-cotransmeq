/**
 * API del centro de cumplimiento PESV.
 *
 * Tres niveles, y ninguno es cosmético:
 *
 *   `read`    consultar. Todo el que tiene el módulo.
 *   `limited` aportar evidencia y registrar operación. Las áreas responsables.
 *   `full`    gestionar el ciclo, metas, configuración y política de jornada.
 *
 * La **revisión de evidencia** no es un nivel: es una regla de negocio que vive
 * en `puedeRevisar()` y exige área HSEQ o Administración, además de no ser el
 * autor. Ponerla como un nivel más habría hecho que `full` implicara poder
 * aprobar lo propio, que es justo lo que no puede pasar.
 *
 * El permiso se aplica SIEMPRE en el servidor. El guard del frontend decide qué
 * se pinta; quien llame a la API directamente pasa por aquí.
 *
 * Orden de declaración: las rutas literales van ANTES que las paramétricas, o
 * Fastify resolvería `/pesv/centro/ciclos/actual` como el ciclo con id
 * "actual".
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { ETIQUETAS_FASE, PASOS_PESV } from './dominio/catalogo'
import { esPesvError, PesvError } from './dominio/errores'
import { construirPeriodo, hoyEnBogota } from './dominio/periodos'
import { CODIGOS_INDICADOR, FICHAS, calcularIndicadores, type CodigoIndicador } from './indicadores'
import { listarAuditoria } from './pesv-auditoria'
import {
  actualizarCiclo,
  actualizarRequisito,
  cerrarCiclo,
  crearCiclo,
  detalleRequisito,
  expedienteDeCiclo,
  listarCiclos,
  obtenerCicloDelAnio,
  obtenerCicloPorId,
  obtenerMatriz,
  puedeRevisar,
  resumirMatriz,
  type ActorPesv,
  type EstadoRequisito,
  type FiltrosMatriz,
} from './pesv-ciclos.service'
import {
  actualizarContrato,
  anularFuec,
  crearContrato,
  crearFuec,
  evaluarCobertura,
  listarContratos,
  listarFuec,
  resumirCobertura,
  vincularServicio,
} from './pesv-contratos.service'
import {
  actualizarTipoDocumento,
  listarDocumentos,
  listarTiposDocumento,
  normalizarDocumento,
  resumirDocumentos,
  revisarDocumento,
} from './pesv-documentos.service'
import {
  bandejaEvidencias,
  crearEvidencia,
  firmarSubidaEvidencia,
  retirarEvidencia,
  revisarEvidencia,
  urlDeDescarga,
} from './pesv-evidencias.service'
import { importarExtractosTxt, listarConciliacion, marcarConciliado } from './pesv-fuec-import.service'
import {
  actualizarMeta,
  actualizarRiesgo,
  actualizarSiniestro,
  alertasMantenimiento,
  cerrarPoliticaJornada,
  coberturaInspecciones,
  crearEventoMantenimiento,
  crearFormacion,
  crearMeta,
  crearPlanMantenimiento,
  crearPoliticaJornada,
  crearPrograma,
  crearRiesgo,
  crearSiniestro,
  cubrirVehiculos,
  ejecutarMantenimiento,
  listarEventosVelocidad,
  listarFormaciones,
  listarMetas,
  listarPoliticasJornada,
  listarProgramas,
  listarRiesgos,
  listarSiniestros,
  opcionesVehiculos,
  registrarEventoVelocidad,
  retirarEventoVelocidad,
  retirarSiniestro,
  serieHistoricaVelocidad,
  vincularAsistencia,
} from './pesv-operacion.service'
import { construirResumen } from './pesv-resumen.service'

const MODULO = 'pesv'

/**
 * Actor a partir del token.
 *
 * La identidad sale SIEMPRE del token, nunca del payload. Aceptar un `usuarioId`
 * del cuerpo permitiría aprobar evidencia en nombre de otro, que es
 * exactamente lo que la prohibición de autoaprobación intenta impedir.
 */
function actorDe(request: FastifyRequest): ActorPesv {
  const user = (request as any).user
  if (!user?.id) throw new PesvError('PROHIBIDO', 'No autenticado.')
  const areas: string[] = !user.area ? [] : Array.isArray(user.area) ? user.area : [user.area]
  return {
    id: user.id,
    nombre: user.nombre ?? user.correo ?? null,
    areas,
    role: user.role ?? null,
    nivel: ((request as any).accessLevel ?? 'read') as ActorPesv['nivel'],
  }
}

/** Traduce el error de dominio a HTTP en un solo sitio. */
async function responder<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    const data = await fn()
    return reply.send({ success: true, data })
  } catch (error) {
    if (esPesvError(error)) {
      return reply.status(error.status).send(error.toBody())
    }
    request_log(error)
    return reply.status(500).send({
      success: false,
      error: { code: 'ERROR_INTERNO', message: 'No se pudo completar la operación.' },
    })
  }
}

function request_log(error: unknown) {
  console.error('[pesv] error no controlado', error)
}

const entero = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isInteger(n) ? n : undefined
}

/**
 * Ciclo del año pedido, o error explícito.
 *
 * No lo crea al vuelo: sembrar un ciclo es un acto con autoría y fecha, y
 * hacerlo como efecto de abrir una pantalla dejaría ciclos creados por quien
 * pasó por ahí.
 */
async function cicloDelAnioOFallo(anio: number) {
  const ciclo = await obtenerCicloDelAnio(anio)
  if (!ciclo) {
    throw new PesvError(
      'CICLO_NO_ENCONTRADO',
      `No hay un ciclo PESV abierto para ${anio}. Créelo desde el encabezado del módulo.`,
      { anio },
    )
  }
  return ciclo
}

/**
 * Exige que el nivel resuelto NO sea de solo lectura.
 *
 * No se puede expresar con `requirePermission`: su jerarquía es
 * `limited < read < full`, así que pedir `'read'` dejaría FUERA a Operaciones,
 * Mantenimiento y Talento Humano —que son justamente quienes aportan— y pedir
 * `'limited'` dejaría DENTRO a Contabilidad y Facturación, que solo consultan.
 *
 * Aportar no es «más» ni «menos» que leer: es otra cosa. Por eso va como un
 * guarda aparte, después del de módulo, y no como un nivel más de la escala.
 */
function exigirAporte() {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const nivel = (request as any).accessLevel as ActorPesv['nivel'] | undefined
    if (nivel === 'read') {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'PROHIBIDO',
          message:
            'Su nivel de acceso al módulo PESV es de consulta. Aportar evidencia y registrar operación corresponde a HSEQ, Administración, Operaciones, Mantenimiento y Talento Humano.',
        },
      })
    }
  }
}

export async function pesvCentroRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  /// Leer: cualquiera con el módulo. Se pide `'limited'` porque es el ESCALÓN
  /// MÁS BAJO de la jerarquía (`limited < read < full`); pedir `'read'` habría
  /// devuelto 403 a las áreas que tienen `limited`, que son las que más usan la
  /// pantalla.
  const puedeLeer = { preHandler: requirePermission(MODULO, 'limited') }
  /// Aportar evidencia y registrar operación: las áreas responsables. Dos
  /// guardas: el del módulo y el que descarta el nivel de solo lectura.
  const puedeAportar = { preHandler: [requirePermission(MODULO, 'limited'), exigirAporte()] }
  /// Gestionar el ciclo, las metas y la configuración: `full`.
  const puedeGestionar = { preHandler: requirePermission(MODULO, 'full') }

  // ── Catálogo y metadatos ──────────────────────────────────────────────

  /** Los 24 pasos y las 13 fichas. Estático: es la normativa, no datos. */
  app.get('/pesv/centro/catalogo', puedeLeer, async (request, reply) =>
    responder(reply, async () => ({
      pasos: PASOS_PESV,
      fases: ETIQUETAS_FASE,
      indicadores: CODIGOS_INDICADOR.map((c) => FICHAS[c]),
      /// El nivel de la empresa. Viaja para que el panel no lo suponga.
      nivel: 'AVANZADO',
    })),
  )

  /** Qué puede hacer QUIEN pregunta. La UI lo usa para no ofrecer lo prohibido. */
  app.get('/pesv/centro/permisos', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const actor = actorDe(request)
      return {
        nivel: actor.nivel,
        areas: actor.areas,
        puedeLeer: true,
        puedeAportar: actor.nivel === 'full' || actor.nivel === 'limited',
        puedeGestionar: actor.nivel === 'full',
        /// La revisión NO se deriva del nivel: exige área HSEQ o Administración.
        /// Un usuario `full` de otra área gestiona el ciclo pero no aprueba.
        puedeRevisar: puedeRevisar(actor),
        usuarioId: actor.id,
      }
    }),
  )

  // ── Resumen ───────────────────────────────────────────────────────────

  app.get('/pesv/centro/resumen', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as { anio?: string; trimestre?: string; mes?: string }
      const anio = entero(q.anio) ?? new Date().getFullYear()
      return construirResumen(anio, entero(q.trimestre) ?? null, entero(q.mes) ?? null)
    }),
  )

  // ── Ciclos ────────────────────────────────────────────────────────────

  app.get('/pesv/centro/ciclos', puedeLeer, async (_request, reply) =>
    responder(reply, () => listarCiclos()),
  )

  app.post('/pesv/centro/ciclos', puedeGestionar, async (request, reply) =>
    responder(reply, async () => {
      const body = request.body as { anio?: number }
      if (!body?.anio || !Number.isInteger(body.anio)) {
        throw new PesvError('DATOS_INVALIDOS', 'El año del ciclo es obligatorio.')
      }
      return crearCiclo(body as never, actorDe(request))
    }),
  )

  app.patch('/pesv/centro/ciclos/:id', puedeGestionar, async (request, reply) =>
    responder(reply, () =>
      actualizarCiclo((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  app.post('/pesv/centro/ciclos/:id/cerrar', puedeGestionar, async (request, reply) =>
    responder(reply, () => cerrarCiclo((request.params as { id: string }).id, actorDe(request))),
  )

  // ── Matriz de los 24 pasos ────────────────────────────────────────────

  app.get('/pesv/centro/cumplimiento', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as Record<string, string | undefined>
      const anio = entero(q.anio) ?? new Date().getFullYear()
      const ciclo = await cicloDelAnioOFallo(anio)
      const filtros: FiltrosMatriz = {
        fase: q.fase as FiltrosMatriz['fase'],
        estado: q.estado as EstadoRequisito | undefined,
        area: q.area,
        responsableId: q.responsable,
        q: q.q,
      }
      const filas = await obtenerMatriz(ciclo.id, filtros)
      /// El resumen se calcula sobre la matriz COMPLETA y no sobre la filtrada:
      /// un avance del 100 % que solo refleja los tres pasos que el usuario
      /// dejó a la vista sería peor que no mostrarlo.
      const todas = await obtenerMatriz(ciclo.id)
      return { ciclo, filas, resumen: resumirMatriz(todas), fechaCorte: new Date().toISOString() }
    }),
  )

  app.get('/pesv/centro/cumplimiento/:step', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as { anio?: string }
      const step = entero((request.params as { step: string }).step)
      if (!step) throw new PesvError('PASO_FUERA_DE_RANGO', 'El número de paso no es válido.')
      const ciclo = await cicloDelAnioOFallo(entero(q.anio) ?? new Date().getFullYear())
      return detalleRequisito(ciclo.id, step)
    }),
  )

  /**
   * Cambia responsable, plazo, notas o estado de un paso.
   *
   * `limited` alcanza: el área responsable actualiza el avance de lo suyo. Lo
   * que NO alcanza es declarar `CUMPLE`, que el servicio restringe a HSEQ o
   * Administración y además exige soportes aprobados y vigentes.
   */
  app.patch('/pesv/centro/cumplimiento/:step', puedeAportar, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as { anio?: string }
      const step = entero((request.params as { step: string }).step)
      if (!step) throw new PesvError('PASO_FUERA_DE_RANGO', 'El número de paso no es válido.')
      const ciclo = await cicloDelAnioOFallo(entero(q.anio) ?? new Date().getFullYear())
      return actualizarRequisito(ciclo.id, step, request.body as never, actorDe(request))
    }),
  )

  // ── Evidencias ────────────────────────────────────────────────────────

  app.get('/pesv/centro/evidencias', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as Record<string, string | undefined>
      const actor = actorDe(request)
      const ciclo = await cicloDelAnioOFallo(entero(q.anio) ?? new Date().getFullYear())
      const filas = await bandejaEvidencias({
        cicloId: ciclo.id,
        estado: q.estado as never,
        stepNumber: entero(q.paso),
        area: q.area,
        cargadoPorId: q.mias === 'true' ? actor.id : undefined,
        limite: entero(q.limite),
      })
      /// `esPropia` se resuelve aquí y no en el servicio para que la UI pueda
      /// ocultar el botón de aprobar sin tener que replicar la regla.
      return filas.map((f) => ({ ...f, esPropia: f.cargadoPor?.id === actor.id }))
    }),
  )

  app.post('/pesv/centro/evidencias/presign', puedeAportar, async (request, reply) =>
    responder(reply, () => firmarSubidaEvidencia(request.body as never, actorDe(request))),
  )

  app.post('/pesv/centro/evidencias', puedeAportar, async (request, reply) =>
    responder(reply, () => crearEvidencia(request.body as never, actorDe(request))),
  )

  app.patch('/pesv/centro/evidencias/:id/revision', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      revisarEvidencia((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  app.get('/pesv/centro/evidencias/:id/descarga', puedeLeer, async (request, reply) =>
    responder(reply, () => urlDeDescarga((request.params as { id: string }).id, actorDe(request))),
  )

  app.delete('/pesv/centro/evidencias/:id', puedeAportar, async (request, reply) =>
    responder(reply, () => retirarEvidencia((request.params as { id: string }).id, actorDe(request))),
  )

  // ── Indicadores ───────────────────────────────────────────────────────

  app.get('/pesv/centro/indicadores', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as Record<string, string | undefined>
      const anio = entero(q.anio) ?? new Date().getFullYear()
      const periodo = construirPeriodo(anio, entero(q.trimestre) ?? null, entero(q.mes) ?? null)
      const ciclo = await obtenerCicloDelAnio(anio)
      const resultados = await calcularIndicadores(ciclo?.id ?? null, periodo)
      return {
        periodo,
        /// Sin ciclo se calculan igual los que no dependen de él (operación
        /// pura) y los demás salen `SIN_DATOS` con su motivo. Devolver 404
        /// dejaría la pantalla en blanco cuando lo útil es ver qué falta.
        ciclo: ciclo ? { id: ciclo.id, anio: ciclo.anio, nivel: ciclo.nivel } : null,
        indicadores: resultados,
        fechaCorte: new Date().toISOString(),
      }
    }),
  )

  app.get('/pesv/centro/indicadores/:codigo', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const codigo = (request.params as { codigo: string }).codigo.toUpperCase() as CodigoIndicador
      if (!CODIGOS_INDICADOR.includes(codigo)) {
        throw new PesvError('INDICADOR_NO_ENCONTRADO', `No existe el indicador «${codigo}».`)
      }
      const q = request.query as Record<string, string | undefined>
      const anio = entero(q.anio) ?? new Date().getFullYear()
      const periodo = construirPeriodo(anio, entero(q.trimestre) ?? null, entero(q.mes) ?? null)
      const ciclo = await obtenerCicloDelAnio(anio)
      const [resultado] = await calcularIndicadores(ciclo?.id ?? null, periodo, { codigos: [codigo] })
      return { ficha: FICHAS[codigo], resultado }
    }),
  )

  // ── Metas, riesgos, programas y formación ─────────────────────────────

  app.get('/pesv/centro/metas', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const ciclo = await cicloDelAnioOFallo(entero((request.query as any).anio) ?? new Date().getFullYear())
      return listarMetas(ciclo.id)
    }),
  )

  app.post('/pesv/centro/metas', puedeGestionar, async (request, reply) =>
    responder(reply, () => crearMeta(request.body as never, actorDe(request))),
  )

  app.patch('/pesv/centro/metas/:id', puedeGestionar, async (request, reply) =>
    responder(reply, () =>
      actualizarMeta((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  app.get('/pesv/centro/riesgos', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const ciclo = await cicloDelAnioOFallo(entero((request.query as any).anio) ?? new Date().getFullYear())
      return listarRiesgos(ciclo.id)
    }),
  )

  app.post('/pesv/centro/riesgos', puedeAportar, async (request, reply) =>
    responder(reply, () => crearRiesgo(request.body as never, actorDe(request))),
  )

  app.patch('/pesv/centro/riesgos/:id', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      actualizarRiesgo((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  app.get('/pesv/centro/programas', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const ciclo = await cicloDelAnioOFallo(entero((request.query as any).anio) ?? new Date().getFullYear())
      return listarProgramas(ciclo.id)
    }),
  )

  app.post('/pesv/centro/programas', puedeGestionar, async (request, reply) =>
    responder(reply, () => crearPrograma(request.body as never, actorDe(request))),
  )

  app.post('/pesv/centro/programas/:id/vehiculos', puedeGestionar, async (request, reply) =>
    responder(reply, () => {
      const body = request.body as { vehiculos?: Array<{ vehiculoId: string }> }
      if (!Array.isArray(body?.vehiculos)) {
        throw new PesvError('DATOS_INVALIDOS', 'Se espera una lista `vehiculos`.')
      }
      return cubrirVehiculos((request.params as { id: string }).id, body.vehiculos as never, actorDe(request))
    }),
  )

  app.get('/pesv/centro/formacion', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const ciclo = await cicloDelAnioOFallo(entero((request.query as any).anio) ?? new Date().getFullYear())
      return listarFormaciones(ciclo.id)
    }),
  )

  app.post('/pesv/centro/formacion', puedeAportar, async (request, reply) =>
    responder(reply, () => crearFormacion(request.body as never, actorDe(request))),
  )

  app.post('/pesv/centro/formacion/:id/asistencia', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      vincularAsistencia((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  // ── Operación segura ──────────────────────────────────────────────────

  app.get('/pesv/centro/operacion', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as Record<string, string | undefined>
      const anio = entero(q.anio) ?? new Date().getFullYear()
      const periodo = construirPeriodo(anio, entero(q.trimestre) ?? null, entero(q.mes) ?? null)
      const ciclo = await obtenerCicloDelAnio(anio)

      const [siniestros, velocidad, historicoVelocidad, inspecciones, mantenimiento] = await Promise.all([
        listarSiniestros(periodo, ciclo?.id ?? null),
        listarEventosVelocidad(periodo),
        serieHistoricaVelocidad(anio),
        coberturaInspecciones(periodo),
        alertasMantenimiento(ciclo?.dias_por_vencer ?? 30),
      ])

      return {
        periodo,
        siniestros,
        velocidad: { eventos: velocidad, historico: historicoVelocidad },
        inspecciones,
        mantenimiento,
        fechaCorte: new Date().toISOString(),
      }
    }),
  )

  app.post('/pesv/centro/siniestros', puedeAportar, async (request, reply) =>
    responder(reply, () => crearSiniestro(request.body as never, actorDe(request))),
  )

  app.patch('/pesv/centro/siniestros/:id', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      actualizarSiniestro((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  app.delete('/pesv/centro/siniestros/:id', puedeGestionar, async (request, reply) =>
    responder(reply, () => retirarSiniestro((request.params as { id: string }).id, actorDe(request))),
  )

  app.post('/pesv/centro/velocidad', puedeAportar, async (request, reply) =>
    responder(reply, () => registrarEventoVelocidad(request.body as never, actorDe(request))),
  )

  app.delete('/pesv/centro/velocidad/:id', puedeAportar, async (request, reply) =>
    responder(reply, () => retirarEventoVelocidad((request.params as { id: string }).id, actorDe(request))),
  )

  app.post('/pesv/centro/mantenimiento/planes', puedeAportar, async (request, reply) =>
    responder(reply, () => crearPlanMantenimiento(request.body as never, actorDe(request))),
  )

  app.post('/pesv/centro/mantenimiento/eventos', puedeAportar, async (request, reply) =>
    responder(reply, () => crearEventoMantenimiento(request.body as never, actorDe(request))),
  )

  app.post('/pesv/centro/mantenimiento/eventos/:id/ejecutar', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      ejecutarMantenimiento((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  // ── Documentos ────────────────────────────────────────────────────────

  app.get('/pesv/centro/documentos', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as Record<string, string | undefined>
      const filas = await listarDocumentos({
        ambito: q.ambito as never,
        tipo: q.tipo,
        estadoVigencia: q.estadoVigencia as never,
        estadoRevision: q.estadoRevision as never,
        conductorId: q.conductor,
        vehiculoId: q.vehiculo,
        corte: q.corte ?? hoyEnBogota(),
        q: q.q,
        limite: entero(q.limite),
      })
      return { filas, resumen: resumirDocumentos(filas), tipos: await listarTiposDocumento() }
    }),
  )

  app.patch('/pesv/centro/documentos/:id', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      normalizarDocumento((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  app.patch('/pesv/centro/documentos/:id/revision', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      revisarDocumento((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  app.patch('/pesv/centro/documentos/tipos/:tipo', puedeGestionar, async (request, reply) =>
    responder(reply, () =>
      actualizarTipoDocumento((request.params as { tipo: string }).tipo, request.body as never, actorDe(request)),
    ),
  )

  // ── Contratos y FUEC ──────────────────────────────────────────────────

  app.get('/pesv/centro/cobertura-fuec', puedeLeer, async (request, reply) =>
    responder(reply, async () => {
      const q = request.query as Record<string, string | undefined>
      const anio = entero(q.anio) ?? new Date().getFullYear()
      const periodo = construirPeriodo(anio, entero(q.trimestre) ?? null, entero(q.mes) ?? null)
      const filas = await evaluarCobertura({
        desde: q.desde ?? periodo.desde,
        hasta: q.hasta ?? periodo.hasta,
        estado: q.estado as never,
        clienteId: q.cliente,
        vehiculoId: q.vehiculo,
        limite: entero(q.limite),
      })
      return { periodo, filas, resumen: resumirCobertura(filas) }
    }),
  )

  app.get('/pesv/centro/contratos', puedeLeer, async (request, reply) =>
    responder(reply, () => {
      const q = request.query as Record<string, string | undefined>
      return listarContratos({
        q: q.q,
        estado: q.estado,
        clienteId: q.cliente,
        vigenteEn: q.vigenteEn,
        limite: entero(q.limite),
      })
    }),
  )

  app.post('/pesv/centro/contratos', puedeAportar, async (request, reply) =>
    responder(reply, () => crearContrato(request.body as never, actorDe(request))),
  )

  app.patch('/pesv/centro/contratos/:id', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      actualizarContrato((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  app.get('/pesv/centro/fuec', puedeLeer, async (request, reply) =>
    responder(reply, () => {
      const q = request.query as Record<string, string | undefined>
      return listarFuec({
        q: q.q,
        estado: q.estado,
        contratoId: q.contrato,
        vehiculoId: q.vehiculo,
        vigenteEn: q.vigenteEn,
        limite: entero(q.limite),
      })
    }),
  )

  app.post('/pesv/centro/fuec', puedeAportar, async (request, reply) =>
    responder(reply, () => crearFuec(request.body as never, actorDe(request))),
  )

  app.post('/pesv/centro/fuec/:id/anular', puedeAportar, async (request, reply) =>
    responder(reply, () => {
      const body = request.body as { motivo?: string }
      return anularFuec((request.params as { id: string }).id, body?.motivo ?? '', actorDe(request))
    }),
  )

  app.post('/pesv/centro/servicios/:id/vinculo', puedeAportar, async (request, reply) =>
    responder(reply, () =>
      vincularServicio((request.params as { id: string }).id, request.body as never, actorDe(request)),
    ),
  )

  // ── Importación histórica del TXT ─────────────────────────────────────

  /**
   * Importa `extractos.txt`.
   *
   * `full` y no `limited`: crea contratos y extractos en masa. Por defecto va en
   * SIMULACIÓN — hay que pedir `simulacion: false` explícitamente. Un endpoint
   * que escribe cuatro mil filas no debe hacerlo porque alguien lo llamó sin
   * cuerpo.
   */
  app.post('/pesv/centro/fuec/importar', puedeGestionar, async (request, reply) =>
    responder(reply, () => {
      const body = (request.body ?? {}) as { simulacion?: boolean; limite?: number }
      return importarExtractosTxt(actorDe(request), {
        simulacion: body.simulacion !== false,
        limite: body.limite,
      })
    }),
  )

  app.get('/pesv/centro/fuec/conciliacion', puedeLeer, async (request, reply) =>
    responder(reply, () => {
      const q = request.query as Record<string, string | undefined>
      return listarConciliacion({
        motivo: q.motivo as never,
        resuelto: q.resuelto === undefined ? undefined : q.resuelto === 'true',
        limite: entero(q.limite),
      })
    }),
  )

  app.post('/pesv/centro/fuec/conciliacion/:id/resolver', puedeAportar, async (request, reply) =>
    responder(reply, () => marcarConciliado((request.params as { id: string }).id, actorDe(request))),
  )

  // ── Configuración ─────────────────────────────────────────────────────

  app.get('/pesv/centro/jornada', puedeLeer, async (_request, reply) =>
    responder(reply, () => listarPoliticasJornada()),
  )

  app.post('/pesv/centro/jornada', puedeGestionar, async (request, reply) =>
    responder(reply, () => crearPoliticaJornada(request.body as never, actorDe(request))),
  )

  app.post('/pesv/centro/jornada/:id/cerrar', puedeGestionar, async (request, reply) =>
    responder(reply, () => {
      const body = request.body as { vigenteHasta?: string }
      if (!body?.vigenteHasta) {
        throw new PesvError('DATOS_INVALIDOS', 'Indique la fecha de cierre de la política.')
      }
      return cerrarPoliticaJornada((request.params as { id: string }).id, body.vigenteHasta, actorDe(request))
    }),
  )

  app.get('/pesv/centro/opciones', puedeLeer, async (_request, reply) =>
    responder(reply, async () => ({ vehiculos: await opcionesVehiculos() })),
  )

  // ── Auditoría y expediente ────────────────────────────────────────────

  app.get('/pesv/centro/auditoria', puedeLeer, async (request, reply) =>
    responder(reply, () => {
      const q = request.query as Record<string, string | undefined>
      return listarAuditoria({
        entidad: q.entidad as never,
        entidadId: q.entidadId,
        usuarioId: q.usuario,
        limite: entero(q.limite),
      })
    }),
  )

  /**
   * Expediente completo del ciclo, en JSON.
   *
   * Es lo que permite a un auditor revisar sin acceso a la base. Se sirve como
   * JSON y no como ZIP con los archivos: los soportes viven en S3 y se
   * descargan uno a uno con URL firmada y corta. Un ZIP con todo produciría un
   * paquete de cientos de megas y, sobre todo, dejaría copias sin caducidad de
   * documentos con datos personales de conductores.
   */
  app.get('/pesv/centro/expediente', puedeGestionar, async (request, reply) =>
    responder(reply, async () => {
      const anio = entero((request.query as any).anio) ?? new Date().getFullYear()
      const ciclo = await cicloDelAnioOFallo(anio)
      const periodo = construirPeriodo(anio, null, null)

      /// `expedienteDeCiclo` construye la matriz UNA vez y le pega sus
      /// evidencias. Llamar a `detalleRequisito` veinticuatro veces recorría la
      /// matriz entera en cada llamada: veinticuatro veces el mismo trabajo
      /// para el mismo resultado.
      const [detalle, indicadores, metas, riesgos, programas, formaciones, auditoria] =
        await Promise.all([
          expedienteDeCiclo(ciclo.id),
          calcularIndicadores(ciclo.id, periodo),
          listarMetas(ciclo.id),
          listarRiesgos(ciclo.id),
          listarProgramas(ciclo.id),
          listarFormaciones(ciclo.id),
          listarAuditoria({ limite: 1000 }),
        ])

      return {
        generadoAt: new Date().toISOString(),
        generadoPor: actorDe(request).nombre,
        ciclo: await obtenerCicloPorId(ciclo.id),
        resumenCumplimiento: resumirMatriz(detalle.filas),
        pasos: detalle.pasos,
        indicadores,
        metas,
        riesgos,
        programas,
        formaciones,
        auditoria,
        advertencia:
          'Los archivos de soporte no viajan en este expediente: se descargan uno a uno con enlace firmado y de corta duración, para no dejar copias sin caducidad de documentos con datos personales.',
      }
    }),
  )
}
