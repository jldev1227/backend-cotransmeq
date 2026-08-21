import { prisma } from '../src/config/prisma'
;(async () => {
  const c: any = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name IN ('es_invitado','invitado_por_id')`)
  console.log('RESULT=' + JSON.stringify(c))
  const fk: any = await prisma.$queryRawUnsafe(`
    SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid='public.users'::regclass AND pg_get_constraintdef(oid) ILIKE '%invitado%'`)
  console.log('FK=' + JSON.stringify(fk))
})().finally(() => prisma.$disconnect())
