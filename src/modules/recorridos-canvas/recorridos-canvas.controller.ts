import { FastifyReply, FastifyRequest } from 'fastify'
import { RecorridosCanvasService } from './recorridos-canvas.service'
import { cortePorDefecto, esFechaValida, type Corte } from './corte-periodo'

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
}
