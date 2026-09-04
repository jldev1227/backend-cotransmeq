import { Server as IOServer, Socket } from "socket.io";
import { bulkSaveLiquidacionTerceroService } from "./bulk-save-liquidacion-tercero.service";
import { resolveActor } from "../sockets/auth";

export function registerBulkSaveLiquidacionTerceroGateway(io: IOServer) {
  io.on("connection", (socket: Socket) => {
    socket.on(
      "liquidaciones-terceros-save-bulk:cancel",
      ({ jobId, userId }: { jobId: string; userId?: string }) => {
        if (!jobId) return;

        // La identidad sale del token cuando lo hay; el `userId` del payload
        // solo se usa como respaldo y únicamente si `SOCKET_AUTH_MODE` no es
        // `enforce`. Antes se confiaba en él sin más, así que cualquiera con
        // el jobId y un uuid ajeno cancelaba el guardado de otro. Es la misma
        // corrección que ya llevaba `borrador:cancel`, que se quedó sin
        // replicar aquí.
        const actor = resolveActor(socket, userId ? { id: userId } : null);
        if (!actor) {
          console.warn("[bulk-save-queue] cancel rechazado: sin identidad");
          return;
        }

        const ok = bulkSaveLiquidacionTerceroService.cancel(jobId, actor.id);
        console.log(
          `[bulk-save-queue] cancel ${jobId} por ${actor.id}: ${ok ? "aplicado" : "ignorado"}`,
        );
      }
    );
  });
}
