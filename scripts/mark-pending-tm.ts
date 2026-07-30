import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Apunta a la DB de Transmeralda (la que está fallando)
const p = new PrismaClient({
  datasources: {
    db: { url: process.env.TRANSMERALDA_DATABASE_URL }
  }
});

const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations');

async function main() {
  console.log(`[INFO] Apuntando a: ${process.env.TRANSMERALDA_DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}`);

  // 1. Listar migraciones ya aplicadas
  const applied: any[] = await p.$queryRawUnsafe(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'
  );
  const appliedSet = new Set(applied.map((r) => r.migration_name));
  console.log(`[INFO] Migraciones aplicadas en Transmeralda: ${appliedSet.size}`);

  // 2. Listar todas las migraciones en el filesystem
  const all = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  // 3. Encontrar las pendientes
  const pending = all.filter((m) => !appliedSet.has(m));
  console.log(`[INFO] Migraciones pendientes: ${pending.length}`);
  for (const m of pending) {
    console.log(`  - ${m}`);
  }

  // 4. Marcar como aplicadas
  console.log(`\n[ACTION] Marcando ${pending.length} migraciones como aplicadas en Transmeralda...`);

  let marked = 0;
  for (const name of pending) {
    try {
      const existing: any[] = await p.$queryRawUnsafe(
        'SELECT id FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1',
        name
      );
      if (existing.length > 0) {
        console.log(`  [SKIP] ${name} (ya existe)`);
        continue;
      }
      const started_at = new Date();
      const finished_at = new Date();
      const applied_steps_count = 1;
      await p.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations"
         (id, checksum, migration_name, logs, started_at, finished_at, applied_steps_count)
         VALUES (gen_random_uuid()::text, '', $1, NULL, $2, $3, $4)`,
        name,
        started_at,
        finished_at,
        applied_steps_count
      );
      marked++;
      console.log(`  [OK] ${name}`);
    } catch (e: any) {
      console.error(`  [ERR] ${name}: ${e.message}`);
    }
  }

  console.log(`\n[DONE] ${marked}/${pending.length} migraciones marcadas como aplicadas`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
