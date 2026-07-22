import { Server as IOServer, Socket } from "socket.io";
import { borradorQueueService } from "./borrador-queue.service";

export function registerBorradorQueueGateway(io: IOServer) {
  io.on("connection", (socket: Socket) => {
    socket.on(
      "borrador:cancel",
      ({ job_id, user_id }: { job_id: string; user_id: string }) => {
        if (!job_id || !user_id) return;
        const ok = borradorQueueService.cancel(job_id, user_id);
        if (ok) {
          console.log(
            `[borrador-queue] job ${job_id} cancelled by user ${user_id}`
          );
        }
      }
    );

    socket.on("disconnect", () => {
      // No cancel jobs on disconnect — let them finish.
      // The user can check status when they reconnect.
    });
  });
}
