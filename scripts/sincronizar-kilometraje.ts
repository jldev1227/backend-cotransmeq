/**
 * Sincroniza `vehiculos.kilometraje` con el último `km_final` reportado en
 * los preoperacionales. Misma lógica que el cron `sincronizar-kilometraje`
 * (cada hora al minuto 20, America/Bogota).
 *
 * Uso:
 *   npx tsx scripts/sincronizar-kilometraje.ts            # aplica
 *   npx tsx scripts/sincronizar-kilometraje.ts --dry-run  # solo muestra
 */
import { ejecutarSincronizacionKilometraje } from '../src/jobs/sincronizar-kilometraje.cron'

const DRY_RUN = process.argv.includes('--dry-run')

const consoleLogger = {
  info: (obj: unknown, msg?: string) => console.log(msg ?? '', JSON.stringify(obj)),
  warn: (obj: unknown, msg?: string) => console.warn(msg ?? '', JSON.stringify(obj)),
  error: (obj: unknown, msg?: string) => console.error(msg ?? '', JSON.stringify(obj)),
}

async function main() {
  const r = await ejecutarSincronizacionKilometraje({ dryRun: DRY_RUN, logger: consoleLogger })
  console.log(`\n${DRY_RUN ? '🟡 DRY-RUN · ' : ''}Placas con reporte: ${r.placasConReporte} · actualizadas: ${r.actualizados} · iguales: ${r.iguales} · menores (no se bajan): ${r.menores}\n`)
  console.log('placa      ficha  →  reporte   fecha        resultado')
  for (const d of r.detalle) {
    console.log(`${d.placa.padEnd(10)} ${String(d.kilometrajeAnterior ?? '—').padStart(7)} → ${String(d.kilometrajeReportado).padStart(8)}   ${d.fechaReporte}   ${d.resultado}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    const { prisma } = await import('../src/config/prisma')
    await prisma.$disconnect()
  })
