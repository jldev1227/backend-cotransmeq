import { CronJob } from "cron";
import { NominaSnapshotsService } from "../modules/nomina-canvas/nomina-snapshots.service";
import { logger } from "../utils/logger";

/**
 * Captura horaria del canvas de nómina.
 *
 * Corre a los 25 minutos: los 05, 15, 35 y 45 ya los ocupan los snapshots de
 * cierres, ocasional, adicionales y recorridos, y solaparlos alarga el pico de
 * carga sobre la misma base sin ninguna ventaja.
 *
 * Se capturan los dos periodos vivos —el abierto y el que se está
 * liquidando—; el servicio omite la captura si no hay cambios respecto a la
 * última, así que las horas tranquilas no dejan snapshots idénticos.
 */
export function startNominaSnapshotJob() {
  const job = new CronJob(
    "25 * * * *",
    async () => {
      try {
        const r = await NominaSnapshotsService.capturarHorario();
        logger.info(
          { capturados: r.capturados, periodos: r.periodos },
          "✅ Cron snapshots nómina ejecutado"
        );
      } catch (error) {
        logger.error({ error }, "❌ Error ejecutando cron snapshots nómina");
      }
    },
    null,
    true,
    "America/Bogota"
  );

  job.start();
  logger.info(
    "⏰ Cron snapshots nómina programado: cada hora (xx:25) America/Bogota"
  );

  return job;
}
