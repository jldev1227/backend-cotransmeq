import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrimasController } from "./primas.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { EmailService } from "../../services/email.service";
import jwt from "jsonwebtoken";

const TOKEN_VALIDITY_DAYS = 30;

const MESES_NOMBRES = [
  '',
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
];

export async function primasRoutes(app: FastifyInstance) {
  // Todas las rutas de primas requieren autenticación
  app.addHook("onRequest", authMiddleware);

  // GET /api/primas - Obtener todas las primas
  app.get("/primas", PrimasController.obtenerTodas);

  // GET /api/primas/buscar - Buscar primas por conductor y período
  app.get("/primas/buscar", PrimasController.buscarPorConductorPeriodo);

  // GET /api/primas/:id/firma-enriquecida - Firma con fallback a nómina (auth admin)
  // Debe declararse ANTES que /primas/:id para que no la capture el wildcard
  app.get(
    "/primas/:id/firma-enriquecida",
    PrimasController.obtenerFirmaEnriquecida
  );

  // GET /api/primas/:id - Obtener una prima por ID
  app.get("/primas/:id", PrimasController.obtenerPorId);

  // POST /api/primas - Crear nueva prima
  app.post("/primas", PrimasController.crear);

  // PUT /api/primas/:id - Actualizar prima
  app.put("/primas/:id", PrimasController.actualizar);

  // DELETE /api/primas/:id - Eliminar (soft delete) prima
  app.delete("/primas/:id", PrimasController.eliminar);

  // POST /api/primas/enviar - Enviar email de notificación de primas
  app.post(
    "/primas/enviar",
    {
      schema: {
        description:
          "Enviar notificación de primas por email a los conductores",
        tags: ["primas"],
        body: {
          type: "object",
          required: ["primasIds"],
          properties: {
            primasIds: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 100
            }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Body: { primasIds: string[] } }>,
      reply: FastifyReply
    ) => {
      try {
        const { primasIds } = request.body;
        const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";

        const primas = await prisma.primas.findMany({
          where: { id: { in: primasIds }, deleted_at: null },
          include: {
            conductores: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                email: true,
                numero_identificacion: true
              }
            }
          }
        });

        if (primas.length === 0) {
          return reply
            .status(404)
            .send({ success: false, message: "No se encontraron primas" });
        }

        let enviados = 0;
        let errores = 0;
        const resultados: Array<{
          primaId: string;
          conductor: string;
          email: string | null;
          status: "enviado" | "error";
          message?: string;
        }> = [];

        for (const p of primas) {
          const conductor = p.conductores;
          const nombreCompleto =
            `${conductor?.nombre || ""} ${conductor?.apellido || ""}`.trim() ||
            "Conductor";
          const email = conductor?.email || null;

          if (!email) {
            errores++;
            resultados.push({
              primaId: p.id,
              conductor: nombreCompleto,
              email: null,
              status: "error",
              message: "El conductor no tiene email registrado"
            });
            continue;
          }

          try {
            // 1) Reutilizar token vigente o generar uno nuevo (30 días)
            let portalToken: string | null = null;
            const existingToken = await prisma.conductor_token.findFirst({
              where: {
                conductor_id: conductor!.id,
                expires_at: { gt: new Date() }
              }
            });
            if (existingToken) {
              portalToken = existingToken.token;
            } else {
              portalToken = jwt.sign(
                {
                  sub: conductor!.id,
                  cedula: conductor!.numero_identificacion,
                  nombre: conductor!.nombre,
                  tipo: "conductor_portal"
                },
                env.JWT_SECRET,
                { expiresIn: `${TOKEN_VALIDITY_DAYS}d` }
              );
              await prisma.conductor_token.create({
                data: {
                  id: require("crypto").randomUUID(),
                  conductor_id: conductor!.id,
                  token: portalToken,
                  expires_at: new Date(
                    Date.now() + TOKEN_VALIDITY_DAYS * 24 * 60 * 60 * 1000
                  )
                }
              });
            }

            const portalLink = `${frontendUrl}/public/portal?token=${encodeURIComponent(
              portalToken
            )}&prima=${p.id}&tab=primas`;

            const periodo = `mes de ${MESES_NOMBRES[p.mes] || p.mes} ${p.anio}`;
            const monto = new Intl.NumberFormat("es-CO", {
              style: "currency",
              currency: "COP",
              minimumFractionDigits: 0,
              maximumFractionDigits: 0
            }).format(Number(p.prima) || 0);

            await EmailService.sendPrimaNotification({
              to: email,
              conductorNombre: nombreCompleto,
              periodo,
              monto,
              portalLink
            });

            enviados++;
            resultados.push({
              primaId: p.id,
              conductor: nombreCompleto,
              email,
              status: "enviado"
            });
          } catch (err: any) {
            request.log.error(
              { error: err, primaId: p.id },
              "Error enviando email de prima"
            );
            errores++;
            resultados.push({
              primaId: p.id,
              conductor: nombreCompleto,
              email,
              status: "error",
              message: err.message || "Error al enviar email"
            });
          }
        }

        return reply.send({
          success: true,
          message: `${enviados} email(s) enviado(s), ${errores} error(es)`,
          data: { enviados, errores, total: primas.length, resultados }
        });
      } catch (err: any) {
        request.log.error({ error: err }, "Error en /api/primas/enviar");
        return reply.status(500).send({
          success: false,
          message: err.message || "Error al enviar emails de primas"
        });
      }
    }
  );
}

export default primasRoutes;
