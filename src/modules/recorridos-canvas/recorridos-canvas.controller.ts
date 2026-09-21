import { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from '../../config/prisma'
import { RecorridosCanvasService } from './recorridos-canvas.service'
import {
  ConflictoVersionRecorrido,
  PatchRecorridoError,
  RecorridosPatchService,
} from './recorridos-patch.service'
import { cortePorDefecto, esFechaValida, periodoDeCorte, type Corte } from './corte-periodo'
import { emitSheetInvalidate } from '../../sockets/sheet.gateway'

/**
 * Tope de hojas por libro.
 *
 * Univer monta TODAS las hojas al abrir el workbook, no solo la visible. Con
 * un conductor por hoja y un mes cargado, pasar de este número deja el
 * navegador sin responder. Se corta y se avisa, en vez de servir un libro que
 * no se puede abrir.
 */
const MAX_HOJAS = 120

/**
 * Tope de días por corte.
 *
 * El corte normal son 31 días. Sin tope, un `desde` de hace tres años monta un
 * libro de miles de filas por conductor que el navegador no abre — y el error
 * llegaría como un cuelgue, no como un mensaje.
 */
const MAX_DIAS_CORTE = 92

function diasEntre(corte: { desde: string; hasta: string }): number {
  const d1 = Date.parse(`${corte.desde}T00:00:00Z`)
  const d2 = Date.parse(`${corte.hasta}T00:00:00Z`)
  return Math.round((d2 - d1) / 86_400_000) + 1
}

export class RecorridosCanvasController {
  static async periodo(request: FastifyRequest, reply: FastifyReply) {
    const q = request.query as Record<string, string | undefined>

    // Sin fechas se sirve el corte vivo (21→20). Así una petición sin
    // parámetros devuelve lo que Operaciones está trabajando hoy.
    const corte: Corte = q.desde || q.hasta
      ? { desde: String(q.desde ?? ''), hasta: String(q.hasta ?? '') }
      : cortePorDefecto()

    if (!esFechaValida(corte.desde) || !esFechaValida(corte.hasta)) {
      return reply.status(400).send({ error: 'Parámetros "desde"/"hasta" inválidos (YYYY-MM-DD)' })
    }
    if (corte.desde > corte.hasta) {
      return reply.status(400).send({ error: 'La fecha inicial no puede ser posterior a la final' })
    }
    if (diasEntre(corte) > MAX_DIAS_CORTE) {
      return reply
        .status(400)
        .send({ error: `El corte no puede pasar de ${MAX_DIAS_CORTE} días` })
    }

    const conductorIds = (q.conductores ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    try {
      const dto = await RecorridosCanvasService.construirPeriodo({
        corte,
        conductorIds: conductorIds.length ? conductorIds : undefined,
        maxHojas: MAX_HOJAS,
      })
      return reply.send(dto)
    } catch (e: any) {
      request.log.error({ err: e }, 'recorridos-canvas: fallo construyendo el periodo')
      return reply.status(500).send({ error: 'No se pudo construir el libro de recorridos' })
    }
  }

  /**
   * Columnas de bono del año.
   *
   * Existe aparte del libro para que el modal de configuración pueda refrescar
   * las columnas sin recargar el periodo entero.
   */
  static async bonos(request: FastifyRequest, reply: FastifyReply) {
    const q = request.query as Record<string, string | undefined>
    const anio = Number(q.anio)
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
      return reply.status(400).send({ error: 'Parámetro "anio" inválido' })
    }
    return reply.send({ anio, bonos: await RecorridosCanvasService.columnasBono(anio) })
  }

  /**
   * Placas de la flota, para validar lo que se teclea en el canvas ANTES de
   * enviarlo: una placa que no existe se avisa al instante, con el consejo de
   * registrarla, en vez de un error del servidor medio segundo después.
   */
  static async placas(_request: FastifyRequest, reply: FastifyReply) {
    const vehiculos = await prisma.vehiculos.findMany({
      where: { deleted_at: null },
      select: { id: true, placa: true },
      orderBy: { placa: 'asc' },
    })
    return reply.send({ placas: vehiculos })
  }

  /**
   * Alta de una fila insertada en el canvas.
   *
   * REST y no socket: el alta devuelve la fila completa —ids, versión, bonos—
   * y no encaja en el acuse por celda de `sheet:patch`. Al resto de la sala se
   * le avisa con `sheet:invalidate`, porque una fila nueva cambia la GEOMETRÍA
   * de la hoja y no se puede aplicar como patch.
   */
  static async crearFila(request: FastifyRequest, reply: FastifyReply) {
    const body = (request.body ?? {}) as Record<string, unknown>
    const user = (request as any).user
    const conductorId = String(body.conductor_id ?? '')
    const corte = { desde: String(body.desde ?? ''), hasta: String(body.hasta ?? '') }

    if (!conductorId) return reply.status(400).send({ error: 'conductor_id es obligatorio' })
    if (!esFechaValida(corte.desde) || !esFechaValida(corte.hasta) || corte.desde > corte.hasta) {
      return reply.status(400).send({ error: 'Parámetros "desde"/"hasta" inválidos (YYYY-MM-DD)' })
    }

    try {
      const r = await RecorridosPatchService.crearFila({
        conductorId,
        corte,
        entrada: {
          fecha: body.fecha,
          tipo_dia: body.tipo_dia,
          vehiculo_placa: body.vehiculo_placa,
          hora_inicio: body.hora_inicio,
          hora_fin: body.hora_fin,
          horas_conducidas: body.horas_conducidas,
          cliente_nombre: body.cliente_nombre,
          km_inicial: body.km_inicial,
          km_final: body.km_final,
          pernocte: body.pernocte,
          observaciones: body.observaciones,
          bonos: Array.isArray(body.bonos) ? (body.bonos as string[]) : [],
        },
        actor: { id: user.id, area: user.area, role: user.role },
      })
      const { anio, mes } = periodoDeCorte(corte)
      emitSheetInvalidate({ scope: 'recorridos', anio, mes, accion: 'filas', by: user.id })
      return reply.status(201).send(r)
    } catch (e: any) {
      return responderFallo(request, reply, e, 'No se pudo crear la fila')
    }
  }

  /** Baja lógica de una fila eliminada en el canvas. */
  static async eliminarFila(request: FastifyRequest, reply: FastifyReply) {
    const { tipo, id } = request.params as { tipo: string; id: string }
    const q = request.query as Record<string, string | undefined>
    const user = (request as any).user

    if (tipo !== 'segmento' && tipo !== 'dia') {
      return reply.status(400).send({ error: 'tipo debe ser "segmento" o "dia"' })
    }
    const baseVersion = q.base_version != null && q.base_version !== '' ? Number(q.base_version) : null
    if (baseVersion != null && !Number.isInteger(baseVersion)) {
      return reply.status(400).send({ error: 'base_version inválido' })
    }
    if (!esFechaValida(q.desde) || !esFechaValida(q.hasta)) {
      return reply.status(400).send({ error: 'Parámetros "desde"/"hasta" inválidos (YYYY-MM-DD)' })
    }

    try {
      const r = await RecorridosPatchService.eliminarFila({
        tipoFila: tipo,
        entityId: id,
        baseVersion,
        actor: { id: user.id, area: user.area, role: user.role },
      })
      const { anio, mes } = periodoDeCorte({ desde: q.desde!, hasta: q.hasta! })
      emitSheetInvalidate({ scope: 'recorridos', anio, mes, accion: 'filas', by: user.id })
      return reply.send(r)
    } catch (e: any) {
      return responderFallo(request, reply, e, 'No se pudo eliminar la fila')
    }
  }
}

/**
 * Los errores de regla van con su mensaje tal cual —está redactado para quien
 * corrige la planilla—; los demás se registran y se devuelven genéricos.
 */
function responderFallo(
  request: FastifyRequest,
  reply: FastifyReply,
  e: any,
  generico: string,
) {
  if (e instanceof ConflictoVersionRecorrido) {
    return reply.status(409).send({ error: e.message, code: e.code, server_row: e.serverRow })
  }
  if (e instanceof PatchRecorridoError) {
    const status = e.code === 'SIN_PERMISO' ? 403 : e.code === 'NO_ENCONTRADO' ? 404 : 422
    return reply.status(status).send({ error: e.message, code: e.code })
  }
  request.log.error({ err: e }, `recorridos-canvas: ${generico}`)
  return reply.status(500).send({ error: generico })
}
