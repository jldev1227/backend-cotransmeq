import type { Server as IOServer } from "socket.io";
import { getSocketUser } from "../../sockets/auth";
import { liberarNumeroPlanilla, renovarNumeroPlanilla } from "./recargos-planilla-consecutivos";
import { EVENTOS_RESERVA_PLANILLA } from "./recargos-planilla.events";

const ROOM_PLANILLA = "recargos-planilla";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La sala representa formularios abiertos, no números gastados. Al salir o
 * desconectarse se libera su reserva; PostgreSQL sigue coordinando procesos.
 */
export function registerRecargosPlanillaGateway(io: IOServer): void {
  io.on("connection", (socket) => {
    const formularios = new Set<string>();
    const usuarioId = getSocketUser(socket)?.id;
    if (!usuarioId) return;

    socket.on(EVENTOS_RESERVA_PLANILLA.entrar, (payload: { reserva_id?: string }) => {
      const id = payload?.reserva_id;
      if (typeof id !== "string" || !UUID.test(id)) return;
      formularios.add(id);
      socket.join(ROOM_PLANILLA);
      void renovarNumeroPlanilla(id, usuarioId).catch(() => undefined);
    });

    socket.on(EVENTOS_RESERVA_PLANILLA.renovar, (payload: { reserva_id?: string }) => {
      const id = payload?.reserva_id;
      if (typeof id !== "string" || !formularios.has(id)) return;
      void renovarNumeroPlanilla(id, usuarioId).catch(() => undefined);
    });

    socket.on(EVENTOS_RESERVA_PLANILLA.salir, (payload: { reserva_id?: string }) => {
      const id = payload?.reserva_id;
      if (typeof id !== "string" || !formularios.delete(id)) return;
      if (!formularios.size) socket.leave(ROOM_PLANILLA);
      void liberarNumeroPlanilla(id, usuarioId).catch(() => undefined);
    });

    socket.on("disconnect", () => {
      for (const id of formularios) {
        void liberarNumeroPlanilla(id, usuarioId).catch(() => undefined);
      }
      formularios.clear();
    });
  });
}
