import { CronJob } from "cron";
import { RecorridosSnapshotsService } from "../modules/recorridos-canvas/recorridos-snapshots.service";
import { logger } from "../utils/logger";

/**
 * Captura horaria del canvas de recorridos.
 *
 * Corre a los 45 minutos: los 05, 15 y 35 ya están ocupados por los snapshots
 * de cierres, ocasional y adicionales, y solaparlos alarga el pico de carga
 * sobre la misma base sin ninguna ventaja.
 *
 * Solo se capturan el mes en curso y —durante los primeros diez días— el
 * anterior, que sigue editándose mientras se cierra la planilla. El servicio
 * además omite la captura si no hay cambios respecto a la última, así que las
 * horas tranquilas no dejan snapshots idénticos.
 */
export function startRecorridosSnapshotJob() {
  const job = new CronJob(
    "45 * * * *",
    async () => {
      try {
        const r = await RecorridosSnapshotsService.capturarHorario();
        logger.info(
          { capturados: r.capturados, periodos: r.periodos },
          "✅ Cron snapshots recorridos ejecutado"
        );
      } catch (error) {
        logger.error({ error }, "❌ Error ejecutando cron snapshots recorridos");
      }
    },
    null,
    true,
    "America/Bogota"
  );

  job.start();
  logger.info(
    "⏰ Cron snapshots recorridos programado: cada hora (xx:45) America/Bogota"
  );

  return job;
}
