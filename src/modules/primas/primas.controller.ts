// @ts-nocheck
import { FastifyRequest, FastifyReply } from "fastify";
import { PrimasService } from "./primas.service";

interface ObtenerTodasQuery {
  page?: string;
  limit?: string;
  search?: string;
  conductor_id?: string;
  mes?: string;
  anio?: string;
  estado?: string;
  sortBy?: string;
  sortOrder?: string;
}

interface PrimasParams {
  id: string;
}

export const PrimasController = {
  // GET /primas
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
        mes,
        anio,
        estado,
        sortBy,
        sortOrder,
      } = request.query;

      const filters: any = {};

      if (search) filters.search = search;
      if (conductor_id) filters.conductor_id = conductor_id;
      if (estado) filters.estado = estado;
      if (mes) filters.mes = parseInt(mes);
      if (anio) filters.anio = parseInt(anio);
      if (page) filters.page = parseInt(page);
      if (limit) filters.limit = parseInt(limit);
      if (sortBy) filters.sortBy = sortBy;
      if (sortOrder) filters.sortOrder = sortOrder;

      const result = await PrimasService.obtenerTodas(filters);

      return reply.status(200).send({
        success: true,
        data: {
          primas: result.primas,
          stats: result.stats,
          pagination: result.pagination,
        },
      });
    } catch (error: any) {
      request.log.error("Error al obtener primas:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al obtener primas",
        error: error.message,
      });
    }
  },

  // GET /primas/:id
  async obtenerPorId(
    request: FastifyRequest<{ Params: PrimasParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const prima = await PrimasService.obtenerPorId(id);

      return reply.status(200).send({
        success: true,
        data: prima,
      });
    } catch (error: any) {
      request.log.error("Error al obtener prima:", error);

      if (error.message === "Prima no encontrada") {
        return reply.status(404).send({
          success: false,
          message: "Prima no encontrada",
        });
      }

      return reply.status(500).send({
        success: false,
        message: "Error al obtener la prima",
        error: error.message,
      });
    }
  },

  // POST /primas
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

      if (data.mes === undefined || data.mes === null || data.anio === undefined || data.anio === null) {
        return reply.status(400).send({
          success: false,
          message: "El mes y el año son requeridos",
        });
      }

      const prima = await PrimasService.crear(data, userId);

      return reply.status(201).send({
        success: true,
        data: prima,
        message: "Prima creada correctamente",
      });
    } catch (error: any) {
      request.log.error("Error al crear prima:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al crear la prima",
        error: error.message,
      });
    }
  },

  // PUT /primas/:id
  async actualizar(
    request: FastifyRequest<{ Params: PrimasParams; Body: any }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const data = request.body;
      const userId = (request as any).user?.id;

      const prima = await PrimasService.actualizar(id, data, userId);

      return reply.status(200).send({
        success: true,
        data: prima,
        message: "Prima actualizada correctamente",
      });
    } catch (error: any) {
      request.log.error("Error al actualizar prima:", error);

      if (error.message === "Prima no encontrada") {
        return reply.status(404).send({
          success: false,
          message: "Prima no encontrada",
        });
      }

      return reply.status(500).send({
        success: false,
        message: "Error al actualizar la prima",
        error: error.message,
      });
    }
  },

  // DELETE /primas/:id
  async eliminar(
    request: FastifyRequest<{ Params: PrimasParams }>,
    reply: FastifyReply,
  ) {
    try {
      const { id } = request.params;
      const result = await PrimasService.eliminar(id);

      return reply.status(200).send(result);
    } catch (error: any) {
      request.log.error("Error al eliminar prima:", error);

      if (error.message === "Prima no encontrada") {
        return reply.status(404).send({
          success: false,
          message: "Prima no encontrada",
        });
      }

      return reply.status(500).send({
        success: false,
        message: "Error al eliminar la prima",
        error: error.message,
      });
    }
  },

  // GET /primas/buscar?conductor_id=&mes=&anio=
  async buscarPorConductorPeriodo(
    request: FastifyRequest<{
      Querystring: { conductor_id?: string; mes?: string; anio?: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const { conductor_id, mes, anio } = request.query;

      if (!conductor_id) {
        return reply.status(400).send({
          success: false,
          message: "El conductor_id es requerido",
        });
      }

      const primas = await PrimasService.buscarPorConductorPeriodo(
        conductor_id,
        mes ? parseInt(mes) : undefined,
        anio ? parseInt(anio) : undefined,
      );

      return reply.status(200).send({
        success: true,
        data: primas,
      });
    } catch (error: any) {
      request.log.error("Error al buscar primas por conductor/período:", error);
      return reply.status(500).send({
        success: false,
        message: "Error al buscar primas por conductor/período",
        error: error.message,
      });
    }
  },
};
