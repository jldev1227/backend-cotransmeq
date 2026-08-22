# Declaración SARLAFT/PTEE para empresa de transporte — COTRANSMEQ S.A.S.

Quinto formato del módulo SARLAFT + PTEE. A diferencia de los otros cuatro, el
documento final **no lo arma el generador HTML genérico**: se dibuja sobre el
PDF controlado de la marca con `pdf-lib` y `@pdf-lib/fontkit`, y el binario
exacto que se entrega se archiva y se versiona.

| Dato | Valor |
|---|---|
| Código documental | `GC-FOR-13` |
| Versión documental | `01` |
| Tipo lógico | `declaracion_empresa_transporte` |
| Categoría | `individual` (no aparece en el selector público) |
| Ruta pública | `/declaracion-empresa-transporte` en la landing |
| Serie de radicado | `DECL-TRA-<año>-#####` |
| Template | `src/assets/pdf-templates/declaracion-empresa-transporte/GC-FOR-13-v01.pdf` |
| SHA-256 del template | `01797d062fb3ba793207eb9ed45e0dfc00a1a59a9970c5f9c1f62a94e39598ec` |

---

## Cómo funciona el diligenciamiento del PDF

El formato es un PDF de una página, tamaño carta, sin AcroForm: no hay campos
de formulario que rellenar por API. El generador abre la página original y
escribe encima, en coordenadas fijas.

```
declaracion-transporte-template.manifest.ts   identidad del asset + verificación de hash
declaracion-transporte-pdf.coordinates.ts     coordenadas de esta marca (no se comparten)
declaracion-transporte-pdf.service.ts         generador
declaracion-transporte.validacion.ts          reglas de coherencia (puras, testeables)
declaracion-transporte-documentos.service.ts  versiones, entregas y tokens de descarga
declaracion-transporte-email.service.ts       copia al declarante
sarlaft-email-mode.ts                         modo sandbox de correo
```

Garantías que sostiene el generador:

- **No se dibuja sobre un asset desconocido.** El manifiesto registra el
  SHA-256 esperado y `leerTemplateVerificado()` falla si no coincide. Sin eso,
  reemplazar el PDF en disco cambiaría el texto legal que firma el declarante.
- **No se rasteriza.** La página conserva su texto vectorial; los valores se
  añaden como texto seleccionable con fuente incrustada (Roboto, que cubre
  tildes y Ñ).
- **No se trunca en silencio.** Si un valor no cabe de forma legible ni
  reduciendo el tamaño hasta el mínimo, la generación falla con 422 en vez de
  producir un documento ilegible.
- **El subrayado acompaña al dato.** Varias rayas del formato están pensadas
  para escritura a mano y se quedan cortas (la de la sección 2 mide 94 pt y una
  razón social típica pasa de 130 pt). El generador dibuja la continuación
  desde donde termina la raya impresa hasta donde termina el texto, de modo que
  el valor nunca quede medio subrayado. Ver `calcularExtensionSubrayado` y el
  campo `subrayadoHasta` de las coordenadas.
- **Los metadatos se reescriben por completo**, incluido el flujo XMP heredado
  de Word. Sin eso, el documento entregado seguiría declarando el autor del
  archivo original.

### Rotar o corregir el template

1. Copiar el PDF nuevo a `src/assets/pdf-templates/declaracion-empresa-transporte/`
   con nombre versionado (`GC-FOR-13-vN.pdf`). **No se borra el anterior**: los
   documentos ya emitidos siguen refiriéndose a su hash.
2. Calcular su hash: `shasum -a 256 <archivo>`.
3. Actualizar en `declaracion-transporte-template.manifest.ts`: `archivo`,
   `sha256`, `version_template`, `fecha_documento` y `estado_aprobacion`.
4. Revisar las coordenadas: si la maqueta cambió de posición, hay que ajustar
   `declaracion-transporte-pdf.coordinates.ts` y volver a hacer la revisión
   visual.
5. Correr `npm run test:declaracion-transporte` y revisar los PNG de salida.

El campo `estado_aprobacion` es el control: con `pendiente_aprobacion` el
generador funciona en desarrollo y QA, pero **rechaza emitir en producción**.

---

## Ciclo de vida del documento

| Momento | Versión | Estado documental | Casilla Resultado |
|---|---|---|---|
| Envío público | 1 | `recibida` | Ninguna marcada |
| `en_revision` / `escalado` | — (no emite) | — | — |
| `aprobado` | +1 | `evaluada` | Aprobado |
| `condicionado` | +1 | `evaluada` | Condicionado |
| `rechazado` | +1 | `evaluada` | No aprobado |

`escalado` **no** es sinónimo de `condicionado`: deja el caso pendiente de
decisión y por eso no emite versión ni marca casilla.

La versión 1 nunca se actualiza. El índice único
`(formulario_id, clase, version_documento)` lo hace imposible incluso ante dos
decisiones simultáneas.

---

## Base de datos

Dos tablas nuevas. El SQL manual está en
`prisma/migrations/22-08-2026-declaracion-empresa-transporte/migration.sql`,
es idempotente e incluye sus consultas de verificación.

### `formulario_sarlaft_ptee_documento_generado`

Una fila por versión documental emitida. Guarda el `s3_key` del binario, su
`pdf_sha256`, el `template_sha256` con el que se produjo, el estado documental
y quién lo emitió.

Se persiste el binario, no una receta para regenerarlo: regenerar desde el JSON
produciría otro archivo (otra fecha, otro hash) y no serviría como evidencia.

### `formulario_sarlaft_ptee_documento_entrega`

Un registro por intento de entrega, en tres canales:

| Canal | Qué representa |
|---|---|
| `email_interno` | Notificación al área responsable |
| `email_declarante` | Copia enviada al correo confirmado |
| `descarga` | Enlace temporal de un solo documento |

El token del enlace **nunca se almacena en claro**: solo su SHA-256. El índice
único `(documento_generado_id, canal, destinatario, intento)` hace idempotente
el reintento.

---

## Correo

**El declarante NO recibe correo.** Decisión de negocio: el único destinatario
es la configuración interna de `sarlaft-config.ts`, desde donde el área
responsable revisa y resuelve el trámite en el dashboard.

El declarante sí conserva su copia: la descarga desde la pantalla de
confirmación con el enlace temporal. Así el documento no viaja por correo a una
dirección que nadie verificó, y el dato de correo queda solo como canal de
contacto impreso en la declaración.

| | Notificación interna | Copia al declarante |
|---|---|---|
| ¿Se envía? | **Sí, siempre** | **No** (`SARLAFT_CLIENT_COPY_ENABLED=false`) |
| Destinatario | Configuración de `sarlaft-config.ts` | — |
| Adjuntos | PDF + anexos del titular + firmas para auditoría | — |

Si el negocio decide reactivar la copia (`SARLAFT_CLIENT_COPY_ENABLED=true`),
el código sigue en su sitio y envía **solo el PDF generado**: nunca cédulas,
RUT, anexo de alertas, la firma como imagen suelta, IP, user agent ni notas
internas. Ningún correo del módulo usa BCC.

Si el correo falla, el radicado y el documento **se conservan** y la entrega
queda registrada como `fallido`, reintentable.

### Variables

```dotenv
# Correo
SARLAFT_EMAIL_MODE=produccion            # o `sandbox` fuera de producción
SARLAFT_TEST_RECIPIENT=                  # obligatorio si el modo es sandbox
SARLAFT_CLIENT_COPY_ENABLED=false        # copia al declarante (apagada por defecto)
SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS=3600 # vigencia del enlace (tope 24 h)
SARLAFT_PUBLIC_API_URL=                  # URL pública de ESTE backend
```

### Modo sandbox

`SARLAFT_EMAIL_MODE=sandbox` redirige **todos** los correos SARLAFT de la
ejecución al buzón de `SARLAFT_TEST_RECIPIENT`, prefija el asunto con
`[SANDBOX]` y menciona los destinatarios reales solo enmascarados.

Reglas que el código impone:

- **Prohibido en producción.** Con `NODE_ENV=production` el resolutor lanza en
  vez de redirigir en silencio: redirigir correo productivo calladamente sería
  peor que no enviarlo.
- El destinatario de prueba **no se agrega** a la configuración de
  destinatarios autorizados. Vive solo como destino de redirección.
- Nunca se usa BCC, ni siquiera para "ver" qué se envió.
- El log no imprime firmas, tokens ni adjuntos.

---

## Reintentar una entrega fallida

1. Localizar la entrega en el detalle del radicado en el dashboard (canal,
   estado y código de error aparecen ahí).
2. Verificar la causa. Con la copia al declarante apagada, el único canal que
   puede fallar es `email_interno`; si el buzón interno rebota, se corrige la
   configuración y se reintenta. Si el correo del declarante está mal escrito,
   el documento ya está emitido y el dato no se corrige solo — hay que pedirle
   un envío nuevo, porque el correo forma parte del documento firmado.
3. Si la causa fue del proveedor, un reintento sobre el mismo
   `(documento, canal, destinatario)` crea el intento siguiente sin duplicar el
   anterior. Un intento ya exitoso **no** se vuelve a numerar.

---

## Rutas

| Método | Ruta | Auth |
|---|---|---|
| GET | `/api/public/formularios-sarlaft/GC-FOR-13` | No |
| GET | `/api/public/formularios-sarlaft/GC-FOR-13/documentos?alertas=` | No |
| GET | `/api/public/formularios-sarlaft/contacto?tipo=declaracion_empresa_transporte` | No |
| POST | `/api/public/formularios-sarlaft` | No |
| GET | `/api/public/formularios-sarlaft/documentos/descargar?token=` | Token |
| GET | `/api/formularios-sarlaft/:id/documentos-generados/:docId/pdf` | Sí |

El `POST` transporta `correo_confirmacion` **fuera** de `respuestas`: es un
control de captura, no una respuesta del formato, y el backend lo descarta tras
compararlo con `DET-REP-04`.

El catálogo público sigue devolviendo **solo tres** formularios: este formato se
obtiene por código.

---

## Tests no destructivos

```bash
npm run test:declaracion-transporte
```

Corre validación de dominio, generador PDF, integración con Prisma/S3/correo
simulados, modo sandbox y no regresión de los cuatro formatos existentes.

Usa `vitest.declaracion.config.ts`, que **no carga `tests/setup.ts`**: ese setup
abre una conexión Prisma real al importarse y esta suite no debe tocar ninguna
base de datos.

Los PDF de cada caso se escriben en `tests/declaracion-transporte-output/`
(ignorada por Git) para la revisión visual. Para renderizarlos:

```bash
cd tests/declaracion-transporte-output
for f in *.pdf; do pdftoppm -png -r 180 "$f" "${f%.pdf}"; done
```

Qué mirar en la revisión visual: logo y marco completos, texto dentro de líneas
y celdas, firma legible y contenida, **una sola** opción de alertas marcada,
Resultado correcto o totalmente en blanco, y ninguna palabra ni color de la
otra empresa.

### E2E

```bash
node tests/e2e-declaracion-transporte.mjs http://localhost:4010/api --permitir-produccion
```

Requiere backend local contra una **base de datos de QA aislada**, almacenamiento
de QA y correo en modo sandbox. El script se detiene si no se confirma
explícitamente esa configuración: crea radicados reales y dispara correos.
