import { FastifyRequest, FastifyReply } from 'fastify';
import {
  borradorNominaQueueService,
  type BorradorNominaPayload,
} from '../../queue/borrador-nomina-queue.service';
import { NominaCanvasService } from './nomina-canvas.service';
import { prisma } from '../../config/prisma';
import { copiarDiasDesdePlanillas } from '../../queue/borrador-nomina-queue.service';
import { rehacerBonificacionesDesdeRecorridos } from '../../queue/borrador-nomina-queue.service';
import {
  sembrarRecargosDesdePlanillas,
  sembrarBonificacionesDesdeRecorridos,
} from '../../queue/borrador-nomina-queue.service';
import { NominaPatchService } from './nomina-patch.service';
import { construirRecargosDataDesdeHoja } from './nomina-desprendible.service';
import { emitSheetInvalidate } from '../../sockets/sheet.gateway';
import { ESTADOS_BLOQUEADOS, permiteRefrescarDias } from './nomina-estado.service';
import { LiquidacionesService } from '../liquidaciones/liquidaciones.service';

/** Techo por lote. Un periodo real ronda los quince conductores. */
const MAX_CONDUCTORES = 200;

function actorDe(request: FastifyRequest) {
  const u = (request as any).user ?? {};
  return {
    id: String(u.id ?? u.sub ?? ''),
    name: String(u.nombre ?? u.name ?? 'Usuario'),
  };
}

function periodoDe(b: Record<string, any>) {
  const anio = Number(b.anio);
  const mes = Number(b.mes);
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return null;
  }
  const corte = b.corte == null ? null : Number(b.corte);
  return { anio, mes, corte: Number.isFinite(corte as number) ? corte : null };
}

export class NominaBorradoresController {
  /**
   * Lo que hay que ver ANTES de lanzar.
   *
   * Sin esto, generar sobre un mes ya trabajado parece inocuo y no lo es: la
   * lista dice quién tiene ya liquidación y en qué estado, y quién no tiene
   * planillas y por tanto saldría en cero. Es el mismo aviso previo que da el
   * modal de cierres de terceros, y por el mismo motivo.
   */
  static async previo(request: FastifyRequest, reply: FastifyReply) {
    const p = periodoDe((request.query ?? {}) as Record<string, any>);
    if (!p) return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });

    try {
      const periodo = await NominaCanvasService.construirPeriodo({
        anio: p.anio,
        mes: p.mes,
        corte: p.corte ?? undefined,
        /**
         * La lista previa enseña a TODO el que no esté inactivo, tenga o no
         * marcado `conductores.nomina`.
         *
         * La pregunta aquí no es «¿quién es la nómina del periodo?» —eso es el
         * canvas— sino «¿a quién puedo generarle un borrador?». Esconder a un
         * conductor que trabajó porque tiene un flag a `false` obligaba a ir a
         * otra pantalla a editarlo solo para poder pagarle, y el flag está
         * desactualizado: la mayoría de los que salían fuera tenían planillas
         * del año, y algunos hasta liquidaciones hechas.
         *
         * Vienen MARCADOS como fuera de nómina y el modal los deja sin
         * seleccionar, así que aparecer aquí no genera nada por sí solo.
         */
        incluirFueraDeNomina: true,
      } as any);

      const dias = periodo.periodo.dias;
      return reply.send({
        anio: p.anio,
        mes: p.mes,
        etiqueta: periodo.etiqueta,
        desde: dias[0]?.fecha ?? null,
        hasta: dias[dias.length - 1]?.fecha ?? null,
        conductores: (periodo.hojas as any[]).map((h) => ({
          conductor_id: h.conductorId,
          nombre: h.nombre,
          cedula: h.cedula,
          /// `false` = trabaja pero no está marcado para nómina. El modal lo
          /// rotula y lo deja desmarcado en vez de esconderlo.
          en_nomina: (h as any).enNomina !== false,
          dias: h.dias?.length ?? 0,
          placas: h.placas ?? [],
          /// Null cuando no hay nada guardado todavía: es la señal de que
          /// generar aquí crea, no reemplaza.
          liquidacion_id: h.liquidacionId,
          estado: h.liquidacionId ? h.estado : null,
          sueldo_estimado: Number(h.totales?.sueldoTotal ?? 0),
          avisos: h.avisos ?? [],
        })),
      });
    } catch (e: any) {
      return reply
        .status(500)
        .send({ error: e?.message || 'No se pudo leer el periodo.' });
    }
  }

  static async generar(request: FastifyRequest, reply: FastifyReply) {
    const b = (request.body ?? {}) as Record<string, any>;
    const p = periodoDe(b);
    if (!p) return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });

    const conductorIds = Array.isArray(b.conductor_ids)
      ? b.conductor_ids.map(String).filter(Boolean)
      : [];
    if (conductorIds.length > MAX_CONDUCTORES) {
      return reply
        .status(400)
        .send({ error: `Máximo ${MAX_CONDUCTORES} conductores por lote.` });
    }

    /// Solo se sobrescribe a quien viene también en la selección: si no, un
    /// id colado aquí reemplazaría una liquidación que nadie marcó.
    const pedidos = new Set(conductorIds);
    const sobrescribir = (
      Array.isArray(b.sobrescribir) ? b.sobrescribir.map(String) : []
    ).filter((id: string) => pedidos.has(id));

    const actor = actorDe(request);
    if (!actor.id) return reply.status(401).send({ error: 'Sesión no válida.' });

    try {
      const payload: BorradorNominaPayload = {
        anio: p.anio,
        mes: p.mes,
        corte: p.corte,
        conductorIds,
        sobrescribir,
      };
      const r = borradorNominaQueueService.enqueue(actor.id, actor.name, payload);

      if (r.status === 'locked') {
        return reply.status(409).send({
          error: 'Ya hay una generación en curso para este periodo.',
          job_id: r.jobId,
          locked_by: r.lockedBy,
        });
      }
      return reply.send({ job_id: r.jobId, status: r.status, total: conductorIds.length });
    } catch (e: any) {
      return reply.status(400).send({ error: e?.message || 'No se pudo encolar.' });
    }
  }

  /**
   * Vuelve a copiar los días de UNA liquidación desde las planillas.
   *
   * Es el «Actualizar desde planillas» del canvas: sirve para cuando se
   * cargaron días nuevos en Recargos después de generar el borrador. Descarta
   * las correcciones manuales de los días —a eso se viene— y deja intactos los
   * bonos, las vacaciones y el resto del desprendible, que no salen de ahí.
   *
   * Síncrono y no encolado: es una sola liquidación y quien lo pulsa está
   * mirando la hoja, esperando a que cambie.
   */
  static async refrescarDias(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const b = (request.body ?? {}) as Record<string, any>;
    const p = periodoDe(b);
    if (!p) return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });

    const actor = actorDe(request);
    if (!actor.id) return reply.status(401).send({ error: 'Sesión no válida.' });

    const liq = await prisma.liquidaciones.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, conductor_id: true, estado_flujo: true },
    });
    if (!liq) return reply.status(404).send({ error: 'Liquidación no encontrada.' });

    /**
     * SOLO EN BORRADOR, que es más estricto que `ESTADOS_BLOQUEADOS`.
     *
     * Esto no refresca: DESCARTA la copia del corte y la rehace desde las
     * planillas, llevándose por delante las horas corregidas a mano. Mientras
     * se arma el borrador es justo lo que se busca; a partir de LIQUIDADA la
     * cifra ya se revisó y a menudo ya se firmó, así que rehacerla desde el
     * origen es deshacer el trabajo sin dejar rastro.
     *
     * La guarda vieja solo miraba APROBADA/PAGADA/ANULADA, así que en LIQUIDADA
     * el botón pasaba sin preguntar nada.
     */
    if (!permiteRefrescarDias(liq.estado_flujo)) {
      return reply.status(409).send({
        error: `La liquidación está en ${liq.estado_flujo} y sus días ya no se vuelven a traer de las planillas. Devuélvela a BORRADOR si de verdad hay que rehacerlos.`,
      });
    }

    try {
      /// Se reconstruye el periodo para ESE conductor y se toman sus días tal
      /// y como los calcula el canvas: así la copia y lo que se ve no pueden
      /// salir de dos sitios distintos.
      const dto = await NominaCanvasService.construirPeriodo({
        anio: p.anio,
        mes: p.mes,
        corte: p.corte,
        conductorIds: [liq.conductor_id!],
        /// IGNORANDO la copia. Sin esto se leería la copia que se va a
        /// reemplazar y el refresco se copiaría a sí mismo: un no-op que desde
        /// fuera parece que el botón no hace nada.
        ignorarCopia: true,
      } as any);
      const hoja = dto.hojas.find((h) => h.conductorId === liq.conductor_id);
      if (!hoja) return reply.status(404).send({ error: 'El conductor no está en este periodo.' });

      const n = await copiarDiasDesdePlanillas(liq.id, hoja.dias as any);
      return reply.send({ dias: n });
    } catch (e: any) {
      return reply.status(400).send({ error: e?.message || 'No se pudo actualizar.' });
    }
  }

  /**
   * Vuelve a montar los bonos de UNA hoja desde lo marcado en recorridos.
   *
   * Es el deshacer del canvas: teclear una cantidad convierte esa celda en
   * cifra propia de la liquidación —y aparece el ámbar `n → m` contra lo
   * marcado—; esto la devuelve a lo que dicen los tramos.
   *
   * PISA A PROPÓSITO, y por eso el cliente pregunta antes diciendo cuántas
   * celdas tecleadas a mano se van a perder. Es la diferencia con el sembrado
   * del generador, que se abstiene si ya hay bonificaciones.
   *
   * La ventana y los meses salen del DTO del canvas, no de una cuenta propia:
   * si se calcularan aparte, el botón podría restaurar sobre un corte distinto
   * del que la tabla está comparando y el ámbar no se iría.
   */
  static async rehacerBonos(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const b = (request.body ?? {}) as Record<string, any>;
    const p = periodoDe(b);
    if (!p) return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });

    const actor = actorDe(request);
    if (!actor.id) return reply.status(401).send({ error: 'Sesión no válida.' });

    const liq = await prisma.liquidaciones.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, conductor_id: true, estado_flujo: true },
    });
    if (!liq) return reply.status(404).send({ error: 'Liquidación no encontrada.' });

    /// Igual que «Actualizar días»: una liquidación aprobada o pagada no se
    /// repisa. Eso no es restaurar, es rehacer un documento ya firmado.
    if (ESTADOS_BLOQUEADOS.includes(liq.estado_flujo)) {
      return reply.status(409).send({
        error: `La liquidación está en ${liq.estado_flujo}. Devuélvela a LIQUIDADA para poder restaurarla.`,
      });
    }

    try {
      const dto = await NominaCanvasService.construirPeriodo({
        anio: p.anio,
        mes: p.mes,
        corte: p.corte,
        conductorIds: [liq.conductor_id!],
      } as any);
      const hoja = dto.hojas.find((h) => h.conductorId === liq.conductor_id);
      if (!hoja) return reply.status(404).send({ error: 'El conductor no está en este periodo.' });

      const dias = dto.periodo.dias;
      const desde = dias[0]?.fecha ?? '';
      const hasta = dias[dias.length - 1]?.fecha ?? '';
      if (!desde || !hasta) {
        return reply.status(400).send({ error: 'El periodo no tiene días.' });
      }

      /// Los meses del corte, tal y como los usa la matriz de bonos. El
      /// respaldo cubre el payload viejo sin desglose por mes.
      const meses =
        (hoja as any).matrizBonos?.meses?.length
          ? ((hoja as any).matrizBonos.meses as string[])
          : [...new Set([desde.slice(0, 7), hasta.slice(0, 7)])];

      const r = await rehacerBonificacionesDesdeRecorridos(
        liq.id,
        liq.conductor_id!,
        desde,
        hasta,
        meses,
        actor.id,
      );

      /// Cambia la GEOMETRÍA del desprendible (una línea de bono puede nacer o
      /// irse a cero), así que no hay patch de celda que lo describa: la sala
      /// entera relee. Va incluso con `celdas: 0` —no cuesta nada y cubre el
      /// caso de dos personas mirando cifras distintas por otra razón.
      emitSheetInvalidate({
        scope: 'nomina',
        anio: p.anio,
        mes: p.mes,
        accion: 'bonos',
        by: actor.id,
      });

      return reply.send(r);
    } catch (e: any) {
      return reply.status(400).send({ error: e?.message || 'No se pudieron restaurar los bonos.' });
    }
  }

  /**
   * Las tablas de recargo del desprendible, sacadas del CANVAS.
   *
   * Sustituye a `recargos_preview` como fuente de las páginas de detalle. El
   * preview lee las planillas; el canvas paga desde su copia del corte
   * (`liquidaciones_dias`), que es la que se edita en la hoja. En cuanto
   * alguien corrige una hora, las dos se separan y el comprobante contradice
   * al canvas — en WILSON eran $325.687 de diferencia, repartidos en ocho días
   * de septiembre.
   *
   * Devuelve la MISMA forma que traía el preview, así que el renderizador del
   * PDF no se entera del cambio.
   */
  static async desprendibleData(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const p = periodoDe((request.query ?? {}) as Record<string, any>);
    if (!p) return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });

    const liq = await prisma.liquidaciones.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, conductor_id: true },
    });
    if (!liq) return reply.status(404).send({ error: 'Liquidación no encontrada.' });

    try {
      const dto = await NominaCanvasService.construirPeriodo({
        anio: p.anio,
        mes: p.mes,
        corte: p.corte,
        conductorIds: [liq.conductor_id!],
      } as any);
      const hoja = dto.hojas.find((h) => h.conductorId === liq.conductor_id);
      if (!hoja) return reply.status(404).send({ error: 'El conductor no está en este periodo.' });

      const dias = dto.periodo.dias;
      const desde = dias[0]?.fecha ?? '';
      const hasta = dias[dias.length - 1]?.fecha ?? '';
      return reply.send(construirRecargosDataDesdeHoja(hoja, { desde, hasta }));
    } catch (e: any) {
      return reply
        .status(400)
        .send({ error: e?.message || 'No se pudieron construir las tablas de recargo.' });
    }
  }

  /**
   * Rehace las filas de `recargos` (y los bonos que falten) de una hoja.
   *
   * QUÉ ARREGLA: el desprendible —el PDF y su preview— no lee la columna
   * `liquidaciones.total_recargos`, sino las FILAS de la tabla `recargos`. El
   * generador de borradores escribía la columna y ninguna fila, así que el
   * comprobante salía con «Otros … $ 0» y el neto corto en todos los recargos
   * del mes. Esto las reconstruye desde las planillas del corte.
   *
   * NO ES DESTRUCTIVO, y por eso no pide confirmación como «Actualizar días»:
   *
   *   • Los recargos escritos A MANO (`es_automatico: false`) no se tocan.
   *   • Los bonos solo se siembran si la liquidación no tiene ninguno; lo
   *     tecleado en la matriz se queda donde está. Para pisarlos a propósito
   *     está «rehacer desde recorridos», que es otro botón.
   *   • Los días de la copia ni se miran.
   *
   * Al final recalcula y guarda los totales, para que la columna y la tabla
   * salgan de la misma pasada y no puedan volver a contradecirse.
   */
  static async repararRecargos(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const b = (request.body ?? {}) as Record<string, any>;
    const p = periodoDe(b);
    if (!p) return reply.status(400).send({ error: 'Periodo inválido (anio/mes).' });

    const actor = actorDe(request);
    if (!actor.id) return reply.status(401).send({ error: 'Sesión no válida.' });

    const liq = await prisma.liquidaciones.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, conductor_id: true, estado_flujo: true },
    });
    if (!liq) return reply.status(404).send({ error: 'Liquidación no encontrada.' });

    /// Igual que el resto del carril: una aprobada o pagada es un documento
    /// con decisiones encima, y aunque esto solo añada lo que faltaba, cambia
    /// el neto del comprobante. Que pase por una reversión de estado.
    if (ESTADOS_BLOQUEADOS.includes(liq.estado_flujo)) {
      return reply.status(409).send({
        error: `La liquidación está en ${liq.estado_flujo} y esto cambia su neto. Devuélvela a LIQUIDADA para repararla.`,
      });
    }

    try {
      const dto = await NominaCanvasService.construirPeriodo({
        anio: p.anio,
        mes: p.mes,
        corte: p.corte,
        conductorIds: [liq.conductor_id!],
      } as any);
      const hoja = dto.hojas.find((h) => h.conductorId === liq.conductor_id);
      if (!hoja) return reply.status(404).send({ error: 'El conductor no está en este periodo.' });

      const dias = dto.periodo.dias;
      const desde = dias[0]?.fecha ?? '';
      const hasta = dias[dias.length - 1]?.fecha ?? '';
      if (!desde || !hasta) return reply.status(400).send({ error: 'El periodo no tiene días.' });

      const r = await sembrarRecargosDesdePlanillas(
        liq.id,
        liq.conductor_id!,
        desde,
        hasta,
        Number(hoja.totales?.totalRecargos ?? 0),
      );
      const bonos = await sembrarBonificacionesDesdeRecorridos(
        liq.id,
        liq.conductor_id!,
        desde,
        hasta,
        actor.id,
      );

      /// Los totales, desde las filas que se acaban de escribir.
      await NominaPatchService.recalcularYGuardar(liq.id, actor.id);

      /// Cambia la geometría del desprendible (una línea de bono puede nacer),
      /// así que no hay patch de celda que lo describa: la sala entera relee.
      emitSheetInvalidate({
        scope: 'nomina',
        anio: p.anio,
        mes: p.mes,
        accion: 'bonos',
        by: actor.id,
      });

      return reply.send({ ...r, bonos });
    } catch (e: any) {
      return reply.status(400).send({ error: e?.message || 'No se pudieron rehacer los recargos.' });
    }
  }

  /**
   * Retira el BORRADOR de una hoja.
   *
   * SOLO BORRADOR. Una liquidación liquidada, aprobada, pagada o anulada es un
   * documento con decisiones tomadas encima —y a partir de PAGADA, con dinero
   * movido—; retirarla desde un botón del carril sería la acción más
   * destructiva de la pantalla y la más fácil de pulsar sin querer.
   *
   * El borrado en sí lo hace `LiquidacionesService.eliminar`, que MARCA la
   * liquidación y no toca ninguna de las siete tablas hijas: ahí vive la firma
   * del conductor sobre su desprendible, que es la prueba de que recibió su
   * pago. No se reimplementa aquí para que esa decisión siga viviendo en un
   * solo sitio.
   */
  static async eliminarBorrador(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const b = (request.body ?? {}) as Record<string, any>;
    const p = periodoDe(b);

    const actor = actorDe(request);
    if (!actor.id) return reply.status(401).send({ error: 'Sesión no válida.' });

    const liq = await prisma.liquidaciones.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, estado_flujo: true, conductor_id: true },
    });
    if (!liq) return reply.status(404).send({ error: 'Liquidación no encontrada.' });

    if (liq.estado_flujo !== 'BORRADOR') {
      return reply.status(409).send({
        error: `Está en ${liq.estado_flujo} y no se puede eliminar desde aquí. Devuélvela a BORRADOR primero, o anúlala si lo que quieres es dejarla sin efecto.`,
      });
    }

    try {
      await LiquidacionesService.eliminar(id);

      /// Desaparece una hoja del libro: eso es geometría, no una celda. La sala
      /// entera relee.
      if (p) {
        emitSheetInvalidate({
          scope: 'nomina',
          anio: p.anio,
          mes: p.mes,
          accion: 'borrador-eliminado',
          by: actor.id,
        });
      }
      return reply.send({ ok: true, conductor_id: liq.conductor_id });
    } catch (e: any) {
      return reply.status(400).send({ error: e?.message || 'No se pudo eliminar.' });
    }
  }

  static async estado(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    const job = borradorNominaQueueService.getStatus(jobId);
    if (!job) return reply.status(404).send({ error: 'Job no encontrado o expirado.' });
    return reply.send(job);
  }

  static async cancelar(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    const actor = actorDe(request);
    const ok = borradorNominaQueueService.cancel(jobId, actor.id);
    /// La promesa honesta: no aborta el conductor en curso ni deshace lo ya
    /// guardado. Esos borradores son válidos y se quedan.
    return reply.send({
      cancelado: ok,
      nota: ok ? 'Se detiene al terminar el conductor en curso.' : undefined,
    });
  }
}
