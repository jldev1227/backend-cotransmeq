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

async function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  const OUTBOX = path.resolve(process.cwd(), 'outbox');
  if (!fs.existsSync(OUTBOX)) fs.mkdirSync(OUTBOX, { recursive: true });

  const docs = await prisma.documentos_compartidos.findMany({
    where: { filename: { contains: 'RECARGOS' } },
    include: { conductores: true }
  });

  if (!docs.length) {
    console.log('No se encontraron documentos con RECARGOS en el filename.');
    await prisma.$disconnect();
    return;
  }

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

  for (const doc of docs) {
    try {
      // prepare logo
      const logoPath = path.resolve(process.cwd(), 'email', 'logo.png');
      let logoDataUriOrUrl = '';
      if (fs.existsSync(logoPath)) {
        const buf = fs.readFileSync(logoPath);
        logoDataUriOrUrl = `data:image/png;base64,${buf.toString('base64')}`;
      } else {
        try {
          const fallbackBucket = 'transmeralda';
          const fallbackKey = 'assets/cotransmeq.png';
          const command = new GetObjectCommand({ Bucket: fallbackBucket, Key: fallbackKey });
          const signed = await getSignedUrl(s3Client, command, { expiresIn: 60 * 60 * 24 * 7 });
          logoDataUriOrUrl = signed;
        } catch (err) {
          logoDataUriOrUrl = '';
        }
      }

      const templatePath = path.resolve(process.cwd(), 'email', 'templates', 'payroll_email_template.html');
      if (!fs.existsSync(templatePath)) {
        console.error('Plantilla no encontrada:', templatePath);
        break;
      }

      let html = fs.readFileSync(templatePath, 'utf-8');
      const payrollMonth = 'Febrero 2026';
      const DOMAIN = process.env.EMAIL_DOMAIN || 'https://cotransmeq-app.vercel.app';
      const link = `${DOMAIN}/public/documento/${doc.token}`;
      const firstName = (doc.conductores?.nombre || '').split(' ')[0] || '';
      const lastName = doc.conductores?.apellido || '';

      html = html.replaceAll('{{LOGO_DATAURI}}', logoDataUriOrUrl);
      html = html.replaceAll('{{PAYROLL_MONTH}}', payrollMonth);
      html = html.replaceAll('{{FIRST_NAME}}', firstName);
      html = html.replaceAll('{{LAST_NAME}}', lastName);
      html = html.replaceAll('{{FILENAME}}', doc.filename || 'Tu desprendible');
      html = html.replaceAll('{{LINK}}', link);
      html = html.replaceAll('{{EXPIRES_AT}}', doc.expires_at ? new Date(doc.expires_at).toLocaleString() : '');

      const outFile = path.join(OUTBOX, `sent_${doc.id}.html`);
      fs.writeFileSync(outFile, html, 'utf-8');

      const conductorFull = `${firstName} ${lastName}`.trim() || doc.filename;
      const subject = `Desprendible de Nómina — ${conductorFull} — ${payrollMonth}`;

      const recipient = doc.conductores?.email?.trim();
      if (!recipient) {
        console.log('Omitido (sin email):', doc.filename, 'id=', doc.id);
        continue;
      }

      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipient,
        subject,
        html
      };

      console.log('Enviando correo a', recipient, 'para document id=', doc.id, ' filename=', doc.filename);
      const info = await transporter.sendMail(mailOptions);
      console.log('Enviado:', info.messageId, '->', recipient, 'guardado en', outFile);

      // brief delay to avoid hammering SMTP
      await delay(400);
    } catch (err) {
      console.error('Error al procesar doc', doc.id, err);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error en batch send:', err);
  process.exit(1);
});
