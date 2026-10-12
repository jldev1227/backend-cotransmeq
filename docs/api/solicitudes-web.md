# Solicitudes web

`/api/public/solicitudes` y `/api/solicitudes` · código en [`src/modules/solicitudes-web/`](../../src/modules/solicitudes-web/) · permiso [`solicitudes`](../permisos.md#catálogo-de-módulos)

Formulario público de la landing (cotizaciones, solicitudes de servicio,
información) y la bandeja donde operaciones lo atiende. Reemplazó a los botones
de WhatsApp, teléfono y correo: llegaban pedidos de procedencia dudosa «para
ya» y no había forma de decidir con criterio a quién atender. Ahora cada envío
entra con radicado, se clasifica solo y espera en la bandeja a que alguien lo
verifique. Vive en `solicitud_web`.

- **Radicado** `SW-<año>-<n>` con cinco dígitos, correlativo por año.
- **Clasificación** al recibir (`triage.ts`, función pura): prioridad
  comercial, urgencia y un puntaje de riesgo con las señales que lo explican,
  que el panel muestra tal cual. No decide nada: una solicitud de riesgo alto
  entra igual, solo marcada.

  | Señal | Peso |
  |---|---|
  | Pide el servicio (cotización o servicio) para hoy, mañana o una fecha pasada — además la marca `urgente` | +3 |
  | Lo pide en 2 o 3 días | +1 |
  | Pide servicio sin empresa ni documento / sin empresa | +2 / +1 |
  | Correo de un dominio temporal / dice ser empresa y escribe desde uno gratuito | +4 / +1 |
  | Teléfono que no parece colombiano | +2 |
  | Formulario llenado en menos de 5 s (`tiempo_llenado_ms`) | +3 |
  | Dos o más enlaces en el mensaje | +2 |
  | Tres o más solicitudes de la misma IP en 24 h | +2 |
  | Mismo teléfono o correo con solicitudes descartadas o spam | +3 |
  | Mismo contacto ya atendido o verificado | −2 |
  | La empresa o el documento coinciden con un cliente | −3 |

  Riesgo `alto` desde 5 puntos, `medio` desde 2, `bajo` por debajo. Prioridad
  `alta` si pide servicio y es cliente, es para los próximos 7 días, son 15
  pasajeros o más, o la modalidad es `contrato`; `media` si pide servicio;
  `baja` en otro caso.
- **Estados**: `nueva`, `en_verificacion`, `verificada`, `atendida`,
  `descartada`, `spam`. «Pendientes» son las tres primeras. Asignar una
  solicitud `nueva` sin cambiarle el estado la pasa a `en_verificacion`.
- **Ley 1581**: sin `acepta_politica: true` no se guarda nada.
- Cada cambio de la bandeja queda en `historial` (JSON) con quién, cuándo y qué.

## Acceso

| Operación | Guarda |
|---|---|
| `POST /api/public/solicitudes` | `pública · límite 5 por hora y 20 por día por IP`. Limitador propio en memoria (`solicitudes-web/limitador.ts`, ventana deslizante) con la IP de `ipCliente` (`CF-Connecting-IP` primero: la primera de `X-Forwarded-For` la escribe el cliente y con ella el límite se saltaba). Cuenta también los envíos inválidos |
| `GET /api/solicitudes`, `/resumen`, `/:id` | `sesión` + `solicitudes:read` |
| `PATCH /api/solicitudes/:id` | `sesión` + `solicitudes:full` |

La landing llama desde otro origen. `https://cotransmeq.com` y
`https://www.cotransmeq.com` ya están en la lista por defecto de CORS
(`src/app.ts`); cualquier otro origen tiene que ir en `FRONTEND_URL` o el
navegador bloquea la petición.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/public/solicitudes` | pública · límite 5/h y 20/día por IP | Recibe una solicitud desde la landing |
| GET | `/api/solicitudes` | `solicitudes:read` | Bandeja paginada con filtros y resumen |
| GET | `/api/solicitudes/resumen` | `solicitudes:read` | Contadores para el menú y el panel de inicio |
| GET | `/api/solicitudes/:id` | `solicitudes:read` | Detalle con antecedentes y candidatos a asignar |
| PATCH | `/api/solicitudes/:id` | `solicitudes:full` | Cambia estado o prioridad, asigna o anota |

**Errores comunes**: los de zod responden **422**
`{ success: false, message: 'Datos inválidos', details: ['campo: mensaje', …] }`;
los de dominio, `{ success: false, message, code }` con su código; cualquier
otro, **500** `{ success: false, message }`.

### `POST /api/public/solicitudes`

**Body** (zod `crearSolicitudPublicaSchema`; un campo opcional vacío cuenta como
no enviado)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tipo` | `cotizacion` \| `servicio` \| `informacion` \| `otro` | sí | |
| `nombre` | string 3–120 | sí | |
| `correo` | email ≤ 160 | sí | Se guarda en minúsculas |
| `telefono` | string 7–30 | sí | Solo dígitos, `+`, espacios, guiones y paréntesis; entre 7 y 15 dígitos |
| `mensaje` | string 10–3000 | sí | |
| `acepta_politica` | `true` | sí | Autorización de tratamiento de datos |
| `empresa` | string ≤ 160 | no | |
| `documento` | string ≤ 30 | no | NIT o cédula |
| `cargo` | string ≤ 80 | no | |
| `origen`, `destino` | string ≤ 160 | no | |
| `fecha_servicio` | `AAAA-MM-DD` | no | |
| `pasajeros` | entero 1–500 | no | |
| `tipo_vehiculo` | string ≤ 60 | no | |
| `modalidad` | `eventual` \| `recurrente` \| `contrato` \| `sin_definir` | no | |
| `sitio_web` | string ≤ 200 | no | Campo trampa: los humanos no lo ven |
| `tiempo_llenado_ms` | entero | no | Lo mide la landing; alimenta la clasificación |
| `origen_sitio` | string ≤ 80 | no | Qué landing lo envió |

Con `empresa` o `documento` se busca un cliente conocido (por NIT si el
documento tiene 6 dígitos o más, o por nombre si la empresa tiene 4 letras o
más) y se enlaza en `cliente_id`. Se guardan además la IP, el user agent y el
referer.

**Respuesta 201**: `{ success: true, radicado: 'SW-2026-00042', urgente: false }`.
Si el campo trampa trae algo, responde lo mismo con `radicado: null` y no guarda
nada: un bot que ve 201 no insiste.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 422 | Lo rechaza zod | `{ success: false, message: 'Datos inválidos', details }` |
| 429 | Pasó el límite por IP | `{ success: false, message: 'Has enviado varias solicitudes seguidas. Intenta de nuevo más tarde.' }` (sin `Retry-After`) |
| 500 | No logró un radicado libre en tres intentos, u otro fallo | `{ success: false, message, code? }` |

### `GET /api/solicitudes`

**Query** (zod `listarSolicitudesSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page`, `limit` | entero | `1`, `20` | `limit` hasta 100 |
| `search` | string ≤ 120 | — | Radicado, nombre, empresa, correo, teléfono, documento, origen o destino |
| `tipo`, `estado`, `prioridad`, `riesgo` | enum | — | `riesgo` es el nivel (`bajo`, `medio`, `alto`) |
| `pendientes` | boolean | — | Sin `estado`, filtra las pendientes (ver Observaciones) |
| `orden` | `created_at` \| `prioridad` \| `estado` \| `fecha_servicio` \| `riesgo_puntaje` | `created_at` | `prioridad` ordena alta, media, baja dentro de la página |
| `direccion` | `asc` \| `desc` | `desc` | |

**Respuesta 200**

```json
{ "success": true,
  "items": [ { "id": "uuid", "radicado": "SW-2026-00042", "tipo": "servicio", "estado": "nueva", "prioridad": "alta",
               "nombre": "…", "empresa": "…", "correo": "…", "telefono": "…", "origen": "…", "destino": "…",
               "fecha_servicio": "…", "pasajeros": 12, "urgente": true, "riesgo_nivel": "medio", "riesgo_puntaje": 3,
               "cliente_id": null, "asignado_a_id": null, "asignado_a": null, "created_at": "…", "updated_at": "…" } ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 },
  "resumen": { "estados": { "nueva": 5, "atendida": 30 }, "pendientes": 9,
               "pendientes_por_prioridad": { "alta": 4, "media": 5 }, "pendientes_riesgo_alto": 2 } }
```

`resumen` cuenta sobre toda la tabla, sin los filtros de la consulta.

### `GET /api/solicitudes/resumen`

`{ success: true, pendientes, nuevas, urgentes }` (urgentes = pendientes
marcadas urgentes).

### `GET /api/solicitudes/:id`

`{ success: true, solicitud }` con la fila completa (incluye `senales`,
`historial`, `ip_origen`, `user_agent`, `referer` y `tiempo_llenado_ms`) más:

- `asignado_a` (`{ id, nombre, correo }`) y `cliente` (`{ id, nombre, nit }`).
- `antecedentes`: hasta diez solicitudes anteriores con el mismo teléfono,
  correo o IP, cada una con `coincide` (`['teléfono', 'correo', 'conexión']`).
- `candidatos`: usuarios activos de administración y operaciones
  (`{ id, nombre }`) para asignar.

**404** `{ success: false, message: 'La solicitud no existe', code: 'NO_EXISTE' }`.

### `PATCH /api/solicitudes/:id`

**Body** (al menos un campo; si no, 422 «No hay nada que cambiar»)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `estado` | enum de estados | no | `atendida` fija `atendida_at` |
| `prioridad` | `alta` \| `media` \| `baja` | no | |
| `asignado_a_id` | uuid \| `null` | no | `null` desasigna |
| `nota` | string 1–2000 | no | Solo va al historial |

Solo se registran los cambios reales; si no hubo ninguno, devuelve el detalle
sin escribir. **Respuesta 200**: `{ success: true, solicitud }` como en el
detalle. **404** `NO_EXISTE`; **422** `{ code: 'USUARIO' }` si el usuario a
asignar no existe.

## Efectos

- **Solicitud nueva** (sin esperar: el radicado ya existe aunque el aviso
  falle):
  - Notificación `GENERAL` (`referencia_tipo: 'solicitud_web'`) a cada usuario
    activo de administración u operaciones, por socket (`nueva-notificacion`
    al room `user-<id>`) y Web Push. Ver [tiempo-real](../tiempo-real.md).
  - Correo a las direcciones de `SOLICITUDES_WEB_EMAIL_TO` (separadas por
    coma; sin la variable no se envía) con el resumen, las señales y un enlace
    a `/dashboard/solicitudes?solicitud=<id>` del frontend (`EMAIL_FRONTEND_URL`
    o la primera de `FRONTEND_URL`). El asunto lleva `[URGENTE]` si aplica.
- **Asignación**: notificación al usuario asignado, salvo que se asigne a sí
  mismo.

## Observaciones

- `pendientes` se lee con `z.coerce.boolean()`: en el query `false` llega como
  texto y se convierte en `true`, así que `?pendientes=false` filtra igual que
  `?pendientes=true`.
- El 429 de este módulo no sigue el formato del limitador compartido (sin
  `Retry-After`, `error` ni `reintentar_en`), y los envíos inválidos también
  consumen cupo porque el límite se cuenta antes de validar.
- La poda del limitador (con más de 5.000 claves) usa la ventana de la
  consulta en curso: una comprobación horaria puede borrar contadores diarios
  que aún valían.
- Los avisos de solicitud nueva van por área (administración y operaciones)
  sin mirar `permisos_rutas`: pueden llegar a quien no puede abrir la bandeja.

## Diferencias con Transmeralda

Ninguna en el módulo. Cambia el CORS de `src/app.ts`: aquí `https://cotransmeq.com`
y `https://www.cotransmeq.com` están en la lista por defecto; en Transmeralda el
origen de su landing tiene que estar en `FRONTEND_URL` o el navegador rechaza el
envío.
