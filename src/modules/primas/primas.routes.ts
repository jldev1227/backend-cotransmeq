import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrimasController } from "./primas.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { EmailService } from "../../services/email.service";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

const TOKEN_VALIDITY_DAYS = 30

const MESES_NOMBRES = [
  "",
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

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

  // ═══════════════════════════════════════════════════════
  // POST /api/primas/preview-envio
  // Retorna preview de las primas a enviar por email
  // ═══════════════════════════════════════════════════════
  app.post("/primas/preview-envio", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { primaIds } = request.body as { primaIds: string[] };

      if (!Array.isArray(primaIds) || primaIds.length === 0) {
        return reply.status(400).send({
          success: false,
          message: "primaIds es requerido y debe ser un array con al menos un elemento",
        });
      }

      const primas = await prisma.primas.findMany({
        where: { id: { in: primaIds }, deleted_at: null },
        select: {
          id: true,
          mes: true,
          anio: true,
          prima: true,
          prima_pendiente: true,
          estado: true,
          conductor_id: true,
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
            },
          },
        },
        orderBy: [{ anio: "desc" }, { mes: "desc" }],
      });

      const items = primas.map((p) => {
        const conductor = p.conductores;
        const conductorNombre = conductor
          ? `${conductor.nombre} ${conductor.apellido || ""}`.trim()
          : "Sin conductor";
        const email = conductor?.email ?? null;
        return {
          primaId: p.id,
          conductor: conductorNombre,
          email,
          mes: p.mes,
          anio: p.anio,
          prima: Number(p.prima) || 0,
          prima_pendiente: p.prima_pendiente != null ? Number(p.prima_pendiente) : null,
          estado: p.estado,
          canSend: !!email,
        };
      });

      return reply.send({
        success: true,
        data: {
          total: items.length,
          canSend: items.filter((i) => i.canSend).length,
          cannotSend: items.filter((i) => !i.canSend).length,
          items,
        },
      });
    } catch (err: any) {
      request.log.error({ error: err }, "Error en preview-envio de primas");
      return reply.status(500).send({
        success: false,
        message: err.message || "Error al generar preview de envío de primas",
      });
    }
  });

  // ═══════════════════════════════════════════════════════
  // POST /api/primas/enviar
  // Envía email de notificación de prima a cada conductor
  // ═══════════════════════════════════════════════════════
  app.post("/primas/enviar", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { primaIds } = request.body as { primaIds: string[] };

      if (!Array.isArray(primaIds) || primaIds.length === 0) {
        return reply.status(400).send({
          success: false,
          message: "primaIds es requerido y debe ser un array con al menos un elemento",
        });
      }

      const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";

      const primas = await prisma.primas.findMany({
        where: { id: { in: primaIds }, deleted_at: null },
        select: {
          id: true,
          mes: true,
          anio: true,
          prima: true,
          prima_pendiente: true,
          estado: true,
          conductor_id: true,
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
              numero_identificacion: true,
            },
          },
        },
      });

      const resultados: any[] = [];
      let enviados = 0;
      let errores = 0;

      for (const prima of primas) {
        const conductor = prima.conductores;

        if (!conductor) {
          resultados.push({
            primaId: prima.id,
            status: "error",
            message: "Prima sin conductor asociado",
          });
          errores++;
          continue;
        }

        if (!conductor.email) {
          resultados.push({
            primaId: prima.id,
            conductor: `${conductor.nombre} ${conductor.apellido || ""}`.trim(),
            status: "error",
            message: "Conductor sin email registrado",
          });
          errores++;
          continue;
        }

        try {
          // Generar o reutilizar token JWT para el portal del conductor
          const existingToken = await prisma.conductor_token.findFirst({
            where: {
              conductor_id: conductor.id,
              expires_at: { gt: new Date() },
            },
            orderBy: { expires_at: "desc" },
          });

          let portalToken: string;

          if (existingToken) {
            portalToken = existingToken.token;
          } else {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + TOKEN_VALIDITY_DAYS);

            portalToken = jwt.sign(
              {
                sub: conductor.id,
                cedula: conductor.numero_identificacion,
                nombre: `${conductor.nombre} ${conductor.apellido || ""}`.trim(),
                tipo: "conductor_portal",
              },
              env.JWT_SECRET,
              { expiresIn: `${TOKEN_VALIDITY_DAYS}d` }
            );

            await prisma.conductor_token.create({
              data: {
                id: randomUUID(),
                conductor_id: conductor.id,
                token: portalToken,
                expires_at: expiresAt,
              },
            });
          }

          const portalLink = `${frontendUrl}/public/portal?token=${encodeURIComponent(
            portalToken
          )}&highlight_prima=${prima.id}`;

          const mesNombre = MESES_NOMBRES[prima.mes] || `Mes ${prima.mes}`;
          const periodo = `${mesNombre} ${prima.anio}`;
          const valorTotal = Number(prima.prima || 0) + Number(prima.prima_pendiente || 0);
          const monto = new Intl.NumberFormat("es-CO", {
            style: "currency",
            currency: "COP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(valorTotal);
          const nombreCompleto = `${conductor.nombre} ${conductor.apellido || ""}`.trim();

          await EmailService.sendPrimaNotification({
            to: conductor.email,
            conductorNombre: nombreCompleto,
            periodo,
            monto,
            portalLink,
          });

          resultados.push({
            primaId: prima.id,
            conductor: nombreCompleto,
            email: conductor.email,
            status: "enviado",
            portalLink,
          });
          enviados++;
        } catch (err: any) {
          request.log.error(
            { error: err, primaId: prima.id },
            "Error enviando email de prima"
          );
          resultados.push({
            primaId: prima.id,
            conductor: `${conductor.nombre} ${conductor.apellido || ""}`.trim(),
            email: conductor.email,
            status: "error",
            message: err.message || "Error al enviar email",
          });
          errores++;
        }
      }

      return reply.send({
        success: true,
        message: `${enviados} email(s) enviado(s), ${errores} error(es)`,
        data: {
          enviados,
          errores,
          total: primas.length,
          resultados,
        },
      });
    } catch (err: any) {
      request.log.error({ error: err }, "Error en enviar de primas");
      return reply.status(500).send({
        success: false,
        message: err.message || "Error al enviar emails de primas",
      });
    }
  });
}

export default primasRoutes;
