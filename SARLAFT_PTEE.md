# SARLAFT + PTEE — Formularios de conocimiento de COTRANSMEQ S.A.S.

Sistema completo de recepción, custodia y revisión de los formularios de
conocimiento exigidos por la **Resolución 2328 de 2025** y la **Resolución
14673 de 2025**, más el tratamiento de datos personales de la **Ley 1581 de
2012** y el **Decreto 1377 de 2013**.

Cubre tres capas: el diligenciamiento público en la landing, la API que lo
recibe y persiste, y la bandeja del Oficial de Cumplimiento en el dashboard.

---

## Formatos soportados

| Código | Tipo | Categoría | Secciones · Preguntas | Anexos obligatorios |
|---|---|---|---|---|
| `GC-FR-04` | `cliente_proveedor` | sarlaft | 16 · 76 | 2 (PN) / 3 (PJ) |
| `GC-FR-05` | `accionistas` | sarlaft | 10 · 39 | 4 |
| `GC-FR-06` | `personal` | sarlaft | 6 · 25 | 2 de 4 ofrecidos |
| `SLFT-PTEE-FR-12` | `autorizacion_propietario` | individual | 12 · 72 | 6 de 11 ofrecidos |
| `GC-FOR-13` | `declaracion_empresa_transporte` | individual | 7 · 13 | 1 condicional de 2 ofrecidos |

Los de categoría `sarlaft` aparecen en el selector público. `SLFT-PTEE-FR-12` y
`GC-FOR-13` son **formatos individuales**: no se listan, viven en su propia ruta
y se piden por código. `SLFT-PTEE-FR-12` es además el único con **dos firmas**
(propietario del vehículo y tercero autorizado).

`GC-FOR-13` se documenta aparte en
[`README_DECLARACION_EMPRESA_TRANSPORTE.md`](./README_DECLARACION_EMPRESA_TRANSPORTE.md)
porque es el único que **no usa el generador HTML genérico**: se dibuja sobre el
PDF controlado de la marca, se archiva el binario exacto que se entrega y se
versiona cada emisión. También es el único cuyos anexos dependen de una
respuesta condicional y no del tipo de cliente.

### Series de radicado

- `SARLAFT-<año>-CLI-#####` · `-ACC-#####` · `-PER-#####`
- `AUTPROP-<año>-#####` (serie propia de SLFT-PTEE-FR-12)
- `DECL-TRA-<año>-#####` (serie propia de GC-FOR-13)

El correlativo se calcula por conteo anual; ante colisión con el índice único
de `radicado` el servicio reintenta hasta 5 veces con el correlativo desplazado.

---

## Rutas

### Públicas (sin autenticación)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/public/formularios-sarlaft` | Catálogo (solo categoría `sarlaft`) |
| GET | `/api/public/formularios-sarlaft/:codigo` | Estructura completa del formato |
| GET | `/api/public/formularios-sarlaft/:codigo/documentos` | Anexos requeridos (acepta `?tipo_cliente=` y, para GC-FOR-13, `?alertas=`) |
| GET | `/api/public/formularios-sarlaft/documentos/descargar?token=` | Descarga temporal del documento generado (GC-FOR-13) |
| GET | `/api/public/formularios-sarlaft/contacto?tipo=` | Canal de atención por tipo |
| POST | `/api/public/formularios-sarlaft` | Envío `multipart/form-data` |

El `POST` espera un campo `payload` con el JSON de respuestas y un campo
`doc_<tipo_documento>` por cada anexo.

### Admin (requieren JWT)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/formularios-sarlaft` | Listado paginado con búsqueda y filtros |
| GET | `/api/formularios-sarlaft/:id` | Detalle + respuestas + definición del formato |
| GET | `/api/formularios-sarlaft/:id/documentos/:docId/url` | URL firmada de S3 (5 min) |
| PATCH | `/api/formularios-sarlaft/:id/evaluacion` | Estado y concepto del Oficial de Cumplimiento |
| GET | `/api/formularios-sarlaft/:id/pdf` | PDF de respuestas + firmas |
| GET | `/api/formularios-sarlaft/:id/evidencia` | ZIP con PDF + adjuntos originales |

El acceso desde el dashboard exige que el usuario tenga el área
`administracion` o `talento_humano` (ver `src/lib/config/permissions.ts` del
front).

---

## Base de datos

Dos tablas, creadas por `prisma/migrations/manual/2026_sarlaft_ptee.sql`:

- `formulario_sarlaft_ptee` — un registro por radicado; guarda el snapshot
  completo de respuestas en `jsonb`, los datos clave extraídos para búsqueda,
  el contexto HTTP (IP, user agent, referer) y la evaluación interna.
- `formulario_sarlaft_ptee_documento` — anexos en S3, con `hash_sha256` y
  unicidad por `(formulario_id, tipo_documento)`.

El script es **idempotente** (`IF NOT EXISTS` / bloques `DO $$`) y no borra ni
trunca nada, así que puede reejecutarse sin riesgo:

```bash
psql "$DATABASE_URL" -f prisma/migrations/manual/2026_sarlaft_ptee.sql
npx prisma generate     # regenera el cliente con los dos modelos
```

---

## Configuración

### Destinatarios y canales (`sarlaft-config.ts`)

**Canales autorizados.** Sólo dos buzones pueden recibir formularios SARLAFT +
PTEE. Están declarados como literales en `CANALES_AUTORIZADOS` dentro de
`sarlaft-config.ts` y **no** son configurables por entorno: son el punto de
control de a dónde sale información con documento de identidad y firma
manuscrita, así que ampliarlos exige un cambio de código revisable.

| Buzón | Uso |
|---|---|
| `compras.cotransmeq@hotmail.com` | Compras / Proveedores |
| `cotransmeqreportesla@gmail.com` | Reportes de Cumplimiento |

**Los dos buzones reciben todos los tipos de formulario.** Van en `to` (no en
BCC) para que Compras y Cumplimiento se vean entre sí y no dupliquen la gestión
del mismo radicado.

Lo que sí varía por tipo es el `correo_publico`, que no recibe nada: es el canal
de dudas que se le muestra al titular tras enviar el formulario.

| Tipo | Área | Correo mostrado al titular |
|---|---|---|
| `cliente_proveedor` | Operaciones | `compras.cotransmeq@hotmail.com` |
| `accionistas` | Cumplimiento | `cotransmeqreportesla@gmail.com` |
| `personal` | Talento Humano | `cotransmeqreportesla@gmail.com` |
| `autorizacion_propietario` | Cumplimiento | `cotransmeqreportesla@gmail.com` |

Lo que se puede ajustar por entorno:

| Variable | Default |
|---|---|
| `SARLAFT_EMPRESA_NOMBRE` | `COTRANSMEQ S.A.S.` |
| `SARLAFT_TELEFONO` / `SARLAFT_TELEFONO_WA` | `+57 302 571 1858` / `573025711858` |
| `SARLAFT_EMAILS_CLIENTE_PROVEEDOR` | ambos buzones |
| `SARLAFT_EMAILS_ACCIONISTAS` | ambos buzones |
| `SARLAFT_EMAILS_PERSONAL` | ambos buzones |
| `SARLAFT_EMAILS_AUTORIZACION_PROPIETARIO` | ambos buzones |

Las listas aceptan varios correos separados por coma, pero **se filtran contra
`CANALES_AUTORIZADOS`**: cualquier dirección fuera de la lista blanca se
descarta con un `console.warn` y, si el override queda vacío, se cae al
destinatario por defecto.

> El correo de notificación **nunca lleva BCC**: contiene datos personales
> sensibles (documento, firma manuscrita) y va directo al Oficial de
> Cumplimiento. El `NOTIF_BCC_EMAIL` del `.env` aplica solo a las
> notificaciones de conductores.

### Remitente (`from`) y Resend

Con `RESEND_API_KEY` presente el proveedor activo es Resend, que **rechaza con
HTTP 403 cualquier remitente cuyo dominio no esté verificado**. El único
dominio verificado de la cuenta es `cotransmeq.com`, así que el `from` debe
salir de ahí (`RESEND_FROM=Cotransmeq <noreply@cotransmeq.com>`).

El módulo SARLAFT no fija su propio `from`: delega en `EmailService.sendEmail`,
que elige `RESEND_FROM` con Resend y `SMTP_FROM` con SMTP. Fijarlo a mano fue
la causa de que las notificaciones no llegaran — tomaba `SMTP_FROM`, que apunta
a una cuenta `@gmail.com`, y Resend devolvía *"The gmail.com domain is not
verified"*.

### CORS

`src/app.ts` debe listar el origen desde el que se sirven los formularios. Ya
incluye `https://www.cotransmeq.com`, `https://cotransmeq.com` y las variantes
locales. **Un origen no listado hace fallar el `load` del formulario** y la
página cae al aviso de "Error de conexión".

### Landing

`PUBLIC_API_URL` apunta al backend. Se usa `127.0.0.1` y no `localhost`: en
Node 20+ `localhost` resuelve primero a `::1` y el backend escucha en
`0.0.0.0` (solo IPv4), así que el fetch de SSR fallaría.

---

## Rutas públicas de la landing

| Ruta | Contenido |
|---|---|
| `/formularios-sarlaft` | Selector con los tres formatos SARLAFT |
| `/formularios-sarlaft/clientes-proveedores` | Solo GC-FR-04, sin selector |
| `/formularios-sarlaft/personal-accionistas` | Selector reducido a GC-FR-05 y GC-FR-06 |
| `/autorizacion-propietario` | Solo SLFT-PTEE-FR-12, sin selector |

Las tres últimas son `standalone`: no ofrecen enlaces de vuelta al sitio, para
poder compartirlas como un documento cerrado.

---

## Pruebas

`node tests/e2e-sarlaft.mjs [baseUrl]` recorre el flujo completo: catálogo,
estructura de los 4 formatos, anexos requeridos, contacto, rechazo de envíos
incompletos, envío real con firma y adjuntos, y toda la cara admin
(autenticación, listado, filtros, detalle, URL firmada, evaluación, PDF y ZIP).

Las respuestas del envío se generan recorriendo la definición que devuelve el
propio backend, así que la prueba sigue siendo válida si cambian las preguntas.
