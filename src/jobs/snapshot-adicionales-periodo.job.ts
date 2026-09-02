import { CronJob } from "cron";
import { LiquidacionesTercerosAdicionalesSnapshotsService } from "../modules/liquidaciones-terceros-adicionales-snapshots/liquidaciones-terceros-adicionales-snapshots.service";
import { logger } from "../utils/logger";

/**
 * Captura horaria de los adicionales de cierres finales.
 *
 * Corre a los 35 minutos, no a los 15 como el del ocasional: los dos
 * recorren `liquidacion_tercero_final` y no tiene sentido solaparlos.
 *
 * Solo se capturan los periodos con actividad en las últimas 24 h. Capturar
 * los 12 meses de cada año cada hora generaría miles de snapshots idénticos.
 */
export function startAdicionalesPeriodoSnapshotJob() {
  const job = new CronJob(
    "35 * * * *",
    async () => {
      try {
        const r = await LiquidacionesTercerosAdicionalesSnapshotsService.capturarHorario();

        // La tabla de snapshots todavía no existe: la migración está
        // pendiente. Es un aviso, no un error — el resto del módulo funciona.
        if (r.omitido) {
          logger.warn(
            { motivo: r.omitido },
            "⏭️  Cron snapshots adicionales omitido"
          );
          return;
        }

        const failCount = r.results.filter((x) => !x.ok).length;
        logger.info(
          {
            total: r.total,
            ok: r.capturados,
            omitidos: r.omitidos,
            fail: failCount,
          },
          "✅ Cron snapshots adicionales por periodo ejecutado"
        );
      } catch (error) {
        logger.error(
          { error },
          "❌ Error ejecutando cron snapshots adicionales por periodo"
        );
      }
    },
    null,
    true,
    "America/Bogota"
  );

  job.start();
  logger.info(
    "⏰ Cron snapshots adicionales programado: cada hora (xx:35) America/Bogota"
  );

  return job;
}
