# Evaluaciones

`/api/evaluaciones` y `/api/public/evaluaciones` · código en [`src/modules/evaluaciones/`](../../src/modules/evaluaciones/) · permiso [`evaluaciones`](../permisos.md#catálogo-de-módulos)

Cuestionarios de capacitación que HSEQ arma y comparte por enlace; quien
responde lo hace sin sesión, desde la página pública. Modelos: `Evaluacion` →
`Pregunta` → `Opcion` (con `esCorrecta`); cada envío es un `Resultado` (datos
de la persona, firma, IP, huella del dispositivo y `puntaje_total`) con una
`Respuesta` por pregunta.

Reglas que un integrador necesita saber:

- **Tipos de pregunta**: `OPCION_UNICA`, `OPCION_MULTIPLE`, `NUMERICA`,
  `TEXTO`, `RELACION`, `VERDADERO_FALSO` y `SOPA_LETRAS`.
- **La nota la pone el servidor** contra la clave **actual**
  (`calificarRespuestas` en `registrar-resultado.ts`); es la misma lógica para
  la página pública, el portal del conductor y la corrección de un
  administrador:
  - `OPCION_UNICA`: todo el puntaje si marca exactamente una y es la única correcta.
  - `OPCION_MULTIPLE`: proporcional, `round(aciertos / correctas × puntaje)`;
    las marcadas incorrectas no restan.
  - `NUMERICA` y `VERDADERO_FALSO` (`valor_numero`: 1 verdadero, 0 falso):
    igualdad exacta con `respuestaCorrecta`.
  - `TEXTO`: la califica la IA (ver Efectos); sin IA configurada o si falla,
    0 y queda para corrección manual.
  - `RELACION`: un punto por pareja correcta (`relacionIzq[i] ↔ relacionDer[i]`),
    con tope en el puntaje de la pregunta.
  - `SOPA_LETRAS`: proporcional a las palabras encontradas con trazos válidos.
  - Marcar una opción que la pregunta ya no tiene es un error (antes se
    calificaba 0 en silencio): 409 `EVALUACION_MODIFICADA` al responder, 400 al
    corregir. Las respuestas a preguntas que no existen se ignoran.
- **La clave** (`esCorrecta`, `respuestaCorrecta`, ubicación de las palabras)
  solo viaja en las rutas del equipo. La vista pública la quita y baraja la
  columna derecha de `RELACION`; `responder` y `verificar` devuelven solo el
  resultado (`resultadoPublico` en `evaluacion-publica.ts`), y el evento
  `nueva-respuesta` tampoco la lleva. Hasta oct-2026 `responder` devolvía la
  evaluación completa: con una respuesta de prueba se sacaba la clave.
- **Aprobado** es llegar al 70 % del puntaje máximo (`MINIMO_APROBACION` en
  `evaluacion-publica.ts`), el mismo umbral del PDF.
- **Editar conserva ids**: las preguntas y opciones que llegan con `id` se
  actualizan en su sitio, porque las respuestas ya registradas guardan el id de
  la opción marcada. Recrearlas dejó a personas con 0 sin haber fallado.

### Sopa de letras

La configuración vive en `Pregunta.configuracion` (JSON). El editor manda
`{ palabras: string[], tamano?: 6–20, diagonales?: boolean }` y el servidor
(`sopa-letras.ts`):

- normaliza las palabras: mayúsculas, sin tildes ni espacios, conserva la Ñ,
  descarta las de menos de dos letras y las repetidas;
- fija el lado de la cuadrícula: el mayor entre 6, `tamano` (12 por defecto) y
  la palabra más larga, con tope 20;
- con `diagonales: true` usa las ocho direcciones, inversas incluidas; si no,
  solo horizontal y vertical hacia adelante;
- genera la cuadrícula **una vez** y de forma determinista (la misma entrada da
  la misma sopa), y guarda
  `{ tamano, diagonales, palabras: [{ texto, fila, columna, dFila, dColumna }], cuadricula: string[] }`.
  Al editar se conserva mientras no cambien palabras, tamaño ni diagonales, para
  que los trazos ya registrados sigan apuntando a las mismas celdas;
- si no hay palabras válidas o no caben, responde 400 con el motivo.

El evaluado recibe `{ tamano, diagonales, cuadricula, palabras: string[] }`,
sin las ubicaciones, y responde con
`trazos: [{ palabra?, desde: [fila, columna], hasta: [fila, columna] }]`. Un
trazo vale si las letras de esa recta forman una palabra de la lista, en
cualquier sentido. Se guarda lo que el servidor validó, no lo que llegó:
`opcionesIds` = palabras encontradas y `relacion` = trazos válidos.

## Acceso

| Operación | Guarda |
|---|---|
| Rutas del equipo | `sesión` (`onRequest: authMiddleware` en cada ruta) y `permisoPorMetodo('evaluaciones')` en el plugin: `evaluaciones:read` en `GET`, `evaluaciones:full` en el resto. Administración y HSEQ |
| `PUT /:id/resultados/:resultadoId` | además, `requirePermission('evaluaciones', 'full')` en la propia ruta (mismo resultado) |
| `GET /public/evaluaciones/:id`, `POST /evaluaciones/:id/responder`, `GET /evaluaciones/:id/verificar` | `pública`: quedan fuera de la guarda por `RUTAS_PUBLICAS` (`excepto`). El enlace lleva el `id` (uuid) de la evaluación; no hay token aparte. `verificar` identifica a quien respondió por `device_fingerprint`. Límites (`preHandlerLimite`, 429 con `Retry-After`): `verificar`, 120 por IP cada 15 minutos; `responder`, 120 por IP por hora y 5 por hora para el mismo documento en la misma evaluación. Holgados por IP porque un grupo en capacitación responde desde el wifi de la sede. `GET /public/evaluaciones/:id` no tiene límite |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/evaluaciones` | `evaluaciones:read` | Lista paginada, con preguntas y clave |
| POST | `/api/evaluaciones` | `evaluaciones:full` | Crea una evaluación con sus preguntas |
| GET | `/api/evaluaciones/:id` | `evaluaciones:read` | Evaluación completa, con la clave |
| PUT | `/api/evaluaciones/:id` | `evaluaciones:full` | Reemplaza la evaluación conservando ids |
| DELETE | `/api/evaluaciones/:id` | `evaluaciones:full` | Borrado lógico |
| GET | `/api/evaluaciones/:id/resultados` | `evaluaciones:read` | Resultados, versión ligera |
| GET | `/api/evaluaciones/:id/resultados/:resultadoId` | `evaluaciones:read` | Un resultado completo, con firma |
| PUT | `/api/evaluaciones/:id/resultados/:resultadoId` | `evaluaciones:full` | Corrige las respuestas y recalifica |
| GET | `/api/evaluaciones/:id/exportar-pdf` | `evaluaciones:read` | PDF resumen de participantes |
| GET | `/api/evaluaciones/:id/resultados/:resultadoId/exportar-pdf` | `evaluaciones:read` | PDF de una respuesta |
| GET | `/api/evaluaciones/:id/exportar-zip` | `evaluaciones:read` | ZIP con un PDF por resultado |
| GET | `/api/public/evaluaciones/:id` | pública | Evaluación sin la clave, para responder |
| POST | `/api/evaluaciones/:id/responder` | pública | Registra y califica una respuesta; devuelve solo la nota |
| GET | `/api/evaluaciones/:id/verificar` | pública | Nota de este dispositivo, si ya respondió |

Ninguna ruta declara esquema de Fastify: valida zod en el controlador, y un
rechazo responde 400 `{ "success": false, "errors": [<issues de zod>] }`. Un
error no capturado sale con el formato por defecto de Fastify.

### `GET /api/evaluaciones`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | entero | `1` | |
| `limit` | entero | `10` | Máximo 100 |
| `search` | string | — | Contiene, en título o descripción |
| `sortBy` | `titulo` \| `created_at` | `created_at` | Otro valor cae a `created_at` |
| `sortOrder` | `asc` \| `desc` | `desc` | |

**Respuesta 200** — `{ success, data: [<evaluación con preguntas y opciones>], meta: { total, page, limit, totalPages } }`.
Sin eliminadas.

### `POST /api/evaluaciones` y `PUT /api/evaluaciones/:id`

**Body** (zod `evaluacionSchema`, el mismo para los dos)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `titulo` | string | sí | |
| `descripcion` | string \| null | no | |
| `requiere_firma` | boolean | no | `false` por defecto, también en `PUT` |
| `preguntas` | arreglo | sí | Ver abajo |

Cada pregunta:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `id` | uuid | no | En `PUT`, si es de esta evaluación se actualiza; sin `id` o con uno ajeno se crea |
| `texto` | string | sí | |
| `tipo` | uno de los siete tipos | sí | |
| `puntaje` | entero ≥ 0 | sí | 0 permitido (p. ej. texto sin nota) |
| `opciones` | `[{ id?, texto, esCorrecta }]` | no | Opción única o múltiple; `esCorrecta` es `false` por defecto |
| `relacionIzq`, `relacionDer` | string[] | no | Parejas por posición |
| `respuestaCorrecta` | number \| null | no | Numérica y verdadero/falso |
| `configuracion` | objeto \| null | no | Solo sopa de letras (ver arriba); en los demás tipos se guarda `null` |

`PUT` es un reemplazo: una pregunta existente que no venga se **borra** junto
con sus respuestas (cascada), y lo mismo una opción que no venga. Todo va en una
transacción con 15 s de tope.

**Respuesta 200** (también en `POST`) — `{ success: true, data: <evaluación con preguntas y opciones> }`.

**Errores**: 400 de zod; 400 `{ success: false, message }` si la sopa no se
puede generar; en `PUT`, un id inexistente da 500.

### `GET /api/evaluaciones/:id` y `DELETE /api/evaluaciones/:id`

`GET` devuelve la evaluación con la clave, también si está eliminada; 404
`{ success: false, message: "No encontrada" }`. `DELETE` marca `deleted_at` y
responde `{ success: true }`; los resultados se quedan. Un id con formato
inválido da 500 en los dos; uno inexistente da 404 en `GET` y 500 en `DELETE`.

### `GET /api/public/evaluaciones/:id`

**Respuesta 200**

```json
{ "success": true, "data": { "id": "uuid", "titulo": "…", "descripcion": null, "requiere_firma": true,
  "preguntas": [ { "id": "uuid", "texto": "…", "tipo": "OPCION_UNICA", "puntaje": 2,
                   "opciones": [ { "id": "uuid", "texto": "…" } ], "relacionIzq": [], "relacionDer": [], "configuracion": null } ] } }
```

Sin `esCorrecta` ni `respuestaCorrecta`; `relacionDer` barajada en `RELACION`;
`configuracion` solo en la sopa y sin ubicaciones. 404 si el id no es uuid, no
existe o está eliminada.

### `POST /api/evaluaciones/:id/responder`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre_completo`, `numero_documento`, `cargo`, `telefono` | string no vacío | sí | `numero_documento` se recorta |
| `correo` | email | sí | |
| `firma` | string | si `requiere_firma` | Imagen en data URI (`data:image/…`); obligatoria cuando la evaluación la pide |
| `device_fingerprint` | string | no | Si llega, una sola respuesta por dispositivo; si no, una por `numero_documento` en esta evaluación (409) |
| `respuestas` | arreglo | sí | Ver abajo |

Cada respuesta (`respuestaPreguntaSchema`, compartido con el portal del conductor):

| Campo | Tipo | Para |
|---|---|---|
| `preguntaId` | string | todas (obligatorio) |
| `opcionesIds` | string[] | opción única o múltiple |
| `valor_numero` | number | numérica y verdadero/falso |
| `valor_texto` | string | texto |
| `relacion` | `[{ izq, der }]` | relación |
| `trazos` | `[{ palabra?, desde: [f, c], hasta: [f, c] }]` | sopa de letras |

El servidor añade la IP (`CF-Connecting-IP`, si no `x-forwarded-for` o la de
la conexión; recortada a 45 caracteres) y el user agent.

**Respuesta 200**

```json
{ "success": true, "data": { "respondido": true, "nombre": "…", "fecha": "2026-10-11T15:00:00.000Z",
  "puntaje_total": 8, "puntaje_maximo": 10, "porcentaje": 80, "aprobado": true,
  "aciertos": 4, "total_preguntas": 5 } }
```

`porcentaje` lleva un decimal, redondeado como en el PDF. `aciertos` cuenta las
preguntas con puntaje mayor que 0 en las que obtuvo el puntaje completo, y
`total_preguntas` cuántas preguntas tienen puntaje. No hay detalle por
pregunta: saber cuáles acertó, con unos pocos intentos, reconstruye la clave.
Tampoco vuelven los datos de quien respondió (salvo el nombre).

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Body inválido | `{ success: false, errors }` |
| 400 | `requiere_firma` y no llega una firma `data:image/…` | `{ success: false, code: "FIRMA_REQUERIDA", message }` |
| 404 | La evaluación no existe, está eliminada o `:id` no es uuid | `{ success: false, message: "Evaluación no encontrada" }` |
| 409 | Ya hay respuesta de ese dispositivo (o, sin huella, de ese documento) | `{ success: false, code: "YA_RESPONDIO", message }` |
| 409 | Marca una opción que ya no existe | `{ success: false, code: "EVALUACION_MODIFICADA", message }` |
| 429 | Pasó el límite por IP o por documento | `{ success: false, error, message, reintentar_en }` |

El control de duplicados frena el doble envío, no a quien se lo proponga: la
huella la genera el cliente. Lo que protege la clave es que la respuesta ya no
la trae.

### `GET /api/evaluaciones/:id/verificar`

Query `device_fingerprint` (obligatorio; 400 si falta). Responde
`{ success: true, data: <resultado público> | null }`, con la misma forma que
`responder` (nombre, fecha y nota; sin documento, correo, teléfono, firma, IP
ni respuestas). La consulta solo pide a la base nombre, puntaje, fecha y el
puntaje de cada respuesta. 404 si el id no es uuid o la evaluación no existe o
está eliminada; 429 al pasar el límite por IP.

### `GET /api/evaluaciones/:id/resultados` y `GET /api/evaluaciones/:id/resultados/:resultadoId`

La lista es ligera a propósito (con 15 respuestas la versión completa pesaba
525 KB y no llegaba a cargar): sin firma y sin la pregunta anidada.

```json
{ "success": true, "data": [ { "id": "uuid", "evaluacionId": "uuid", "nombre_completo": "…", "numero_documento": "…",
  "cargo": "…", "correo": "…", "telefono": "…", "puntaje_total": 8, "created_at": "…", "tiene_firma": true,
  "respuestas": [ { "id": "uuid", "preguntaId": "uuid", "valor_texto": null, "valor_numero": null,
                    "opcionesIds": ["uuid"], "relacion": [], "puntaje": 2 } ] } ] }
```

El detalle de un resultado trae todo: firma y, en cada respuesta, la pregunta
con sus opciones. 404 `{ success: false, error: "No encontrado" }` si algún id
no es uuid, y `Resultado no encontrado` si no es de esa evaluación.

### `PUT /api/evaluaciones/:id/resultados/:resultadoId`

Corrección por un administrador, típicamente cuando la evaluación se editó
después de que alguien respondiera. Body `{ "respuestas": [<respuesta>] }` con
el mismo formato que `responder`. Reemplaza **todas** las respuestas del
resultado y recalifica con la clave actual; las de texto conservan su nota si
el texto no cambió (la IA no es determinista).

**Respuesta 200** — el resultado con respuestas y preguntas. **Errores**: 400
de zod (`errors`) o por una opción que no existe (`message`); 404
`{ success: false, error }` si algún id no es uuid, si la evaluación no existe o
está eliminada, o si el resultado no es suyo.

### Exportaciones

- `GET /api/evaluaciones/:id/exportar-pdf`: resumen de participantes en carta apaisada,
  `attachment; filename="evaluacion_<título>_<fecha>.pdf"`.
- `GET /api/evaluaciones/:id/resultados/:resultadoId/exportar-pdf`: detalle de una respuesta en
  carta vertical, `evaluacion_<título>_<nombre>.pdf`.
- `GET /api/evaluaciones/:id/exportar-zip`: ZIP armado en memoria con un PDF individual por
  resultado (`<nombre>_<documento>.pdf`); 404 si no hay resultados.

404 `{ success: false, message }` si la evaluación o el resultado no existen;
cualquier otro fallo, 500 con el mensaje.

## Efectos

- **Sockets** (ver [tiempo real](../tiempo-real.md)): `nueva-respuesta` a la
  sala `evaluacion-<id>` cada vez que alguien responde (web pública, portal del
  conductor o Mis capacitaciones), con la misma forma que una fila de
  `GET /:id/resultados` (`SELECT_RESULTADO_LIGERO` en `registrar-resultado.ts`:
  sin firma, con `tiene_firma`, y sin la evaluación ni la pregunta anidada, es
  decir, sin la clave); y `respuesta-actualizada` al corregir un resultado. Para entrar a la sala
  (`join-evaluacion`) basta un socket autenticado.
- **IA**: las preguntas `TEXTO` las califica `aiGradingService`
  (`src/services/ai-grading.service.ts`), Ministral-3B en Azure con
  `MINISTRAL_ENDPOINT`, `MINISTRAL_API_KEY` y `MINISTRAL_MODEL_NAME`. Sin esas
  variables avisa en el log y pone 0; no impide arrancar. Ver
  [integraciones](../integraciones.md).
- **PDF**: HTML paginado por Chromium (`pdfFromHtml`), plantilla
  `evaluacion-pdf.template.ts` con la marca, el NIT y los colores de la
  empresa.
- **Otras vías**: el portal del conductor y Mis capacitaciones responden
  evaluaciones con `registrarResultado`, por sus propias rutas
  (`src/modules/conductor-portal/capacitaciones.service.ts`; ver
  [conductor-portal](./conductor-portal.md) y [mis-capacitaciones](./mis-capacitaciones.md)).
- **Registro de actividad**: las escrituras del equipo dejan fila en
  `registro_actividad` (ver [actividad](./actividad.md)); `responder` desde la
  web pública no, porque no hay usuario.

## Observaciones

- La sala `evaluacion-<id>` pide identidad pero no permiso: cualquier usuario
  autenticado que conozca el uuid recibe las respuestas con datos personales.
  El propio `src/sockets/index.ts` lo deja como pendiente; su comentario dice
  que no existe el módulo `evaluaciones` en `permissions.ts`, y ya existe.
- `PUT /:id` borra en duro las preguntas que no vengan y, por cascada, las
  respuestas ya registradas a esas preguntas.
- Ids con formato inválido en `GET /:id` y `DELETE /:id`, e ids inexistentes
  en `PUT` y `DELETE`, salen 500 con el mensaje de Prisma.
- `respuesta-actualizada` sí lleva el resultado con cada pregunta y sus
  opciones (`esCorrecta`): solo lo dispara la corrección de un administrador y
  la sala exige sesión, pero vale lo dicho arriba sobre el permiso de la sala.
- `GET /public/evaluaciones/:id` no tiene límite de intentos (no expone datos
  personales ni la clave).
