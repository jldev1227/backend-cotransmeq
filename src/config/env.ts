import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const envSchema = z.object({
  PORT: z.string().transform(s => Number(s)).default('4000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  RESEND_API_KEY: z.string().optional(),
  // `from` que se usa cuando el proveedor es Resend. Debe ser un dominio
  // verificado en Resend (ej: "Transmeralda <noreply@cotransmeq.com>").
  // Si no se define, el código cae a SMTP_FROM o a noreply@cotransmeq.com.
  RESEND_FROM: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  EMAIL_LOGO_URL: z.string().optional(),
  // URL pública (single, sin coma) usada por los emails para construir enlaces
  // del portal conductor, certificados, invitaciones, etc. Debe ser la URL
  // canónica que verán los destinatarios al hacer clic. Si está vacía, se
  // intenta tomar la primera URL válida de FRONTEND_URL (separadas por coma).
  EMAIL_FRONTEND_URL: z.string().optional(),
  // SMTP fallback (usado cuando no hay RESEND_API_KEY)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(s => Number(s)).optional(),
  SMTP_SECURE: z.string().transform(s => s === 'true').optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Email de copia oculta (BCC) para copias de auditoría de notificaciones
  // a conductores. Si está configurado, se añade como BCC en todos los
  // emails de envío de desprendibles y primas.
  NOTIF_BCC_EMAIL: z.string().optional(),

  // AWS S3 — Certificados Tributarios
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET_NAME: z.string().optional(),

  // Cola de borradores de liquidaciones de terceros
  BORRADOR_QUEUE_CONCURRENCY: z.string().transform(s => Number(s)).default('1'),
  BORRADOR_QUEUE_MAX_SIZE: z.string().transform(s => Number(s)).default('10'),
  BORRADOR_QUEUE_JOB_TTL_MS: z.string().transform(s => Number(s)).default('300000'),

  // Prefijo del número de planilla auto-generado (TM = Transmeralda, CM = Cotransmeq)
  PLANILLA_PREFIX: z.string().trim().min(1).max(5).optional().default('TM'),

  // URL de la base de datos Transmeralda (mismo schema, instancia distinta).
  // Se usa para importar recargos desde Transmeralda hacia Cotransmeq.
  // Si no se define, los endpoints /importar-desde-transmeralda/* devuelven 503.
  TRANSMERALDA_DATABASE_URL: z.string().optional(),

  // ── Checksum nativo de S3 para adjuntos de formularios dinámicos ────
  // Con 'true' (default) el PUT firmado incluye `ChecksumSHA256`, S3 rechaza
  // la subida si los bytes no producen ese digest, y `HeadObject` lo devuelve
  // para que el backend lo compare. Es la única forma de verificar integridad
  // contra los bytes ALMACENADOS y no contra lo que el cliente declara.
  //
  // Ponerlo en 'false' solo si el proveedor compatible con S3 no implementa
  // checksums nativos (algunos MinIO antiguos, Ceph). En ese caso la
  // verificación se hace descargando el objeto en streaming y hasheándolo, que
  // es correcto pero consume red.
  FORMS_S3_NATIVE_CHECKSUM: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v !== 'false'),

  // ── Autenticación de Socket.IO ──────────────────────────────────────
  // Hasta ahora los sockets NO verificaban nada: la identidad venía en el
  // payload de cada evento. El gateway de formularios dinámicos SÍ la exige
  // (`getSocketUser`), así que la verificación se instala en el handshake.
  //
  // Activar el rechazo de golpe tumbaría a la vez chat, colas de borrador y
  // presencia del dashboard, así que se despliega en dos pasos:
  //   'permissive' (default) → verifica el token si viene y deja pasar si no,
  //                            dejando rastro en logs de quién falta migrar.
  //   'enforce'              → rechaza el handshake sin token válido.
  //   'off'                  → no instala nada (comportamiento anterior).
  SOCKET_AUTH_MODE: z
    .enum(['off', 'permissive', 'enforce'])
    .optional()
    .default('permissive'),

  // Orígenes permitidos para Socket.IO, separados por coma. Vacío = '*'
  // (comportamiento anterior). Conviene fijarlo antes de pasar a 'enforce'.
  SOCKET_CORS_ORIGINS: z.string().optional(),

  // ── Correo de los formularios SARLAFT + PTEE ────────────────────────
  //
  // `sandbox` redirige TODOS los correos SARLAFT de la ejecución al buzón de
  // `SARLAFT_TEST_RECIPIENT`, prefija el asunto con [SANDBOX] y menciona los
  // destinatarios reales solo enmascarados. Existe para poder probar el flujo
  // completo (incluida la copia al declarante) sin alcanzar a un proveedor.
  //
  // Está PROHIBIDO en producción: con NODE_ENV=production el resolutor lanza
  // en vez de redirigir en silencio (ver `sarlaft-email-mode.ts`). El
  // destinatario de prueba NO se agrega a CANALES_AUTORIZADOS y nunca se usa BCC.
  SARLAFT_EMAIL_MODE: z.enum(['produccion', 'sandbox']).optional().default('produccion'),
  SARLAFT_TEST_RECIPIENT: z.string().optional(),

  // Copia del PDF al correo del declarante. Apagada por decisión de negocio:
  // el trámite se revisa internamente y el declarante conserva su copia por el
  // enlace temporal de descarga, no por correo. Si alguna vez se activa, el
  // correo lleva SOLO el PDF final: nunca cédulas, RUT, anexos ni la firma
  // como imagen suelta.
  SARLAFT_CLIENT_COPY_ENABLED: z.string().optional().default('false'),

  // Vigencia del enlace temporal de descarga, en segundos (tope de 24 h).
  SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS: z.string().optional().default('3600'),

  // URL pública de ESTE backend, usada para construir el enlace de descarga
  // que viaja en el correo. Si falta, se cae a http://localhost:PORT, que solo
  // sirve en desarrollo.
  SARLAFT_PUBLIC_API_URL: z.string().optional()
})

export const env = envSchema.parse(process.env)
