import { FastifyReply, FastifyRequest } from 'fastify';
import { TercerosService } from './tercero.service';
import { createTerceroSchema, updateTerceroSchema } from './tercero.schema';

interface TerceroParams {
  id: string;
}

export const TercerosController = {
  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createTerceroSchema.parse(request.body);
      const tercero = await TercerosService.create(data);
      reply.status(201).send({
        success: true,
        message: 'Tercero creado exitosamente',
        data: tercero,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Ya existe un tercero')) {
          return reply.status(409).send({ success: false, message: error.message });
        }
      }
      throw error;
    }
  },

  async obtenerTodos(request: FastifyRequest, reply: FastifyReply) {
    const { page, limit, tipo_persona, search, sortBy, sortOrder } = request.query as {
      page?: string;
      limit?: string;
      tipo_persona?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
    };

    const pageNum = page ? parseInt(page) : 1;
    const limitNum = limit ? parseInt(limit) : 20;

    const result = await TercerosService.list(pageNum, limitNum, tipo_persona, search, sortBy, sortOrder);

    reply.send({
      success: true,
      message: 'Terceros obtenidos exitosamente',
      ...result,
    });
  },

  async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as TerceroParams;
    try {
      const tercero = await TercerosService.findById(id);
      reply.send({ success: true, data: tercero });
    } catch (error) {
      if (error instanceof Error && error.message === 'Tercero no encontrado') {
        return reply.status(404).send({ success: false, message: error.message });
      }
      throw error;
    }
  },

  async actualizar(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as TerceroParams;
    try {
      const data = updateTerceroSchema.parse(request.body);
      const tercero = await TercerosService.update(id, data);
      reply.send({
        success: true,
        message: 'Tercero actualizado exitosamente',
        data: tercero,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Tercero no encontrado') {
          return reply.status(404).send({ success: false, message: error.message });
        }
        if (error.message.includes('Ya existe un tercero')) {
          return reply.status(409).send({ success: false, message: error.message });
        }
      }
      throw error;
    }
  },

  async eliminar(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as TerceroParams;
    try {
      await TercerosService.delete(id);
      reply.send({ success: true, message: 'Tercero eliminado exitosamente' });
    } catch (error) {
      if (error instanceof Error && error.message === 'Tercero no encontrado') {
        return reply.status(404).send({ success: false, message: error.message });
      }
      throw error;
    }
  },

  async importarDesdeVehiculos(_request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await TercerosService.importarDesdeVehiculos();
      reply.send({
        success: true,
        message: `Importación completada: ${result.importados} nuevos, ${result.duplicados} ya existían`,
        data: result,
      });
    } catch (error) {
      throw error;
    }
  },

  async buscar(request: FastifyRequest, reply: FastifyReply) {
    const { q } = request.query as { q?: string };
    const data = await TercerosService.buscar(q || '');
    reply.send({ success: true, data });
  },
};
