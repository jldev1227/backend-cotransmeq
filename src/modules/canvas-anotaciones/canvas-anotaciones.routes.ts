import { FastifyInstance } from "fastify";
import { CanvasAnotacionesService } from "./canvas-anotaciones.service";
import { authMiddleware } from "../../middlewares/auth.middleware";

/**
 * Carga inicial de las anotaciones de un canvas.
 *
 * Solo lectura: las escrituras van por socket (`sheet:patch` con
 * `entity_type: 'anotacion'`), igual que el resto de celdas, para que el
 * resto del equipo las vea al momento.
 */
export async function canvasAnotacionesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);

  app.get("/canvas-anotaciones", async (req: any, reply) => {
    const { scope, anio, mes } = req.query ?? {};
    if (!scope || !anio) {
      return reply.status(400).send({ error: "scope y anio son obligatorios" });
    }
    try {
      const data = await CanvasAnotacionesService.listar({
        scope: String(scope),
        anio: Number(anio),
        mes: mes != null && mes !== "" ? Number(mes) : null,
      });
      return { porMes: data };
    } catch (e: any) {
      return reply.status(400).send({ error: e?.message ?? "Error" });
    }
  });
}
