import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

const envSchema = z.object({
  PORT: z.string().transform(s => Number(s)).default('4000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  // ── Recuperación de contraseña ──────────────────────────────────────
  // Secreto compartido con el frontend (SvelteKit), que es quien emite y
  // verifica el magic link. Viaja en la cabecera `x-recovery-token` y es el
  // único control de acceso de `/api/auth/recuperacion/*`. Sin él, esas rutas
  // responden 503: es preferible a dejarlas abiertas.
  PASSWORD_RECOVERY_SERVICE_TOKEN: z.string().optional(),
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
  // Deep link confiable para solicitudes originadas en la app móvil.
  // No se recibe una URL arbitraria del cliente para evitar open redirects.
  MOBILE_PORTAL_URL: z.string().optional().default('cotransmeq://portal'),
  // Autocompletado de sitios (HERE) para la app móvil; la web usa su propio proxy con la misma clave.
  HERE_MAPS_API_KEY: z.string().optional(),
  // Web Push (notificaciones del navegador). Par VAPID generado con
  // `npx web-push generate-vapid-keys`; la pública también la pide el front por
  // `/api/notificaciones/web-push/clave`. Sin el par, el push web se apaga y la
  // campana sigue funcionando igual. El subject es un `mailto:` de contacto que
  // los servicios de push usan si algo sale mal.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  // Clave de `localStorage` con la que el portal web del conductor guarda su
  // sesión. La lee el impresor de recibos: Chromium navega la página del
  // portal y tiene que sembrar la sesión con la MISMA clave que usa
  // `portalStore` del frontend, o la página se pintaría como no autenticada.
  PORTAL_SESSION_STORAGE_KEY: z.string().optional().default('cotransmeq_portal_token'),
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

  // Maquetación del PDF del desprendible de nómina: 'clasico' (la de
  // siempre) o 'nuevo' (la aprobada en septiembre de 2026). Por defecto
  // 'clasico', para que un entorno sin la variable siga imprimiendo lo
  // mismo que ayer. Ver `nomina-canvas/desprendible.render.ts`.
  DESPRENDIBLE_LAYOUT: z.enum(['clasico', 'nuevo']).optional().default('nuevo'),

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

  // ── Envíos por correo de liquidaciones de terceros (canvas de cierres) ──
  // El requisito es que el tercero vea el correo COMO ENVIADO POR contabilidad
  // y que al responder, la respuesta llegue a ese buzón.
  //
  // Dos maneras de lograrlo, en orden de preferencia:
  //  1. SMTP directo del Gmail de contabilidad (CONTABILIDAD_SMTP_USER +
  //     app password). El From ES el propio Gmail, sin ambigüedad posible.
  //     Gmail limita ~500 envíos/día por cuenta.
  //  2. Resend con dominio verificado (RESEND_FROM) + Reply-To al Gmail de
  //     contabilidad. Resend NO permite From @gmail.com; el nombre visible
  //     se fuerza a LIQ_EMAIL_FROM_NAME y las respuestas van al Reply-To.
  CONTABILIDAD_SMTP_USER: z.string().optional(),
  CONTABILIDAD_SMTP_PASSWORD: z.string().optional(),
  // Nombre visible del remitente en ambos proveedores.
  LIQ_EMAIL_FROM_NAME: z.string().optional().default('Contabilidad Cotransmeq S.A.S.'),
  // Buzón que recibe las respuestas de los terceros. Sin default a propósito:
  // transmeralda lo trae apuntando a su propio Gmail de contabilidad, y
  // heredarlo mandaría las respuestas de los terceros de cotransmeq a la otra
  // empresa. Vacío = sin Reply-To, que es lo que hace el `|| undefined` de
  // envios-email.service.
  LIQ_EMAIL_REPLY_TO: z.string().optional().default(''),
  // Copia oculta de constancia. Vacío = sin BCC, por el mismo motivo que
  // Reply-To. En envíos de PRUEBA nunca se manda BCC.
  LIQ_EMAIL_BCC: z.string().optional().default(''),
  // Pausa entre envíos del lote. Resend limita a 2 req/s; 800ms deja margen.
  ENVIO_LIQ_DELAY_MS: z.string().transform(s => Number(s)).default('800'),
  ENVIO_LIQ_MAX_QUEUE: z.string().transform(s => Number(s)).default('5'),
  ENVIO_LIQ_JOB_TTL_MS: z.string().transform(s => Number(s)).default('600000'),

  // Cómo aplica `requirePermission` (ver middlewares/permissions.middleware.ts).
  //   'enforce' (default) → rechaza con 403.
  //   'warn'              → registra en consola quién habría sido rechazado
  //                         y deja pasar.
  //
  // Hasta oct-2026 el default era 'warn', para estrenar los permisos sin
  // tumbar a nadie, y se quedó así: los permisos que existían solo avisaban.
  // Ahora el default es el estricto y 'warn' queda como salida de emergencia
  // explícita (ponerlo en el .env si un despliegue deja fuera a alguien que sí
  // debía entrar, mientras se corrige el mapa de `config/permissions.ts`).
  //
  // Una lista blanca en `permisos_rutas` y el 401 por falta de sesión se
  // aplican siempre, en los dos modos.
  PERMISSIONS_MODE: z.enum(['warn', 'enforce']).optional().default('enforce'),

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
  // La identidad de un socket sale del token del handshake, nunca del payload
  // de los eventos (ver `sockets/auth.ts`).
  //   'enforce' (default) → rechaza el handshake sin token válido. Un token
  //                         del equipo tiene que tener su sesión abierta; uno
  //                         del portal conecta sin identidad de equipo.
  //   'permissive'        → verifica si viene token y deja pasar si no, con
  //                         rastro en el log. Solo como salida de emergencia:
  //                         un socket anónimo recibe todos los `io.emit`.
  //   'off'               → no instala nada.
  // Hasta oct-2026 el default era 'permissive', puesto para medir antes de
  // apretar; los dos clientes del front ya mandan el token en cada intento.
  SOCKET_AUTH_MODE: z
    .enum(['off', 'permissive', 'enforce'])
    .optional()
    .default('enforce'),

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
  SARLAFT_PUBLIC_API_URL: z.string().optional(),
  // Buzones (separados por coma) que reciben un correo por cada solicitud del
  // formulario público de la landing. Vacío = solo notificación en el panel.
  SOLICITUDES_WEB_EMAIL_TO: z.string().optional()
})

export const env = envSchema.parse(process.env)
