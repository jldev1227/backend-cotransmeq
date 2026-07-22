import { FastifyRequest, FastifyReply } from "fastify";
import {
  AccionesCorrectivasService,
  CreateAccionCorrectivaInput,
  UpdateAccionCorrectivaInput,
  FiltrosAccionesCorrectivas,
  CreateSeguimientoCausaInput,
} from "./acciones-correctivas.service";
import { PDFGeneratorAccionesService } from "./pdf-generator-acciones.service";
import {
  IAsugerenciasService,
  SolicitudSugerenciaIA,
} from "./ia-sugerencias.service";

const service = new AccionesCorrectivasService();
const iaService = new IAsugerenciasService();

export class AccionesCorrectivasController {
  // POST /api/acciones-correctivas - Crear nueva acción
  static async crear(
    request: FastifyRequest<{ Body: CreateAccionCorrectivaInput }>,
    reply: FastifyReply,
  ) {
    try {
      // Obtener usuario autenticado
      const userId = (request as any).user?.id;

      const accion = await service.crear({
        ...request.body,
        creado_por_id: userId,
      });

      return reply.code(201).send({
        success: true,
        message: "Acción correctiva/preventiva creada exitosamente",
        data: accion,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al crear la acción",
      });
    }
  }

  // GET /api/acciones-correctivas/:id/causas/:causaId/seguimientos - Listar seguimientos
  static async listarSeguimientosCausa(
    request: FastifyRequest<{ Params: { id: string; causaId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const seguimientos = await service.listarSeguimientosCausa(
        request.params.id,
        request.params.causaId,
      );

      return reply.code(200).send({
        success: true,
        data: seguimientos,
      });
    } catch (error: any) {
      const statusCode = error.message.includes("no encontrada") ? 404 : 400;
      return reply.code(statusCode).send({
        success: false,
        message: error.message || "Error al listar seguimientos",
      });
    }
  }

  // POST /api/acciones-correctivas/:id/causas/:causaId/seguimientos - Crear seguimiento
  static async crearSeguimientoCausa(
    request: FastifyRequest<{
      Params: { id: string; causaId: string };
      Body: CreateSeguimientoCausaInput;
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = (request as any).user?.id;

      const seguimiento = await service.crearSeguimientoCausa(
        request.params.id,
        request.params.causaId,
        request.body,
        userId,
      );

      return reply.code(201).send({
        success: true,
        message: "Seguimiento creado exitosamente",
        data: seguimiento,
      });
    } catch (error: any) {
      const statusCode = error.message.includes("no encontrada") ? 404 : 400;
      return reply.code(statusCode).send({
        success: false,
        message: error.message || "Error al crear seguimiento",
      });
    }
  }


  // POST /api/acciones-correctivas/:id/duplicar
  static async duplicar(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = (request as any).user?.id;
      const accion = await service.duplicar(request.params.id, userId);

      return reply.code(201).send({
        success: true,
        message: "Acción duplicada exitosamente",
        data: accion,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al duplicar la acción",
      });
    }
  }

  
  // POST /api/acciones-correctivas/upload
  static async uploadAdjunto(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: "No se envió ningún archivo" });
      }

      const buffer = await data.toBuffer();
      const ext = data.filename.split('.').pop()?.toLowerCase() || 'bin';
      const uuid = require('crypto').randomUUID();
      const key = `acciones-correctivas/adjuntos/${uuid}.${ext}`;

      const { uploadToS3, getS3SignedUrl } = require('../../config/aws');
      await uploadToS3(key, buffer, data.mimetype);
      const signedUrl = await getS3SignedUrl(key, 3600 * 24 * 7); // 7 days

      return reply.code(200).send({
        success: true,
        data: {
          key,
          url: signedUrl,
          filename: data.filename,
          mimetype: data.mimetype
        },
      });
    } catch (error: any) {
      console.error("Error en uploadAdjunto:", error);
      return reply.code(500).send({
        success: false,
        message: error.message || "Error al subir el archivo",
      });
    }
  }

  // GET /api/acciones-correctivas - Listar acciones con filtros
  static async listar(
    request: FastifyRequest<{ Querystring: FiltrosAccionesCorrectivas }>,
    reply: FastifyReply,
  ) {
    try {
      const resultado = await service.listar(request.query);

      return reply.code(200).send({
        success: true,
        data: resultado,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message || "Error al listar acciones",
      });
    }
  }

  // GET /api/acciones-correctivas/:id - Obtener acción por ID
  static async obtenerPorId(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const accion = await service.obtenerPorId(request.params.id);

      return reply.code(200).send({
        success: true,
        data: accion,
      });
    } catch (error: any) {
      return reply.code(404).send({
        success: false,
        message: error.message || "Acción no encontrada",
      });
    }
  }

  // GET /api/acciones-correctivas/numero/:accion_numero - Obtener por número
  static async obtenerPorNumero(
    request: FastifyRequest<{ Params: { accion_numero: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const accion = await service.obtenerPorNumero(
        request.params.accion_numero,
      );

      return reply.code(200).send({
        success: true,
        data: accion,
      });
    } catch (error: any) {
      return reply.code(404).send({
        success: false,
        message: error.message || "Acción no encontrada",
      });
    }
  }

  // PUT /api/acciones-correctivas/:id - Actualizar acción
  static async actualizar(
    request: FastifyRequest<{
      Params: { id: string };
      Body: UpdateAccionCorrectivaInput;
    }>,
    reply: FastifyReply,
  ) {
    try {
      const accion = await service.actualizar(request.params.id, request.body);

      return reply.code(200).send({
        success: true,
        message: "Acción actualizada exitosamente",
        data: accion,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al actualizar la acción",
      });
    }
  }

  // DELETE /api/acciones-correctivas/:id - Eliminar acción (soft delete)
  static async eliminar(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await service.eliminar(request.params.id);

      return reply.code(200).send({
        success: true,
        message: "Acción movida a la papelera",
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al eliminar la acción",
      });
    }
  }

  // POST /api/acciones-correctivas/:id/restaurar - Restaurar acción eliminada
  static async restaurar(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const accion = await service.restaurar(request.params.id);

      return reply.code(200).send({
        success: true,
        message: "Acción restaurada exitosamente",
        data: accion,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al restaurar la acción",
      });
    }
  }

  // DELETE /api/acciones-correctivas/:id/permanente - Eliminar permanentemente
  static async eliminarPermanente(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await service.eliminarPermanente(request.params.id);

      return reply.code(200).send({
        success: true,
        message: "Acción eliminada permanentemente",
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al eliminar permanentemente",
      });
    }
  }

  // POST /api/acciones-correctivas/:id/causas - Crear nueva causa
  static async crearCausa(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        orden: number;
        analisis_causa: string;
        descripcion_plan_accion?: string;
        responsable_ejecucion?: string;
        fecha_limite_implementacion?: string;
        estado_seguimiento?: "En Proceso" | "Cumplida" | "Vencida";
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const causa = await service.crearCausa(request.params.id, request.body);

      return reply.code(201).send({
        success: true,
        message: "Causa creada exitosamente",
        data: causa,
      });
    } catch (error: any) {
      const statusCode = error.message.includes("no encontrada") ? 404 : 400;
      return reply.code(statusCode).send({
        success: false,
        message: error.message || "Error al crear la causa",
      });
    }
  }

  // PUT /api/acciones-correctivas/:id/causas/:causaId - Actualizar causa individual
  static async actualizarCausa(
    request: FastifyRequest<{
      Params: { id: string; causaId: string };
      Body: {
        analisis_causa?: string;
        descripcion_plan_accion?: string;
        responsable_ejecucion?: string;
        fecha_limite_implementacion?: string;
        estado_seguimiento?: "En Proceso" | "Cumplida" | "Vencida";
        descripcion_observaciones?: string;
        fecha_seguimiento?: string;
        fecha_evaluacion_eficacia?: string;
        criterio_evaluacion_eficacia?: string;
        analisis_evidencias_cierre?: string;
        evaluacion_cierre_eficaz?: "EFICAZ" | "NO EFICAZ";
        soporte_cierre_eficaz?: string;
        fecha_cierre?: string;
        responsable_cierre?: string;
        sugerencia_ia?: any;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const causa = await service.actualizarCausa(
        request.params.id,
        request.params.causaId,
        request.body,
      );

      return reply.code(200).send({
        success: true,
        message: "Causa actualizada exitosamente",
        data: causa,
      });
    } catch (error: any) {
      const statusCode = error.message.includes("no encontrada") ? 404 : 400;
      return reply.code(statusCode).send({
        success: false,
        message: error.message || "Error al actualizar la causa",
      });
    }
  }

  // GET /api/acciones-correctivas/estadisticas - Obtener estadísticas
  static async obtenerEstadisticas(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const estadisticas = await service.obtenerEstadisticas();

      return reply.code(200).send({
        success: true,
        data: estadisticas,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message || "Error al obtener estadísticas",
      });
    }
  }

  // GET /api/acciones-correctivas/:id/exportar-pdf - Exportar PDF individual
  static async exportarPDF(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const accion = await service.obtenerPorId(request.params.id);
      if (!accion) {
        return reply
          .code(404)
          .send({ success: false, message: "Acción no encontrada" });
      }

      const pdfData = {
        ...accion,
        evaluaciones_eficacia: (accion as any).evaluaciones_eficacia || undefined,
      };
      const pdfBuffer = await PDFGeneratorAccionesService.generarPDFAccion(pdfData);

      const filename = `accion-correctiva-${String(accion.accion_numero).padStart(3, "0")}.pdf`;

      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Length", pdfBuffer.length)
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(pdfBuffer);
    } catch (error: any) {
      console.error("exportarPDF error:", error);
      return reply.code(500).send({
        success: false,
        message: error.message || "Error al generar PDF",
      });
    }
  }

  // POST /api/acciones-correctivas/sugerencias-ia - Obtener sugerencias de IA
  static async obtenerSugerenciasIA(
    request: FastifyRequest<{ Body: SolicitudSugerenciaIA }>,
    reply: FastifyReply,
  ) {
    try {
      const sugerencias = await iaService.generarSugerenciasPlanAccion(
        request.body,
      );

      return reply.code(200).send({
        success: true,
        message: "Sugerencias generadas exitosamente",
        data: sugerencias,
      });
    } catch (error: any) {
      console.error("Error al generar sugerencias de IA:", error);
      return reply.code(500).send({
        success: false,
        message: error.message || "Error al generar sugerencias con IA",
      });
    }
  }

  // POST /api/acciones-correctivas/causas/:causa_id/cierre - Cerrar una causa específica
  static async cerrarCausa(
    request: FastifyRequest<{
      Params: { causa_id: string };
      Body: {
        fecha_evaluacion_eficacia: string;
        criterio_evaluacion_eficacia: string;
        analisis_evidencias_cierre: string;
        evaluacion_cierre_eficaz: "EFICAZ" | "NO EFICAZ";
        soporte_cierre_eficaz?: string;
        responsable_cierre: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const causaCerrada = await service.cerrarCausa(
        request.params.causa_id,
        request.body,
      );

      return reply.code(200).send({
        success: true,
        message: "Causa cerrada exitosamente",
        data: causaCerrada,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al cerrar la causa",
      });
    }
  }

  // GET /api/acciones-correctivas/:id/validar-cierre - Validar si todas las causas están cerradas
  static async validarCierreCompleto(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const validacion = await service.validarCierreCompleto(request.params.id);

      return reply.code(200).send({
        success: true,
        data: validacion,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message || "Error al validar cierre",
      });
    }
  }

  // POST /api/acciones-correctivas/causas/:causa_id/sugerencias-seguimiento - Sugerencias de seguimiento
  static async obtenerSugerenciasSeguimiento(
    request: FastifyRequest<{
      Params: { causa_id: string };
      Body: {
        plan_accion: string;
        estado_actual: string;
        observaciones?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const sugerencias = await iaService.generarSugerenciasSeguimiento(
        request.params.causa_id,
        request.body.plan_accion,
        request.body.estado_actual,
        request.body.observaciones,
      );

      return reply.code(200).send({
        success: true,
        message: "Sugerencias de seguimiento generadas",
        data: sugerencias,
      });
    } catch (error: any) {
      console.error("Error al generar sugerencias de seguimiento:", error);
      return reply.code(500).send({
        success: false,
        message: error.message || "Error al generar sugerencias de seguimiento",
      });
    }
  }

  // ============================================
  // STEP 4 - APROBACIÓN
  // ============================================
  //
  // El usuario identificado por el JWT aprueba/rechaza directamente.
  // El backend valida que su cargo corresponda al rol esperado para
  // el tipo de hallazgo de la acción. NO se inicializa nada previamente.
  //

  // GET /api/acciones-correctivas/:id/aprobaciones
  static async obtenerAprobaciones(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const data = await service.obtenerAprobaciones(request.params.id)
      return reply.code(200).send({ success: true, data })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al obtener aprobaciones",
      })
    }
  }

  // POST /api/acciones-correctivas/:id/aprobaciones/aprobar
  static async aprobar(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { comentario?: string }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = (request as any).user?.id
      if (!userId) {
        return reply.code(401).send({ success: false, message: "No autenticado" })
      }
      const aprobacion = await service.aprobar(
        request.params.id,
        userId,
        request.body?.comentario,
      )
      return reply.code(200).send({
        success: true,
        message: "Aprobación registrada",
        data: aprobacion,
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al aprobar",
      })
    }
  }

  // POST /api/acciones-correctivas/:id/aprobaciones/rechazar
  static async rechazar(
    request: FastifyRequest<{
      Params: { id: string }
      Body: { comentario: string }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const userId = (request as any).user?.id
      if (!userId) {
        return reply.code(401).send({ success: false, message: "No autenticado" })
      }
      const rechazo = await service.rechazar(
        request.params.id,
        userId,
        request.body.comentario,
      )
      return reply.code(200).send({
        success: true,
        message: "Rechazo registrado",
        data: rechazo,
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al rechazar",
      })
    }
  }

  // POST /api/acciones-correctivas/:id/aprobaciones/reset (admin)
  static async resetAprobacion(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await service.resetAprobacion(request.params.id)
      return reply.code(200).send({
        success: true,
        message: "Aprobación reseteada",
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al resetear aprobación",
      })
    }
  }

  // ============================================
  // STEP 5 - ESTADO GLOBAL
  // ============================================

  // POST /api/acciones-correctivas/:id/calcular-estado
  static async calcularEstadoGlobal(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const resultado = await service.calcularEstadoGlobal(request.params.id)
      return reply.code(200).send({
        success: true,
        message: "Estado global calculado",
        data: resultado,
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al calcular estado global",
      })
    }
  }

  // POST /api/acciones-correctivas/:id/estado-global
  static async actualizarEstadoGlobal(
    request: FastifyRequest<{
      Params: { id: string }
      Body: {
        estado_global: string
        registrado_por_id?: string
        observaciones?: string
      }
    }>,
    reply: FastifyReply,
  ) {
    try {
      const accion = await service.actualizarEstadoGlobal(
        request.params.id,
        request.body,
      )
      return reply.code(200).send({
        success: true,
        message: "Estado global actualizado",
        data: accion,
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || "Error al actualizar estado global",
      })
    }
  }
}
