import { Server as IOServer, Socket } from "socket.io";
import { borradorQueueService } from "./borrador-queue.service";
import { resolveActor } from "../sockets/auth";

export function registerBorradorQueueGateway(io: IOServer) {
  io.on("connection", (socket: Socket) => {
    socket.on(
      "borrador:cancel",
      ({ job_id, user_id }: { job_id: string; user_id?: string }) => {
        if (!job_id) return;

        // La identidad sale del token cuando lo hay; el `user_id` del payload
        // solo se usa como respaldo y únicamente si `SOCKET_AUTH_MODE` no es
        // `enforce`. Antes se confiaba en él sin más, así que cualquiera podía
        // cancelar el job de otro sabiendo su uuid.
        const actor = resolveActor(socket, user_id ? { id: user_id } : null);
        if (!actor) {
          console.warn("[borrador-queue] cancel rechazado: sin identidad");
          return;
        }

        const ok = borradorQueueService.cancel(job_id, actor.id);
        console.log(
          `[borrador-queue] cancel ${job_id} por ${actor.id}: ${ok ? "aplicado" : "ignorado"}`,
        );
      },
    );

    socket.on("disconnect", () => {
      // Los jobs NO se cancelan al desconectar: en modo encadenado ya han
      // persistido cierres, y el usuario puede volver y ver el resultado.
    });
  });
}
