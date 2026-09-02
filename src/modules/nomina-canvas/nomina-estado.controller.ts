import { FastifyRequest, FastifyReply } from 'fastify';
import {
  NominaEstadoService,
  ErrorEstadoNomina,
  TRANSICIONES,
  ESTADOS_VALIDOS,
  ESTADOS_BLOQUEADOS,
  ESTADOS_QUE_EXIGEN_ADMIN,
  ESTADOS_QUE_EXIGEN_MOTIVO,
  transicionesPermitidas,
} from './nomina-estado.service';
import { NominaSnapshotsService } from './nomina-snapshots.service';

/** Con 30 conductores por periodo, 200 deja margen sin abrir la puerta. */
const MAX_LOTE = 200;

function actorDe(request: FastifyRequest) {
  const u = (request as any).user ?? {};
  return { id: u.id ?? u.sub ?? null, name: u.nombre ?? u.name ?? null, areas: u.area ?? u.areas ?? null };
}

function responderError(reply: FastifyReply, error: unknown) {
  if (error instanceof ErrorEstadoNomina) {
    return reply.status(error.status).send({
      error: error.message,
      code: error.code,
      ...(error.detalle ?? {}),
    });
  }
  throw error;
}

export class NominaEstadoController {
  /** GET /nomina/estados — la matriz, para que la barra pinte lo correcto. */
  static async vocabulario(request: FastifyRequest, reply: FastifyReply) {
    const actor = actorDe(request);
    return reply.send({
      estados: ESTADOS_VALIDOS,
      transiciones: TRANSICIONES,
      bloqueados: ESTADOS_BLOQUEADOS,
      exigen_admin: ESTADOS_QUE_EXIGEN_ADMIN,
      exigen_motivo: ESTADOS_QUE_EXIGEN_MOTIVO,
      permitidas_por_estado: Object.fromEntries(
        ESTADOS_VALIDOS.map((e) => [e, transicionesPermitidas(e, actor)]),
      ),
    });
  }

  /** PATCH /nomina/liquidaciones/:id/estado */
  static async cambiar(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const b = (request.body ?? {}) as Record<string, unknown>;
    try {
      const resultado = await NominaEstadoService.cambiar({
        id,
        estado: String(b.estado ?? ''),
        motivo: typeof b.motivo === 'string' ? b.motivo : null,
        base_version: b.base_version == null ? null : Number(b.base_version),
        actor: actorDe(request),
      });
      return reply.send(resultado);
    } catch (error) {
      try {
        return responderError(reply, error);
      } catch {
        request.log.error({ err: error, id }, 'nomina: fallo al cambiar el estado');
        return reply.status(500).send({ error: 'No se pudo cambiar el estado.' });
      }
    }
  }

  /** POST /nomina/estado-lote */
  static async cambiarLote(request: FastifyRequest, reply: FastifyReply) {
    const b = (request.body ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(b.ids) ? b.ids.map(String).filter(Boolean) : [];
    if (!ids.length) return reply.status(400).send({ error: 'No hay liquidaciones en el lote.' });
    if (ids.length > MAX_LOTE) {
      return reply.status(413).send({ error: `Máximo ${MAX_LOTE} liquidaciones por lote.` });
    }
    try {
      const resultado = await NominaEstadoService.cambiarLote({
        ids,
        estado: String(b.estado ?? ''),
        motivo: typeof b.motivo === 'string' ? b.motivo : null,
        actor: actorDe(request),
      });
      return reply.send(resultado);
    } catch (error) {
      request.log.error({ err: error }, 'nomina: fallo en el cambio de estado en lote');
      return reply.status(500).send({ error: 'No se pudo cambiar el estado del lote.' });
    }
  }

  /** GET /nomina/liquidaciones/:id/historial-estados */
  static async historial(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    try {
      return reply.send(await NominaEstadoService.historial(id));
    } catch (error) {
      request.log.error({ err: error, id }, 'nomina: fallo al leer el historial de estados');
      return reply.status(500).send({ error: 'No se pudo leer el historial.' });
    }
  }
}

export class NominaSnapshotsController {
  /** GET /nomina/snapshots?anio=&mes= */
  static async listar(request: FastifyRequest, reply: FastifyReply) {
    const q = (request.query ?? {}) as Record<string, string>;
    const anio = Number(q.anio);
    const mes = Number(q.mes);
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });
    }
    try {
      return reply.send(await NominaSnapshotsService.listar(anio, mes));
    } catch (error) {
      request.log.error({ err: error }, 'nomina: fallo al listar snapshots');
      return reply.status(500).send({ error: 'No se pudieron listar las versiones.' });
    }
  }

  /** POST /nomina/snapshots { anio, mes, corte? } */
  static async capturar(request: FastifyRequest, reply: FastifyReply) {
    const b = (request.body ?? {}) as Record<string, unknown>;
    const anio = Number(b.anio);
    const mes = Number(b.mes);
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });
    }
    try {
      const creado = await NominaSnapshotsService.capturar({
        anio,
        mes,
        corte: b.corte == null ? undefined : Number(b.corte),
        origen: 'manual',
        usuarioId: actorDe(request).id,
      });
      // `null` significa «no hacía falta», no un fallo.
      return reply.send(creado ?? { sinCambios: true });
    } catch (error) {
      request.log.error({ err: error }, 'nomina: fallo al capturar snapshot');
      return reply.status(500).send({ error: 'No se pudo guardar la versión.' });
    }
  }

  /** GET /nomina/snapshots/:id */
  static async obtener(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const snap = await NominaSnapshotsService.obtener(id);
    if (!snap) return reply.status(404).send({ error: 'Versión no encontrada.' });
    return reply.send(snap);
  }

  /** GET /nomina/snapshots/:id/diff[?vs=<id>] */
  static async diff(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const q = (request.query ?? {}) as Record<string, string>;
    const resultado = await NominaSnapshotsService.diff(id, q.vs || undefined);
    if (!resultado) return reply.status(404).send({ error: 'Versión no encontrada.' });
    return reply.send(resultado);
  }

  /** POST /nomina/snapshots/:id/revertir */
  static async revertir(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    try {
      const resultado = await NominaSnapshotsService.revertir({
        snapshotId: id,
        usuarioId: actorDe(request).id,
      });
      return reply.send(resultado);
    } catch (error) {
      request.log.error({ err: error, id }, 'nomina: fallo al revertir');
      return reply.status(500).send({ error: 'No se pudo restaurar la versión.' });
    }
  }
}
