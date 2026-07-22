import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { LiquidacionesController } from "./liquidaciones.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { EmailService } from "../../services/email.service";
import jwt from "jsonwebtoken";

const TOKEN_VALIDITY_DAYS = 30;

export async function liquidacionesRoutes(app: FastifyInstance) {
  // Todas las rutas de liquidaciones requieren autenticación
  app.addHook("onRequest", authMiddleware);

  // GET /api/liquidaciones - Obtener todas las liquidaciones
  app.get("/liquidaciones", LiquidacionesController.obtenerTodas);

  // GET /api/liquidaciones/preview-recargos - Preview de recargos desde planillas
  app.get(
    "/liquidaciones/preview-recargos",
    LiquidacionesController.previewRecargos,
  );

  // GET /api/liquidaciones/:id - Obtener una liquidación por ID
  app.get("/liquidaciones/:id", LiquidacionesController.obtenerPorId);

  // GET /api/liquidaciones/:id/pdf-desprendible - Descargar un desprendible individual en PDF
  app.get(
    "/liquidaciones/:id/pdf-desprendible",
    LiquidacionesController.downloadSinglePayslipPdf,
  );

  // Obtener analisis
  app.get("/liquidaciones/analisis", LiquidacionesController.obtenerAnalisis);

  // POST /api/liquidaciones - Crear nueva liquidación
  app.post("/liquidaciones", LiquidacionesController.crear);

  // PUT /api/liquidaciones/:id - Actualizar liquidación
  app.put("/liquidaciones/:id", LiquidacionesController.actualizar);

  // DELETE /api/liquidaciones/:id - Eliminar liquidación
  app.delete("/liquidaciones/:id", LiquidacionesController.eliminar);

  // POST /api/liquidaciones/:id/recargos/:recargoId/revertir-override
  // Revierte un override manual: borra el recargo manual que sobrescribe
  // un automático y reactiva el automático original. Usado desde la UI
  // cuando el usuario decide descartar el cambio manual.
  app.post(
    "/liquidaciones/:id/recargos/:recargoId/revertir-override",
    LiquidacionesController.revertirOverrideRecargo
  );

  // GET /api/configuraciones-liquidacion - Obtener configuraciones (con filtro por año)
  app.get(
    "/configuraciones-liquidacion",
    LiquidacionesController.obtenerConfiguraciones,
  );

  // GET /api/configuraciones-liquidacion/activas?anio=YYYY
  // Endpoint dedicado al flujo de BONOS DE PLANILLA. Devuelve solo
  // configuraciones activas, ordenadas por nombre, con su valor.
  // Si no se pasa `anio`, devuelve las del año actual.
  app.get(
    "/configuraciones-liquidacion/activas",
    {
      schema: {
        description:
          "Configuraciones de liquidación activas (usadas para pintar checkboxes de bonos de planilla)",
        tags: ["liquidaciones", "bonos"],
        querystring: {
          type: "object",
          properties: {
            anio: { type: "integer", minimum: 2000, maximum: 2100 }
          }
        }
      }
    },
    LiquidacionesController.obtenerConfiguracionesActivas
  );

  // GET /api/configuraciones-liquidacion/anios - Obtener años disponibles
  app.get(
    "/configuraciones-liquidacion/anios",
    LiquidacionesController.obtenerAniosConfiguraciones,
  );

  // POST /api/configuraciones-liquidacion - Crear nueva configuración
  app.post(
    "/configuraciones-liquidacion",
    LiquidacionesController.crearConfiguracion,
  );

  // POST /api/configuraciones-liquidacion/duplicar - Duplicar configuraciones de un año a otro
  app.post(
    "/configuraciones-liquidacion/duplicar",
    LiquidacionesController.duplicarConfiguraciones,
  );

  // PUT /api/configuraciones-liquidacion/:id - Actualizar configuración
  app.put(
    "/configuraciones-liquidacion/:id",
    LiquidacionesController.actualizarConfiguracion,
  );

  // DELETE /api/configuraciones-liquidacion/:id - Eliminar configuración
  app.delete(
    "/configuraciones-liquidacion/:id",
    LiquidacionesController.eliminarConfiguracion,
  );

  // ═══════════════════════════════════════════════════════
  // POST /api/liquidaciones/enviar-desprendibles
  // Envía notificación por email a los conductores con link al portal
  // ═══════════════════════════════════════════════════════
  app.post(
    "/liquidaciones/enviar-desprendibles",
    {
      schema: {
        description:
          "Enviar notificación de desprendibles por email a los conductores",
        tags: ["liquidaciones"],
        body: {
          type: "object",
          required: ["liquidacionIds"],
          properties: {
            liquidacionIds: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 100,
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { liquidacionIds } = request.body as { liquidacionIds: string[] };

        // 1. Obtener liquidaciones con datos del conductor
        const liquidaciones = await prisma.liquidaciones.findMany({
          where: { id: { in: liquidacionIds } },
          select: {
            id: true,
            periodo_start: true,
            periodo_end: true,
            sueldo_total: true,
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

        if (liquidaciones.length === 0) {
          return reply
            .status(404)
            .send({
              success: false,
              message: "No se encontraron liquidaciones",
            });
        }

        const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";
        const resultados: any[] = [];
        let enviados = 0;
        let errores = 0;

        for (const liq of liquidaciones) {
          const conductor = liq.conductores;
          if (!conductor) {
            resultados.push({
              liquidacionId: liq.id,
              status: "error",
              message: "Sin conductor asociado",
            });
            errores++;
            continue;
          }

          if (!conductor.email) {
            resultados.push({
              liquidacionId: liq.id,
              conductor: conductor.nombre,
              status: "error",
              message: "Conductor sin email registrado",
            });
            errores++;
            continue;
          }

          try {
            // 2. Generar o reutilizar token JWT para el conductor
            const existingToken = await prisma.conductor_token.findFirst({
              where: {
                conductor_id: conductor.id,
                expires_at: { gt: new Date() },
              },
              orderBy: { expires_at: "desc" },
            });

            let portalToken: string;

            if (existingToken) {
              // Reutilizar token válido
              portalToken = existingToken.token;
            } else {
              // Crear nuevo token
              const expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + TOKEN_VALIDITY_DAYS);

              portalToken = jwt.sign(
                {
                  sub: conductor.id,
                  cedula: conductor.numero_identificacion,
                  nombre:
                    `${conductor.nombre} ${conductor.apellido || ""}`.trim(),
                  tipo: "conductor_portal",
                },
                env.JWT_SECRET,
                { expiresIn: `${TOKEN_VALIDITY_DAYS}d` },
              );

              await prisma.conductor_token.create({
                data: {
                  id: require("crypto").randomUUID(),
                  conductor_id: conductor.id,
                  token: portalToken,
                  expires_at: expiresAt,
                },
              });
            }

            // 3. Construir link con token y desprendible_id
            const portalLink = `${frontendUrl}/public/portal?token=${encodeURIComponent(portalToken)}&desprendible=${liq.id}&tab=desprendibles`;

            // 4. Formatear datos para el email — extraer mes de periodo_end
            const periodoEndDate = new Date(
              liq.periodo_end +
                (liq.periodo_end.length === 10 ? "T00:00:00" : ""),
            );
            const mesNombre = periodoEndDate.toLocaleDateString("es-CO", {
              month: "long",
            });
            const periodo = `mes de ${mesNombre}`;
            const monto = new Intl.NumberFormat("es-CO", {
              style: "currency",
              currency: "COP",
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(Number(liq.sueldo_total) || 0);
            const nombreCompleto =
              `${conductor.nombre} ${conductor.apellido || ""}`.trim();

            // 5. Enviar email
            await EmailService.sendDesprendibleNotification({
              to: conductor.email,
              conductorNombre: nombreCompleto,
              periodo,
              monto,
              portalLink,
            });

            resultados.push({
              liquidacionId: liq.id,
              conductor: nombreCompleto,
              email: conductor.email,
              status: "enviado",
            });
            enviados++;
          } catch (err: any) {
            request.log.error(
              { error: err, liquidacionId: liq.id },
              "Error enviando email desprendible",
            );
            resultados.push({
              liquidacionId: liq.id,
              conductor:
                `${conductor.nombre} ${conductor.apellido || ""}`.trim(),
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
            total: liquidaciones.length,
            resultados,
          },
        });
      } catch (err: any) {
        request.log.error({ error: err }, "Error en enviar-desprendibles");
        return reply.status(500).send({
          success: false,
          message: err.message || "Error al enviar desprendibles",
        });
      }
    },
  );

  // ═══════════════════════════════════════════════════════
  // POST /api/liquidaciones/preview-desprendibles
  // Retorna preview de los conductores/emails para confirmar envío
  // ═══════════════════════════════════════════════════════
  app.post(
    "/liquidaciones/preview-desprendibles",
    {
      schema: {
        description: "Preview de desprendibles a enviar por email",
        tags: ["liquidaciones"],
        body: {
          type: "object",
          required: ["liquidacionIds"],
          properties: {
            liquidacionIds: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 100,
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { liquidacionIds } = request.body as { liquidacionIds: string[] };

        const liquidaciones = await prisma.liquidaciones.findMany({
          where: { id: { in: liquidacionIds } },
          select: {
            id: true,
            periodo_start: true,
            periodo_end: true,
            sueldo_total: true,
            estado: true,
            conductores: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                email: true,
              },
            },
          },
          orderBy: { periodo_end: "desc" },
        });

        const preview = liquidaciones.map((liq) => {
          const c = liq.conductores;
          return {
            liquidacionId: liq.id,
            conductor: c
              ? `${c.nombre} ${c.apellido || ""}`.trim()
              : "Sin conductor",
            email: c?.email || null,
            periodo_inicio: liq.periodo_start,
            periodo_fin: liq.periodo_end,
            sueldo_total: liq.sueldo_total,
            estado: liq.estado,
            canSend: !!c?.email,
          };
        });

        return reply.send({
          success: true,
          data: {
            total: preview.length,
            canSend: preview.filter((p) => p.canSend).length,
            cannotSend: preview.filter((p) => !p.canSend).length,
            items: preview,
          },
        });
      } catch (err: any) {
        request.log.error({ error: err }, "Error en preview-desprendibles");
        return reply.status(500).send({
          success: false,
          message: err.message || "Error al obtener preview",
        });
      }
    },
  );

  // ═══════════════════════════════════════════════════════
  // PATCH /api/liquidaciones/desprendible-visible
  // Toggle la visibilidad de desprendibles en el portal del conductor
  // ═══════════════════════════════════════════════════════
  app.patch(
    "/liquidaciones/desprendible-visible",
    {
      schema: {
        description:
          "Cambiar visibilidad de desprendibles en el portal del conductor",
        tags: ["liquidaciones"],
        body: {
          type: "object",
          required: ["liquidacionIds", "visible"],
          properties: {
            liquidacionIds: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 500,
            },
            visible: { type: "boolean" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { liquidacionIds, visible } = request.body as {
          liquidacionIds: string[];
          visible: boolean;
        };

        const result = await prisma.liquidaciones.updateMany({
          where: { id: { in: liquidacionIds } },
          data: { desprendible_visible: visible },
        });

        return reply.send({
          success: true,
          message: `${result.count} liquidación(es) actualizada(s)`,
          data: { updated: result.count, visible },
        });
      } catch (err: any) {
        request.log.error(
          { error: err },
          "Error actualizando visibilidad de desprendibles",
        );
        return reply.status(500).send({
          success: false,
          message: err.message || "Error al actualizar visibilidad",
        });
      }
    },
  );

  // POST /api/liquidaciones/generate-payslips-zip - Generar ZIP de múltiples desprendibles PDF
  app.post(
    "/liquidaciones/generate-payslips-zip",
    LiquidacionesController.generatePayslipsZip,
  );

  // ═══════════════════════════════════════════════════════
  // PATCH /api/liquidaciones/desprendible-tablas-visible - Toggle visibilidad de desprendibles
  app.patch(
    "/liquidaciones/desprendible-tablas-visible",
    async (
      request: FastifyRequest<{
        Body: { liquidacionIds: string[]; visible: boolean };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { liquidacionIds, visible } = request.body as {
          liquidacionIds: string[];
          visible: boolean;
        };

        if (
          !liquidacionIds ||
          !Array.isArray(liquidacionIds) ||
          liquidacionIds.length === 0
        ) {
          return reply
            .status(400)
            .send({ success: false, message: "liquidacionIds es requerido" });
        }

        await prisma.liquidaciones.updateMany({
          where: { id: { in: liquidacionIds } },
          data: { mostrar_recargos: visible },
        });

        return reply.send({
          success: true,
          message: `${liquidacionIds.length} liquidación(es) actualizadas`,
          data: { count: liquidacionIds.length, visible },
        });
      } catch (error: any) {
        request.log.error(
          { error },
          "Error al cambiar visibilidad de desprendibles",
        );
        return reply
          .status(500)
          .send({ success: false, message: error.message });
      }
    },
  );
}
