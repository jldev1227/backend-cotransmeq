import path from 'path';
import dotenv from 'dotenv';
import { S3Client, PutObjectAclCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── Configuración desde .env ───────────────────────────────────────────────────
const AWS_ACCESS_KEY_ID     = process.env.AWS_ACCESS_KEY_ID!;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY!;
const AWS_REGION            = process.env.AWS_REGION!;
const BUCKET_NAME           = process.env.AWS_S3_BUCKET_NAME!;

// ── Cliente S3 ─────────────────────────────────────────────────────────────────
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function validarEnv() {
  const required = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET_NAME'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
}

function buildObjectKey(conductorId: string, filename: string): string {
  return `documentos_compartidos/${conductorId}/${filename}`;
}

// ── Opción 1: URL firmada con vigencia (máx. 7 días = 604800 s) ───────────────
async function generarUrlFirmada(objectKey: string, expiresIn: number = 604800): Promise<string> {
  if (expiresIn > 604800) {
    console.warn(`⚠️  AWS solo permite hasta 7 días (604800 s). Se usará 604800 en lugar de ${expiresIn}.`);
    expiresIn = 604800;
  }

  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey });
  const url = await getSignedUrl(s3Client, command, { expiresIn });

  const dias  = Math.floor(expiresIn / 86400);
  const horas = Math.floor((expiresIn % 86400) / 3600);
  console.log(`\n✅ URL firmada (vigencia: ${dias}d ${horas}h):`);
  console.log(url);
  return url;
}

// ── Opción 2: URL pública permanente (sin vencimiento) ────────────────────────
async function hacerObjetoPublico(objectKey: string): Promise<string> {
  const command = new PutObjectAclCommand({ Bucket: BUCKET_NAME, Key: objectKey, ACL: 'public-read' });
  await s3Client.send(command);

  const encodedKey = objectKey.split('/').map((part) => encodeURIComponent(part)).join('/');
  const url = `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${encodedKey}`;

  console.log('\n✅ URL pública permanente (sin vencimiento):');
  console.log(url);
  console.log('\n⚠️  Este objeto ahora es accesible por cualquier persona con la URL.');
  return url;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  validarEnv();

  const modo        = process.argv[2] ?? 'maxima';
  const conductorId = process.argv[3] ?? '7dfeb448-26eb-4a4f-a84e-34c2fbf08515';
  const filename    = process.argv[4] ?? 'JESUS DAVID TORRES HORMAZA.pdf';
  const segundos    = parseInt(process.argv[5] ?? '604800', 10);

  const objectKey = buildObjectKey(conductorId, filename);

  console.log(`🪣 Bucket : ${BUCKET_NAME}`);
  console.log(`📄 Objeto : ${objectKey}`);
  console.log(`🔧 Modo   : ${modo}`);

  if (modo === 'firmada') {
    await generarUrlFirmada(objectKey, segundos);
  } else if (modo === 'publica') {
    await hacerObjetoPublico(objectKey);
  } else {
    await generarUrlFirmada(objectKey, 604800);
  }
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  if (err.Code === 'AccessDenied' || err.message?.includes('Access Denied')) {
    console.error('💡 Verifica que las credenciales tengan permisos s3:GetObject / s3:PutObjectAcl');
  }
  if (err.message?.includes('PublicAccessBlock')) {
    console.error(
      '💡 El bucket tiene "Block Public Access" activado.\n' +
      '   Ve a S3 > cotransmeq > Permisos > Bloquear acceso público y desactívalo.'
    );
  }
  process.exit(1);
});