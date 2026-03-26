// send-single.ts
// Uso:
// npx ts-node send-single.ts \
//   --token <sharetoken> \
//   --to <email@destino.com> \
//   --month "Febrero 2026"

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { s3Client } from '../src/config/aws';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── Argumentos ────────────────────────────────────────────────────────────────
function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
function requireArg(flag: string): string {
  const v = arg(flag);
  if (!v) { console.error(`Falta argumento requerido: ${flag}`); process.exit(1); }
  return v!;
}

const TOKEN = requireArg('--token');
const TO    = requireArg('--to');
const MONTH = arg('--month') ?? 'Febrero 2026';
// ─────────────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();

async function main() {
  // ── Validar SMTP desde .env ───────────────────────────────────────────────
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, EMAIL_DOMAIN } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD) {
    console.error('Faltan variables SMTP en el .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD)');
    process.exit(1);
  }

  // ── Buscar documento ──────────────────────────────────────────────────────
  const doc = await prisma.documentos_compartidos.findFirst({
    where: { token: TOKEN },
    include: { conductores: true }
  });

  if (!doc) {
    console.error(`No se encontró ningún documento con token="${TOKEN}"`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── Logo ──────────────────────────────────────────────────────────────────
  const logoPath = path.resolve(process.cwd(), 'email', 'logo.png');
  let logoDataUriOrUrl = '';

  if (fs.existsSync(logoPath)) {
    const buf = fs.readFileSync(logoPath);
    logoDataUriOrUrl = `data:image/png;base64,${buf.toString('base64')}`;
  } else {
    try {
      const cmd = new GetObjectCommand({ Bucket: 'transmeralda', Key: 'assets/cotransmeq.png' });
      logoDataUriOrUrl = await getSignedUrl(s3Client, cmd, { expiresIn: 60 * 60 * 24 * 7 });
    } catch {
      logoDataUriOrUrl = '';
    }
  }

  // ── Plantilla ─────────────────────────────────────────────────────────────
  const templatePath = path.resolve(process.cwd(), 'email', 'templates', 'payroll_email_template.html');
  if (!fs.existsSync(templatePath)) {
    console.error('Plantilla no encontrada:', templatePath);
    process.exit(1);
  }

  const firstName = (doc.conductores?.nombre || '').split(' ')[0] || '';
  const lastName  = doc.conductores?.apellido || '';
  const link      = `${EMAIL_DOMAIN ?? 'https://cotransmeq-app.vercel.app'}/public/documento/${doc.token}`;

  let html = fs.readFileSync(templatePath, 'utf-8');
  html = html.replaceAll('{{LOGO_DATAURI}}', logoDataUriOrUrl);
  html = html.replaceAll('{{PAYROLL_MONTH}}', MONTH);
  html = html.replaceAll('{{FIRST_NAME}}',    firstName);
  html = html.replaceAll('{{LAST_NAME}}',     lastName);
  html = html.replaceAll('{{FILENAME}}',      doc.filename || 'Tu desprendible');
  html = html.replaceAll('{{LINK}}',          link);
  html = html.replaceAll('{{EXPIRES_AT}}',    doc.expires_at ? new Date(doc.expires_at).toLocaleString() : '');

  // ── Guardar preview ───────────────────────────────────────────────────────
  const OUTBOX = path.resolve(process.cwd(), 'outbox');
  if (!fs.existsSync(OUTBOX)) fs.mkdirSync(OUTBOX, { recursive: true });
  const outFile = path.join(OUTBOX, `sent_single_${doc.id}.html`);
  fs.writeFileSync(outFile, html, 'utf-8');

  // ── Envío ─────────────────────────────────────────────────────────────────
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT, 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
  });

  const conductorFull = `${firstName} ${lastName}`.trim() || doc.filename;
  const subject = `Desprendible de Nómina — ${conductorFull} — ${MONTH}`;

  console.log(`Enviando a ${TO} (doc id=${doc.id}, token=${TOKEN}) ...`);
  const info = await transporter.sendMail({
    from: SMTP_FROM ?? SMTP_USER,
    to: TO,
    subject,
    html
  });

  console.log('✅ Enviado:', info.messageId, '→', TO);
  console.log('   Preview guardado en:', outFile);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});