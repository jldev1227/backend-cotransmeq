# Formularios dinámicos

`/api/formularios`, `/api/form-field-templates`, `/api/conductor-portal/formularios`, `/api/mis-formularios` · código en [`src/modules/formularios-dinamicos/`](../../src/modules/formularios-dinamicos/) · permisos [`formularios`](../permisos.md#catálogo-de-módulos) (constructor) y [`mis-formularios`](../permisos.md#catálogo-de-módulos) (diligenciar desde el dashboard); el portal del conductor entra con el token del magic link

Motor de formatos HSEQ versionados (preoperacionales, inspecciones, listas de
chequeo). Un **formulario** (`form_definitions`, `code` único en mayúsculas)
tiene **versiones** (`form_versions`: `DRAFT` → `PUBLISHED` → `ARCHIVED`) con
un árbol de secciones, campos (19 tipos, un nivel de anidación para
repetibles/matrices), opciones y reglas de visibilidad. Una **asignación**
(`form_assignments` + `form_assignment_targets`) decide qué versión publicada
diligencia quién, con qué frecuencia y con qué límite; cada diligenciamiento es
un **envío** (`form_submissions`) con respuestas (`form_answers`,
`form_answer_options`), adjuntos (`form_attachments`) y bitácora
(`form_submission_events`). Las **plantillas de cards** (`form_field_templates`)
son campos prearmados para el builder.

Hay tres registros de rutas en `src/app.ts` porque se autentican distinto: el
**constructor** (dashboard, permiso `formularios`), el **portal del conductor**
(JWT del magic link) y **«mis formularios»** (usuario interno que diligencia lo
que le asignaron, permiso `mis-formularios`). Los dos últimos comparten entero
`formularios-portal.service.ts`: límites, idempotencia, validación de respuestas
y adjuntos son el mismo código; solo cambia de dónde sale el actor. Reglas que
un integrador necesita saber:

- **Solo un `DRAFT` se edita.** Publicar revalida el árbol completo y lo
  congela; «editar» algo publicado es clonarlo (`/clone`, ids nuevos). Archivar
  solo impide asignaciones y envíos nuevos; no toca lo enviado.
- **Una asignación apunta siempre a una versión `PUBLISHED`** y su `versionId`
  no cambia: para pasar a otra versión se crea otra asignación y se cierra la
  vieja. Targets: `ALL_CONDUCTORS`, `CONDUCTOR`, `VEHICLE` (alcanza al conductor
  asignado al vehículo), `SEDE` (igualdad exacta con `conductores.sede_trabajo`,
  sensible a mayúsculas), `GROUP` (**no lo resuelve nadie**: una asignación solo
  con `GROUP` no le aparece a nadie), `ALL_USERS`, `USER`, `AREA` y `CARGO`
  (insensible a mayúsculas). Las dos familias se mezclan en una misma asignación.
- **Accesible** = asignación `ACTIVE` y no borrada, versión `PUBLISHED`,
  formulario vivo y algún target que alcance al actor (`condicionAcceso`).
  Áreas, cargo, sede y vehículos se releen de la base en cada petición, nunca del
  JWT. Para ver la definición y enviar, además, «ahora» tiene que caer entre
  `startsAt` y `endsAt` (reloj del servidor).
- **La identidad sale siempre del token.** Ningún `conductorId`/`usuarioId` del
  body autoriza nada; la propiedad de un envío se filtra por `conductor_id` o
  `usuario_id` del actor.
- **El envío es idempotente por `clientSubmissionId`** (UUID que genera el
  cliente antes de empezar). Un reintento con el mismo contenido devuelve el
  envío existente con `idempotentReplay: true` (HTTP 200); con otro contenido,
  `IDEMPOTENCY_PAYLOAD_MISMATCH`. La huella cubre `assignmentId`, `versionId`,
  `context`, respuestas (ordenadas) y adjuntos (`clientAttachmentId` + `sha256`).
- **Borrador y envío guardan las respuestas en columnas distintas y
  disjuntas.** El backup del borrador (`PUT …/drafts/:clientSubmissionId`) mete
  cada valor sin tipar ni validar en `value_json` como `{draftValue}` o
  `{draftOptionValues}` (un `"12,"` a medio teclear no se pierde); el envío final
  usa las columnas tipadas y `form_answer_options`. La API lo oculta
  (`toAnswerDto()` deshace la envoltura), pero cualquier SQL o informe sobre
  `form_answers` tiene que cubrir las dos formas.
- **Límites** (`limitPolicy`), contados sobre `SUBMITTED` vivos del mismo actor
  (cada conductor o usuario tiene su cupo): `ONE_PER_PERIOD` uno por período de
  la frecuencia; `ONE_PER_CONTEXT` uno por período y `context.vehicleId`;
  `ONCE` limita a uno aunque la política sea `UNLIMITED`. Con `ON_DEMAND` o
  `PER_SERVICE` no hay período, así que `ONE_PER_*` significa «uno para siempre»
  (por vehículo en `ONE_PER_CONTEXT`). Los `VOIDED` no cuentan.
- **Fechas del servidor.** `businessDate` y `periodKey` se calculan al guardar
  o enviar, en la zona de la asignación (`America/Bogota` por defecto).
  `context.filledOn` (fecha del formulario) la escribe el servidor a partir del
  `startedAt` más antiguo conocido y descarta la que mande el cliente.
- **La evidencia no pasa por la API.** `attachments/init` reserva la fila y
  devuelve una URL prefirmada de S3; el cliente hace `PUT` directo al bucket y
  `attachments/:id/complete` verifica el SHA-256 contra los bytes almacenados.
  Ver [`POST /api/conductor-portal/formularios/attachments/init`](#post-apiconductor-portalformulariosattachmentsinit).
- **Descartar** es borrado lógico (`deleted_at`) y solo de `DRAFT`; un
  `SUBMITTED` no se borra: se **anula** (`VOIDED`, con motivo) y conserva todo.

Especificación histórica del módulo (en el repo del frontend):
[`README_FORMULARIOS_DINAMICOS.md`](../../README_FORMULARIOS_DINAMICOS.md). Sus
enlaces apuntan a `../ingreso-svelte/…` (el frontend de Transmeralda); aquí la
misma especificación está en `cotransmeq-app/docs/formularios-dinamicos/`. Está
desactualizada en la audiencia (no conoce los targets de usuarios internos y
habla de «grupo» como si funcionara); el código manda.

## Acceso

| Superficie | Rutas | Guarda |
|---|---|---|
| Constructor | `/api/formularios/**`, `/api/form-field-templates/**` | `sesión` (hook `onRequest` del plugin) + por ruta `formularios:read` (lecturas, `…/validate` y `documento/pdf`) o `formularios:full` (escrituras). `formularios` es `full` para `administracion` y `hseq`, `read` para `operaciones` |
| Portal del conductor | `/api/conductor-portal/formularios/**` | `portal`: `portalAuthMiddleware` propio del archivo exige `Authorization: Bearer` con un JWT firmado con `JWT_SECRET` y `tipo: 'conductor_portal'`, sin vencer (30 días) y todavía registrado (`tokenPortalRegistrado`: su fila de `conductor_token` existe, no ha vencido y el conductor no está borrado; caché de 30 s). Sin áreas ni permisos de módulo |
| Portal: token de impresión | `GET /api/conductor-portal/formularios/submissions/:id` | Además acepta `tipo: 'conductor_portal_print'` (3 min de vida) solo en esa ruta declarada, con método `GET` y `:id` igual a su `sid`; fuera de eso, 403 `FORBIDDEN` «Token fuera de su alcance». No se guarda en `conductor_token` y no pasa por la comprobación de registro |
| Mis formularios | `/api/mis-formularios/**` | `sesión` + `mis-formularios:read`. El módulo es `general: true`: cualquier usuario del equipo pasa, salvo que tenga lista blanca en `permisos_rutas` sin `mis-formularios` |
| En el servicio | portal y mis formularios | Propiedad: cada lectura o escritura de un envío filtra por el `conductor_id`/`usuario_id` del actor. Audiencia: los targets de la asignación (`condicionAcceso`) deciden si el actor puede abrirla, respaldar borradores o enviar |

Respuestas de las guardas: `authMiddleware` responde 401 `{ "error": … }`;
`requirePermission` 403 `{ "error", "message" }`; `portalAuthMiddleware` 401
`{ "success": false, "error": { "code": "UNAUTHORIZED", "message": … } }`, con
el mensaje «Tu acceso al portal venció o fue revocado. Pide un enlace nuevo.»
cuando el token ya no está registrado.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/formularios` | `formularios:read` | Catálogo paginado con versiones y conteos |
| POST | `/api/formularios` | `formularios:full` | Crea el formulario y su versión 1 en `DRAFT` |
| GET | `/api/formularios/:formId` | `formularios:read` | Formulario con el resumen de todas sus versiones |
| PATCH | `/api/formularios/:formId` | `formularios:full` | Edita código, slug, nombre, descripción o área dueña |
| DELETE | `/api/formularios/:formId` | `formularios:full` | Borrado lógico; se niega si hay asignaciones vivas |
| POST | `/api/formularios/:formId/restore` | `formularios:full` | Deshace el borrado lógico |
| POST | `/api/formularios/:formId/duplicate` | `formularios:full` | Formulario nuevo a partir del árbol de una versión |
| GET | `/api/formularios/:formId/versions/:versionId` | `formularios:read` | Versión con su árbol completo |
| PUT | `/api/formularios/:formId/versions/:versionId` | `formularios:full` | Reemplaza el árbol de un `DRAFT` (autosave del builder) |
| POST | `/api/formularios/:formId/versions/:versionId/validate` | `formularios:read` | Valida el árbol guardado sin cambiar nada |
| POST | `/api/formularios/:formId/versions/:versionId/clone` | `formularios:full` | Clona la versión en un `DRAFT` nuevo |
| POST | `/api/formularios/:formId/versions/:versionId/publish` | `formularios:full` | Publica el `DRAFT` (idempotente) |
| POST | `/api/formularios/:formId/versions/:versionId/archive` | `formularios:full` | Archiva una versión publicada |
| GET | `/api/form-field-templates` | `formularios:read` | Lista las plantillas de cards |
| POST | `/api/form-field-templates` | `formularios:full` | Crea una plantilla |
| PATCH | `/api/form-field-templates/:id` | `formularios:full` | Edita una plantilla |
| DELETE | `/api/form-field-templates/:id` | `formularios:full` | Borrado lógico de una plantilla |
| GET | `/api/formularios/asignaciones` | `formularios:read` | Asignaciones paginadas |
| POST | `/api/formularios/asignaciones` | `formularios:full` | Crea una asignación `ACTIVE` |
| GET | `/api/formularios/asignaciones/:id` | `formularios:read` | Una asignación con sus targets |
| PATCH | `/api/formularios/asignaciones/:id` | `formularios:full` | Edita audiencia, vigencia, frecuencia o límite |
| POST | `/api/formularios/asignaciones/:id/pause` | `formularios:full` | Pasa a `PAUSED` |
| POST | `/api/formularios/asignaciones/:id/resume` | `formularios:full` | Vuelve a `ACTIVE` |
| POST | `/api/formularios/asignaciones/:id/close` | `formularios:full` | Cierra (terminal) |
| GET | `/api/formularios/submissions` | `formularios:read` | Explorador de envíos, con filtros |
| GET | `/api/formularios/submissions/export.csv` | `formularios:read` | Exporta a CSV la lista filtrada (máx. 5000) |
| GET | `/api/formularios/submissions/:id` | `formularios:read` | Envío completo con la definición de su versión |
| POST | `/api/formularios/submissions/:id/void` | `formularios:full` | Anula un `SUBMITTED` con motivo |
| DELETE | `/api/formularios/submissions/:id` | `formularios:full` | Descarta (lógico) un `DRAFT` |
| POST | `/api/formularios/submissions/:id/restore` | `formularios:full` | Deshace un descarte |
| POST | `/api/formularios/documento/pdf` | `formularios:read` | Imprime con Chromium el HTML+CSS que manda el cliente |
| GET | `/api/formularios/metricas` | `formularios:read` | Contadores y latencias del proceso |
| GET | `/api/formularios/audiencia/usuarios` | `formularios:read` | Usuarios activos, cargos y áreas para el asignador |
| GET | `/api/formularios/campana-portal/audiencia` | `formularios:read` | Conductores que recibirían la guía del portal |
| POST | `/api/formularios/campana-portal/test` | `formularios:full` | Envía al correo de quien la pide la guía de un conductor, sin su enlace personal |
| POST | `/api/formularios/campana-portal/enviar` | `formularios:full` | Envía la guía a toda la audiencia |
| GET | `/api/conductor-portal/formularios/ping` | `portal` | Sonda de conectividad de la outbox |
| GET | `/api/conductor-portal/formularios` | `portal` | Tarjetas: asignaciones vigentes del conductor |
| GET | `/api/conductor-portal/formularios/:assignmentId` | `portal` | Definición publicada de una asignación (ETag/304) |
| GET | `/api/conductor-portal/formularios/submissions` | `portal` | Historial propio (`SUBMITTED`/`VOIDED`) |
| GET | `/api/conductor-portal/formularios/submissions/:id` | `portal` (+ token de impresión) | Un envío propio con su definición |
| GET | `/api/conductor-portal/formularios/submissions/:id/pdf` | `portal` | PDF del documento del envío |
| GET | `/api/conductor-portal/formularios/drafts/papelera` | `portal` | Borradores propios descartados |
| POST | `/api/conductor-portal/formularios/drafts/:clientSubmissionId/restaurar` | `portal` | Restaura un borrador descartado |
| GET | `/api/conductor-portal/formularios/drafts/:clientSubmissionId` | `portal` | Relee un borrador (o envío) propio |
| PUT | `/api/conductor-portal/formularios/drafts/:clientSubmissionId` | `portal` | Backup del borrador en el servidor |
| DELETE | `/api/conductor-portal/formularios/drafts/:clientSubmissionId` | `portal` | Descarta (lógico) un borrador propio |
| POST | `/api/conductor-portal/formularios/attachments/init` | `portal` | Reserva un adjunto y firma la URL de subida |
| POST | `/api/conductor-portal/formularios/attachments/:id/complete` | `portal` | Verifica el objeto subido y lo marca `UPLOADED` |
| DELETE | `/api/conductor-portal/formularios/attachments/:id` | `portal` | Quita un adjunto del borrador |
| POST | `/api/conductor-portal/formularios/submissions` | `portal` | Envío final, idempotente |
| GET | `/api/mis-formularios` | `mis-formularios:read` | Tarjetas del usuario interno |
| GET | `/api/mis-formularios/:assignmentId` | `mis-formularios:read` | Definición publicada (ETag/304) |
| GET | `/api/mis-formularios/submissions` | `mis-formularios:read` | Historial propio |
| GET | `/api/mis-formularios/submissions/:id` | `mis-formularios:read` | Un envío propio |
| GET | `/api/mis-formularios/drafts/:clientSubmissionId` | `mis-formularios:read` | Relee un borrador propio |
| PUT | `/api/mis-formularios/drafts/:clientSubmissionId` | `mis-formularios:read` | Autoguardado del borrador |
| DELETE | `/api/mis-formularios/drafts/:clientSubmissionId` | `mis-formularios:read` | Descarta un borrador propio |
| POST | `/api/mis-formularios/attachments/init` | `mis-formularios:read` | Reserva un adjunto y firma la URL de subida |
| POST | `/api/mis-formularios/attachments/:id/complete` | `mis-formularios:read` | Verifica el objeto subido |
| DELETE | `/api/mis-formularios/attachments/:id` | `mis-formularios:read` | Quita un adjunto del borrador |
| POST | `/api/mis-formularios/submissions` | `mis-formularios:read` | Envío final, idempotente |

### Formato de respuesta y de error

Casi todo responde `{ "success": true, "data": …, "meta"?: … }`. Las
excepciones (CSV, PDF, `documento/pdf`, `ping`) se indican en su sección.

Los errores de las tres superficies salen de `fail()` con esta forma:

```json
{ "success": false, "error": { "code": "SUBMISSION_LIMIT_REACHED", "message": "…", "details": { "…": "…" } } }
```

- `400 VALIDATION_ERROR`: el body, la query o los parámetros no pasaron Zod
  (`formularios-dinamicos.schema.ts`). `details` es la lista de issues
  (`{ path, message }`; el portal añade `code`).
- `500 INTERNAL_ERROR`: cualquier error no previsto; el mensaje real solo va al
  log (no se filtran textos de Prisma).
- Errores de dominio (`FormError`, `domain/errors.ts`). El `code` es el contrato:
  la outbox del portal decide con él si reintenta, bloquea el borrador o pide
  magic link nuevo.

| HTTP | Códigos |
|---|---|
| 403 | `ASSIGNMENT_TARGET_DENIED` (la asignación no existe, no te alcanza, está pausada/cerrada o su versión ya no está publicada), `FORBIDDEN` (recurso de otro actor; conductor/usuario inexistente o inactivo) |
| 404 | `FORM_NOT_FOUND`, `VERSION_NOT_FOUND`, `ASSIGNMENT_NOT_FOUND`, `SUBMISSION_NOT_FOUND`, `ATTACHMENT_NOT_FOUND`, `TEMPLATE_NOT_FOUND` |
| 409 | `VERSION_IMMUTABLE`, `VERSION_NOT_PUBLISHED`, `VERSION_ARCHIVED`, `REVISION_CONFLICT`, `FORM_HAS_ACTIVE_ASSIGNMENTS`, `FORM_CODE_TAKEN`, `ASSIGNMENT_NOT_AVAILABLE`, `SUBMISSION_LIMIT_REACHED`, `SUBMISSION_IMMUTABLE`, `SUBMISSION_ALREADY_VOIDED`, `SUBMISSION_DISCARDED` (terminal: la outbox debe soltar ese borrador), `IDEMPOTENCY_PAYLOAD_MISMATCH`, `PREOPERACIONAL_EN_OTRO_SERVICIO`, `ATTACHMENT_CONFLICT` |
| 413 | `ATTACHMENT_TOO_LARGE`, `PAYLOAD_TOO_LARGE` |
| 415 | `ATTACHMENT_TYPE_NOT_ALLOWED` |
| 422 | `FORM_DEFINITION_INVALID`, `FIELD_RULE_CYCLE`, `FIELD_VALUE_INVALID`, `ASSIGNMENT_CONTEXT_REQUIRED`, `SERVICE_CONTEXT_INVALID`, `VEHICULO_DISTINTO_DEL_SERVICIO`, `ATTACHMENT_MISSING`, `ATTACHMENT_HASH_MISMATCH`, `ATTACHMENT_NOT_DECLARED` |

Un body por encima del `bodyLimit` de la ruta lo corta Fastify antes del
handler con su 413 propio (`{ statusCode, error, message }`).

## Constructor

DTOs en `formularios-dinamicos.mapper.ts`: `FormDefinitionDto` (`id`, `code`,
`slug`, `name`, `description`, `ownerArea`, `deletedAt`, `createdAt`,
`updatedAt`, `activeVersion` = la `PUBLISHED` de número más alto,
`draftVersion`, `versions[]`, `counts`), `FormVersionDto` (resumen `id`,
`formId`, `versionNumber`, `status`, `title`, `revision`, fechas, más
`description`, `instructions`, `settings`, `sourceMetadata` y `sections[]` con
`fields[]` anidados, `options[]` y `children[]`) y `toAssignmentDto`.

### `GET /api/formularios`

**Query** (`listarFormulariosSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | entero ≥ 1 | 1 | |
| `limit` | entero 1–100 | 20 | |
| `search` | string ≤ 200 | — | En `code`, `name` y `description`, sin distinguir mayúsculas (no en el título de las versiones) |
| `ownerArea` | string ≤ 80 | — | Igualdad exacta |
| `includeDeleted` | boolean (coaccionado) | ausente | Incluye los borrados lógicos (ver Observaciones) |

**Respuesta 200** — `data: FormDefinitionDto[]` ordenado por `updated_at`
descendente, cada uno con `versions` y `counts: { assignments, submissions }`
(asignaciones no borradas de cualquier estado; envíos `SUBMITTED` vivos).
`meta: { total, page, limit, totalPages }`.

### `POST /api/formularios`

**Body** (`crearFormularioSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `code` | string 2–50 | sí | `^[A-Za-z0-9][A-Za-z0-9._-]*$`; se guarda en mayúsculas |
| `slug` | string 2–120 | no | Minúsculas, números y guiones; si falta se deriva del nombre |
| `name` | string ≤ 255 | sí | Se sanea (una línea, sin caracteres invisibles) |
| `description` | string ≤ 8000 \| null | no | |
| `ownerArea` | string ≤ 80 | no | `hseq` por defecto |
| `versionTitle` | string ≤ 255 | no | Título de la v1; por defecto el nombre |

**Respuesta 201** — `FormDefinitionDto` con la versión 1 en `DRAFT` (formulario
y versión se crean en la misma transacción).

**Errores**: 409 `FORM_CODE_TAKEN` si el código o el slug ya existen, también
contra un formulario archivado (`details: { conflictingId, deleted }`); 422
`FORM_DEFINITION_INVALID` si del nombre no sale ningún slug.

### `GET /api/formularios/:formId`

`FormDefinitionDto` con `versions` (de la más nueva a la más vieja), aunque el
formulario esté borrado. 404 `FORM_NOT_FOUND`.

### `PATCH /api/formularios/:formId`

**Body** (`actualizarFormularioSchema`, al menos un campo): `code`, `slug`,
`name` (≤ 255), `description` (≤ 8000 o `null`), `ownerArea` (≤ 80). Cambiar
código o slug pasa por la misma comprobación de duplicado (409
`FORM_CODE_TAKEN`). Responde el `FormDefinitionDto`. 404 `FORM_NOT_FOUND`.

### `DELETE /api/formularios/:formId` y `POST /api/formularios/:formId/restore`

El borrado es lógico (`deleted_at`) e idempotente: responde
`{ id, deletedAt }`. Se niega con 409 `FORM_HAS_ACTIVE_ASSIGNMENTS`
(`details.activeAssignments`) mientras queden asignaciones `ACTIVE` o `PAUSED`:
primero se cierran. `restore` limpia `deleted_at` y devuelve el
`FormDefinitionDto`. 404 `FORM_NOT_FOUND` en los dos.

### `POST /api/formularios/:formId/duplicate`

Crea un formulario nuevo con su v1 `DRAFT`, copia del árbol de una versión del
origen (ids nuevos; `sourceMetadata` guarda `duplicatedFromFormId` y
`duplicatedFromVersionId`).

**Query**: `versionId` (opcional). Si no viene o no es de este formulario, se
copia la `PUBLISHED` más reciente y, si no hay, la versión más alta.

**Body** (`duplicarFormularioSchema`): `code` (mismo formato que el alta),
`slug` (opcional), `name` (1–255).

**Respuesta 201** — `FormDefinitionDto` del formulario nuevo. **Errores**: 404
`FORM_NOT_FOUND`/`VERSION_NOT_FOUND`, 409 `FORM_CODE_TAKEN`.

### `GET /api/formularios/:formId/versions/:versionId`

`FormVersionDto` completo. Envía `ETag: "<versionId>-<revision>"` y
`Cache-Control: private, max-age=0, must-revalidate`, pero no responde 304. 404
`VERSION_NOT_FOUND` si la versión no existe o es de otro formulario.

### `PUT /api/formularios/:formId/versions/:versionId`

Reemplaza el árbol entero del borrador (`PUT`, no `PATCH`). Concurrencia
optimista por `revision`, con la fila bloqueada (`FOR UPDATE`). `bodyLimit` de
8 MiB.

**Body** (`guardarVersionSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `revision` | entero ≥ 1 | sí | La que el builder cree vigente; si no coincide, 409 |
| `title` | string ≤ 255 | sí | |
| `description` | string ≤ 8000 \| null | no | |
| `instructions` | string ≤ 20000 \| null | no | |
| `settings` | objeto | no | JSON saneado; se conservan claves que el backend no interpreta |
| `sections` | arreglo ≤ 60 | sí | `{ id?, key, title, description?, sortOrder, settings?, fields[] }` |
| `clientMutationId` | uuid | no | Se acepta y no se usa |

Cada campo: `id?`, `key`, `type` (`SHORT_TEXT`, `LONG_TEXT`, `INTEGER`,
`DECIMAL`, `DATE`, `TIME`, `DATETIME`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`,
`BOOLEAN`, `SIGNATURE`, `PHOTO`, `FILE`, `LOCATION`, `INFO`,
`REPEATABLE_GROUP`, `MATRIX`, `LOOKUP`, `CALCULATED`), `label`, `helpText`,
`placeholder`, `required`, `sortOrder`, `config`, `validation`,
`visibilityRule` (`{ version: 1, all?|any?: [{ fieldKey, operator, value? }],
effect: { action: show|hide|require|disable, targetFieldKey? } }`),
`defaultValue`, `options[]` y `children[]` (un solo nivel). Topes en
`domain/limits.ts` (300 campos por sección, 800 por versión, 300 opciones por
campo). Un `id` que llega y no pertenece a esta versión se rechaza en vez de
crearse. Esquema completo en `formularios-dinamicos.schema.ts`.

**Respuesta 200** — `data: FormVersionDto` releído;
`meta: { validation, revision }`, donde `validation` es la validación en modo
`publish` (los errores y warnings que verá HSEQ al publicar; no bloquean el
guardado).

**Errores**

| Código | Cuándo |
|---|---|
| 422 `FORM_DEFINITION_INVALID` | La validación en modo `draft` falla (`details: { errors, warnings }`) o un id no es de la versión |
| 404 `VERSION_NOT_FOUND` | No existe o es de otro formulario |
| 409 `VERSION_IMMUTABLE` | La versión no está en `DRAFT` (`details.status`) |
| 409 `REVISION_CONFLICT` | Otra pestaña guardó antes (`details: { expected, actual }`) |

### `POST /api/formularios/:formId/versions/:versionId/validate`

Valida el árbol **guardado** (no recibe body). **Query**: `mode=draft` relaja
los requisitos de completitud; cualquier otro valor (o ninguno) valida en modo
`publish`. Responde `data: { valid, errors[], warnings[] }`, cada issue
`{ code, severity, message, path, meta? }`. 404 `VERSION_NOT_FOUND`.

### `POST /api/formularios/:formId/versions/:versionId/clone`

Crea un `DRAFT` con el siguiente `versionNumber`, copia de la versión indicada
(sea cual sea su estado), con claves y configuración iguales e ids nuevos.
Responde 201 con el `FormVersionDto` nuevo. 404 `VERSION_NOT_FOUND`.

### `POST /api/formularios/:formId/versions/:versionId/publish`

Revalida en modo `publish` y pasa la versión a `PUBLISHED` (fila bloqueada).
Republicar una ya publicada no es error: responde igual con
`meta.alreadyPublished: true` y no emite evento.

**Respuesta 200** — `data: FormVersionDto`, `meta: { validation, alreadyPublished }`.

**Errores**: 409 `VERSION_ARCHIVED`; 422 `FIELD_RULE_CYCLE` (si entre los errores
hay un ciclo de reglas) o `FORM_DEFINITION_INVALID`, con
`details: { errors, warnings }`; 409 `VERSION_IMMUTABLE` si otra petición la
sacó de `DRAFT` entre la validación y la escritura; 404 `VERSION_NOT_FOUND`.

### `POST /api/formularios/:formId/versions/:versionId/archive`

Pasa una `PUBLISHED` a `ARCHIVED` (idempotente si ya lo está). 409
`VERSION_NOT_PUBLISHED` si es un `DRAFT`; 409 `FORM_HAS_ACTIVE_ASSIGNMENTS` si
alguna asignación `ACTIVE`/`PAUSED` apunta a ella. Responde el `FormVersionDto`.

### Plantillas: `GET /api/form-field-templates`, `POST /api/form-field-templates`, `PATCH /api/form-field-templates/:id`, `DELETE /api/form-field-templates/:id`

- `GET` — **Query**: `category` (igualdad) y `search` (en `name`). Devuelve un
  arreglo de `{ id, name, category, fieldType, template, ownerArea, isGlobal,
  createdAt, updatedAt }` sin los borrados, ordenado por categoría y nombre.
- `POST` — **Body** (`plantillaSchema`, `bodyLimit` 1 MiB): `name` (1–255),
  `category` (1–100), `fieldType`, `template` (un campo completo como en el
  `PUT` de versión, sin `id` y con `sortOrder` opcional), `ownerArea` (opcional),
  `isGlobal` (opcional, `false`). Responde 201 con la plantilla.
- `PATCH` — mismo body, todo opcional pero al menos un campo. 404
  `TEMPLATE_NOT_FOUND`.
- `DELETE` — borrado lógico; responde `{ id }`. 404 `TEMPLATE_NOT_FOUND`.

### `GET /api/formularios/asignaciones`

**Query** (`listarAsignacionesSchema`): `page`, `limit` (como el catálogo),
`search` (en `name`), `formId`, `versionId` (uuid), `status`
(`ACTIVE`\|`PAUSED`\|`CLOSED`).

**Respuesta 200** — `data` de asignaciones no borradas, por `created_at`
descendente: `{ id, versionId, name, status, frequency, limitPolicy, timezone,
startsAt, endsAt, contextSchema, settings, createdAt, updatedAt, deletedAt,
targets[], version: { id, formId, versionNumber, status, title, code },
submissionCount }`. Cada target trae su columna de valor y el nombre resuelto
(`conductor`, `vehiculo`, `usuario`). `meta` de paginación.

### `POST /api/formularios/asignaciones`

**Body** (`crearAsignacionSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `versionId` | uuid | sí | Tiene que estar `PUBLISHED` y su formulario vivo |
| `name` | string 1–255 | sí | |
| `frequency` | enum | sí | `ON_DEMAND`, `ONCE`, `DAILY`, `WEEKLY` (semana ISO), `MONTHLY`, `PER_SERVICE` |
| `limitPolicy` | enum | sí | `UNLIMITED`, `ONE_PER_PERIOD`, `ONE_PER_CONTEXT` |
| `timezone` | string ≤ 64 | no | `America/Bogota` por defecto |
| `startsAt`, `endsAt` | ISO datetime \| null | no | `endsAt` posterior a `startsAt` |
| `targets` | arreglo 1–500 | sí | `{ type, conductorId?, vehicleId?, sede?, groupKey?, usuarioId?, area?, cargo? }`: cada tipo exige exactamente su columna (`CONDUCTOR`→`conductorId`, `VEHICLE`→`vehicleId`, `SEDE`→`sede`, `GROUP`→`groupKey`, `USER`→`usuarioId`, `AREA`→`area`, `CARGO`→`cargo`) y ninguna otra; `ALL_CONDUCTORS`/`ALL_USERS` ninguna |
| `contextSchema` | `{ [clave]: { required?: boolean } }` | no | Lo que el runner exige al abrir (p. ej. `vehicleId`) |
| `settings` | objeto | no | P. ej. `allowOffline` (el portal lo lee como `true` salvo `false` explícito) |

**Respuesta 201** — `data: asignación`, `meta: { warnings }`. Hay warning si la
política es `ONE_PER_CONTEXT` y ninguna clave de `contextSchema` es
`required` (el límite degeneraría a «uno por persona y período»).

**Errores**: 400 `VALIDATION_ERROR` (target mal formado, fechas al revés); 404
`VERSION_NOT_FOUND`; 404 `FORM_NOT_FOUND` (formulario archivado); 409
`VERSION_NOT_PUBLISHED`; 409 `ASSIGNMENT_NOT_AVAILABLE` si algún conductor o
vehículo no existe o está borrado, algún usuario no existe o está inactivo, o
un `area` no está en `AREAS` (la lista va en `details`).

### `GET /api/formularios/asignaciones/:id`

La asignación con sus targets (forma del listado). 404 `ASSIGNMENT_NOT_FOUND`
si no existe o está borrada.

### `PATCH /api/formularios/asignaciones/:id`

Mismo body que el alta sin `versionId` (si llega, Zod lo descarta en silencio),
todo opcional pero al menos un campo. `targets` reemplaza la lista entera. Las
fechas se validan contra el estado final (lo que llega mezclado con lo
guardado). Responde `data` + `meta.warnings`.

**Errores**: 404 `ASSIGNMENT_NOT_FOUND`; 409 `ASSIGNMENT_NOT_AVAILABLE` si está
`CLOSED`, si `endsAt` queda antes de `startsAt` o por targets inválidos.

### `POST /api/formularios/asignaciones/:id/pause`, `POST /api/formularios/asignaciones/:id/resume`, `POST /api/formularios/asignaciones/:id/close`

Transiciones `ACTIVE ↔ PAUSED` y `ACTIVE|PAUSED → CLOSED`; `CLOSED` es terminal.
Pedir el estado en que ya está responde la asignación sin cambios. Una
transición no permitida da 409 `ASSIGNMENT_NOT_AVAILABLE`
(`details: { from, to }`). Pausar hace desaparecer la tarjeta del portal y de
«mis formularios». 404 `ASSIGNMENT_NOT_FOUND`.

### `GET /api/formularios/submissions` y `GET /api/formularios/submissions/export.csv`

**Query** (`listarEnviosSchema`, la misma en los dos)

| Parámetro | Tipo | Descripción |
|---|---|---|
| `page`, `limit` | entero | 1 y 20 por defecto, `limit` ≤ 100 (el CSV los ignora) |
| `search` | string ≤ 200 | Nombre, apellido o cédula del conductor, nombre del usuario, placa, nombre de la asignación, o formato (código, nombre o título de versión; sin tildes y todas las palabras) |
| `formId`, `versionId`, `assignmentId`, `conductorId`, `usuarioId`, `vehicleId` | uuid | Filtros exactos |
| `status` | `DRAFT`\|`SUBMITTED`\|`VOIDED` | Sin él salen los tres |
| `businessDateFrom`, `businessDateTo` | `YYYY-MM-DD` | Inclusivos, sobre `business_date` |
| `includeDeleted` | boolean (coaccionado) | Incluye los descartados (ver Observaciones) |

**Respuesta 200 (lista)** — `data` ordenado por `submitted_at` descendente (los
borradores al final) y luego `started_at`. Cada fila: `id`,
`clientSubmissionId`, `assignmentId`, `versionId`, `conductorId`, `usuarioId`,
`vehicleId`, `serviceId`, `supersedesSubmissionId`, `status`, `businessDate`,
`periodKey`, `context`
(incluye `filledOn`), `etapasCerradas` (de `device.stagesClosed`), `startedAt`,
`submittedAt`, `updatedAt`, `voidedAt`, `voidReason`, `deletedAt`, `actor:
{ kind: CONDUCTOR|USER, id, nombre }`, `conductor`, `usuario`, `vehiculo`,
`assignment`, `version`, `answerCount`, `attachmentCount`. `meta` de paginación.

**CSV** — `text/csv; charset=utf-8` con BOM, CRLF y
`Content-Disposition: attachment; filename="envios-formularios-AAAA-MM-DD.csv"`.
Columnas fijas (`submission_id`, `codigo`, `version`, `asignacion`, `estado`,
`fecha_negocio`, `fecha_formulario`, `periodo`, `tipo_actor`,
`diligenciado_por`, `identificacion`, `placa`, `enviado_en`, `anulado_en`,
`motivo_anulacion`) y, si todas las filas son del mismo formato, una columna
`key | label` por campo raíz unida por `key` entre versiones (las respuestas de
filas de repetibles no salen). Tope de 5000 filas: si se alcanza, la última
línea lo dice. Las celdas que empiezan por `=`, `+`, `-` o `@` llevan `'`
delante (inyección de fórmulas).

Las dos consultas quedan auditadas en el log (`forms:admin.query`, con los
filtros y no el contenido).

### `GET /api/formularios/submissions/:id`

`data: { submission, definition }`: el resumen anterior más `device`,
`answers[]` (`{ id, fieldId, fieldKey, occurrenceId, rowIndex, value,
optionValues }`, con la envoltura de borrador ya deshecha), `attachments[]`
(con `url` firmada de S3 de 1 h para los `UPLOADED`) y `events[]` (bitácora).
`definition` es la versión **del envío**, no la vigente. Devuelve también envíos
descartados. `Cache-Control: no-store`. 404 `SUBMISSION_NOT_FOUND`.

### `POST /api/formularios/submissions/:id/void`

Anula un `SUBMITTED`: conserva respuestas y adjuntos y añade `voided_at`,
`voided_by_id`, `void_reason` y un evento `VOIDED` en la bitácora.

**Body** (`anularEnvioSchema`): `reason`, texto saneado de 10 a 2000
caracteres (el mínimo se mide después de sanear).

**Respuesta 200** — `data: { submission, definition }` ya anulado.

**Errores**: 404 `SUBMISSION_NOT_FOUND`; 409 `SUBMISSION_DISCARDED` (está
descartado: restaurarlo primero); 409 `SUBMISSION_ALREADY_VOIDED`; 409
`SUBMISSION_IMMUTABLE` si es un `DRAFT`.

### `DELETE /api/formularios/submissions/:id` y `POST /api/formularios/submissions/:id/restore`

`DELETE` descarta un borrador ajeno desde el explorador (borrado lógico, evento
`DISCARDED` con `source: 'dashboard'`). Responde
`{ id, deleted, alreadyGone, deletedAt }`; descartar lo ya descartado responde
`deleted: false, alreadyGone: true`. 409 `SUBMISSION_IMMUTABLE` si no es
`DRAFT` (lo entregado se anula). `restore` limpia `deleted_at` (evento
`RESTORED`) y devuelve `{ submission, definition }`; si no estaba descartado,
devuelve el envío sin cambios. 404 `SUBMISSION_NOT_FOUND` en los dos.

### `POST /api/formularios/documento/pdf`

Recibe el documento que el cliente ya tiene pintado y solo pone Chromium, para
que el PDF sea idéntico al preview. `bodyLimit` 8 MiB. Sin Zod. Chromium lo
carga sin JavaScript y solo deja pedir `data:`, `blob:`, `about:` y http(s)
hacia direcciones públicas (`blindarPagina`, ver
[integraciones](../integraciones.md#pdf)): las fotos y firmas, que llegan como
URL firmadas de S3, cargan; cualquier recurso hacia la red interna no, y sale
como imagen rota.

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `html` | string | sí | Cuerpo del documento, ≤ 6 000 000 caracteres |
| `css` | string | sí | Hoja de estilos (con su `@page`), ≤ 400 000 caracteres |
| `filename` | string | no | Se reduce a `[a-z0-9_-]`; `documento` por defecto |

**Respuesta 200** — `application/pdf`, `Content-Disposition: inline`,
`Cache-Control: private, max-age=0, no-store`.

**Errores** (formato propio, sin `success`): 400 `{ "error": … }` si falta
`html` o `css`; 413 si superan los topes; 500 `{ "error": <mensaje> }`.

### `GET /api/formularios/metricas`

`data: { module, scope: 'process', since, counters, latencyMs }`. Contadores en
memoria **del proceso** (se reinician con él): envíos aceptados, replays,
mismatches, límites, rechazos de validación y de payload, fallos y
verificaciones de adjuntos, conflictos de revisión, publicaciones y bloqueos,
targets denegados, textos saneados. `latencyMs` da p50/p95 de `submit`,
`listPortal`, `saveVersion`, `listMis` y `submitMis` (ventana de 500
muestras). `Cache-Control: no-store`.

### `GET /api/formularios/audiencia/usuarios`

Para el editor de asignaciones (existe aparte de `/api/usuarios`, que pide un
permiso que HSEQ no tiene). `data: { usuarios: [{ id, nombre, correo, cargo,
area }], cargos: string[], areas }`: usuarios activos por nombre, los cargos
distintos que existen (para que un target `CARGO` se escriba como en la ficha) y
la lista canónica `AREAS`.

### `GET /api/formularios/campana-portal/audiencia`

**Query**: `periodo` (`YYYY-MM`, opcional).

- Sin `periodo` (`origen: 'ULTIMA_NOMINA'`): la nómina más reciente, es decir,
  las liquidaciones no borradas con exactamente el `periodo_start` y
  `periodo_end` de la última; `periodo.periodo` vale `<inicio>_<fin>`.
- Con `periodo` (`origen: 'MES_EXPLICITO'`): las liquidaciones cuyo período
  cruza ese mes.

**Respuesta 200** — `data: { periodo: { periodo, inicio, fin }, origen,
destinatarios: [{ conductorId, nombre, apellido, numeroIdentificacion, email }] }`,
`meta: { total }`: conductores únicos de esas liquidaciones, sin los borrados,
ocultos o sin correo válido.

**Errores**: 400 `{ success: false, error: { code: 'CAMPAIGN_INVALID', message } }`
si el período no tiene formato `YYYY-MM` o no hay ninguna liquidación.

### `POST /api/formularios/campana-portal/test`

**Body**: `conductorId` (id de conductor no borrado) y, opcional, `to`. Envía
la guía tal como la recibiría ese conductor (su nombre en el saludo, las mismas
capturas), con asunto `[PRUEBA] …` y una nota que dice que es una prueba.

- **Destinatario**: siempre el correo del usuario de la sesión
  (`request.user.correo`). `to` se acepta solo por compatibilidad: si viene,
  tiene que ser ese mismo correo (sin distinguir mayúsculas); otro, 400.
- **Sin token**: no se emite magic link ni se escribe en `conductor_token`. El
  botón lleva a `<frontend>/public/portal`, la entrada del portal sin sesión,
  así que el correo no abre el portal de nadie aunque se reenvíe. Antes la
  prueba llevaba un enlace real de 30 días del conductor y salía a cualquier
  `to`.

**Respuesta 200** — `data: { id, to, conductorId, test: true }` (`id` del
proveedor de correo; `to` es el correo al que salió). **Errores**: 400
`CAMPAIGN_INVALID` si falta `conductorId`, el usuario no tiene correo válido o
`to` no es su correo; 400 `CAMPAIGN_SEND_FAILED` si el conductor no existe o no
tiene correo, o falla el envío.

### `POST /api/formularios/campana-portal/enviar`

**Body**: `periodo` (`YYYY-MM`, opcional: misma regla que la audiencia) y
`confirmacion`, que tiene que ser literalmente
`ENVIAR_GUIA_FORMULARIOS_<origen>_<periodo.periodo>` (p. ej.
`ENVIAR_GUIA_FORMULARIOS_ULTIMA_NOMINA_<inicio>_<fin>` o
`ENVIAR_GUIA_FORMULARIOS_MES_EXPLICITO_<YYYY-MM>`). Envía la guía a cada
conductor de la audiencia, uno por uno y con 600 ms entre correos, dentro de la
misma petición; cada correo lleva un magic link nuevo.

**Respuesta 200** — `{ success: fallidos === 0, data: { periodo, total,
enviados, fallidos, resultados: [{ conductorId, email, ok, error? }] } }` (sin
`origen`): con fallos parciales responde 200 con `success: false`.

**Errores**: 400 `CAMPAIGN_SEND_FAILED` si el período es inválido, no hay
liquidaciones o la confirmación no coincide (el mensaje dice cuál se esperaba).

## Portal del conductor

Prefijo `/api/conductor-portal/formularios`. Todas las respuestas llevan
`Cache-Control: no-store` salvo que la ruta ponga otro. Los parámetros
`:assignmentId`, `:id` y `:clientSubmissionId` se validan como UUID (400
`VALIDATION_ERROR`).

### `GET /api/conductor-portal/formularios/ping`

`{ "success": true }` sin tocar la base: llegar al handler ya prueba que hay ruta
al servidor y que el token es válido. Lo usa la outbox antes de cada ronda de
sincronización.

### `GET /api/conductor-portal/formularios`

**Respuesta 200** — `data`: una tarjeta por asignación accesible y vigente,
por antigüedad: `{ assignmentId, formId, versionId, code, title, name,
frequency, limitPolicy, dueState, submittedThisPeriod, periodKey, businessDate,
draft, drafts[], allowOffline, requiresContext[], revision }`.

- `dueState`: `DONE` si la política es `ONE_PER_PERIOD` (o la frecuencia
  `ONCE`) y ya hay un envío en el período; si no, `AVAILABLE`. `ONE_PER_CONTEXT`
  sale siempre `AVAILABLE`: el límite se comprueba al enviar, con el vehículo ya
  elegido.
- `drafts[]`: **todos** los borradores vivos del actor en esa asignación
  (`{ clientSubmissionId, updatedAt, progress, context }`, el más reciente
  primero); `draft` es solo el primero, por compatibilidad.
- `meta: { today, pending, drafts }` (`drafts` cuenta borradores, no
  asignaciones).

### `GET /api/conductor-portal/formularios/:assignmentId`

**Respuesta 200** — `data: { assignment: { id, name, frequency, limitPolicy,
timezone, contextSchema, settings, businessDate, periodKey }, definition:
FormVersionDto }`. Cabeceras `ETag: "<versionId>-<revision>"` y
`Cache-Control: private, max-age=0, must-revalidate`; con `If-None-Match` igual
al ETag responde **304** sin cuerpo.

**Errores**: 403 `ASSIGNMENT_TARGET_DENIED` (no existe, no te alcanza, pausada,
cerrada o versión no publicada: el 403 es a propósito, para distinguir un
target mal configurado); 409 `ASSIGNMENT_NOT_AVAILABLE` fuera de vigencia; 404
`VERSION_NOT_FOUND`.

### `GET /api/conductor-portal/formularios/submissions`

**Query** (`listarEnviosPortalSchema`)

| Parámetro | Tipo | Descripción |
|---|---|---|
| `page` | entero ≥ 1 | 1 |
| `limit` | entero 1–50 | 20 |
| `assignmentId`, `vehicleId` | uuid | Filtros exactos |
| `businessDateFrom`, `businessDateTo` | `YYYY-MM-DD` | Por fecha de negocio, no de envío |
| `placa` | string 1–20 | Parcial, sin distinguir mayúsculas |
| `status` | `SUBMITTED`\|`VOIDED` | Acota; sin él salen los dos. Nunca devuelve `DRAFT` |

**Respuesta 200** — `data`: resúmenes de envíos propios y vivos (misma forma
que el explorador), por `submitted_at` descendente; `meta` de paginación.

### `GET /api/conductor-portal/formularios/submissions/:id`

`data: { submission, definition }` como en el detalle del dashboard (respuestas,
adjuntos con URL firmada de 1 h, eventos), solo si el envío es del actor y no
está descartado; no filtra por estado. 404 `SUBMISSION_NOT_FOUND` también
cuando es de otro (para el conductor, simplemente no existe). Es la única ruta
que acepta el token de impresión.

### `GET /api/conductor-portal/formularios/submissions/:id/pdf`

Comprueba la propiedad (la misma lectura que la ruta anterior) y manda a
Chromium a imprimir la página del portal web
`<FRONTEND_URL>/public/portal/formularios/envios/<id>/documento`, la misma
`PreviewEnvioPDF` que exporta el dashboard. Para que esa página cargue, siembra
en su `localStorage` (clave `PORTAL_SESSION_STORAGE_KEY`) una sesión con un
token de impresión nuevo (`tipo: 'conductor_portal_print'`, `sid` del envío, 3
min), en un contexto de navegador propio que se destruye al terminar; el token
nunca va en la URL. Espera a `[data-listo="si"]`.

**Respuesta 200** — `application/pdf`, `Content-Disposition: inline;
filename="documento-<id>.pdf"`, `Cache-Control: private, max-age=0, no-store`.
404 `SUBMISSION_NOT_FOUND`; si la página no llega a estar lista, 500
`INTERNAL_ERROR`.

### `GET /api/conductor-portal/formularios/drafts/papelera`

**Query**: `page`, `limit` (1–50, 20), `assignmentId`. `data`: borradores
**propios** descartados (`DRAFT` con `deleted_at`), del descarte más reciente
al más viejo; `meta` de paginación.

### `POST /api/conductor-portal/formularios/drafts/:clientSubmissionId/restaurar`

Quita la marca de descarte (evento `RESTORED`). Idempotente. Responde
`data: { id, restored, alreadyLive }`. **Errores**: 404 `SUBMISSION_NOT_FOUND`;
403 `FORBIDDEN` si es de otro; 409 `SUBMISSION_IMMUTABLE` si no es `DRAFT` (un
entregado con `deleted_at` lo retiró administración).

### `GET /api/conductor-portal/formularios/drafts/:clientSubmissionId`

Red de rescate: relee la copia del servidor por `clientSubmissionId` cuando la
outbox sobrevivió pero el borrador de IndexedDB no. `data: { submission,
definition }` (respuestas sin envoltura, adjuntos con URL firmada). Sin filtro de
estado: sirve también para un envío ya entregado. 404 `SUBMISSION_NOT_FOUND` si
no existe, es de otro o está descartado.

### `PUT /api/conductor-portal/formularios/drafts/:clientSubmissionId`

Backup del borrador. Nunca valida tipos ni obligatorios (es un borrador a
medias) y no lleva binarios. La primera llamada crea la fila (`DRAFT`, evento
`CREATED`); las siguientes reescriben respuestas, contexto y `device_json`.
`bodyLimit` 2 MiB.

**Body** (`backupDraftSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `assignmentId` | uuid | sí | Asignación accesible (la vigencia no se comprueba aquí) |
| `versionId` | uuid | sí | La vigente de la asignación. Otra solo si este `clientSubmissionId` ya existe, es del actor, de esta asignación, atado a esa versión y sigue `PUBLISHED` |
| `answers` | arreglo ≤ 5000 | sí | `{ fieldId, occurrenceId?, rowIndex?, value?, optionValues? }` |
| `context` | objeto | no | Saneado. Se interpretan `vehicleId` y `serviceId`; `filledOn` lo pone el servidor |
| `progress` | entero 0–100 | no | Va a `device_json.progress` |
| `startedAt` | ISO datetime | no | Cuándo se abrió en el dispositivo; se guarda el inicio más antiguo conocido |
| `updatedAt` | ISO datetime | no | Se valida y no se usa |
| `device` | objeto | no | Reemplaza `device_json` (p. ej. `stagesClosed` de los formularios por etapas) |

**Respuesta 200** — `data: { id, status: 'DRAFT', alreadySubmitted: false }`,
o `{ id, status, alreadySubmitted: true }` si ese `clientSubmissionId` ya se
entregó (la outbox venía retrasada; no es error).

**Errores**

| Código | Cuándo |
|---|---|
| 403 `ASSIGNMENT_TARGET_DENIED` | La asignación no es accesible |
| 409 `VERSION_NOT_PUBLISHED` | `versionId` no es la vigente ni una atada válida (`details.currentVersionId`) |
| 403 `FORBIDDEN` | El `clientSubmissionId` es de otro actor |
| 409 `SUBMISSION_DISCARDED` | El borrador se descartó (terminal para la outbox) |
| 422 `SERVICE_CONTEXT_INVALID` | `context.serviceId` no existe, está borrado o no es del conductor |
| 422 `VEHICULO_DISTINTO_DEL_SERVICIO` | `context.vehicleId` no es el vehículo del servicio |
| 409 `PREOPERACIONAL_EN_OTRO_SERVICIO` | El envío ya está ligado a otro servicio |

### `DELETE /api/conductor-portal/formularios/drafts/:clientSubmissionId`

Borrado lógico de un borrador propio, de cualquier fecha (evento `DISCARDED`,
`source: 'portal'`). Idempotente: `data: { id, deleted, alreadyGone }`, con
`id: null` si nunca existió. 403 `FORBIDDEN` si es de otro; 409
`SUBMISSION_IMMUTABLE` si ya se entregó.

### `POST /api/conductor-portal/formularios/attachments/init`

Reserva la metadata del adjunto y firma una URL de subida. El borrador tiene que
existir ya en el servidor (primero `PUT …/drafts/:clientSubmissionId`).
Idempotente por `clientAttachmentId` solo si los metadatos coinciden.

**Body** (`initAttachmentSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `clientSubmissionId` | uuid | sí | Borrador propio, vivo y en `DRAFT` |
| `clientAttachmentId` | uuid | sí | Clave de idempotencia; forma parte de la clave S3 |
| `fieldId` | uuid | sí | Campo `PHOTO`, `FILE` o `SIGNATURE` de la versión del envío |
| `occurrenceId` | uuid \| null | no | Fila de un repetible |
| `kind` | `PHOTO`\|`FILE`\|`SIGNATURE` | sí | |
| `mimeType` | string | sí | `PHOTO`: jpeg, png, webp; `SIGNATURE`: png, webp; `FILE`: pdf, jpeg, png, webp |
| `byteSize` | entero > 0 | sí | Tope `PHOTO` 10 MB, `SIGNATURE` 2 MB, `FILE` 25 MB |
| `sha256` | 64 hex minúsculas | sí | Se compara contra el objeto subido |
| `originalName` | string ≤ 255 \| null | no | |

**Respuesta 200** — `data: { attachmentId, uploadUrl, alreadyUploaded,
objectKey, checksumSha256 }`. Si el adjunto ya está `UPLOADED`, `uploadUrl` es
`null` y `alreadyUploaded: true` (la outbox puede seguir con el envío).

**La subida** es un `PUT` del binario directo a `uploadUrl` (S3, válida 15 min),
con `Content-Type` y `Content-Length` iguales a los declarados: los dos van
firmados. Con checksum nativo (`FORMS_S3_NATIVE_CHECKSUM`, activo salvo que
valga `'false'`) la firma incluye el SHA-256 en el **query string** de la URL;
`checksumSha256` (base64 del digest) es informativo y **no** se debe reenviar
como cabecera `x-amz-checksum-sha256`: S3 rechaza con 403 toda cabecera
`x-amz-*` que no esté en `X-Amz-SignedHeaders`. Como el `PUT` sale del
navegador, el bucket necesita una regla CORS que permita `PUT` desde el origen
del portal; un preflight rechazado se ve en DevTools igual que un problema de
firma.

**Errores**: 413 `ATTACHMENT_TOO_LARGE` (`details: { maxBytes, byteSize }`); 415
`ATTACHMENT_TYPE_NOT_ALLOWED` (`details.allowed`); 404 `SUBMISSION_NOT_FOUND`
(«guarda el borrador antes»); 403 `FORBIDDEN` (envío o adjunto de otro); 409
`SUBMISSION_DISCARDED`; 409 `SUBMISSION_IMMUTABLE` (ya entregado); 422
`FIELD_VALUE_INVALID` (campo de otra versión o que no admite adjuntos); 409
`ATTACHMENT_CONFLICT` (mismo `clientAttachmentId` con otro tipo, tamaño, hash,
campo u ocurrencia; `details.diferencias`).

### `POST /api/conductor-portal/formularios/attachments/:id/complete`

Verifica contra S3 que el objeto almacenado es el declarado y lo marca
`UPLOADED` (evento `ATTACHMENT_ATTACHED`). `:id` es el `attachmentId` de `init`.

**Body**: `sha256` (obligatorio, el mismo de `init`) y `byteSize` (opcional; se
valida y no se usa: el tamaño se compara contra el de `init`).

**Respuesta 200** — `data: { attachmentId, submissionId, clientAttachmentId,
status: 'UPLOADED', alreadyUploaded, verifiedBy }`, con `verifiedBy`
`native-checksum` (S3 devolvió `ChecksumSHA256`), `streaming-hash` (se
descargó y hasheó el objeto) o `previous` (ya estaba verificado).

**Errores**: 404 `ATTACHMENT_NOT_FOUND` / `SUBMISSION_NOT_FOUND`; 403
`FORBIDDEN`; 409 `SUBMISSION_DISCARDED`; 409 `SUBMISSION_IMMUTABLE`; 422
`ATTACHMENT_HASH_MISMATCH` (el `sha256` no es el de `init`, o los bytes
almacenados no lo producen); 422 `ATTACHMENT_MISSING` (no hay objeto, el tamaño
no cuadra o no se pudo leer). Los dos últimos, cuando vienen de S3, dejan el
adjunto `FAILED` (la marca se confirma antes de responder): hay que volver a
subirlo.

### `DELETE /api/conductor-portal/formularios/attachments/:id`

Quita un adjunto del borrador (la fila, en duro; el objeto de S3 se queda y lo
retira la política de ciclo de vida del bucket). Es la forma de resolver un
`ATTACHMENT_NOT_DECLARED`. Idempotente: `data: { attachmentId, discarded,
alreadyGone }`. 404 `SUBMISSION_NOT_FOUND`; 403 `FORBIDDEN`; 409
`SUBMISSION_DISCARDED`; 409 `SUBMISSION_IMMUTABLE`.

### `POST /api/conductor-portal/formularios/submissions`

Envío final. Resuelve acceso y vigencia, cortocircuita por idempotencia,
revalida respuestas y adjuntos contra la definición versionada y escribe todo
en una transacción con locks (`formularios-portal.locks.ts`: idempotencia →
límite → fila). `bodyLimit` 4 MiB.

**Body** (`enviarSubmissionSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `clientSubmissionId` | uuid | sí | Clave de idempotencia; si ya hay borrador en el servidor, lo convierte en envío |
| `assignmentId` | uuid | sí | Accesible y vigente |
| `versionId` | uuid | sí | Misma regla que el backup |
| `answers` | arreglo ≤ 5000 | sí | Se validan tipo, obligatorios (los ocultos por regla no se exigen), rangos, opciones existentes, filas de repetibles |
| `attachments` | arreglo ≤ 60 | no | `{ clientAttachmentId, fieldId, occurrenceId?, kind, mimeType, byteSize, sha256, originalName?, metadata? }`; todos `UPLOADED`, del actor y de este envío |
| `context` | objeto | no | Tiene que traer las claves `required` de `contextSchema` |
| `startedAt` | ISO datetime | no | Inicio en el dispositivo |
| `completedAt` | ISO datetime | no | Se valida y no se usa |
| `device` | objeto | no | `{ installationId?, appVersion?, offlineCreated?, platform? }`; va a `device_json` junto con la huella |

**Respuesta** — 201 si se guardó ahora, 200 si es un replay:

```json
{ "success": true, "data": { "submissionId": "uuid", "clientSubmissionId": "uuid", "businessDate": "2026-10-11",
  "periodKey": "2026-10-11", "submittedAt": "…", "idempotentReplay": false } }
```

**Errores**

| Código | Cuándo |
|---|---|
| 403 `ASSIGNMENT_TARGET_DENIED` | Asignación no accesible |
| 409 `ASSIGNMENT_NOT_AVAILABLE` | Fuera de vigencia |
| 409 `VERSION_NOT_PUBLISHED` | Versión que ya no es la de la asignación |
| 403 `FORBIDDEN` | El `clientSubmissionId` o un adjunto es de otro |
| 409 `SUBMISSION_DISCARDED` | El borrador se descartó: no revive al entregarse |
| 409 `IDEMPOTENCY_PAYLOAD_MISMATCH` | Mismo `clientSubmissionId`, contenido distinto |
| 422 `ASSIGNMENT_CONTEXT_REQUIRED` | Falta contexto obligatorio (`details.missing`) |
| 422 `FIELD_VALUE_INVALID` | Respuestas inválidas: `details.errors[]` con `{ fieldId, fieldKey, occurrenceId, code, message }` (`REQUIRED`, `TYPE`, `OPTION_UNKNOWN`, `MIN`, `MAX`, `PATTERN`, `MAX_FILES`, `FIELD_NOT_IN_VERSION`…) |
| 422 `ATTACHMENT_MISSING` | Adjunto declarado sin registrar, de otro envío o no `UPLOADED`; o el borrador tiene adjuntos sin terminar |
| 422 `ATTACHMENT_HASH_MISMATCH` | El hash declarado no es el registrado |
| 422 `ATTACHMENT_NOT_DECLARED` | El borrador tiene adjuntos `UPLOADED` que el envío no declara: declararlos o borrarlos |
| 409 `SUBMISSION_LIMIT_REACHED` | Límite de la política (`details: { existingSubmissionId, periodKey, vehicleId? }`); no se reintenta |
| 422 / 409 | `SERVICE_CONTEXT_INVALID`, `VEHICULO_DISTINTO_DEL_SERVICIO`, `PREOPERACIONAL_EN_OTRO_SERVICIO`, como en el backup |

## Mis formularios

Prefijo `/api/mis-formularios`. Es la misma API que el portal, servida por las
mismas funciones de `formularios-portal.service.ts`, con estas diferencias:

- El actor es el usuario del dashboard (`kind: 'USER'`): los envíos se guardan
  con `usuario_id` y la audiencia se resuelve con `ALL_USERS`, `USER`, `AREA` y
  `CARGO`. Las áreas y el cargo se releen de `users`, no del JWT.
- Los parámetros `:assignmentId`, `:id` y `:clientSubmissionId` **no** se
  validan como UUID (ver Observaciones).
- No existen `ping`, la papelera, `restaurar` ni el PDF del portal: este runner
  es en línea, sin outbox; el servidor es la única copia del borrador.
- No emite eventos de socket (las rooms del gateway son de conductores) y el
  envío solo dispara el aviso a mantenimiento, no el aviso general de
  preoperacional (ver Efectos).
- `400 VALIDATION_ERROR` lleva el mensaje «El formulario no tiene el formato
  esperado.» y `details` sin `code`.

### `GET /api/mis-formularios`, `GET /api/mis-formularios/:assignmentId`

Iguales que [`GET /api/conductor-portal/formularios`](#get-apiconductor-portalformularios)
y [`GET /api/conductor-portal/formularios/:assignmentId`](#get-apiconductor-portalformulariosassignmentid):
tarjetas con `drafts[]` y `meta: { today, pending, drafts }`; definición con
`ETag` y 304. `/:assignmentId` está declarada al final del archivo para que
`submissions`, `drafts` y `attachments` no se lean como ids.

### `GET /api/mis-formularios/submissions`, `GET /api/mis-formularios/submissions/:id`

Iguales que el historial y el detalle del portal (misma query
`listarEnviosPortalSchema`), filtrados por `usuario_id`.

### `GET /api/mis-formularios/drafts/:clientSubmissionId`, `PUT /api/mis-formularios/drafts/:clientSubmissionId`, `DELETE /api/mis-formularios/drafts/:clientSubmissionId`

Iguales que en el portal: relectura (sin ella, recargar la página a media
inspección perdería lo escrito), autoguardado (`backupDraftSchema`, `bodyLimit`
2 MiB, mismas respuestas y errores) y descarte lógico idempotente.

### `POST /api/mis-formularios/attachments/init`, `POST /api/mis-formularios/attachments/:id/complete`, `DELETE /api/mis-formularios/attachments/:id`

Misma cadena que el portal: `init` reserva y firma la URL, el navegador hace el
`PUT` directo a S3 (mismas reglas de cabeceras, checksum y CORS) y `complete`
verifica el SHA-256 contra el objeto. El binario nunca pasa por el backend.

### `POST /api/mis-formularios/submissions`

Mismo body, respuesta (201/200 con `idempotentReplay`) y errores que
[`POST /api/conductor-portal/formularios/submissions`](#post-apiconductor-portalformulariossubmissions).
El límite cuenta por usuario: en una asignación mixta cada persona tiene su
propio cupo.

## Efectos

- **Sockets** (`formularios-dinamicos.events.ts`; ver
  [tiempo real](../tiempo-real.md)). Se emiten después del commit y solo llevan
  ids, `eventId` y `occurredAt`:
  - `forms:assignment.changed` al crear, editar, pausar, reanudar o cerrar una
    asignación → room `forms:admin` y `conductor:<id>:forms` de los conductores
    afectados por targets `CONDUCTOR`, `VEHICLE` o `SEDE` (con `ALL_CONDUCTORS`,
    solo el room admin; el portal reconcilia por GET al reconectar).
  - `forms:version.published` al publicar por primera vez → `forms:admin`.
  - `forms:submission.accepted` en cada envío del **portal** (también en replays,
    con `idempotentReplay`) → room del conductor y `forms:admin`.
  - `forms:submission.voided` al anular → room del conductor autor y
    `forms:admin`.
  - `forms:attachment.ready` al verificar un adjunto **del portal** → room del
    conductor.
  - Entrada: `forms:join` (room del conductor; el id sale del token del
    handshake) y `forms:join-admin` (exige el permiso `formularios`, con lista
    blanca incluida).
- **Notificaciones** (campana, tabla `notificacion`), solo en envíos nuevos:
  el envío del portal llama a `avisarPreoperacional` (si el nombre o título del
  formato contiene «preoperacional», aviso a `operaciones`, `hseq` y
  `administracion`); el del portal y el de «mis formularios» llaman a
  `avisarNovedadesPreoperacional` (si el formato está en
  `CODIGOS_PREOPERACIONAL` y trae ítems en «Malo», un aviso por envío al área
  `mantenimiento`). Ninguno bloquea nada.
- **S3**: adjuntos en `formularios-dinamicos/<versionId>/<submissionId>/<clientAttachmentId>.<ext>`;
  URLs de lectura firmadas de 1 h. Quitar un adjunto no borra el objeto.
- **Correo**: la campaña del portal envía la guía con capturas embebidas
  (`src/assets/email/formularios`) y un magic link nuevo por destinatario
  (`conductor_token`). La prueba (`campana-portal/test`) no emite ninguno.
- **Chromium**: `documento/pdf` y `submissions/:id/pdf` usan
  `src/services/pdf.service.ts`; el primero con `pdfFromHtml` (red y
  JavaScript cerrados), el segundo con `pdfFromUrl` sobre la página del portal.
- **Bitácora** `form_submission_events`: `CREATED` (primer backup), `SUBMITTED`
  (con `limitLockKey`), `ATTACHMENT_ATTACHED` (con `verifiedBy`), `VOIDED`,
  `DISCARDED`, `RESTORED`.
- **Logs**: `forms:admin.query` por cada lista, detalle o export del explorador;
  eventos `forms:*` estructurados con `request_id`, actor e ids para seguir un
  envío de punta a punta.
- **Registro de actividad**: las escrituras con sesión pasan por el hook global
  de `registro_actividad`, salvo `/api/mis-formularios/drafts`,
  `/api/mis-formularios/attachments` y los patrones con `/validate` o `/export`. El portal no se registra (no hay
  `request.user`).

## Observaciones

- `POST /api/formularios/documento/pdf` renderiza HTML del cliente en una página
  del contexto por defecto del Chromium compartido (`--no-sandbox`), con solo
  `formularios:read`. La red interna y el JavaScript están cerrados
  (`blindarPagina`), pero no hay un contexto de navegador propio como dice la
  cabecera de `formularios-documento-pdf.service.ts` («página aislada»).
- `forms:join` (socket) solo verifica firma y `tipo` del token del portal: un
  enlace revocado sigue entrando a la sala de su conductor hasta que vence el
  JWT (`formularios-dinamicos.gateway.ts`).
- Ids sin validar: en el constructor (`:formId`, `:versionId`, `:id`) y en «mis
  formularios» (`:id`, `:clientSubmissionId`, `:assignmentId`) un id que no es
  UUID llega a Prisma o al cast `::uuid` del SQL crudo y sale como 500
  `INTERNAL_ERROR`, no como 400/404. El portal sí los valida
  (`formularios-dinamicos.controller.ts`, `formularios-mis.routes.ts`).
- `includeDeleted` usa `z.coerce.boolean()`: `?includeDeleted=false` (o `0`) se
  interpreta como `true`; solo la ausencia o el valor vacío lo apagan
  (`formularios-dinamicos.schema.ts`).
- El CSV incluye borradores si no se filtra `status`, y `valorPlano` no deshace
  la envoltura: esas celdas salen como `{"draftValue":…}` o
  `{"draftOptionValues":[…]}` (`formularios-envios.service.ts`).
- `submissionCount` de las asignaciones usa `_count` sin filtro: cuenta
  borradores, descartados y anulados, mientras el catálogo solo cuenta
  `SUBMITTED` vivos (`formularios-asignaciones.service.ts`).
- Targets `SEDE` con fallos silenciosos: la comparación es exacta (`Yopal` no
  alcanza a `YOPAL`, y el enum `sede_trabajo` tiene las dos grafías) y el valor
  no se valida contra el enum al crear. Con un valor fuera del enum, la
  asignación se guarda y después `conductoresAfectados` filtra
  `sede_trabajo: { in: [...] }` con ese texto, que Prisma rechaza: el alta
  responde 500 con la asignación ya creada, pausar/reanudar/cerrar cambian el
  estado y responden 500, y el `PATCH` falla antes de escribir (calcula los
  afectados primero), así que ese target no se puede corregir por la API.
  `GROUP` se acepta y no alcanza a nadie, sin error
  (`formularios-dinamicos.controller.ts`, `formularios-asignaciones.service.ts`,
  `formularios-portal.service.ts`).
- El `ETag` de la definición (`…/formularios/:assignmentId` en el portal y en
  «mis formularios») solo cubre `versionId` + `revision`, pero el cuerpo lleva
  datos de la asignación (`contextSchema`, `settings`, `name`) y el
  `businessDate`/`periodKey` del día: con `If-None-Match` el cliente recibe 304
  aunque eso haya cambiado (`formularios-portal.service.ts`).
- Anular el envío de un usuario interno emite `forms:submission.voided` a la
  room `conductor:null:forms` (`formularios-dinamicos.controller.ts`).
- `campana-portal/enviar` es síncrono: con 600 ms por correo, una audiencia de
  200 conductores tiene la petición abierta más de dos minutos; si un proxy la
  corta, reintentar reenvía a todos y emite otro magic link por cada uno.
- `PATCH /api/formularios/:formId` y `duplicate` validan `name`/`description`
  con `z.string()`, sin el saneado (`textoLinea`/`textoLargo`) que aplica el
  alta (`formularios-dinamicos.schema.ts`).
- Si el envío final entra mientras un backup espera el lock, el backup responde
  igualmente `status: 'DRAFT', alreadySubmitted: false`
  (`guardarBorradorPortal`).
- Campos que se validan y no se usan: `completedAt` (envío), `updatedAt`
  (backup), `clientMutationId` (versión) y `byteSize` (`complete`).

## Diferencias con Transmeralda

- **Campaña del portal.** Sin `periodo`, Cotransmeq toma la **nómina más
  reciente** (liquidaciones con exactamente el `periodo_start`/`periodo_end` de
  la última) y Transmeralda el mes calendario anterior. Transmeralda no devuelve
  `origen` en `GET /api/formularios/campana-portal/audiencia`, su
  `periodo.periodo` es siempre `YYYY-MM`, y la confirmación de
  `POST /api/formularios/campana-portal/enviar` es
  `ENVIAR_GUIA_FORMULARIOS_<YYYY-MM>` en vez de
  `ENVIAR_GUIA_FORMULARIOS_<origen>_<periodo>`.
- **Búsqueda del catálogo.** En Transmeralda `GET /api/formularios?search=`
  busca también en el título de las versiones; en Cotransmeq solo en código,
  nombre y descripción.
