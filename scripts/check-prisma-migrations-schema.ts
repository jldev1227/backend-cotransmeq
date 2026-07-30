import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const cols: any[] = await p.$queryRawUnsafe(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '_prisma_migrations' ORDER BY ordinal_position"
  );
  console.log('Columnas de _prisma_migrations:');
  for (const c of cols) console.log(`  ${c.column_name} (${c.data_type}, ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'})`);
  await p.$disconnect();
}
main();
