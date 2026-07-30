import { Server as IOServer, Socket } from "socket.io";
import { bulkSaveLiquidacionTerceroService } from "./bulk-save-liquidacion-tercero.service";

export function registerBulkSaveLiquidacionTerceroGateway(io: IOServer) {
  io.on("connection", (socket: Socket) => {
    socket.on(
      "liquidaciones-terceros-save-bulk:cancel",
      ({ jobId, userId }: { jobId: string; userId: string }) => {
        if (!jobId || !userId) return;
        const ok = bulkSaveLiquidacionTerceroService.cancel(jobId, userId);
        if (ok) {
          console.log(
            `[bulk-save-queue] job ${jobId} cancelled by user ${userId}`
          );
        }
      }
    );
  });
}
