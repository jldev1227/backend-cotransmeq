// @ts-nocheck
import { FastifyRequest, FastifyReply } from "fastify";
import { LiquidacionesService } from "./liquidaciones.service";

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
      const liquidaciones = await LiquidacionesService.obtenerTodas();

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
};
