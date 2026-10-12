# Mis capacitaciones

`/api/mis-capacitaciones` · código en [`src/modules/mis-capacitaciones/`](../../src/modules/mis-capacitaciones/) (rutas) y [`src/modules/conductor-portal/capacitaciones.service.ts`](../../src/modules/conductor-portal/capacitaciones.service.ts) (lógica) · sin permiso de módulo en el [catálogo](../permisos.md#catálogo-de-módulos): solo `sesión` (ver [autenticación](../autenticacion.md))

Asistencias y evaluaciones de capacitación para los usuarios del dashboard,
pensadas para la app de gestión. Es el mismo servicio que usa la app del
conductor; solo cambia de dónde salen los datos de quien firma: aquí de `users`
(nombre, correo, teléfono, cargo —o sus áreas si no tiene cargo—,
`numero_documento` y `fecha_ingreso`, o `created_at` si falta). Las entidades
son ajenas a este módulo: las listas de asistencia (`formularios_asistencia`,
firmas en `respuestas_asistencia`) las gestiona [asistencias](./asistencias.md)
y las evaluaciones (`evaluacion`, resultados en `resultado`), [evaluaciones](./evaluaciones.md).

La persona se reconoce en esas tablas por su `numero_documento` **o** por la
huella `app-usuario:<id>` que se guarda en `device_fingerprint`: una asistencia
o evaluación cuenta como respondida si hay una fila con cualquiera de los dos,
así que lo firmado en la web pública con la misma cédula también cuenta. Reglas
que un integrador necesita saber:

- **Cédula obligatoria para firmar o responder.** Los usuarios no la tenían: si
  el perfil no la trae, el `POST` la recibe en `numero_documento` (se queda solo
  con los dígitos; 5 a 15). Sin cédula, 422.
- **La cédula es autodeclarada, y por eso está acotada.** Como firmas y
  resultados se casan por cédula, declarar la de otro abría su historial, sus
  respuestas y la imagen de su firma. Decisión (`cedulaDeclarada` en
  `mis-capacitaciones.routes.ts`, `esPropia` en `capacitaciones.service.ts`):
  - Se acepta solo si **ninguna otra cuenta activa** de `users` la tiene y **no
    es la de un conductor** (borrados incluidos) salvo que ese conductor tenga el
    mismo correo que el usuario (es la misma persona). Si no, 409 y no se
    escribe nada.
  - Se valida todo antes de escribir: la cédula se guarda en
    `users.numero_documento` **después** de que la firma o la evaluación
    quedaron (o si respondieron 409 por estar ya registradas con esa cédula),
    nunca cuando el `POST` falla por otra causa.
  - **Una vez guardada no se cambia desde aquí**: si el perfil ya tiene cédula,
    `numero_documento` del body se ignora. Corregirla es cosa de un
    administrador (hoy, en la base: la API de [usuarios](./usuarios.md) no
    expone el campo).
  - Aun así no se toma como verificada: las filas que casan **solo por
    cédula** (no llevan la huella `app-usuario:<id>`) cuentan como firmadas o
    respondidas y salen en el historial (título, fecha, puntaje), pero sus
    detalles no: `firma` va `null` y `resultado.respuestas` va vacío. Para
    los conductores (`conductor-portal`) la cédula la pone la empresa y no
    aplica este recorte.
- **Una firma por asistencia y una respuesta por evaluación** (409 la segunda).
- **Pendientes**: asistencias activas y no borradas, con fecha desde el ingreso
  del usuario hasta mañana (hora de Bogotá), que aún no firmó; evaluaciones de
  formaciones PESV cuya asistencia ya firmó, más hasta 30 evaluaciones creadas
  en los últimos 30 días, con preguntas, que aún no respondió.
- **La clave nunca sale**: el detalle de una evaluación no trae `esCorrecta` ni
  `respuestaCorrecta`, en `RELACION` la columna derecha va barajada y en
  `SOPA_LETRAS` no va dónde está cada palabra. Después de responder solo se
  devuelve lo que respondió y si acertó.
- **Calificación**: la misma que la web pública (`registrarResultado`); las
  preguntas `TEXTO` se califican con IA y valen 0 si esa llamada falla.
- Las respuestas llaman `conductor` a los datos de la persona (nombre, cédula,
  cargo, teléfono) por compatibilidad con la app del conductor.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` con `authMiddleware`), sin permiso de módulo. La persona sale del token (`request.user.id`): cada usuario solo ve y firma lo suyo |
| `…/asistencias/:token` | `:token` es el token público de la lista de asistencia (`formularios_asistencia.token`): identifica el formulario, no autentica. Con él se firma cualquier asistencia activa, esté o no entre las pendientes del usuario |
| `…/evaluaciones/:id` | `:id` es el id de la evaluación; si no es un UUID responde 404 |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/mis-capacitaciones` | sesión | Pendientes e historial del usuario |
| GET | `/api/mis-capacitaciones/asistencias/:token` | sesión | Una asistencia y si ya la firmó |
| POST | `/api/mis-capacitaciones/asistencias/:token` | sesión | Firma la asistencia |
| GET | `/api/mis-capacitaciones/evaluaciones/:id` | sesión | Una evaluación (sin la clave) y su resultado si ya respondió |
| POST | `/api/mis-capacitaciones/evaluaciones/:id` | sesión | Responde y califica la evaluación |

Los errores del servicio salen como `{ "success": false, "message": … }` con el
estado que indica cada caso; cualquier otro fallo, 500 con un mensaje genérico
(«No fue posible …»).

### `GET /api/mis-capacitaciones`

**Respuesta 200**

```json
{ "success": true, "data": {
  "asistencias_pendientes": [ { "token": "…", "tematica": "…", "objetivo": "…", "fecha": "2026-10-11",
                                "hora_inicio": "…", "hora_finalizacion": "…", "tipo_evento": "…",
                                "tipo_evento_otro": null, "lugar_sede": "…", "nombre_instructor": "…" } ],
  "evaluaciones_pendientes": [ { "id": "uuid", "titulo": "…", "descripcion": "…", "preguntas": 10,
                                 "puntaje_maximo": 100, "requiere_firma": true, "formacion": "…" } ],
  "asistencias_firmadas": [ { "token": "…", "…": "…", "firmada_en": "…" } ],
  "evaluaciones_respondidas": [ { "id": "uuid", "titulo": "…", "puntaje_total": 80, "puntaje_maximo": 100,
                                  "respondida_en": "…" } ] } }
```

- `asistencias_pendientes`: más reciente primero.
- `evaluaciones_pendientes`: `formacion` es el tema de la formación PESV de la
  que viene, o `null` si es una evaluación reciente sin formación.
- `asistencias_firmadas` y `evaluaciones_respondidas`: las 30 más recientes;
  si hay dos filas de la misma (web y app) cuenta la última. Las listas o
  evaluaciones borradas no aparecen.

### `GET /api/mis-capacitaciones/asistencias/:token`

**Respuesta 200** — `data: { asistencia, firmada_en, firma, conductor }`:
`asistencia` es el resumen del listado más `activo` (también se devuelven las
inactivas); `firmada_en` y `firma` (la imagen que dejó, como data URI) son
`null` si no ha firmado. Si hay una firma con su huella, es esa; si solo hay una
que casa por cédula (p. ej. firmó en la web pública), `firmada_en` trae su fecha
pero `firma` va `null`; `conductor` son sus datos (`nombre_completo`,
`numero_documento`, `cargo`, `telefono`). 404 `Asistencia no encontrada` si el
token no existe o la lista está borrada.

### `POST /api/mis-capacitaciones/asistencias/:token`

**Body** (sin esquema: el servicio lee lo que reconoce)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `firma` | string | sí | Tiene que empezar por `data:image/` |
| `numero_documento` | string | si el perfil no tiene cédula | Se queda con los dígitos; 5 a 15. Única entre cuentas activas y no puede ser la de otro conductor; se ignora si el perfil ya tiene cédula |

La fila de `respuestas_asistencia` se arma con los datos del perfil (nombre,
cédula, cargo, teléfono), la firma, la IP, el user agent y la huella; el
usuario no puede mandar otros datos.

**Respuesta 201** — `{ "success": true, "data": { "firmada_en": "…" } }`.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | `Revisa tu número de cédula` (fuera de 5–15 dígitos) |
| 409 | `Esa cédula ya está registrada en otra cuenta…` o `Esa cédula pertenece a otra persona registrada…` (no se guarda nada) |
| 404 | `Asistencia no encontrada` |
| 403 | `Esta asistencia ya no está disponible` (lista inactiva) |
| 409 | `Ya firmaste esta asistencia`, también si dos firmas simultáneas chocan con la llave única (formulario, huella) |
| 400 | `La firma es requerida` |
| 422 | `Tu perfil no tiene número de identificación registrado` |

### `GET /api/mis-capacitaciones/evaluaciones/:id`

**Respuesta 200** — `data: { evaluacion, resultado, conductor }`:

- `evaluacion`: `{ id, titulo, descripcion, requiere_firma, puntaje_maximo,
  preguntas: [{ id, texto, tipo, puntaje, opciones: [{ id, texto }],
  relacion_izq, relacion_der, configuracion }] }`, preguntas en orden de
  creación. `relacion_der` va barajada en `RELACION`; `configuracion` solo
  existe en `SOPA_LETRAS` (cuadrícula y lista de palabras, sin posiciones).
- `resultado`: `null` si no ha respondido; si no, `{ puntaje_total,
  puntaje_maximo, respondida_en, respuestas: [{ pregunta_id, valor_texto,
  valor_numero, opciones_ids, relacion, puntaje, estado }] }` con `estado`
  `correcta`, `parcial` o `incorrecta`. Prefiere el resultado con su huella; si
  solo hay uno que casa por cédula, `respuestas` va vacío.

404 `Evaluación no encontrada` si el id no es UUID, no existe o está borrada.

### `POST /api/mis-capacitaciones/evaluaciones/:id`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `respuestas` | arreglo | sí | `{ preguntaId, valor_texto?, valor_numero?, opcionesIds?, relacion?: [{ izq, der }], trazos?: [{ palabra?, desde: [fila, columna], hasta: [fila, columna] }] }` (`respuestaPreguntaSchema` de `evaluaciones/registrar-resultado.ts`). Las preguntas que no son de la evaluación se ignoran |
| `firma` | string | si `requiere_firma` | Una firma vacía cuenta como ausente |
| `numero_documento` | string | si el perfil no tiene cédula | Igual que en la asistencia |

**Respuesta 201** — `data: { puntaje_total, puntaje_maximo, respondida_en,
respuestas }` con el mismo detalle por pregunta que el `GET`.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | `Revisa tu número de cédula` |
| 409 | La cédula es de otra cuenta activa o de otro conductor (igual que en la asistencia) |
| 404 | `Evaluación no encontrada` |
| 409 | `Ya respondiste esta evaluación` |
| 400 | `Las respuestas no son válidas` (el body no pasa Zod) |
| 400 | `Esta evaluación requiere tu firma` |
| 422 | `Tu perfil no tiene número de identificación registrado` |
| 409 | La evaluación se editó mientras se respondía y una opción marcada ya no existe («Recarga la página y vuelve a responder») |

## Efectos

- **Firma de asistencia**: fila en `respuestas_asistencia` y evento de socket
  `asistencias:respuesta:created` (el mismo que emite la firma desde la web
  pública) con `{ respuesta, formularioId, formularioToken, timestamp }`, donde
  `respuesta` es la fila completa. Ver [tiempo real](../tiempo-real.md).
- **Evaluación**: fila en `resultado` con sus respuestas calificadas y evento
  `nueva-respuesta` al room `evaluacion-<id>` con una fila ligera (sin firma,
  sin la evaluación ni la clave; ver [evaluaciones](./evaluaciones.md)).
- **IA**: cada respuesta `TEXTO` no vacía se califica con `aiGradingService`
  (ver [integraciones](../integraciones.md)).
- **Perfil**: `users.numero_documento` cuando el usuario no lo tenía, lo manda,
  pasa la validación y la firma o la respuesta quedaron (o ya estaban). Solo
  si sigue vacío (`updateMany` con `numero_documento` nulo o vacío) y sin tocar
  `updated_at`.
- **Registro de actividad**: los dos `POST` pasan por el hook global de
  `registro_actividad`.

## Observaciones

- La cédula sigue siendo autodeclarada en lo que no cubre la validación: quien
  declare la de una persona sin cuenta activa ni ficha de conductor (p. ej.
  alguien que solo firmó en la web pública, o un usuario desactivado) ve en su
  historial los títulos, fechas y puntajes de esa persona y no puede firmar lo
  que ella ya firmó; ya no su firma ni sus respuestas. Tampoco hay pantalla de
  administrador para corregir una cédula mal puesta: la API de usuarios no
  expone `numero_documento` (`mis-capacitaciones.routes.ts`).
- `asistencias:respuesta:created` se emite con `io.emit`, a **todos** los sockets
  conectados, con la fila entera: firma en data URI, cédula, teléfono, IP y user
  agent (mismo patrón que `asistencias.controller.ts`).
- `resultado` no tiene índice único por evaluación y persona: dos `POST`
  simultáneos pueden pasar la comprobación previa y guardar dos resultados (la
  firma de asistencia sí lo tiene, `@@unique([formulario_id, device_fingerprint])`).
- Firmar no comprueba fecha ni ingreso: con el `token` de cualquier lista activa
  el usuario firma aunque no le aparezca como pendiente.
