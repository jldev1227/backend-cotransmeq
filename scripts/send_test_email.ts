import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { s3Client } from '../src/config/aws';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  const OUTBOX = path.resolve(process.cwd(), 'outbox');
  if (!fs.existsSync(OUTBOX)) fs.mkdirSync(OUTBOX, { recursive: true });

  // Find a documentos_compartidos record that contains WILMER in the filename
  const doc = await prisma.documentos_compartidos.findFirst({
    where: { filename: { contains: 'ROMERO' } },
    include: { conductores: true }
  });

  if (!doc) {
    console.error('No se encontró un registro con WILMER en filename. Abortando.');
    process.exit(1);
  }

  const templatePath = path.resolve(process.cwd(), 'email', 'templates', 'payroll_email_template.html');
  if (!fs.existsSync(templatePath)) {
    console.error('No se encontró la plantilla de email:', templatePath);
    process.exit(1);
  }

  let html = fs.readFileSync(templatePath, 'utf-8');

  // Try to embed logo if exists locally; otherwise try S3 signed URL as fallback
  const logoPath = path.resolve(process.cwd(), 'email', 'logo.png');
  let logoDataUriOrUrl = '';
  if (fs.existsSync(logoPath)) {
    const buf = fs.readFileSync(logoPath);
    const mime = 'image/png';
    logoDataUriOrUrl = `data:${mime};base64,${buf.toString('base64')}`;
  } else {
    // fallback: try to get a signed URL from the transmeralda bucket for assets/cotransmeq.png
    try {
      const fallbackBucket = 'transmeralda';
      const fallbackKey = 'assets/cotransmeq.png';
      const command = new GetObjectCommand({ Bucket: fallbackBucket, Key: fallbackKey });
      const signed = await getSignedUrl(s3Client, command, { expiresIn: 60 * 60 * 24 * 7 });
      logoDataUriOrUrl = signed;
    } catch (err) {
      // leave empty if no logo available
      logoDataUriOrUrl = '';
    }
  }

  const DOMAIN = process.env.EMAIL_DOMAIN || 'https://cotransmeq-app.vercel.app';
  const link = `${DOMAIN}/public/documento/${doc.token}`;

  const conductorName = doc.conductores ? `${doc.conductores.nombre || ''} ${doc.conductores.apellido || ''}`.trim() : '';

  // Replace all occurrences of placeholders (use replaceAll to cover multiple instances)
  html = html.replaceAll('{{LOGO_DATAURI}}', logoDataUriOrUrl);
  const payrollMonth = 'Febrero 2026';
  html = html.replaceAll('{{PAYROLL_MONTH}}', payrollMonth);
  // Some conductor fields in the schema use 'nombre'/'apellido'.
  const firstName = (doc.conductores?.nombre || '').split(' ')[0] || '';
  const lastName = (doc.conductores?.apellido || '') || '';
  html = html.replaceAll('{{FIRST_NAME}}', firstName);
  html = html.replaceAll('{{LAST_NAME}}', lastName);
  html = html.replaceAll('{{FILENAME}}', doc.filename || 'Tu desprendible');
  html = html.replaceAll('{{LINK}}', link);
  html = html.replaceAll('{{EXPIRES_AT}}', doc.expires_at ? new Date(doc.expires_at).toLocaleString() : '');
  html = html.replace('{{LINK}}', link);
  html = html.replace('{{FILENAME}}', doc.filename || 'Tu desprendible');
  html = html.replace('{{EXPIRES_AT}}', doc.expires_at ? new Date(doc.expires_at).toLocaleString() : '');

  const outFile = path.join(OUTBOX, `sent_wilmer_${doc.id}.html`);
  fs.writeFileSync(outFile, html, 'utf-8');

  // Prepare nodemailer transport using SMTP from env
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined;
  const secure = process.env.SMTP_SECURE === 'true';

  if (!host || !port || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    console.error('Faltan variables SMTP en el .env. Revisa SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD.');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  const fullName = `${firstName} ${lastName}`.trim() || conductorName || doc.filename;
  const subject = `Desprendible de Nómina — ${fullName} — ${payrollMonth}`;

  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: '1227jldev@gmail.com',
    subject,
    html
  };

  console.log('Enviando email de prueba a 1227jldev@gmail.com usando:', host, port);
  const info = await transporter.sendMail(mailOptions);

  console.log('Email enviado. messageId=', info.messageId);
  console.log('HTML guardado en', outFile);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error al enviar email:', err);
  process.exit(1);
});
