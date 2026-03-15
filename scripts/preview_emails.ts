import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  const outdir = path.resolve(process.cwd(), 'outbox');
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });

  const docs = await prisma.documentos_compartidos.findMany({
    include: { conductores: true }
  });

  const rows = docs.map((d) => {
    const conductor = d.conductores;
    const conductorName = conductor ? `${conductor.nombre || ''} ${conductor.apellido || ''}`.trim() : '';
    const conductorEmail = conductor?.email || '';
    return {
      id: d.id,
      filename: d.filename,
      token: d.token,
      conductorName,
      conductorEmail
    };
  });

  const csvPath = path.join(outdir, 'preview_emails.csv');
  const jsonPath = path.join(outdir, 'preview_emails.json');

  const header = 'id,filename,token,conductorName,conductorEmail\n';
  const csv = header + rows.map(r => `${r.id},"${r.filename}",${r.token},"${r.conductorName}",${r.conductorEmail}`).join('\n');
  fs.writeFileSync(csvPath, csv, 'utf-8');
  fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf-8');

  console.log(`Wrote ${rows.length} rows to ${csvPath} and ${jsonPath}`);
  console.table(rows.map(r => ({ filename: r.filename, token: r.token, conductor: r.conductorName, email: r.conductorEmail })));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error previewing emails:', err);
  await prisma.$disconnect();
  process.exit(1);
});
