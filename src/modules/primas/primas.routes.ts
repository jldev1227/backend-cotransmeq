import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrimasController } from "./primas.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { prisma } from "../../config/prisma";

export async function primasRoutes(app: FastifyInstance) {
  // Todas las rutas de primas requieren autenticación
  app.addHook("onRequest", authMiddleware);

  // GET /api/primas - Obtener todas las primas
  app.get("/primas", PrimasController.obtenerTodas);

  // GET /api/primas/buscar - Buscar primas por conductor y período
  app.get("/primas/buscar", PrimasController.buscarPorConductorPeriodo);

  // GET /api/primas/:id - Obtener una prima por ID
  app.get("/primas/:id", PrimasController.obtenerPorId);

  // POST /api/primas - Crear nueva prima
  app.post("/primas", PrimasController.crear);

  // PUT /api/primas/:id - Actualizar prima
  app.put("/primas/:id", PrimasController.actualizar);

  // DELETE /api/primas/:id - Eliminar (soft delete) prima
  app.delete("/primas/:id", PrimasController.eliminar);
}

export default primasRoutes;
