import { CronJob } from "cron";
import { LiquidacionesTercerosOcasionalSnapshotsService } from "../modules/liquidaciones-terceros-ocasional-snapshots/liquidaciones-terceros-ocasional-snapshots.service";
import { logger } from "../utils/logger";

export function startLiquidacionesMensualSnapshotJob() {
  const job = new CronJob(
    "15 * * * *",
    async () => {
      try {
        const r = await LiquidacionesTercerosOcasionalSnapshotsService.capturarHorario();
        const failCount = r.results.filter((x) => !x.ok).length;
        logger.info(
          {
            total: r.total,
            ok: r.capturadas,
            omitidas: r.omitidas,
            fail: failCount,
          },
          "✅ Cron snapshots liquidaciones mensuales ejecutado"
        );
      } catch (error) {
        logger.error(
          { error },
          "❌ Error ejecutando cron snapshots liquidaciones mensuales"
        );
      }
    },
    null,
    true,
    "America/Bogota"
  );

  job.start();
  logger.info(
    "⏰ Cron snapshots liquidaciones mensuales programado: cada hora (xx:15) America/Bogota"
  );

  return job;
}
