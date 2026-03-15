import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function loadTemplate() {
  const tplPath = path.resolve(__dirname, '../email/templates/payroll_email_template.html');
  return fs.readFileSync(tplPath, 'utf-8');
}

function base64Logo() {
  try {
    const logoPath = path.resolve(__dirname, '../public/assets/logo.png');
    if (!fs.existsSync(logoPath)) return '';
    const data = fs.readFileSync(logoPath);
    const mime = 'image/png';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (e) {
    return '';
  }
}

function replacePlaceholders(template: string, placeholders: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(placeholders)) {
    out = out.replace(new RegExp(`{{${k}}}`, 'g'), v || '');
  }
  return out;
}

async function main() {
  console.log('Generando ejemplos de correos para documentos compartidos...');
  const template = await loadTemplate();
  const logoData = base64Logo();

  // Query documentos_compartidos that have an associated conductor with email
  const docs = await prisma.documentos_compartidos.findMany({
    where: { conductor_id: { not: null } },
    include: { conductores: true }
  });

  if (!docs || docs.length === 0) {
    console.log('No se encontraron documentos compartidos asociados a conductores.');
    await prisma.$disconnect();
    return;
  }

  const outdir = path.resolve(__dirname, '../outbox');
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir);

  const domain = process.env.DOMAIN || 'http://midominio.local';
  const payrollMonth = 'Febrero';

  for (const doc of docs) {
    const conductor = (doc as any).conductores;
    const toEmail = conductor?.email || 'no-email@example.com';
    const link = `${domain}/public/documento/${doc.token}`;
    const expiresAt = doc.expires_at ? new Date(doc.expires_at).toLocaleString('es-CO') : 'N/A';

    const html = replacePlaceholders(template, {
      LOGO_DATAURI: logoData || '',
      PAYROLL_MONTH: payrollMonth,
      FIRST_NAME: conductor?.nombre || '',
      LAST_NAME: conductor?.apellido || '',
      LINK: link,
      FILENAME: doc.filename || doc.original_name || '',
      EXPIRES_AT: expiresAt
    });

    // Save an example file per-conductor addressed to the developer email (example)
    const filename = `example_email_for_${(conductor?.numero_identificacion || 'noid')}_to_1227jldev.html`;
    const outPath = path.join(outdir, filename);
    // We include a small header with the intended To: so you can see it at a glance
    const emailWithMeta = `<!-- To: ${toEmail} -->\n<!-- Subject: Desprendible de Nómina - ${payrollMonth} -->\n${html}`;
    fs.writeFileSync(outPath, emailWithMeta, 'utf-8');
    console.log(`Ejemplo generado: ${outPath} (destinatario real: ${toEmail})`);
  }

  console.log('\nGeneración completada. NO se enviaron correos.');
  console.log('Para enviar realmente los correos, revisa scripts/send_payroll_emails.ts (no creado automáticamente por seguridad).');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
