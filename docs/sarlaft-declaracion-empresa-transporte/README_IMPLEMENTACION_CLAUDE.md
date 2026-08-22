# Guía de implementación para Claude

## Resultado esperado

Implementar el quinto formato individual `declaracion_empresa_transporte` en las seis aplicaciones listadas en el README principal, manteniendo el comportamiento y branding propios de cada marca.

Antes de editar:

1. Leer el `AGENTS.md` aplicable a cada repositorio.
2. Revisar `git status` y preservar cambios existentes.
3. Confirmar cuál versión corregida del template Transmeralda fue aprobada.
4. No ejecutar migraciones ni conectarse directamente a bases de datos. Si hay cambios de esquema, entregar Prisma y SQL manual idempotente para ejecución humana.

## Orden recomendado

### 1. Congelar los assets documentales

En cada backend crear una carpeta equivalente a:

```text
src/assets/pdf-templates/declaracion-empresa-transporte/
  template.pdf
  template.manifest.ts
```

El manifiesto define marca, código, versión, fecha documental, tamaño de página y SHA-256 esperado. El build ya copia `src/assets`; comprobar que el asset PDF llegue a `dist/assets`.

No referenciar archivos de `Downloads` en runtime.

### 2. Extender el dominio del backend

Archivos principales en ambos backends:

- `src/modules/formularios-sarlaft/formularios-sarlaft.constants.ts`
- `src/modules/formularios-sarlaft/formularios-sarlaft.schema.ts`
- `src/modules/formularios-sarlaft/formularios-sarlaft.service.ts`
- `src/modules/formularios-sarlaft/formularios-sarlaft.controller.ts`
- `src/modules/formularios-sarlaft/formularios-sarlaft.routes.ts`
- `src/modules/formularios-sarlaft/sarlaft-config.ts`

Cambios:

- Agregar `declaracion_empresa_transporte` a `TipoFormularioSarlaft`.
- Agregar el código de la marca al `CodigoFormulario`, registro `FORMULARIOS`, schema Zod y Swagger.
- Registrar una definición `categoria: 'individual'` con los IDs de `README_TEMPLATES_Y_MAPEO.md`.
- Agregar el firmante `DET-FIR-01` al mapa `FIRMANTES`, asociado a `DET-REP-01`.
- Agregar la serie de radicado `DECL-TRA`.
- Extender `extraerDatosClave`: nombre = razón social, documento = NIT, correo/teléfono = representante.
- Agregar validaciones de coherencia y anexos condicionales.
- Extender `getDocumentosRequeridos` y su consumidor para que puedan evaluar las respuestas; hoy solo reciben tipo de formulario y tipo de cliente.
- Agregar contacto por tipo conservando los canales de cada empresa.
- Extender labels de correo y respuestas de API.
- Hacer que `listarAdmin` acepte el nuevo tipo; hoy Transmeralda restringe el tipo en la firma TypeScript a solo tres valores.

El listado público general debe seguir devolviendo solo los tres formularios de categoría `sarlaft`. El nuevo formato se obtiene directamente por código.

### 3. Crear un generador específico

Crear un servicio independiente, por ejemplo:

```text
src/modules/formularios-sarlaft/declaracion-transporte-pdf.service.ts
src/modules/formularios-sarlaft/declaracion-transporte-pdf.coordinates.ts
```

El servicio genérico actual `pdf-generator-sarlaft-html.service.ts` sigue atendiendo los cuatro formatos existentes. En el orquestador:

```ts
if (formulario.tipo === 'declaracion_empresa_transporte') {
  return DeclaracionTransportePdfService.generar(data)
}
return PDFGeneratorSarlaftService.generarPDFSarlaft(data)
```

Requisitos del generador:

- Agregar `pdf-lib` y `@pdf-lib/fontkit`; usar el primero para cargar/dibujar sobre el template y el segundo para incrustar la fuente con caracteres españoles.
- Coordenadas distintas para Transmeralda y Cotransmeq.
- Funciones testeables para ajuste de texto, formato de fecha, casillas y firma.
- No imprimir `data:image...` como texto.
- No incluir metadata HTTP ni notas internas.
- Resultado en blanco para la versión recibida.
- Mapeo exacto del resultado para la versión evaluada.
- Rechazar contenido que no pueda encajar de forma legible.

### 4. Persistir versiones generadas

Se recomienda una tabla dedicada en lugar de reutilizar el adjunto de usuario:

```text
formulario_sarlaft_ptee_documento_generado
  id uuid PK
  formulario_id uuid FK
  marca varchar(30)
  clase varchar(50)
  version_documento int
  estado_documental varchar(20)
  codigo_template varchar(30)
  version_template varchar(20)
  template_sha256 varchar(64)
  s3_key varchar(500)
  mime_type varchar(100)
  tamano_bytes bigint
  pdf_sha256 varchar(64)
  generado_por_id uuid null
  created_at timestamptz
```

Restricciones mínimas:

- unique `(formulario_id, clase, version_documento)`.
- índice por `formulario_id` y `created_at`.
- `ON DELETE CASCADE` al formulario.
- La versión 1 nunca se actualiza; cada resultado final crea una versión nueva.

Agregar una tabla de entregas o un registro equivalente para conservar destinatario, canal, estado, intentos y provider message ID. Nunca guardar tokens de descarga en claro.

Modelo sugerido de entrega:

```text
formulario_sarlaft_ptee_documento_entrega
  id uuid PK
  documento_generado_id uuid FK
  canal varchar(20)                 # email | descarga
  destinatario varchar(255) null
  estado varchar(20)                # pendiente | enviado | fallido | descargado
  proveedor varchar(30) null
  provider_message_id varchar(255) null
  intento int
  error_codigo varchar(80) null
  token_hash varchar(64) null
  expires_at timestamptz null
  completed_at timestamptz null
  created_at timestamptz
  updated_at timestamptz
```

El payload del `POST` debe transportar `correo_confirmacion` fuera de `respuestas`; el backend compara su valor normalizado con `DET-REP-04` y luego lo descarta. Validarlo solo en el navegador no es suficiente.

Seguir las reglas del `AGENTS.md`: actualizar schemas Prisma de dev/producción si existen, crear SQL manual completo y consultas de verificación, pero no aplicarlo.

### 5. Separar notificación interna de entrega al declarante

El servicio actual solo notifica internamente. Agregar dos operaciones explícitas:

- `notificarOficialCumplimiento(...)`: mantiene destinatarios internos y puede incluir PDF + anexos.
- `entregarCopiaDeclarante(...)`: envía solo el PDF generado al correo confirmado del representante.

Reglas para la copia del declarante:

- Asunto con empresa, código y radicado.
- Cuerpo con hash, fecha, estado `Recibido` y recomendación de conservar el radicado.
- Solo el PDF; no adjuntar cédulas, RUT, anexos de alertas ni firmas como PNG separado.
- Si el correo falla, conservar el formulario y marcar la entrega como pendiente/fallida.
- Diseñar reintento idempotente: un mismo `documento_generado_id + destinatario + canal` no debe producir duplicados accidentales.

### 6. Exponer descarga segura al finalizar

Ampliar `SubmitResult` con:

```ts
documento: {
  id: string
  nombre_archivo: string
  sha256: string
  download_url: string
  expires_at: string
}
entrega_email: {
  destinatario_enmascarado: string
  estado: 'enviado' | 'pendiente' | 'fallido'
}
```

El endpoint de descarga pública debe validar un token aleatorio y expiración. El endpoint administrativo autenticado actual puede seguir descargando la última versión o permitir seleccionar versión.

### 7. Integrar las landings

Archivos principales en las dos landings:

- `src/lib/sarlaft/types.ts`
- `src/lib/sarlaft/load.ts`
- `src/lib/sarlaft/FormularioSarlaftApp.svelte`
- `src/lib/sarlaft/FormField.svelte`
- `src/lib/sarlaft/instructivo.ts`
- `src/lib/sarlaft/api.ts`

Crear:

```text
src/routes/declaracion-empresa-transporte/+page.ts
src/routes/declaracion-empresa-transporte/+page.svelte
```

La ruta debe ser `standalone` y cargar por código propio de la marca. El renderer dinámico existente soporta los tipos necesarios, pero requiere:

- confirmación doble de correo;
- validación condicional de observaciones/anexo;
- resumen final antes de enviar;
- pantalla de éxito con botón `Descargar copia`, hash y estado de correo;
- instructivo específico del formato;
- textos, logo, contacto y SEO de la marca correcta.

No agregar el formato al selector de `/formularios-sarlaft` salvo instrucción posterior del negocio.

### 8. Integrar ambos dashboards

Archivos principales:

- `src/lib/api/sarlaft.ts`
- `src/lib/sarlaft/SarlaftRespuestas.svelte`
- `src/routes/dashboard/sarlaft/+page.svelte`
- `src/routes/dashboard/sarlaft/[id]/+page.svelte`

Cambios:

- Ampliar uniones de tipo/código y labels.
- Agregar filtro `Declaración empresa de transporte`.
- Agregar estado `condicionado` con estilo propio.
- Mostrar documento generado, versión, hash y estado de entrega.
- Permitir descargar versión recibida y evaluada.
- Al guardar una decisión final, mostrar confirmación porque se emitirá una nueva versión documental.
- Mantener `SarlaftRespuestas` genérico mediante la definición del backend; no es obligatorio crear un mapa curado.

### 9. Actualizar documentación operativa

Actualizar el README SARLAFT de cada backend con:

- quinto formato y ruta;
- serie de radicado;
- variables de correo sandbox;
- tabla de documentos generados y entregas;
- procedimiento de reintento;
- procedimiento de rotación/versionado del template;
- comandos de test no destructivos.

## Compatibilidad y no regresión

- Los cuatro formatos existentes conservan payload, radicado, PDF HTML, adjuntos y correos actuales.
- El nuevo generador se selecciona solo por tipo/código.
- El endpoint de catálogo sigue listando tres formularios.
- El ZIP administrativo incluye la versión documental solicitada y los anexos, sin duplicar el PDF.
- Cotransmeq no debe contener textos, logos, enlaces o destinatarios de Transmeralda.
- Transmeralda no debe contener textos, logos, enlaces o destinatarios de Cotransmeq.

## Decisiones que deben cerrarse antes de producción

1. Aprobar un template Transmeralda sin recortes y decidir si cambia su versión.
2. Confirmar si `relacion_vehiculos` será opcional, obligatoria o una tabla estructurada.
3. Confirmar si la versión evaluada también se envía automáticamente al declarante.
4. Confirmar el remitente verificado y los contactos internos de Transmeralda para este tipo.
5. Confirmar si el concepto/observaciones internas deben aparecer en la copia evaluada. Por defecto, no.

## Definición de terminado para Claude

- Código implementado en las seis aplicaciones.
- SQL manual entregado, no ejecutado.
- Tests unitarios, integración y E2E agregados.
- PDFs de prueba renderizados y revisados visualmente en ambas marcas.
- Correos sandbox recibidos en `1227jldev@gmail.com`.
- README por backend actualizado.
- Sin cambios de branding cruzados y sin modificar funcionalidades SARLAFT existentes.
