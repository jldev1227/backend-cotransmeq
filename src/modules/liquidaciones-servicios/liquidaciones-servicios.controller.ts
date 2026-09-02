import { FastifyRequest, FastifyReply } from "fastify";
import { LiquidacionesServiciosService } from "./liquidaciones-servicios.service";
import {
  emitLiquidacionServicio,
  emitLiquidacionServicioBorrador,
  emitNotificacion,
} from "../../sockets";
import { NotificacionesService } from "../notificaciones/notificaciones.service";

export class LiquidacionesServiciosController {
  // ── TARIFAS ──

  static async obtenerTarifas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { operadora, anio } = request.query as any;
      const tarifas = await LiquidacionesServiciosService.obtenerTarifas(
        undefined,
        operadora,
        anio ? Number(anio) : undefined,
      );
      return reply.send(tarifas);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async crearTarifa(request: FastifyRequest, reply: FastifyReply) {
    try {
      const tarifa = await LiquidacionesServiciosService.crearTarifa(
        request.body as any,
      );
      return reply.status(201).send(tarifa);
    } catch (error: any) {
      if (error.code === "P2002") {
        return reply
          .status(409)
          .send({ error: "Ya existe una tarifa para esta operadora y año" });
      }
      return reply.status(500).send({ error: error.message });
    }
  }

  static async actualizarTarifa(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const tarifa = await LiquidacionesServiciosService.actualizarTarifa(
        id,
        request.body as any,
      );
      return reply.send(tarifa);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async eliminarTarifa(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesServiciosService.eliminarTarifa(id);
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── PREVIEW ──

  static async checkConsecutivo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { consecutivo } = request.params as any;
      const { excludeId } = request.query as any;
      if (!consecutivo)
        return reply.status(400).send({ error: "Se requiere consecutivo" });
      const result = await LiquidacionesServiciosService.checkConsecutivo(
        consecutivo,
        excludeId,
      );
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async previewLiquidacion(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const { cliente_id, mes, anio, servicio_ids, tarifa_id } =
        request.query as any;
      if (!cliente_id || !mes || !anio) {
        return reply
          .status(400)
          .send({ error: "Se requiere cliente_id, mes y anio" });
      }

      const servicioIds = servicio_ids
        ? (servicio_ids as string).split(",")
        : undefined;
      const preview = await LiquidacionesServiciosService.previewLiquidacion(
        cliente_id,
        Number(mes),
        Number(anio),
        servicioIds,
        tarifa_id || undefined,
      );
      return reply.send(preview);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── CRUD LIQUIDACIONES ──

  static async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id;
      const userName = (request as any).user?.nombre || "Usuario";
      const liquidacion = await LiquidacionesServiciosService.crear(
        request.body as any,
        userId,
      );
      emitLiquidacionServicio("liquidacion-servicio-created", liquidacion);

      // Notificar a todos los usuarios con acceso
      try {
        const consecutivo = liquidacion.consecutivo;
        const clienteNombre = liquidacion.cliente?.nombre || "";
        const aprobadores =
          await NotificacionesService.obtenerUsuariosAprobadores();
        const otros = aprobadores.filter((u) => u.id !== userId);
        if (otros.length > 0) {
          const notifData = otros.map((u) => ({
            usuario_id: u.id,
            tipo: "LIQUIDACION_CREADA" as const,
            titulo: `Nueva liquidación ${consecutivo}`,
            mensaje: `${userName} creó la liquidación ${consecutivo} (${clienteNombre}).`,
            referencia_id: liquidacion.id,
          }));
          await NotificacionesService.crearMasivas(notifData);
          for (const nd of notifData) {
            emitNotificacion(nd);
          }
        }
      } catch (notifError) {
        console.error("Error creando notificaciones de creación:", notifError);
      }

      return reply.status(201).send(liquidacion);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const usuario = (request as any).user;
      const areas = Array.isArray(usuario?.area)
        ? usuario.area
        : usuario?.area
          ? [usuario.area]
          : [];
      const result = await LiquidacionesServiciosService.listar({
        ...(request.query as any),
        /// De la sesión y no del query string: si el cliente pudiera declarar
        /// el `usuario_id`, cualquiera leería los borradores de cualquiera.
        usuario_id: usuario?.id,
        puede_ver_no_confirmadas_ajenas:
          usuario?.role === "admin" || areas.includes("administracion"),
      });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const liquidacion = await LiquidacionesServiciosService.obtenerPorId(id);
      return reply.send(liquidacion);
    } catch (error: any) {
      if (error.message.includes("no encontrada")) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: error.message });
    }
  }

  static async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const result = await LiquidacionesServiciosService.eliminar(id);
      emitLiquidacionServicio("liquidacion-servicio-deleted", { id });
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  /**
   * Autoguardado del formulario.
   *
   * Deliberadamente NO hace lo que hacen `crear` y `actualizar`: ni emite
   * `liquidacion-servicio-created/updated` —que van por `io.emit` global, así
   * que cada tecleo llegaría a todos los clientes— ni dispara el fan-out de
   * notificaciones a los aprobadores. Está aquí y no como una rama con un flag
   * dentro de `crear` para que esa diferencia sea estructural y no dependa de
   * que nadie borre un `if`.
   */
  static async autoguardar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.status(401).send({ error: "Sesión no válida" });
      }

      const resultado = await LiquidacionesServiciosService.autoguardar(
        request.body as any,
        userId,
      );

      emitLiquidacionServicioBorrador({
        id: resultado.id!,
        consecutivo: resultado.consecutivo!,
        estado: String(resultado.estado),
        version: resultado.version!,
      });

      return reply.send(resultado);
    } catch (error: any) {
      /// 409 con el motivo, no un 500 genérico: el editor necesita saber si
      /// debe recargar (`version`), avisar de que ya no es un borrador
      /// (`estado`) o rendirse (`borrada`).
      if (error.conflicto) {
        return reply
          .status(409)
          .send({ error: error.message, ...error.conflicto });
      }
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── BORRADOR PREVIO ──
  //
  // `liquidacion_id` viaja en el cuerpo o en la ruta, y `null` significa «el
  // borrador de una liquidación que todavía no existe». El `usuario_id` sale
  // SIEMPRE de la sesión: un borrador es privado de quien lo escribe.

  static async guardarDraft(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id;
      if (!userId) return reply.status(401).send({ error: "Sesión no válida" });

      const { liquidacion_id, payload } = request.body as any;
      if (!payload) {
        return reply.status(400).send({ error: "Falta el payload del borrador" });
      }

      const r = await LiquidacionesServiciosService.guardarDraft(
        userId,
        liquidacion_id ?? null,
        payload,
      );
      return reply.send(r);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerDraft(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id;
      if (!userId) return reply.status(401).send({ error: "Sesión no válida" });

      const { id } = request.params as any;
      const draft = await LiquidacionesServiciosService.obtenerDraft(
        userId,
        id ?? null,
      );
      /// 200 con `null` y no 404: «no hay borrador» es una respuesta normal al
      /// abrir el formulario, no un error que el cliente deba tratar aparte.
      return reply.send(draft);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async eliminarDraft(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id;
      if (!userId) return reply.status(401).send({ error: "Sesión no válida" });

      const { id } = request.params as any;
      const r = await LiquidacionesServiciosService.eliminarDraft(
        userId,
        id ?? null,
      );
      return reply.send(r);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async actualizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const userId = (request as any).user?.id;
      const userName = (request as any).user?.nombre || "Usuario";

      // Mismo criterio que `cambiarEstado`, que sí lo aplicaba: una
      // liquidación aprobada o facturada solo la toca Administración. Sin
      // esto, un PUT sobrescribía una aprobada sin preguntar — y el editor
      // llegaba a mandarlo solo, restaurando un borrador local viejo encima
      // de lo que ya estaba aprobado.
      const userAreas: string[] = ((request as any).user?.area || []).map(
        (a: string) => a.toUpperCase(),
      );
      const esAdministracion = userAreas.includes("ADMINISTRACION");
      const previa = await LiquidacionesServiciosService.obtenerPorId(id);

      if (previa.deleted_at || previa.estado === "ANULADA") {
        return reply.status(403).send({
          error:
            "La liquidación está anulada o eliminada. Restáurala antes de editarla.",
        });
      }
      if (
        (previa.estado === "APROBADA" || previa.estado === "FACTURADA") &&
        !esAdministracion
      ) {
        return reply.status(403).send({
          error: `La liquidación está en ${previa.estado.toLowerCase()}. Solo Administración puede modificarla.`,
        });
      }

      /// Si venía sin confirmar, este PUT es el primer Guardar explícito: la
      /// liquidación pasa a existir para el resto del mundo AHORA. Se lee antes
      /// de actualizar porque `actualizar` no distingue los dos casos.
      const eraBorradorSinConfirmar = !previa.confirmada_at;

      const liquidacion = await LiquidacionesServiciosService.actualizar(
        id,
        request.body as any,
        userId,
      );

      if (eraBorradorSinConfirmar) {
        await LiquidacionesServiciosService.confirmar(id);
      }

      /// «created» y no «updated» cuando se confirma: para todos los demás la
      /// liquidación nace en este momento, y un feed que dijera «actualizó»
      /// hablaría de algo que nunca vieron aparecer.
      emitLiquidacionServicio(
        eraBorradorSinConfirmar
          ? "liquidacion-servicio-created"
          : "liquidacion-servicio-updated",
        liquidacion,
      );

      // Notificar a todos los usuarios con acceso
      try {
        const consecutivo = liquidacion.consecutivo;
        const clienteNombre = liquidacion.cliente?.nombre || "";
        const aprobadores =
          await NotificacionesService.obtenerUsuariosAprobadores();
        const otros = aprobadores.filter((u) => u.id !== userId);
        if (otros.length > 0) {
          const notifData = otros.map((u) => ({
            usuario_id: u.id,
            tipo: "LIQUIDACION_ACTUALIZADA" as const,
            titulo: `Liquidación ${consecutivo} actualizada`,
            mensaje: `${userName} actualizó la liquidación ${consecutivo} (${clienteNombre}).`,
            referencia_id: liquidacion.id,
          }));
          await NotificacionesService.crearMasivas(notifData);
          for (const nd of notifData) {
            emitNotificacion(nd);
          }
        }
      } catch (notifError) {
        console.error(
          "Error creando notificaciones de actualización:",
          notifError,
        );
      }

      return reply.send(liquidacion);
    } catch (error: any) {
      if (error.message.includes("no encontrada")) {
        return reply.status(404).send({ error: error.message });
      }
      return reply.status(500).send({ error: error.message });
    }
  }

  static async cambiarEstado(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { estado, motivo_anulacion } = request.body as any;
      const userId = (request as any).user?.id;
      const userName = (request as any).user?.nombre || "Usuario";

      const userAreas: string[] = ((request as any).user?.area || []).map(
        (a: string) => a.toUpperCase(),
      );

      const liqActual = await LiquidacionesServiciosService.obtenerPorId(id);
      const estadoActual: string = liqActual.estado;

      const esAdministracion = userAreas.includes("ADMINISTRACION");
      if (estadoActual === "APROBADA" && !esAdministracion) {
        return reply.status(403).send({
          error: `La liquidación está aprobada. Solo Administración puede modificar su estado.`,
        });
      }

      const result = await LiquidacionesServiciosService.cambiarEstado(
        id,
        estado,
        userId,
        motivo_anulacion,
      );
      emitLiquidacionServicio("liquidacion-servicio-updated", result);

      // ── Notificaciones ──
      try {
        const consecutivo = result.consecutivo;
        const clienteNombre = result.cliente?.nombre || "";

        if (estado === "ANULADA") {
          // Obtener la liquidación completa para saber quién la creó
          const liqCompleta =
            await LiquidacionesServiciosService.obtenerPorId(id);
          if (
            liqCompleta.creado_por_id &&
            liqCompleta.creado_por_id !== userId
          ) {
            const notif = await NotificacionesService.crear({
              usuario_id: liqCompleta.creado_por_id,
              tipo: "LIQUIDACION_ANULADA",
              titulo: `Liquidación ${consecutivo} anulada`,
              mensaje: `La liquidación ${consecutivo} (${clienteNombre}) fue anulada por ${userName}. ${motivo_anulacion ? "Motivo: " + motivo_anulacion : ""}`,
              referencia_id: id,
            });
            emitNotificacion(notif);
          }
        } else if (estado === "LIQUIDADA") {
          // Notificar a usuarios con permisos de aprobación
          const aprobadores =
            await NotificacionesService.obtenerUsuariosAprobadores();
          const otrosAprobadores = aprobadores.filter((u) => u.id !== userId);
          if (otrosAprobadores.length > 0) {
            const notifData = otrosAprobadores.map((u) => ({
              usuario_id: u.id,
              tipo: "LIQUIDACION_PENDIENTE" as const,
              titulo: `Liquidación pendiente de revisión`,
              mensaje: `${userName} liquidó ${consecutivo} (${clienteNombre}). Pendiente de aprobación.`,
              referencia_id: id,
            }));
            await NotificacionesService.crearMasivas(notifData);
            // Emit individual notifications for each user
            for (const nd of notifData) {
              emitNotificacion(nd);
            }
          }
        } else if (estado === "BORRADOR") {
          // Reversión de LIQUIDADA → BORRADOR: notificar aprobadores
          const aprobadores =
            await NotificacionesService.obtenerUsuariosAprobadores();
          const otrosAprobadores = aprobadores.filter((u) => u.id !== userId);
          if (otrosAprobadores.length > 0) {
            const notifData = otrosAprobadores.map((u) => ({
              usuario_id: u.id,
              tipo: "LIQUIDACION_ACTUALIZADA" as const,
              titulo: `Liquidación ${consecutivo} revertida a borrador`,
              mensaje: `${userName} revirtió la liquidación ${consecutivo} (${clienteNombre}) a estado borrador.`,
              referencia_id: id,
            }));
            await NotificacionesService.crearMasivas(notifData);
            for (const nd of notifData) {
              emitNotificacion(nd);
            }
          }
        } else if (estado === "APROBADA") {
          // Notificar al creador y liquidador que fue aprobada
          const liqCompleta =
            await LiquidacionesServiciosService.obtenerPorId(id);
          const targetIds = new Set<string>();
          if (liqCompleta.creado_por_id && liqCompleta.creado_por_id !== userId)
            targetIds.add(liqCompleta.creado_por_id);
          if (
            liqCompleta.liquidado_por_id &&
            liqCompleta.liquidado_por_id !== userId
          )
            targetIds.add(liqCompleta.liquidado_por_id);
          if (targetIds.size > 0) {
            const notifData = [...targetIds].map((uid) => ({
              usuario_id: uid,
              tipo: "LIQUIDACION_ACTUALIZADA" as const,
              titulo: `Liquidación ${consecutivo} aprobada`,
              mensaje: `${userName} aprobó la liquidación ${consecutivo} (${clienteNombre}).`,
              referencia_id: id,
            }));
            await NotificacionesService.crearMasivas(notifData);
            for (const nd of notifData) {
              emitNotificacion(nd);
            }
          }
        }
      } catch (notifError) {
        console.error("Error creando notificaciones:", notifError);
        // No fallar el cambio de estado por error en notificaciones
      }

      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async estadisticas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const stats = await LiquidacionesServiciosService.estadisticas();
      return reply.send(stats);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async serviciosDisponibles(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const { cliente_id, mes, anio } = request.query as any;
      if (!cliente_id || !mes || !anio) {
        return reply
          .status(400)
          .send({ error: "Se requiere cliente_id, mes y anio" });
      }
      const servicios =
        await LiquidacionesServiciosService.serviciosDisponibles(
          cliente_id,
          Number(mes),
          Number(anio),
        );
      return reply.send(servicios);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerTiposRecargo(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const tipos = await LiquidacionesServiciosService.obtenerTiposRecargo();
      return reply.send(tipos);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerHistorial(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const historial =
        await LiquidacionesServiciosService.obtenerHistorial(id);
      return reply.send(historial);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async obtenerCSV(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any;
      const { buffer, filename } =
        await LiquidacionesServiciosService.obtenerCSV(id);

      reply.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);

      return reply.send(buffer);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  // ── CONFIGURACIÓN LIQUIDADOR DE SERVICIOS ──

  static async obtenerConfigLiquidador(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const config =
        await LiquidacionesServiciosService.obtenerConfigLiquidador();
      return reply.send(config);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }

  static async actualizarConfigLiquidador(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const config =
        await LiquidacionesServiciosService.actualizarConfigLiquidador(
          request.body as any,
        );
      return reply.send(config);
    } catch (error: any) {
      return reply.status(400).send({ error: error.message });
    }
  }

  // ── SOFT DELETE: RESTAURAR Y LISTAR ELIMINADAS ──

  static async restaurar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const result = await LiquidacionesServiciosService.restaurar(id);
      emitLiquidacionServicio("liquidacion-servicio-created", result);
      return reply.send(result);
    } catch (error: any) {
      if (error.message.includes("no encontrada"))
        return reply.status(404).send({ error: error.message });
      return reply.status(500).send({ error: error.message });
    }
  }

  static async listarEliminadas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesServiciosService.listarEliminadas(
        request.query as any,
      );
      return reply.send(result);
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  }
}
