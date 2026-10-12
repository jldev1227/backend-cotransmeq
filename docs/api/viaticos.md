# Viáticos

`/api/viaticos` y `/api/conductor-portal/viaticos` · código en [`src/modules/viaticos/`](../../src/modules/viaticos/) · permiso [`viaticos`](../permisos.md#catálogo-de-módulos)

Anticipos de dinero que Operaciones entrega a los conductores, los gastos con que
el conductor los legaliza desde la app, las solicitudes de más dinero, el saldo
(«fondo») del área de Operaciones del que salen, y los gastos que asume la empresa
directamente. Dos archivos de rutas: `viaticos.routes.ts` (panel, con sesión del
equipo) y `viaticos-portal.routes.ts` (portal del conductor), que se registra
dentro del bloque protegido de [conductor-portal](./conductor-portal.md); la
lógica está en `viaticos.service.ts`, `viaticos-fondo.service.ts`,
`viaticos-empresa.service.ts` y `viaticos-comprobante.service.ts`.

Reglas del módulo:

- **Anticipo** (`viatico_anticipo`): dinero entregado a un conductor para una
  placa, por `TRANSFERENCIA` (con fecha y comprobante opcional) o
  `RETIRO_TARJETA` (se anota la tarjeta o cuenta). Lleva el tercero propietario
  de la placa: el que se indique o el que tenga el vehículo.
- **Gasto** (`viatico_gasto`): lo reporta el conductor desde el portal contra uno
  de sus anticipos, con sus facturas adjuntas. Descuenta del saldo en cuanto se
  registra. Operaciones puede **anularlo** con motivo; nunca se borra.
- **Saldo** de un anticipo = `valor − Σ gastos no anulados`. No se guarda y
  puede quedar negativo (lo que la empresa le debe al conductor). Es «bajo»
  cuando queda en el 15 % del valor o menos (`UMBRAL_SALDO_BAJO`): se avisa una
  vez a Operaciones y al conductor, y si vuelve a subir la marca se limpia.
- **Solicitud** (`viatico_solicitud`): el conductor pide más dinero desde un
  anticipo; una sola pendiente por anticipo. Operaciones la **aprueba**
  registrando un anticipo nuevo con `solicitud_id` (mismo conductor y placa) o la
  **rechaza** con motivo.
- **Fondo del área** (`viatico_fondo_movimiento`, fondo `OPERACIONES`, uno solo):
  su saldo es la suma de los movimientos `RECARGA` (+), `ANTICIPO` (−),
  `GASTO_EMPRESA` (−), `AJUSTE` (±), `REVERSO` (+) y `CIERRE` (0, marca el fin de
  un corte; lo que queda pasa como arrastre al siguiente). Lo que entrega o paga
  un usuario del área `operaciones` **sin** `administracion` sale del fondo: sin
  saldo suficiente, el anticipo o el gasto no se registra. Administración entrega
  sin fondo. Los movimientos se serializan con un `pg_advisory_xact_lock`. Editar
  o eliminar un anticipo o gasto que salió del fondo deja un `AJUSTE` o un
  `REVERSO`.
- **Gastos de la empresa** (`viatico_gasto_empresa`): oficina, mantenimiento,
  pagos a conductores, cobros bancarios u otros, que asume la empresa o el tercero
  propietario de una placa.
- Anticipos y gastos de la empresa tienen borrado lógico (`deleted_at`); las
  lecturas lo filtran.

## Acceso

| Operación | Guarda |
|---|---|
| `/api/viaticos/*` | `sesión` (hook `onRequest` del plugin) |
| `GET /api/viaticos/*` | `viaticos:read` (`requirePermission` en cada ruta): Administración, Operaciones y Contabilidad |
| `POST`, `PUT`, `PATCH`, `DELETE /api/viaticos/*` | `viaticos:full`: Administración y Operaciones |
| `/api/conductor-portal/viaticos/*` | `portal`: `portalAuthMiddleware` de `conductor-portal.routes.ts`, token del magic link con `tipo: 'conductor_portal'` (el token de impresión de desprendibles recibe 403 aquí). El conductor sale del token (`sub`), nunca del cuerpo ni de la URL, y solo alcanza sus propios anticipos y gastos |

Contabilidad solo lee: también el fondo y el resumen. `POST /viaticos/comprobantes/leer`
solo lee, pero va por `POST` y pide `full`.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/viaticos/anticipos` | `viaticos:read` | Anticipos con su saldo, filtros y totales |
| POST | `/api/viaticos/anticipos` | `viaticos:full` | Registra un anticipo (o aprueba una solicitud) |
| GET | `/api/viaticos/anticipos/:id` | `viaticos:read` | Detalle con gastos, adjuntos y solicitudes |
| PUT | `/api/viaticos/anticipos/:id` | `viaticos:full` | Edita un anticipo |
| DELETE | `/api/viaticos/anticipos/:id` | `viaticos:full` | Elimina (lógico) un anticipo sin gastos vigentes |
| POST | `/api/viaticos/comprobantes/presign` | `viaticos:full` | URL firmada para subir el comprobante de un anticipo |
| POST | `/api/viaticos/comprobantes/leer` | `viaticos:full` | Lee el comprobante con IA para prellenar el formulario |
| POST | `/api/viaticos/gastos/:id/anular` | `viaticos:full` | Anula un gasto del conductor |
| GET | `/api/viaticos/solicitudes` | `viaticos:read` | Solicitudes de más dinero |
| GET | `/api/viaticos/solicitudes/:id` | `viaticos:read` | Una solicitud |
| POST | `/api/viaticos/solicitudes/:id/rechazar` | `viaticos:full` | Rechaza una solicitud |
| GET | `/api/viaticos/fondo` | `viaticos:read` | Saldo del fondo del área, cortes y últimos movimientos |
| GET | `/api/viaticos/fondo/consolidado` | `viaticos:read` | Movimientos de un periodo con saldo antes y después |
| POST | `/api/viaticos/fondo/recargas` | `viaticos:full` | Registra el saldo que recibió el área |
| POST | `/api/viaticos/fondo/ajustes` | `viaticos:full` | Corrección manual del saldo, con motivo |
| POST | `/api/viaticos/fondo/cierres` | `viaticos:full` | Cierra el corte en curso |
| PATCH | `/api/viaticos/fondo/movimientos/:id` | `viaticos:full` | Edita una recarga o un ajuste manual |
| GET | `/api/viaticos/vehiculos/:id/tercero` | `viaticos:read` | Tercero propietario de una placa |
| POST | `/api/viaticos/vehiculos/:id/tercero` | `viaticos:full` | Crea o reutiliza el tercero y lo asocia a la placa |
| GET | `/api/viaticos/resumen` | `viaticos:read` | Tablero: anticipos, legalizado y gastos por periodo |
| GET | `/api/viaticos/gastos-empresa` | `viaticos:read` | Gastos que asume la empresa (o el tercero) |
| POST | `/api/viaticos/gastos-empresa` | `viaticos:full` | Registra uno |
| PUT | `/api/viaticos/gastos-empresa/:id` | `viaticos:full` | Edita uno |
| DELETE | `/api/viaticos/gastos-empresa/:id` | `viaticos:full` | Elimina (lógico) uno |
| GET | `/api/conductor-portal/viaticos` | `portal` | Anticipos del conductor con su saldo |
| GET | `/api/conductor-portal/viaticos/:id` | `portal` | Detalle de uno de sus anticipos |
| POST | `/api/conductor-portal/viaticos/:id/gastos` | `portal` | Reporta un gasto contra su anticipo |
| POST | `/api/conductor-portal/viaticos/gastos/:gastoId/adjuntos/init` | `portal` | URL firmada para subir una factura del gasto |
| POST | `/api/conductor-portal/viaticos/gastos/:gastoId/adjuntos/:id/complete` | `portal` | Confirma la factura subida (tamaño y SHA-256) |
| POST | `/api/conductor-portal/viaticos/:id/solicitudes` | `portal` | Pide más dinero desde un anticipo |

### Formato de respuesta y errores

Todas las rutas responden `{ "success": true, "data": … }` (los dos listados
paginados ponen además `meta` y sus totales al mismo nivel). Los errores de
dominio (`ViaticosError`) salen como `{ "success": false, "message": "…", "code": "…" }`
con su estado; cualquier otro, como 500 con un mensaje fijo por ruta
(«No fue posible …»). Un body que no pasa el esquema zod da 400
`DATOS_INVALIDOS` con el mensaje `campo: motivo`. Un `:id` que no es uuid se
responde como inexistente (404 `NO_ENCONTRADO`), salvo en
`/vehiculos/:id/tercero` (ver Observaciones).

| Código | `code` | Cuándo |
|---|---|---|
| 400 | `DATOS_INVALIDOS`, `CONDUCTOR_INVALIDO`, `VEHICULO_INVALIDO`, `TERCERO_INVALIDO`, `COMPROBANTE_INVALIDO`, `RANGO_INVALIDO`, `RANGO_GRANDE` | Entrada inválida o referencias que no existen |
| 404 | `NO_ENCONTRADO`, `SOLICITUD_NO_ENCONTRADA`, `GASTO_NO_ENCONTRADO`, `ADJUNTO_NO_ENCONTRADO`, `VEHICULO_INVALIDO` | No existe, está eliminado o no es del conductor |
| 409 | `SOLICITUD_RESUELTA`, `SOLICITUD_PENDIENTE`, `SOLICITUD_CONFLICTO`, `ANTICIPO_CON_GASTOS`, `GASTO_ANULADO`, `GASTO_CONFLICTO`, `ADJUNTO_CONFLICTO`, `LIMITE_ADJUNTOS`, `ARCHIVO_NO_SUBIDO`, `FONDO_SIN_SALDO`, `FONDO_INSUFICIENTE`, `MOVIMIENTO_NO_EDITABLE`, `CORTE_VACIO`, `CORTE_YA_CERRADO`, `PLACA_SIN_TERCERO` | Conflicto con el estado actual |
| 413 / 415 | `ARCHIVO_GRANDE` / `TIPO_NO_ADMITIDO` | Archivo de más de 10 MB / que no es JPG, PNG, WEBP o PDF |
| 422 | `ARCHIVO_NO_COINCIDE` | El archivo subido no tiene el tamaño o el SHA-256 declarados |
| 502 / 503 | `LECTURA_FALLIDA` / `LECTURA_NO_DISPONIBLE` | Lectura automática del comprobante |

### Forma de un anticipo

El listado y el portal devuelven el **resumen**:

```json
{ "id": "uuid", "conductor": { "id": "…", "nombre": "…", "numero_identificacion": "…" },
  "vehiculo": { "id": "…", "placa": "ABC123", "descripcion": "Toyota Hilux" },
  "tercero": { "id": "…", "nombre": "…", "identificacion": "…" },
  "concepto": "…", "metodo": "TRANSFERENCIA", "fecha": "2026-10-01",
  "numero_comprobante": "…", "entidad": "…", "tarjeta_cuenta": null, "tiene_comprobante": true,
  "solicitud_id": null, "solicitud_pendiente": { "id": "…", "valor_solicitado": 200000, "created_at": "…" },
  "creado_por": { "id": "…", "nombre": "…" }, "created_at": "…",
  "valor": 1000000, "gastado": 870000, "saldo": 130000, "porcentaje_restante": 13,
  "saldo_bajo": true, "agotado": false }
```

El **detalle** añade `comprobante: { url, mime_type, nombre, key } | null` (URL de
lectura de 1 hora), `comprobante_lectura` (lo que leyó la IA), `actualizado_por`,
`updated_at`, `gastos` y `solicitudes`. Cada gasto:
`{ id, client_gasto_id, valor, descripcion, fecha, anulado, anulado_at, anulado_por, motivo_anulacion, created_at, adjuntos }`,
y cada adjunto `{ id, client_attachment_id, mime_type, byte_size, original_name, status: "PENDING" | "UPLOADED", url }`
(URL solo si está `UPLOADED`). Cada solicitud:
`{ id, anticipo_origen_id, valor_solicitado, observaciones, estado: "PENDIENTE" | "APROBADA" | "RECHAZADA", motivo_rechazo, resuelta_por, resuelta_at, anticipo_generado_id, created_at }`.

### `GET /api/viaticos/anticipos`

**Query** (zod)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `q` | string (≤ 120) | — | Cada palabra contra concepto, comprobante, tarjeta, placa y nombre, apellido o cédula del conductor |
| `estado` | `todos` \| `con_saldo` \| `saldo_bajo` \| `agotados` | `todos` | `con_saldo` = no está bajo; `saldo_bajo` = bajo pero no agotado; `agotados` = saldo ≤ 0 |
| `conductor_id`, `vehiculo_id` | uuid | — | |
| `desde`, `hasta` | `YYYY-MM-DD` | — | Sobre la fecha del anticipo |
| `page` | entero ≥ 1 | `1` | |
| `limit` | entero 1–100 | `20` | |

Trae todos los anticipos vigentes que cumplen los demás filtros, calcula el saldo
y filtra y pagina en memoria (son decenas o pocos cientos).

**Respuesta 200**:
`{ success, data: [resumen], meta: { total, page, limit, totalPages }, conteos: { todos, con_saldo, saldo_bajo, agotados }, totales: { anticipado, gastado, saldo }, solicitudes_pendientes }`.

### `POST /api/viaticos/anticipos` y `PUT /api/viaticos/anticipos/:id`

**Body** (zod `anticipoSchema`; el `PUT` reemplaza, con los mismos campos obligatorios)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `conductor_id` | uuid | sí | Conductor no eliminado |
| `vehiculo_id` | uuid | sí | Vehículo no eliminado |
| `concepto` | string 3–500 | sí | |
| `valor` | number > 0 | sí | Hasta 9.999.999.999 |
| `metodo` | `TRANSFERENCIA` \| `RETIRO_TARJETA` | sí | |
| `fecha` | `YYYY-MM-DD` | sí | |
| `tarjeta_cuenta` | string ≤ 120 | si `RETIRO_TARJETA` | De qué tarjeta o cuenta se retiró |
| `numero_comprobante`, `entidad` | string | no | Solo con `TRANSFERENCIA` |
| `comprobante` | `{ key, mime_type, nombre? }` | no | Solo con `TRANSFERENCIA`. La `key` tiene que estar bajo `viaticos/comprobantes/` y existir ya en S3 (409 `ARCHIVO_NO_SUBIDO` si no) |
| `comprobante_lectura` | objeto | no | Lo que devolvió `/comprobantes/leer`, para auditar luego si el valor registrado difiere |
| `solicitud_id` | uuid | no | Solo en el alta: aprueba esa solicitud pendiente. Conductor y placa se toman de la solicitud |
| `tercero_id` | uuid | no | Propietario de la placa; si falta, el vinculado al vehículo |

Lo que no aplica al método se limpia (un retiro con tarjeta no arrastra el
comprobante de una transferencia anterior). Al editar no se puede cambiar el
conductor si el anticipo tiene gastos vigentes (409 `ANTICIPO_CON_GASTOS`), ni
conductor y placa si nació de una solicitud.

**Fondo**: el alta descuenta del fondo si quien la registra es de Operaciones
sin Administración (409 `FONDO_SIN_SALDO` o `FONDO_INSUFICIENTE`, y no se crea
nada). Al editar, si el anticipo salió del fondo, la diferencia de valor se
devuelve o se descuenta con un `AJUSTE`.

**Respuesta**: 201 en el alta, 200 al editar; `data` es el detalle.

**Errores**: 400 (`DATOS_INVALIDOS`, `CONDUCTOR_INVALIDO`, `VEHICULO_INVALIDO`,
`TERCERO_INVALIDO`, `COMPROBANTE_INVALIDO`); 404 (anticipo o solicitud
inexistente); 409 (`SOLICITUD_RESUELTA`, `ARCHIVO_NO_SUBIDO`,
`ANTICIPO_CON_GASTOS`, `FONDO_SIN_SALDO`, `FONDO_INSUFICIENTE`).

### `DELETE /api/viaticos/anticipos/:id`

Borrado lógico. Solo si no tiene gastos vigentes (409 `ANTICIPO_CON_GASTOS`:
hay que anularlos antes). Si salió del fondo, lo descontado vuelve con un
`REVERSO`. **Respuesta 200**: `data: { id }`.

### `POST /api/viaticos/comprobantes/presign`

**Body**: `{ "mime_type": "image/jpeg" | "image/png" | "image/webp" | "application/pdf", "byte_size": 12345, "nombre"?: "…" }`
(`byte_size` como número JSON, hasta 10 MB).

**Respuesta 200**:
`data: { key: "viaticos/comprobantes/<AAAA-MM>/<uuid>.<ext>", upload_url, headers: { "Content-Type": "…" } }`.
El navegador hace `PUT` directo a `upload_url` (válida 15 minutos) con esas
cabeceras; luego manda la `key` en `comprobante` del anticipo.

### `POST /api/viaticos/comprobantes/leer`

**Body**: `{ "key": "viaticos/comprobantes/…", "mime_type": "image/jpeg" | "image/png" | "image/webp" | "application/pdf" }`.
La `key` tiene que empezar por `viaticos/comprobantes/` y no contener `..` (400
`COMPROBANTE_INVALIDO`).

Manda el archivo al despliegue de Azure OpenAI del asistente y devuelve lo que
lee, para prellenar el formulario (no decide nada):

```json
{ "success": true, "data": { "valor": 341110, "fecha": "2026-10-01", "numero_comprobante": "…",
  "entidad": "Bancolombia", "cuenta_origen": "…", "destinatario": "…", "confianza": "alta" } }
```

**Errores**: 503 `LECTURA_NO_DISPONIBLE` (Azure OpenAI sin configurar); 409
`ARCHIVO_NO_SUBIDO` (no se pudo leer de S3); 502 `LECTURA_FALLIDA` (el modelo
falló o tardó más de 45 s).

### `POST /api/viaticos/gastos/:id/anular`

**Body**: `{ "motivo": "…" }` (3–500). El gasto deja de descontar pero no se
borra. **Respuesta 200**: `data` es el detalle del anticipo. Errores: 404; 409
`GASTO_ANULADO`. Avisa al conductor y reevalúa la alerta de saldo bajo.

### `GET /api/viaticos/solicitudes` y `GET /api/viaticos/solicitudes/:id`

**Query** del listado: `estado` = `PENDIENTE` (por defecto) \| `APROBADA` \|
`RECHAZADA` \| `todas`. Devuelve hasta las **200** más recientes, sin paginar.
Cada solicitud trae, además de su forma, `conductor: { id, nombre, numero_identificacion }`,
`vehiculo: { id, placa }` y `anticipo_origen: { id, concepto, valor, gastado, saldo, porcentaje_restante, saldo_bajo, agotado }`.
El detalle devuelve un elemento con esa misma forma (404 si no existe).

### `POST /api/viaticos/solicitudes/:id/rechazar`

**Body**: `{ "motivo": "…" }` (3–500). Solo una `PENDIENTE` (409
`SOLICITUD_RESUELTA`; condicionado en el `UPDATE`, así que dos decisiones
simultáneas no se pisan). **Respuesta 200**: `data` es la solicitud. Avisa al
conductor. Para **aprobar** se registra el anticipo con
`POST /api/viaticos/anticipos` y `solicitud_id`.

### `GET /api/viaticos/fondo`

**Respuesta 200** — `data`:

```json
{ "fondo": "OPERACIONES", "requiere_fondo": true, "saldo": 2500000, "base_ultima_recarga": 5000000,
  "porcentaje_restante": 50, "saldo_bajo": false, "sin_saldo": false,
  "ultima_recarga": { "valor": 5000000, "fecha": "…", "por": "…" },
  "corte_actual": { "desde": "…", "arrastre": 0, "recibido": 0, "anticipos": 0, "gastos": 0, "ajustes": 0,
    "reversos": 0, "restante": 0, "movimientos": 0, "cerrado": null },
  "cortes": [],
  "movimientos": [{ "id": "…", "tipo": "ANTICIPO", "valor": -300000, "observaciones": null, "fecha": "…",
    "registrado_por": "…", "editable": false,
    "anticipo": { "id": "…", "concepto": "…", "conductor": "…", "placa": "…" }, "gasto_empresa": null }]
}
```

`requiere_fondo` dice si lo que entrega **quien consulta** descuenta del fondo.
`saldo_bajo` compara contra el 15 % de lo que había justo después de la última
recarga. `cortes` son los 12 últimos cerrados y `movimientos`, los 60 últimos,
del más reciente al más antiguo; `editable` marca las recargas y ajustes manuales.

### `GET /api/viaticos/fondo/consolidado`

**Query**: `desde` y `hasta` obligatorios (`YYYY-MM-DD`, días de Colombia, UTC−5);
400 `DATOS_INVALIDOS` si faltan o están al revés.

**Respuesta 200** — `data`:
`{ fondo, desde, hasta, saldo_inicial, saldo_final, totales: { recibido, anticipos, gastos, ajustes, reversos, cierres }, cierres: [{ id, fecha, restante, por, observaciones }], movimientos: [{ id, tipo, fecha, detalle, entra, sale, saldo_antes, saldo_despues, registrado_por, observaciones }] }`.
Es lo que alimenta el PDF del consolidado.

### `POST /api/viaticos/fondo/recargas`, `POST /api/viaticos/fondo/ajustes`, `POST /api/viaticos/fondo/cierres` y `PATCH /api/viaticos/fondo/movimientos/:id`

| Ruta | Body | Reglas |
|---|---|---|
| `recargas` | `{ valor > 0, observaciones? (≤ 500) }` | El saldo que recibió el área. No cierra el corte |
| `ajustes` | `{ valor ≠ 0 (con signo), observaciones (5–500, obligatorio) }` | Restar no puede dejar el saldo negativo (409 `FONDO_INSUFICIENTE`) |
| `cierres` | `{ observaciones? (≤ 500) }` | No mueve dinero. 409 `CORTE_VACIO` sin movimientos, `CORTE_YA_CERRADO` si el último ya es un cierre |
| `movimientos/:id` | El de `recargas` si el movimiento es una recarga; el de `ajustes` si es un ajuste | Solo movimientos manuales (409 `MOVIMIENTO_NO_EDITABLE` si vienen de un anticipo o gasto). Bajar el valor no puede dejar el saldo negativo |

Las tres primeras responden 201 y la última 200, todas con el estado del fondo
(forma de `GET /api/viaticos/fondo`) en `data`.

### `GET /api/viaticos/vehiculos/:id/tercero` y `POST /api/viaticos/vehiculos/:id/tercero`

El vehículo no tiene llave al tercero: se busca por `propietario_identificacion`
(tal cual y solo dígitos) y, si no, por `propietario_nombre` (sin distinguir
mayúsculas). El `GET` responde
`data: { placa, tercero: { id, nombre_completo, identificacion, telefono } | null, propietario: { nombre, identificacion } | null }`
(`propietario` es lo que el vehículo tiene escrito, para prellenar).

**Body del `POST`**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre_completo` | string 3–255 | sí | Se guarda en mayúsculas |
| `identificacion` | string 5–50 | sí | Se guardan solo dígitos y guion; al menos 5 dígitos |
| `telefono` | string ≤ 50 | no | |

Si ya hay un tercero con esa identificación lo reutiliza (y lo reactiva si estaba
eliminado); si no, lo crea. Luego escribe `propietario_nombre` y
`propietario_identificacion` del vehículo. **Respuesta 201**:
`data: { tercero, reutilizado }`. Errores: 400 `DATOS_INVALIDOS`; 404
`VEHICULO_INVALIDO`.

### `GET /api/viaticos/resumen`

**Query**: `desde`, `hasta` (`YYYY-MM-DD`, obligatorios); `agrupar` = `dia` \|
`semana` (por defecto; de lunes a domingo) \| `mes`. Con `dia`, como mucho 190
días (400 `RANGO_GRANDE`).

**Respuesta 200** — `data`:
`{ rango, totales: { anticipos, cantidad_anticipos, legalizado, gastos_empresa, cantidad_gastos_empresa, gastos_tercero, cantidad_gastos_tercero, egresos, en_manos_de_conductores }, periodos: [{ clave, desde, hasta, anticipos, cantidad_anticipos, legalizado, gastos_empresa, cantidad_gastos_empresa }], por_categoria: [{ categoria, valor, cantidad }], top_conductores: [{ id, etiqueta, valor, cantidad }], top_placas: […], fondos: [{ usuario_id, nombre, saldo }] }`.

Los periodos vacíos se incluyen. Los gastos que asume el tercero no suman a
`gastos_empresa` sino a `gastos_tercero`; `egresos` suma anticipos y todos los
gastos directos. `en_manos_de_conductores` es el saldo positivo de todos los
anticipos vigentes, sin importar el rango. Los top son los 8 mayores.

### `GET /api/viaticos/gastos-empresa`

**Query**: `q` (descripción, beneficiario, comprobante, placa, tercero o
conductor), `categoria`, `asume`, `desde`, `hasta`, `page` (1), `limit` (1–100,
20). **Respuesta 200**:
`{ success, data: [gasto], meta: { total, page, limit, totalPages }, total_valor }`.
Cada gasto:
`{ id, categoria, asume, tercero, descripcion, beneficiario, valor, fecha, metodo, numero_comprobante, comprobante: { key, mime_type, nombre } | null, vehiculo, conductor, creado_por, created_at }`.

### `POST /api/viaticos/gastos-empresa`, `PUT /api/viaticos/gastos-empresa/:id` y `DELETE /api/viaticos/gastos-empresa/:id`

**Body** (zod; el `PUT` reemplaza)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `categoria` | `OFICINA` \| `MANTENIMIENTO` \| `CONDUCTOR` \| `BANCARIO` \| `OTRO` | sí | `CONDUCTOR` exige `conductor_id` |
| `asume` | `EMPRESA` \| `TERCERO` | no | `EMPRESA` por defecto. `TERCERO` exige `vehiculo_id`; un `BANCARIO` no puede ser `TERCERO` |
| `tercero_id` | uuid | no | Con `TERCERO`: el indicado o el propietario de la placa (409 `PLACA_SIN_TERCERO` si no tiene) |
| `descripcion` | string 3–1000 | sí | |
| `beneficiario` | string ≤ 255 | no | |
| `valor` | number > 0 | sí | |
| `fecha` | `YYYY-MM-DD` | sí | |
| `metodo` | `TRANSFERENCIA` \| `RETIRO_TARJETA` \| `EFECTIVO` \| `DEBITO_AUTOMATICO` | sí | |
| `numero_comprobante` | string ≤ 60 | no | |
| `comprobante` | `{ key, mime_type, nombre? }` | no | `key` bajo `viaticos/comprobantes/` |
| `vehiculo_id`, `conductor_id` | uuid | no | Tienen que existir |

Si lo registra alguien de Operaciones sin Administración, sale del fondo
(`GASTO_EMPRESA`); al editar se ajusta la diferencia y al eliminar (borrado
lógico) se devuelve con un `REVERSO`. Respuestas: 201 / 200 con el gasto en
`data`; el `DELETE`, `data: { id }`.

### Portal del conductor: `GET /api/conductor-portal/viaticos` y `GET /api/conductor-portal/viaticos/:id`

El listado devuelve los 100 anticipos más recientes del conductor:
`data: { anticipos: [resumen], totales: { anticipado, gastado, saldo }, umbral_saldo_bajo: 0.15 }`
(con `creado_por: null`). El detalle es el del panel, solo si el anticipo es del
conductor (si no, 404), y sin `comprobante.key` ni `comprobante_lectura`.

### `POST /api/conductor-portal/viaticos/:id/gastos`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `client_gasto_id` | string 1–64 `[A-Za-z0-9_-]` | sí | Lo genera el teléfono; hace la operación idempotente |
| `valor` | number > 0 | sí | Valor total de las facturas |
| `fecha` | `YYYY-MM-DD` | sí | |
| `descripcion` | string ≤ 500 | no | |

Reintentar con el mismo `client_gasto_id` devuelve el gasto ya creado; si ese id
es de otro conductor u otro anticipo, 409 `GASTO_CONFLICTO`. El anticipo tiene
que ser del conductor y no estar eliminado (404). No se valida contra el saldo:
puede quedar negativo. **Respuesta 200**: `data` es el gasto. Reevalúa la alerta
de saldo bajo.

### `POST /api/conductor-portal/viaticos/gastos/:gastoId/adjuntos/init` y `POST /api/conductor-portal/viaticos/gastos/:gastoId/adjuntos/:id/complete`

Subida de cada factura en dos pasos, directo a S3 (como los adjuntos de
formularios):

**Body de `init`**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `client_attachment_id` | string 1–64 `[A-Za-z0-9_-]` | sí | Idempotencia; va en la clave de S3 |
| `mime_type` | `image/jpeg` \| `image/png` \| `image/webp` \| `application/pdf` | sí | Otro → 415 |
| `byte_size` | entero (número JSON) | sí | Hasta 10 MB (413) |
| `sha256` | 64 caracteres hex | sí | |
| `original_name` | string ≤ 255 | no | |

`init` responde `data: { id, status: "PENDING", upload_url, headers: { "Content-Type" } }`
(o `{ id, status: "UPLOADED" }` si ese archivo ya quedó). La clave es
`viaticos/gastos/<conductor>/<gasto>/<client_attachment_id>.<ext>` y la URL de
`PUT` dura 15 minutos. Con `FORMS_S3_NATIVE_CHECKSUM` el SHA-256 va firmado en la
URL y S3 rechaza bytes distintos; **no** hay que reenviarlo como cabecera. Un
gasto admite hasta 10 archivos vivos (409 `LIMITE_ADJUNTOS`).

`complete` (sin body) comprueba que el objeto existe (409 `ARCHIVO_NO_SUBIDO`),
que mide lo declarado y que su SHA-256 coincide —por el checksum nativo o leyendo
el objeto— (422 `ARCHIVO_NO_COINCIDE`), y lo marca `UPLOADED`. Responde el
adjunto con su URL de lectura. Errores de los dos: 404 si el gasto o el archivo
no son del conductor; 409 `ADJUNTO_CONFLICTO` si el `client_attachment_id` es de
otro gasto.

### `POST /api/conductor-portal/viaticos/:id/solicitudes`

**Body**: `{ "client_solicitud_id": "…", "valor": 200000, "observaciones"?: "…" }`
(`client_solicitud_id` como el de los gastos; `observaciones` ≤ 1000).
Idempotente por `client_solicitud_id` (409 `SOLICITUD_CONFLICTO` si es de otro
conductor). Una sola pendiente por anticipo (409 `SOLICITUD_PENDIENTE`).
**Respuesta 200**: `data` es la solicitud. Avisa a Operaciones.

## Efectos

- **Notificaciones del panel** (campana, socket `nueva-notificacion` al room del
  usuario y Web Push, tipo `GENERAL`): a todos los usuarios activos del área
  `operaciones` cuando llega una solicitud y cuando un anticipo queda con saldo
  bajo; a `operaciones` y `administracion` cuando el fondo cruza el 15 % de la
  última recarga. Ver [tiempo real](../tiempo-real.md).
- **Avisos al conductor**: fila en `conductor_notification` (su bandeja) y push a
  la app (`enviarPushConductor`, canal `viaticos`, ruta `/viaticos/<anticipo>`;
  `?solicitar=1` en el de saldo bajo) para `VIATICO_ANTICIPO_NUEVO`,
  `VIATICO_SOLICITUD_APROBADA`, `VIATICO_SOLICITUD_RECHAZADA`,
  `VIATICO_GASTO_ANULADO` y `VIATICO_SALDO_BAJO`. Nunca hacen fallar la operación.
- **S3**: comprobantes de anticipos en `viaticos/comprobantes/<AAAA-MM>/` y
  facturas de gastos en `viaticos/gastos/<conductor>/<gasto>/`, subidos por el
  cliente con URL firmada de `PUT` (15 min); las URL de lectura duran 1 hora.
  Ver [integraciones](../integraciones.md).
- **Azure OpenAI** (`/comprobantes/leer`): el comprobante sale hacia el
  despliegue del asistente.
- **Fondo**: anticipos y gastos de la empresa registrados por Operaciones dejan
  movimientos `ANTICIPO`/`GASTO_EMPRESA`, y sus ediciones y retiros, `AJUSTE` y
  `REVERSO`.
- **Registro de actividad** de las escrituras del panel; excluye
  `/api/viaticos/comprobantes/*` y todo `/api/conductor-portal`.

## Observaciones

- `GET /api/viaticos/solicitudes/:id` busca la solicitud entre las 200 más
  recientes (`detalleSolicitud` reutiliza el listado con `take: 200`): una más
  antigua responde 404 aunque exista. El listado tampoco pagina.
  (`viaticos.service.ts`)
- `GET` y `POST /api/viaticos/vehiculos/:id/tercero` no validan que `:id` sea un
  uuid: uno mal formado llega a Prisma y sale como 500. El `POST` además escribe
  en `terceros` (crea, o reactiva uno eliminado) y en `vehiculos` (propietario)
  con solo `viaticos:full`. (`viaticos-fondo.service.ts`)
- El detalle del portal (`GET /api/conductor-portal/viaticos/:id`) devuelve
  `creado_por` y `actualizado_por` (nombres de usuarios del panel), que el listado
  del portal oculta a propósito.
- El comprobante de un gasto de la empresa solo se comprueba por prefijo (no que
  exista en S3, como en los anticipos) y se devuelve como `key` sin URL: no hay
  ruta que firme su lectura. (`viaticos-empresa.service.ts`)
- Eliminar un anticipo no resuelve sus solicitudes pendientes: siguen
  `PENDIENTE` y cuentan en `solicitudes_pendientes`.
- Un gasto anulado sigue aceptando adjuntos (`iniciarAdjuntoGasto` no mira
  `anulado_at`).
- El comentario de `viaticos-portal.routes.ts` dice que reportar gastos y pedir
  dinero es solo de la app, pero la API acepta cualquier token del portal (web
  incluida): solo lo limita la interfaz.
- En `GET /api/viaticos/resumen`, `fondos[].usuario_id` lleva el nombre del
  fondo (`OPERACIONES`), no un id de usuario.
