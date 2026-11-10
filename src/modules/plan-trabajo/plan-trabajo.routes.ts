import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permissions.middleware";
import { prisma } from "../../config/prisma";
import {
  activarPlan,
  actualizarBandasIndicador,
  asignarConductores,
  clonarPlan,
  configurarCargo,
  obtenerGestion,
  obtenerIndicadores,
  obtenerPlan,
  PlanTrabajoError,
  subirEvidencia,
  actualizarOcurrencia,
  urlEvidencia,
} from "./plan-trabajo.service";

function responderError(reply: FastifyReply, error: unknown) {
  if (error instanceof PlanTrabajoError)
    return reply
      .status(error.statusCode)
      .send({ success: false, message: error.message });
  const message =
    error instanceof Error
      ? error.message
      : "No fue posible procesar el plan de trabajo.";
  return reply.status(500).send({ success: false, message });
}

async function cargarArchivo(request: FastifyRequest) {
  const archivo = await request.file({
    limits: { files: 1, fileSize: 8 * 1024 * 1024 },
  });
  if (!archivo) throw new PlanTrabajoError("Adjunta un archivo de soporte.");
  const buffer = await archivo.toBuffer();
  return { nombre: archivo.filename, mime: archivo.mimetype, buffer };
}

export async function planTrabajoRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);
  const leer = requirePermission("acciones-correctivas", "read");
  const escribir = requirePermission("acciones-correctivas", "full");

  app.get("/plan-trabajo", { preHandler: leer }, async (_request, reply) => {
    try {
      const planes = await prisma.plan_trabajo_anual.findMany({
        orderBy: [{ anio: "desc" }, { created_at: "desc" }],
      });
      const datos = await Promise.all(
        planes.map(async (plan) => {
          const [actividades, ocurrencias, ejecutadas, pendientes, atrasadas] =
            await Promise.all([
              prisma.plan_trabajo_actividad.count({
                where: { plan_id: plan.id },
              }),
              prisma.plan_trabajo_ocurrencia.count({
                where: { actividad: { plan_id: plan.id } },
              }),
              prisma.plan_trabajo_ocurrencia.count({
                where: {
                  actividad: { plan_id: plan.id },
                  estado: "COMPLETADA",
                },
              }),
              prisma.plan_trabajo_ocurrencia.count({
                where: { actividad: { plan_id: plan.id }, estado: "PENDIENTE" },
              }),
              prisma.plan_trabajo_ocurrencia.count({
                where: {
                  actividad: { plan_id: plan.id },
                  estado: "PENDIENTE",
                  fecha_vencimiento: {
                    lt: new Date(new Date().toISOString().slice(0, 10)),
                  },
                },
              }),
            ]);
          return {
            ...plan,
            resumen: {
              actividades,
              ocurrencias,
              ejecutadas,
              pendientes,
              atrasadas,
            },
          };
        }),
      );
      return reply.send({ success: true, data: datos });
    } catch (error) {
      return responderError(reply, error);
    }
  });

  app.get(
    "/plan-trabajo/:planId/gestion",
    { preHandler: leer },
    async (request: FastifyRequest<{ Params: { planId: string } }>, reply) => {
      try {
        return reply.send({
          success: true,
          data: await obtenerGestion(request.params.planId),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.get(
    "/plan-trabajo/:planId/indicadores",
    { preHandler: leer },
    async (
      request: FastifyRequest<{
        Params: { planId: string };
        Querystring: { trimestre?: number };
      }>,
      reply,
    ) => {
      try {
        const q =
          request.query.trimestre === undefined
            ? undefined
            : Number(request.query.trimestre);
        if (q !== undefined && (!Number.isInteger(q) || q < 1 || q > 4))
          throw new PlanTrabajoError("El trimestre debe estar entre 1 y 4.");
        return reply.send({
          success: true,
          data: await obtenerIndicadores(request.params.planId, q),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.put(
    "/plan-trabajo/:planId/cargos",
    { preHandler: escribir },
    async (
      request: FastifyRequest<{
        Params: { planId: string };
        Body: {
          cargo: string;
          area: string | null;
          asignaciones: Array<{ usuario_id: string; rol: string }>;
        };
      }>,
      reply,
    ) => {
      try {
        const { cargo, area, asignaciones } = request.body;
        if (!Array.isArray(asignaciones))
          throw new PlanTrabajoError("La lista de responsables no es válida.");
        await configurarCargo(
          request.params.planId,
          cargo,
          area ?? null,
          asignaciones,
        );
        return reply.send({ success: true });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.post(
    "/plan-trabajo/:planId/activar",
    { preHandler: escribir },
    async (request: FastifyRequest<{ Params: { planId: string } }>, reply) => {
      try {
        const usuarioId = (request as any).user?.id;
        return reply.send({
          success: true,
          data: await activarPlan(request.params.planId, usuarioId),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.post(
    "/plan-trabajo/:planId/clonar",
    { preHandler: escribir },
    async (
      request: FastifyRequest<{
        Params: { planId: string };
        Body: { anio: number };
      }>,
      reply,
    ) => {
      try {
        return reply
          .status(201)
          .send({
            success: true,
            data: await clonarPlan(
              request.params.planId,
              Number(request.body.anio),
            ),
          });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.put(
    "/plan-trabajo/ocurrencias/:id/conductores",
    { preHandler: escribir },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          asignaciones?: Array<{ conductor_id: string; rol: string }>;
          conductor_ids?: string[];
        };
      }>,
      reply,
    ) => {
      try {
        const entradas = Array.isArray(request.body.asignaciones)
          ? request.body.asignaciones
          : Array.isArray(request.body.conductor_ids)
            ? request.body.conductor_ids.map((conductor_id) => ({
                conductor_id,
                rol: "RESPONSABLE",
              }))
            : null;
        if (!entradas)
          throw new PlanTrabajoError("Indica las asignaciones de conductores.");
        return reply.send({
          success: true,
          data: await asignarConductores(request.params.id, entradas),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.patch(
    "/plan-trabajo/ocurrencias/:id/completar",
    { preHandler: escribir },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        return reply.send({
          success: true,
          data: await actualizarOcurrencia({
            id: request.params.id,
            estado: "COMPLETADA",
            actorTipo: "ADMIN",
            actorId: (request as any).user.id,
          }),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.patch(
    "/plan-trabajo/ocurrencias/:id/no-aplica",
    { preHandler: escribir },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { motivo: string };
      }>,
      reply,
    ) => {
      try {
        return reply.send({
          success: true,
          data: await actualizarOcurrencia({
            id: request.params.id,
            estado: "NO_APLICA",
            actorTipo: "ADMIN",
            actorId: (request as any).user.id,
            motivo: request.body.motivo,
          }),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.post(
    "/plan-trabajo/ocurrencias/:id/evidencias",
    { preHandler: escribir },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        const actor = (request as any).user;
        const archivo = await cargarArchivo(request);
        const evidencia = await subirEvidencia({
          objetivoTipo: "OCURRENCIA",
          objetivoId: request.params.id,
          actorTipo: "ADMIN",
          actorId: actor.id,
          ...archivo,
        });
        return reply.status(201).send({ success: true, data: evidencia });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.put(
    "/plan-trabajo/:planId/indicadores/:numero",
    { preHandler: escribir },
    async (
      request: FastifyRequest<{
        Params: { planId: string; numero: string };
        Body: { cumple: boolean; observacion?: string };
      }>,
      reply,
    ) => {
      try {
        const numero = Number(request.params.numero);
        if (typeof request.body.cumple !== "boolean")
          throw new PlanTrabajoError(
            "Indica si el documento cumple el requisito.",
          );
        const { guardarIndicadorManual } =
          await import("./plan-trabajo.service");
        return reply.send({
          success: true,
          data: await guardarIndicadorManual({
            planId: request.params.planId,
            numero,
            cumple: request.body.cumple,
            observacion: request.body.observacion,
            usuarioId: (request as any).user.id,
          }),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.put(
    "/plan-trabajo/:planId/indicadores/:numero/bandas",
    { preHandler: escribir },
    async (
      request: FastifyRequest<{
        Params: { planId: string; numero: string };
        Body: {
          bandas_referencia: {
            adecuado: string;
            riesgo: string;
            critico: string;
          };
        };
      }>,
      reply,
    ) => {
      try {
        const bandas = request.body?.bandas_referencia;
        if (!bandas || typeof bandas !== "object")
          throw new PlanTrabajoError("Indica las bandas de referencia.");
        return reply.send({
          success: true,
          data: await actualizarBandasIndicador(
            request.params.planId,
            Number(request.params.numero),
            bandas,
          ),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.post(
    "/plan-trabajo/indicadores/:id/evidencias",
    { preHandler: escribir },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        const actor = (request as any).user;
        const archivo = await cargarArchivo(request);
        const evidencia = await subirEvidencia({
          objetivoTipo: "INDICADOR",
          objetivoId: request.params.id,
          actorTipo: "ADMIN",
          actorId: actor.id,
          ...archivo,
        });
        return reply.status(201).send({ success: true, data: evidencia });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.get(
    "/plan-trabajo/evidencias/:id/url",
    { preHandler: leer },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      try {
        return reply.send({
          success: true,
          data: await urlEvidencia(request.params.id),
        });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );

  app.patch(
    "/plan-trabajo/actividades/:id/evidencia-requerida",
    { preHandler: escribir },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { requiere_evidencia: boolean };
      }>,
      reply,
    ) => {
      try {
        if (typeof request.body.requiere_evidencia !== "boolean")
          throw new PlanTrabajoError("Indica si la actividad exige soporte.");
        const updated = await prisma.plan_trabajo_actividad.update({
          where: { id: request.params.id },
          data: { requiere_evidencia: request.body.requiere_evidencia },
        });
        return reply.send({ success: true, data: updated });
      } catch (error) {
        return responderError(reply, error);
      }
    },
  );
}
