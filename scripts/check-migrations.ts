import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  try {
    const rows: any[] = await p.$queryRawUnsafe(
      'SELECT migration_name, finished_at IS NOT NULL as applied FROM "_prisma_migrations" ORDER BY started_at'
    );
    console.log(`Total migraciones registradas: ${rows.length}`);
    for (const r of rows) {
      console.log(`  ${r.applied ? '[OK]' : '[--]'} ${r.migration_name}`);
    }
  } catch (e: any) {
    console.error('Error:', e.message);
  } finally {
    await p.$disconnect();
  }
}
main();
