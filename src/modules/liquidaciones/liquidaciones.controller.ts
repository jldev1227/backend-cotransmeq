// @ts-nocheck
import { FastifyRequest, FastifyReply } from "fastify";
import { LiquidacionesService } from "./liquidaciones.service";
import { getS3ObjectAsBase64 } from "../../config/aws";
import { getIO } from '../../sockets'
import { prisma } from '../../config/prisma'

interface ObtenerTodasQuery {
  page?: string;
  limit?: string;
  search?: string;
  conductor_id?: string;
  estado?: string;
  sortBy?: string;
  sortOrder?: string;
  nomina_month?: string;
}

interface LiquidacionParams {
  id: string;
}

export const LiquidacionesController = {
  // GET /liquidaciones
  async obtenerTodas(
    request: FastifyRequest<{ Querystring: ObtenerTodasQuery }>,
    reply: FastifyReply,
  ) {
    try {
      const {
        page,
        limit,
        search,
        conductor_id,
        estado,
        sortBy,
        sortOrder,
        nomina_month,
      } = request.query;

      const filters: any = {};

      if (search) filters.search = search;
      if (conductor_id) filters.conductor_id = conductor_id;
      if (estado) filters.estado = estado;
      if (page) filters.page = parseInt(page);
      if (limit) filters.limit = parseInt(limit);
      if (sortBy) filters.sortBy = sortBy;
      if (sortOrder) filters.sortOrder = sortOrder;
      if (nomina_month) filters.nomina_month = nomina_month;

      const result = await LiquidacionesService.obtenerTodas(filters);

      return reply.status(200).send({
        success: true,
        data: result.liquidaciones,
        pagination: result.pagination,
        stats: result.stats,
      });
    } catch (error: any) {
      console.error("Error al obtener liquidaciones:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al obtener liquidaciones",
        error: error.message,
      });
    }
  },

  // GET /liquidaciones/:id
  async obtenerPorId(
    request: FastifyRequest<{ Params: LiquidacionParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const liquidacion = await LiquidacionesService.obtenerPorId(id);

      // Enriquecer firmas con base64 desde S3 (solo para admin, evita CORS en el frontend)
      if (liquidacion.firmas_desprendibles?.length) {
        const firmasConBase64 = await Promise.all(
          liquidacion.firmas_desprendibles.map(async (firma: any) => {
            if (firma.firma_s3_key) {
              try {
                const firmaBase64 = await getS3ObjectAsBase64(
                  firma.firma_s3_key,
                );
                return { ...firma, presignedUrl: firmaBase64 };
              } catch (error) {
                console.error(
                  "Error descargando firma de S3:",
                  firma.id,
                  error,
                );
                return firma;
              }
            }
            return firma;
          }),
        );
        liquidacion.firmas_desprendibles = firmasConBase64;
      }

      // Fallback: si no hay firma de desprendible, intentar firma de prima
      // del mismo conductor del mismo mes/año (±1 mes del periodo_fin)
      const tieneFirmaValida =
        liquidacion.firmas_desprendibles?.some(
          (f: any) => f.presignedUrl && f.firma_url !== 'pending' && f.firma_url !== '',
        ) ?? false
      if (!tieneFirmaValida && liquidacion.conductor_id && liquidacion.periodo_fin) {
        try {
          const fechaFin = new Date(
            liquidacion.periodo_fin +
              (liquidacion.periodo_fin.length === 10 ? 'T00:00:00' : ''),
          )
          if (!isNaN(fechaFin.getTime())) {
            const candidatos: Array<{ anio: number; mes: number }> = []
            for (let offset = -1; offset <= 1; offset++) {
              const d = new Date(fechaFin.getFullYear(), fechaFin.getMonth() + offset, 1)
              candidatos.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 })
            }
            const firmasPrimas = await prisma.firmas_primas.findMany({
              where: {
                conductor_id: liquidacion.conductor_id,
                firma_url: { not: '' },
                NOT: { firma_url: 'pending' },
              },
              orderBy: { fecha_firma: 'desc' },
            })
            // Traer primas por separado (evita dependencia de la relación en el cliente Prisma)
            const primaIds = Array.from(new Set(firmasPrimas.map((f) => f.prima_id)))
            const primasRelacionadas = primaIds.length
              ? await prisma.primas.findMany({
                  where: { id: { in: primaIds } },
                  select: { id: true, anio: true, mes: true },
                })
              : []
            const primaMap = new Map(primasRelacionadas.map((p) => [p.id, p]))
            for (const fp of firmasPrimas) {
              const primaRel = primaMap.get(fp.prima_id)
              if (!primaRel) continue
              const match = candidatos.some(
                (c) => c.anio === primaRel.anio && c.mes === primaRel.mes,
              )
              if (!match) continue
              try {
                const firmaBase64 = await getS3ObjectAsBase64(fp.firma_s3_key)
                liquidacion.firmas_desprendibles = [
                  {
                    id: fp.id,
                    liquidacion_id: id,
                    conductor_id: fp.conductor_id,
                    firma_url: fp.firma_url,
                    firma_s3_key: fp.firma_s3_key,
                    fecha_firma: fp.fecha_firma,
                    estado: fp.estado,
                    presignedUrl: firmaBase64,
                    // Marca virtual para que el frontend distinga el origen
                    origen_fallback: 'prima',
                    prima_origen_id: fp.prima_id,
                  } as any,
                ]
                break
              } catch (e) {
                console.error('Error descargando firma de prima (fallback):', fp.id, e)
              }
            }
          }
        } catch (e) {
          console.error('Error en fallback firma de prima:', e)
        }
      }

      return reply.status(200).send({
        success: true,
        data: liquidacion,
      });
    } catch (error: any) {
      console.error("Error al obtener liquidación:", error);

      if (error.message === "Liquidación no encontrada") {
        return reply.status(404).send({
          success: false,
          message: "Liquidación no encontrada",
        });
      }

      return reply.status(500).send({
        success: false,
        message: "Error al obtener la liquidación",
        error: error.message,
      });
    }
  },

  // GET /liquidaciones/analisis
  async obtenerAnalisis(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { page, limit, noLimit } = request.query;

      const liquidaciones = await LiquidacionesService.obtenerTodas({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        noLimit: noLimit === "true",
      });
      
      return reply.status(200).send({
        success: true,
        data: liquidaciones,
      });
    } catch (error) {
      console.error("Error al obtener liquidación:", error);

      if (error.message === "Liquidaciones no encontradas") {
        return reply.status(404).send({
          success: false,
          message: "Liquidaciones no encontradas",
        });
      }

      return reply.status(500).send({
        success: false,
        message: "Error al obtener analisis de liquidaciones",
        error: error.message,
      });
    }
  },

  // POST /liquidaciones
  async crear(request: FastifyRequest<{ Body: any }>, reply: FastifyReply) {
    try {
      const data = request.body;
      const userId = (request as any).user?.id;

      if (!data.conductor_id) {
        return reply.status(400).send({
          success: false,
          message: "El conductor es requerido",
        });
      }

      if (!data.periodo_inicio || !data.periodo_fin) {
        return reply.status(400).send({
          success: false,
          message: "Las fechas del período son requeridas",
        });
      }

      const liquidacion = await LiquidacionesService.crear(data, userId);

      return reply.status(201).send({
        success: true,
        data: liquidacion,
        message: "Liquidación creada correctamente",
      });
    } catch (error: any) {
      console.error("Error al crear liquidación:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al crear la liquidación",
        error: error.message,
      });
    }
  },

  // PUT /liquidaciones/:id
  async actualizar(
    request: FastifyRequest<{ Params: LiquidacionParams; Body: any }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const data = request.body;
      const userId = (request as any).user?.id;

      const liquidacion = await LiquidacionesService.actualizar(
        id,
        data,
        userId,
      );

      return reply.status(200).send({
        success: true,
        data: liquidacion,
        message: "Liquidación actualizada correctamente",
      });
    } catch (error: any) {
      console.error("Error al actualizar liquidación:", error);

      if (error.message === "Liquidación no encontrada") {
        return reply.status(404).send({
          success: false,
          message: "Liquidación no encontrada",
        });
      }

      return reply.status(500).send({
        success: false,
        message: "Error al actualizar la liquidación",
        error: error.message,
      });
    }
  },

  // DELETE /liquidaciones/:id
  async eliminar(
    request: FastifyRequest<{ Params: LiquidacionParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const result = await LiquidacionesService.eliminar(id);

      return reply.status(200).send(result);
    } catch (error: any) {
      console.error("Error al eliminar liquidación:", error);

      if (error.message === "Liquidación no encontrada") {
        return reply.status(404).send({
          success: false,
          message: "Liquidación no encontrada",
        });
      }

      return reply.status(500).send({
        success: false,
        message: "Error al eliminar la liquidación",
        error: error.message,
      });
    }
  },

  // POST /liquidaciones/:id/recargos/:recargoId/revertir-override
  // Revierte un override manual: borra el recargo manual que sobrescribe un
  // automático y reactiva el automático original. Devuelve la liquidación
  // actualizada.
  async revertirOverrideRecargo(
    request: FastifyRequest<{
      Params: { id: string; recargoId: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { id, recargoId } = request.params;
      const userId = (request as any).user?.id;

      const liquidacion = await LiquidacionesService.revertirOverrideRecargo(
        id,
        recargoId,
        userId,
      );

      return reply.status(200).send({
        success: true,
        data: liquidacion,
        message: "Override revertido correctamente",
      });
    } catch (error: any) {
      console.error("Error al revertir override de recargo:", error);

      if (error.message?.includes("no encontrado")) {
        return reply.status(404).send({
          success: false,
          message: error.message,
        });
      }

      if (error.message?.includes("no es un override")) {
        return reply.status(400).send({
          success: false,
          message: error.message,
        });
      }

      return reply.status(500).send({
        success: false,
        message: "Error al revertir el override",
        error: error.message,
      });
    }
  },

  // GET /configuraciones-liquidacion
  async obtenerConfiguraciones(
    request: FastifyRequest<{
      Querystring: { anio?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const anio = request.query.anio
        ? parseInt(request.query.anio)
        : undefined;
      const configuraciones =
        await LiquidacionesService.obtenerConfiguraciones(anio);

      return reply.status(200).send({
        success: true,
        data: configuraciones,
      });
    } catch (error: any) {
      console.error("Error al obtener configuraciones:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al obtener configuraciones",
        error: error.message,
      });
    }
  },

  // GET /configuraciones-liquidacion/activas
  // Devuelve solo las configuraciones activas del año (por defecto
  // el año actual). Pensada para el flujo de bonos de planilla: el
  // frontend pinta una columna de checkbox por cada config activa.
  async obtenerConfiguracionesActivas(
    request: FastifyRequest<{ Querystring: { anio?: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const anio = request.query.anio
        ? parseInt(request.query.anio)
        : new Date().getFullYear();
      const data = await LiquidacionesService.obtenerConfiguraciones(anio);
      return reply.status(200).send({ success: true, data });
    } catch (error: any) {
      console.error("Error al obtener configuraciones activas:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al obtener configuraciones activas",
        error: error.message,
      });
    }
  },

  // GET /configuraciones-liquidacion/anios
  async obtenerAniosConfiguraciones(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const anios = await LiquidacionesService.obtenerAniosConfiguraciones();

      return reply.status(200).send({
        success: true,
        data: anios,
      });
    } catch (error: any) {
      console.error("Error al obtener años de configuraciones:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al obtener años de configuraciones",
        error: error.message,
      });
    }
  },

  // PUT /configuraciones-liquidacion/:id
  async actualizarConfiguracion(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { nombre?: string; valor?: number; tipo?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const data = request.body as {
        nombre?: string;
        valor?: number;
        tipo?: string;
      };
      const updated = await LiquidacionesService.actualizarConfiguracion(
        id,
        data,
      );

      return reply.status(200).send({
        success: true,
        data: updated,
      });
    } catch (error: any) {
      console.error("Error al actualizar configuración:", error);
      if (error.message === "Configuración no encontrada") {
        return reply
          .status(404)
          .send({ success: false, message: error.message });
      }
      return reply.status(500).send({
        success: false,
        message: "Error al actualizar configuración",
        error: error.message,
      });
    }
  },

  // POST /configuraciones-liquidacion
  async crearConfiguracion(
    request: FastifyRequest<{
      Body: { nombre: string; valor: number; tipo: string; anio: number };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const data = request.body as {
        nombre: string;
        valor: number;
        tipo: string;
        anio: number;
      };
      if (
        !data.nombre ||
        data.valor === undefined ||
        !data.tipo ||
        !data.anio
      ) {
        return reply.status(400).send({
          success: false,
          message: "Se requiere nombre, valor, tipo y anio",
        });
      }
      const created = await LiquidacionesService.crearConfiguracion(data);

      return reply.status(201).send({
        success: true,
        data: created,
      });
    } catch (error: any) {
      console.error("Error al crear configuración:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al crear configuración",
        error: error.message,
      });
    }
  },

  // POST /configuraciones-liquidacion/duplicar
  async duplicarConfiguraciones(
    request: FastifyRequest<{
      Body: { anio_origen: number; anio_destino: number };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { anio_origen, anio_destino } = request.body as {
        anio_origen: number;
        anio_destino: number;
      };
      if (!anio_origen || !anio_destino) {
        return reply.status(400).send({
          success: false,
          message: "Se requiere anio_origen y anio_destino",
        });
      }
      const nuevas = await LiquidacionesService.duplicarConfiguracionesAnio(
        anio_origen,
        anio_destino,
      );

      return reply.status(201).send({
        success: true,
        data: nuevas,
        message: `Se duplicaron ${nuevas.length} configuraciones del año ${anio_origen} al año ${anio_destino}`,
      });
    } catch (error: any) {
      console.error("Error al duplicar configuraciones:", error);
      return reply.status(400).send({
        success: false,
        message: error.message,
      });
    }
  },

  // DELETE /configuraciones-liquidacion/:id
  async eliminarConfiguracion(
    request: FastifyRequest<{
      Params: { id: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const result = await LiquidacionesService.eliminarConfiguracion(id);

      return reply.status(200).send(result);
    } catch (error: any) {
      console.error("Error al eliminar configuración:", error);
      if (error.message === "Configuración no encontrada") {
        return reply
          .status(404)
          .send({ success: false, message: error.message });
      }
      return reply.status(500).send({
        success: false,
        message: "Error al eliminar configuración",
        error: error.message,
      });
    }
  },

  // GET /empresas
  async obtenerEmpresas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const empresas = await LiquidacionesService.obtenerEmpresas();

      return reply.status(200).send({
        success: true,
        data: empresas,
      });
    } catch (error: any) {
      console.error("Error al obtener empresas:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al obtener empresas",
        error: error.message,
      });
    }
  },

  // GET /liquidaciones/preview-recargos
  // GET /liquidaciones/preview-recargos
  async previewRecargos(
    request: FastifyRequest<{
      Querystring: {
        conductor_id: string;
        periodo_inicio: string;
        periodo_fin: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { conductor_id, periodo_inicio, periodo_fin } = request.query;

      if (!conductor_id || !periodo_inicio || !periodo_fin) {
        return reply.status(400).send({
          success: false,
          message: "Se requiere conductor_id, periodo_inicio y periodo_fin",
        });
      }

      const preview = await LiquidacionesService.previewRecargos(
        conductor_id,
        periodo_inicio,
        periodo_fin,
      );

      return reply.status(200).send({
        success: true,
        data: preview,
      });
    } catch (error: any) {
      console.error("Error al obtener preview de recargos:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al obtener preview de recargos",
        error: error.message,
      });
    }
    },

    // GET /api/liquidaciones/:id/pdf-desprendible - Descargar un desprendible individual en PDF
    async downloadSinglePayslipPdf(
    request: FastifyRequest<{ Params: LiquidacionParams }>,
    reply: FastifyReply,
    ) {
    try {
    const { id } = request.params;
    const { buffer, fileName } = await LiquidacionesService.generatePayslipPdfBuffer(id);

    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
    return reply.send(buffer);
    } catch (error: any) {
    console.error("Error al descargar desprendible PDF:", error);
    return reply.status(500).send({
    success: false,
    message: "Error al descargar desprendible PDF",
    error: error.message,
    });
    }
    },

    // POST /liquidaciones/generate-payslips-zip
    async generatePayslipsZip(
    request: FastifyRequest<{ Body: { liquidationIds: string[], socketId?: string } }>,
    reply: FastifyReply,
  ) {
    if (request.method !== 'POST') {
      return reply.status(405).send({
        success: false,
        message: 'Method Not Allowed. Please use POST.',
      });
    }
    try {
      const { liquidationIds, socketId } = request.body as { liquidationIds: string[], socketId?: string };

      	if (!liquidationIds || !Array.isArray(liquidationIds) || liquidationIds.length === 0) {
      		return reply.status(400).send({
      			success: false,
      			message: "Se requiere una lista de IDs de liquidación para generar el ZIP.",
      		});
      }

      const zipBuffer = await LiquidacionesService.generatePayslipsZip(liquidationIds, socketId); // Pass socketId to service

      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", "attachment; filename=\"payslips.zip\"");
      return reply.send(zipBuffer);
    } catch (error: any) {
      console.error("Error al generar ZIP de desprendibles:", error);
      if (socketId) {
        getIO().to(socketId).emit('progress:error', { message: error.message });
      }
      return reply.status(500).send({
        success: false,
        message: "Error al generar ZIP de desprendibles",
        error: error.message,
      });
    }
  },
};
