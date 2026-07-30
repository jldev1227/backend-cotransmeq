import { PrismaClient } from '@prisma/client';

const tmUrl = process.env.TRANSMERALDA_DATABASE_URL;
if (!tmUrl) {
  console.error('Falta TRANSMERALDA_DATABASE_URL');
  process.exit(1);
}

const tm = new PrismaClient({ datasources: { db: { url: tmUrl } } });

async function main() {
  console.log('[INFO] Apuntando a TRANSMERALDA:', tmUrl.replace(/:[^:@]+@/, ':***@'));

  // 1. Verificar columnas en recargos_planillas
  const cols: any[] = await tm.$queryRawUnsafe(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'recargos_planillas'
      AND column_name IN ('imported_from_transmeralda_id', 'imported_from_transmeralda_at')
  `);
  console.log(`\n[INFO] Columnas 'imported_from_transmeralda_*' en recargos_planillas (Transmeralda):`);
  if (cols.length === 0) {
    console.log('  ❌ NO EXISTEN');
  } else {
    for (const c of cols) console.log(`  ✓ ${c.column_name} (${c.data_type})`);
  }

  // 2. Verificar si la tabla _prisma_migrations existe
  try {
    const migs: any[] = await tm.$queryRawUnsafe(`
      SELECT migration_name, finished_at IS NOT NULL as applied
      FROM "_prisma_migrations"
      ORDER BY started_at
    `);
    console.log(`\n[INFO] Migraciones aplicadas en Transmeralda: ${migs.length}`);
    for (const m of migs) console.log(`  ${m.applied ? '[OK]' : '[--]'} ${m.migration_name}`);
  } catch (e: any) {
    console.log(`\n[WARN] _prisma_migrations: ${e.message}`);
  }

  await tm.$disconnect();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
