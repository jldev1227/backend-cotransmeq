import { FastifyReply, FastifyRequest } from "fastify";
import { generarPDFReporteServicios, RecargosService } from "./recargos.service";
import { RecargosImportarTransmeraldaService } from "./recargosImportarTransmeralda.service";
import { requireTransmeraldaConfigured } from "../../config/prismaTransmeralda";
import { z } from "zod";
import {
  createRecargoSchema,
  updateRecargoSchema,
  buscarRecargosSchema,
  liquidarRecargoSchema,
  cambiarEstadoMultipleSchema,
  previewImportarTransmeraldaSchema,
  importarTransmeraldaSchema,
} from "./recargos.schema";

interface RecargoParams {
  id: string;
}

export const RecargosController = {
  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createRecargoSchema.parse(request.body);
      const userId = (request as any).user?.id;

      const recargo = await RecargosService.create(data, userId);

      // Calcular el "Valor a Pagar" (suma de valor_calculado de
      // detalles_recargos_dias) para incluirlo en el payload del socket
      // Y en la respuesta HTTP. El frontend lo usa para pintar la columna
      // "Valor a Pagar" al instante (tanto en esta pestaña vía response
      // como en las demás vía socket) sin esperar al endpoint de preview.
      const valorPagar = await RecargosService.calcularValorAPagar(recargo.id);

      // Emitir evento socket para notificar recargo creado
      const io = (request.server as any).io;
      if (io) {
        io.emit("recargo-creado", {
          recargoId: recargo.id,
          recargo: recargo,
          valor_pagar: valorPagar,
        });
      }

      reply.status(201).send({
        success: true,
        message: "Recargo creado exitosamente",
        data: recargo,
        valor_pagar: valorPagar,
      });
    } catch (error) {
      console.error("❌ Error en crear recargo:", error);

      if (error instanceof z.ZodError) {
        console.error(
          "❌ Errores de validación Zod:",
          JSON.stringify(error.errors, null, 2),
        );
        return reply.status(400).send({
          success: false,
          message: "Error de validación",
          errors: error.errors,
        });
      }

      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async obtenerParaCanvas(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Log para debug
      console.log("Query params recibidos:", request.query);

      const query = buscarRecargosSchema.parse(request.query);

      // page y limit ya vienen transformados a number desde el schema
      // (con cap a 200 en limit). Si alguien los manda como string,
      // Number() los coerce sin tirar.
      const page = Number(query.page);
      const limit = Number(query.limit);

      const filters = {
        mes: query.mes,
        año: query.año,
        conductor_id: query.conductor_id,
        vehiculo_id: query.vehiculo_id,
        empresa_id: query.empresa_id,
        estado: query.estado,
        numero_planilla: query.numero_planilla,
        eliminados: query.eliminados,
        imported_from_transmeralda: query.imported_from_transmeralda,
      };

      console.log(filters, "FILTERS");

      const result = await RecargosService.list(page, limit, filters);

      reply.send({
        success: true,
        data: result.recargos,
        pagination: result.pagination,
        meta: result.meta,
      });
    } catch (error) {
      console.error("Error en obtenerParaCanvas:", error);
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: "Error de validación",
          errors: error.errors,
        });
      }
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  /**
   * Devuelve el siguiente número de planilla libre (TM-XXXX).
   * Endpoint ligero: solo consulta el campo numero_planilla, sin joins.
   * Se usa en ModalFormRecargo para auto-generar el número al abrir para
   * un recargo nuevo (no consume ancho de banda ni tarda 7+ segundos).
   */
  async obtenerSiguienteNumeroPlanilla(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const numero = await RecargosService.getNextNumeroPlanilla();
      reply.send({
        success: true,
        data: { numero_planilla: numero }
      });
    } catch (error) {
      console.error("Error en obtenerSiguienteNumeroPlanilla:", error);
      reply.status(500).send({
        success: false,
        message: "Error al generar el siguiente número de planilla",
      });
    }
  },

  async obtenerPorId(
    request: FastifyRequest<{ Params: RecargoParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const recargo = await RecargosService.findById(id);

      reply.send({
        success: true,
        data: recargo,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Recargo no encontrado") {
        return reply.status(404).send({
          success: false,
          message: "Recargo no encontrado",
        });
      }
      throw error;
    }
  },

  async actualizar(
    request: FastifyRequest<{ Params: RecargoParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const data = updateRecargoSchema.parse(request.body);
      const userId = (request as any).user?.id;

      const recargo = await RecargosService.update(id, data, userId);

      // Calcular el "Valor a Pagar" actualizado para incluirlo en el
      // payload del socket Y en la respuesta HTTP. Si solo cambiaron
      // datos escalares (no los días), el valor no cambia, pero igual
      // lo recalculamos por consistencia: el cliente no tiene que saber
      // qué cambió.
      const valorPagar = await RecargosService.calcularValorAPagar(recargo.id);

      // Emitir evento socket para notificar recargo actualizado
      const io = (request.server as any).io;
      if (io) {
        io.emit("recargo-actualizado", {
          recargoId: recargo.id,
          recargo: recargo,
          valor_pagar: valorPagar,
        });
      }

      reply.send({
        success: true,
        message: "Recargo actualizado exitosamente",
        data: recargo,
        valor_pagar: valorPagar,
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async eliminar(
    request: FastifyRequest<{ Params: RecargoParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const userId = (request as any).user?.id;

      const result = await RecargosService.softDelete(id, userId);

      // Emitir evento socket para notificar recargo eliminado
      const io = (request.server as any).io;
      if (io) {
        io.emit("recargo-eliminado", {
          recargoId: id,
        });
      }

      reply.send({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async eliminarMultiple(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { ids } = request.body as { ids: string[] };
      const userId = (request as any).user?.id;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          message: "Debe proporcionar un array de IDs válido",
        });
      }

      const result = await RecargosService.softDeleteMany(ids, userId);

      // Emitir evento socket para notificar recargos eliminados
      const io = (request.server as any).io;
      if (io) {
        io.emit("recargos-eliminados", {
          recargoIds: ids,
          cantidad: result.eliminados,
        });
      }

      reply.send({
        success: true,
        message: result.message,
        data: {
          eliminados: result.eliminados,
        },
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async restaurar(
    request: FastifyRequest<{ Params: RecargoParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const userId = (request as any).user?.id;

      const result = await RecargosService.restored(id, userId);

      const io = (request.server as any).io;
      if (io) {
        io.emit("recargo-restaurado", {
          recargoId: id,
        });
      }

      reply.send({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async restaurarMultiple(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { ids } = request.body as { ids: string[] };
      const userId = (request as any).user?.id;

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          message: "Debe proporcionar un array de IDs válido",
        });
      }

      const result = await RecargosService.restoredMany(ids, userId);

      const io = (request.server as any).io;
      if (io) {
        io.emit("recargos-restaurados", {
          recargoIds: ids,
          cantidad: result.restaurados, // ✅ era result.eliminados
        });
      }

      reply.send({
        success: true,
        message: result.message,
        data: {
          restaurados: result.restaurados, // ✅ era eliminados: result.eliminados
        },
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async liquidar(
    request: FastifyRequest<{ Params: RecargoParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const userId = (request as any).user?.id;

      const recargo = await RecargosService.liquidar(id, userId);

      reply.send({
        success: true,
        message: "Recargo liquidado exitosamente",
        data: recargo,
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async duplicar(
    request: FastifyRequest<{ Params: RecargoParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const userId = (request as any).user?.id;

      const recargo = await RecargosService.duplicar(id, userId);

      reply.status(201).send({
        success: true,
        message: "Recargo duplicado exitosamente",
        data: recargo,
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  /**
   * Recalcula un recargo existente con la config salarial y % de tipos
   * vigentes en cada día. NO modifica las horas de los días — solo
   * regenera los snapshots (porcentaje_aplicado, valor_hora_calculado,
   * valor_calculado, configuracion_salario_id, fecha_aplicacion).
   *
   * Casos de uso:
   * - Cambió el tarifario (ej: nuevo tarifario desde 15-jul) y se
   *   quieren aplicar a planillas ya existentes.
   * - Se creó/actualizó una config salarial retroactiva.
   */
  async recalcular(
    request: FastifyRequest<{ Params: RecargoParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const userId = (request as any).user?.id;

      const recargo = await RecargosService.recalcular(id, userId);

      // Recalcular el "Valor a Pagar" post-recalcular (puede haber
      // cambiado por la nueva config vigente).
      const valorPagar = await RecargosService.calcularValorAPagar(id);

      // Emitir evento socket para que cualquier cliente con el modal/preview
      // abierto para esta planilla recargue el preview y vea los nuevos
      // valores (config vigente por día) sin tener que recargar la página.
      // Patrón: igual que `recargo-creado` / `recargo-actualizado`.
      const io = (request.server as any).io;
      if (io) {
        io.emit("recargo-recalculado", {
          recargoId: recargo.planilla.id,
          conductorId: recargo.planilla.conductor_id,
          empresaId: recargo.planilla.empresa_id,
          mes: recargo.planilla.mes,
          año: recargo.planilla.a_o,
          recargo,
          valor_pagar: valorPagar,
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({
        success: true,
        message: "Recargo recalculado exitosamente con la config vigente",
        data: recargo,
        valor_pagar: valorPagar
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  /**
   * Lanza un recálculo bulk de N planillas. Retorna inmediatamente
   * con `{ batchId, total }` (uuid + cantidad) y procesa en
   * background, emitiendo:
   *
   *   - `recargos-bulk-recalc:progress` (al room `user-${userId}`)
   *     por cada planilla procesada: `{ batchId, processed, total,
   *     currentId, ok, valor_pagar, error?, elapsedMs }`.
   *
   *   - `recargos-bulk-recalc:done` (al mismo room) al terminar:
   *     `{ batchId, status, processed, total, okCount, errCount,
   *     results, timestamp }`.
   *
   * El cliente persiste el `batchId` en localStorage para poder
   * consultar `GET /recalcular-bulk/:batchId` y reanudar la UI
   * tras recargar la página.
   */
  async recalcularBulk(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    try {
      const { ids } = (request.body as any) || {};
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.status(401).send({ success: false, message: "No autenticado" });
      }
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          message: "Debe proporcionar un array `ids` con al menos un elemento"
        });
      }
      // Saneamiento básico: solo strings UUID-like.
      const cleanIds = ids
        .filter((x) => typeof x === "string" && x.length > 0)
        .slice(0, 500); // cap defensivo
      if (cleanIds.length === 0) {
        return reply.status(400).send({
          success: false,
          message: "Ninguno de los ids es válido"
        });
      }

      const result = await RecargosService.recalcularBulk(cleanIds, userId);

      reply.status(202).send({
        success: true,
        message: `Recálculo bulk iniciado para ${result.total} planilla(s)`,
        batchId: result.batchId,
        total: result.total
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({ success: false, message: error.message });
      } else {
        throw error;
      }
    }
  },

  /**
   * Devuelve el estado actual de un batch bulk. Lo usa el cliente
   * al recargar la página para reanudar la UI de progreso.
   *
   * Retorna 404 si el batch no existe o pertenece a otro usuario.
   */
  async getBatchStatus(
    request: FastifyRequest<{ Params: { batchId: string } }>,
    reply: FastifyReply
  ) {
    try {
      const { batchId } = request.params;
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.status(401).send({ success: false, message: "No autenticado" });
      }
      const status = RecargosService.getBatchStatus(batchId, userId);
      if (!status) {
        return reply.status(404).send({
          success: false,
          message: "Batch no encontrado o ya purgado (los batches completados se purgan a la 1h)"
        });
      }
      reply.send({ success: true, data: status });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({ success: false, message: error.message });
      } else {
        throw error;
      }
    }
  },

  async cambiarEstadoMultiple(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = cambiarEstadoMultipleSchema.parse(request.body);
      const userId = (request as any).user?.id;

      const result = await RecargosService.cambiarEstadoMultiple(
        data.ids,
        data.estado,
        userId,
      );

      // Emitir evento socket para notificar cambio de estado masivo
      const io = (request.server as any).io;
      if (io) {
        io.emit("recargos-estado-actualizado", {
          recargoIds: data.ids,
          estado: data.estado,
          cantidad: result.actualizados,
        });
      }

      reply.send({
        success: true,
        message: result.message,
        data: {
          actualizados: result.actualizados,
          estado: result.estado,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: "Error de validación",
          errors: error.errors,
        });
      }
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async obtenerTiposRecargo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const tipos = await RecargosService.getTiposRecargo();

      reply.send({
        success: true,
        data: tipos,
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async obtenerEstadisticas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = request.query as any;

      const filters = {
        mes: query.mes,
        año: query.año,
        empresa_id: query.empresa_id,
      };

      const estadisticas = await RecargosService.getEstadisticas(filters);

      reply.send({
        success: true,
        data: estadisticas,
      });
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message,
        });
      } else {
        throw error;
      }
    }
  },

  async reportePdf(
    request: FastifyRequest<{ Params: RecargoParams }>,
    reply: FastifyReply,
  ) {
    try {
      const query = request.query as { mes: string; anio: string };
      console.log(query, "QUERY")

      // 1. Obtener datos
      const recargos = await RecargosService.reporteServiciosporPlaca(query.mes, query.anio);

      // Normalizar tipos para generar PDF: dias_laborales_planillas[].dia debe ser string o Date
      const recargosForPdf = recargos.map((r: any) => ({
        ...r,
        dias_laborales_planillas: (r.dias_laborales_planillas || []).map((d: any) => ({
          dia: String(d.dia),
        })),
      }));

      // 2. Generar PDF en memoria
      const pdfBuffer = await generarPDFReporteServicios(
        recargosForPdf,
        query.mes,
        query.anio,
      );

      // 3. Enviar como descarga
      const nombreArchivo = `Reporte_Servicios_${query.mes}_${query.anio}.pdf`;

      reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${nombreArchivo}"`,
        )
        .header("Content-Length", pdfBuffer.length)
        .send(pdfBuffer);
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({ success: false, message: error.message });
      } else {
        throw error;
      }
    }
  },

  // ═══════════════════════════════════════════════════════════
  // IMPORTAR DESDE TRANSMERALDA
  //
  // Flujo:
  //   1. (Una vez) POST /sincronizar-conductores-cotransmeq
  //      → marca inactivos en TM a los conductores sin liq 2026.
  //   2. POST /importar-desde-transmeralda/preview { mes, año }
  //      → devuelve planillas de TM filtradas, marcando ya importadas.
  //   3. POST /importar-desde-transmeralda { source_ids: [...] }
  //      → importa las planillas seleccionadas a Cotransmeq.
  // ═══════════════════════════════════════════════════════════

  /**
   * Sincroniza en Transmeralda la marca de "conductor Cotransmeq":
   * pone `inactivo` a los conductores que NO tienen liquidaciones en 2026.
   * Idempotente.
   */
  async sincronizarConductoresCotransmeqTransmeralda(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      requireTransmeraldaConfigured();
      const resultado =
        await RecargosImportarTransmeraldaService.sincronizarConductoresCotransmeq();
      reply.send({ success: true, data: resultado });
    } catch (error: any) {
      const status = error?.statusCode || 400;
      if (error instanceof Error) {
        reply.status(status).send({ success: false, message: error.message });
      } else {
        throw error;
      }
    }
  },

  /**
   * Devuelve el preview de planillas de Transmeralda filtradas por mes/año,
   * marcando cuáles ya están importadas en Cotransmeq y cuáles no son
   * importables (conductor no existe en destino). Las placas y empresas
   * faltantes se marcan como "a crear" y se crean automáticamente al
   * importar.
   */
  async previewImportarTransmeralda(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      requireTransmeraldaConfigured();
      const { mes, año, incluir_no_importables } =
        previewImportarTransmeraldaSchema.parse(request.body ?? request.query);
      const preview =
        await RecargosImportarTransmeraldaService.obtenerPreview(
          mes,
          año,
          incluir_no_importables,
        );
      reply.send({ success: true, data: preview });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: "Error de validación",
          errors: error.errors,
        });
      }
      const status = error?.statusCode || 400;
      if (error instanceof Error) {
        reply.status(status).send({ success: false, message: error.message });
      } else {
        throw error;
      }
    }
  },

  /**
   * Crea en Cotransmeq las placas y empresas que faltan (las que el
   * preview marca como "a crear"). NO importa planillas — solo entidades.
   * Útil para pre-crear y luego re-abrir el preview con menos pendientes.
   */
  async crearEntidadesFaltantesTransmeralda(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      requireTransmeraldaConfigured();
      const { mes, año } = previewImportarTransmeraldaSchema.parse(
        request.body ?? request.query,
      );
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply
          .status(401)
          .send({ success: false, message: "No autenticado" });
      }
      const result =
        await RecargosImportarTransmeraldaService.crearEntidadesFaltantes(
          mes,
          año,
          userId,
        );
      reply.send({ success: true, data: result });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: "Error de validación",
          errors: error.errors,
        });
      }
      const status = error?.statusCode || 400;
      if (error instanceof Error) {
        reply.status(status).send({ success: false, message: error.message });
      } else {
        throw error;
      }
    }
  },

  /**
   * Importa las planillas de Transmeralda seleccionadas (por source_id).
   * Por cada una:
   *   - Resuelve conductor/vehículo/empresa en Cotransmeq
   *   - Crea recargos_planilla + dias_laborales_planillas
   *   - Llama a `recalcular` para regenerar detalles con la config de CM
   *   - Devuelve cuántas se importaron / omitieron / fallaron
   */
  async importarDesdeTransmeralda(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      requireTransmeraldaConfigured();
      const { source_ids } = importarTransmeraldaSchema.parse(request.body);
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply
          .status(401)
          .send({ success: false, message: "No autenticado" });
      }
      const resultado =
        await RecargosImportarTransmeraldaService.importarPlanillas(
          source_ids,
          userId,
        );

      // Notificar a clientes conectados para que refresquen el canvas
      const io = (request.server as any).io;
      if (io) {
        io.emit("recargos-importados-transmeralda", {
          importadas: resultado.importadas,
          omitidas: resultado.omitidas,
          errores: resultado.errores
        });
      }

      // Si la importación creó planillas, el service devuelve el
      // `recalculoBatchId` del job bulk que está corriendo en background
      // y emitirá `recargos-bulk-recalc:progress` / `:done` al room del
      // usuario. El frontend usa este id para mostrar el progreso.
      reply.send({
        success: true,
        message: `Importación completada: ${resultado.importadas} importadas, ${resultado.omitidas} omitidas, ${resultado.errores} con error`,
        recalculoBatchId: resultado.recalculoBatchId,
        data: resultado,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: "Error de validación",
          errors: error.errors,
        });
      }
      const status = error?.statusCode || 400;
      if (error instanceof Error) {
        reply.status(status).send({ success: false, message: error.message });
      } else {
        throw error;
      }
    }
  },
};
