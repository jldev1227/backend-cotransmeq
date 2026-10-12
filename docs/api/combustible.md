# Combustible

`/api/combustible` · código en [`src/modules/combustible/`](../../src/modules/combustible/) · permiso [`combustible`](../permisos.md#catálogo-de-módulos)

Registro de tanqueos de la flota (tabla `combustible_tanqueos`, modelo
`combustible_tanqueo`), con comprobante opcional en S3, y cálculo del rendimiento
(km por galón) y del costo por kilómetro. El modelo no declara relaciones: placas,
conductores y usuarios se resuelven por lote al serializar. Solo se registran
`DIESEL` y `GASOLINA`, que se miden en galones (gas y carga eléctrica se venden en
otras unidades y darían un «rendimiento» sin sentido). Medios de pago: `EFECTIVO`,
`TARJETA`, `TRANSFERENCIA`, `CREDITO_ESTACION`, `ANTICIPO` (la plata de viáticos que
lleva el conductor).

**Rendimiento de llenado a llenado** (`rendimiento.ts`). Solo cuando el tanque queda
lleno se sabe cuánto se gastó desde el lleno anterior. Cada tramo va de un lleno al
siguiente y se atribuye al que lo cierra: km recorridos entre los dos llenos ÷
galones de todos los tanqueos posteriores al primero (parciales incluidos). Un
parcial no cierra tramo; lo anterior al primer lleno de un vehículo no se puede
medir; dos llenos al mismo odómetro se descartan. Un tramo es **alerta** cuando
rinde menos del 75 % de la referencia: el rendimiento ponderado de los 5 tramos
anteriores del mismo vehículo, con un mínimo de 3 (con menos no se alerta). El
cálculo usa siempre el historial completo del vehículo hasta el final del periodo
consultado, aunque se filtre por fechas o por conductor: el rendimiento es del
vehículo, no de quien tanqueó.

**Fecha y hora.** `fecha_hora` llega como la escribe un `datetime-local`
(`2026-10-10T14:30`, hora de Colombia) o en ISO con zona; sin zona se interpreta en
Bogotá (UTC−5) y no en la del servidor. No puede ser más de una hora futura. Los
filtros `desde`/`hasta` son días de calendario en Colombia, ambos incluidos.

**Odómetro.** No puede ser menor que el del tanqueo inmediatamente anterior (por
fecha) ni mayor que el del siguiente: al registrar uno atrasado manda el que queda
en medio. Igual al anterior sí se acepta. El mismo vehículo a la misma fecha y hora
exactas se rechaza como duplicado (doble clic o factura cargada dos veces).

## Acceso

| Operación | Guarda |
|---|---|
| `GET` | `sesión` + `combustible:read` (administración, operaciones y mantenimiento `full`; contabilidad y HSEQ `read`) |
| `POST`, `PUT`, `DELETE` | `sesión` + `combustible:full` |
| Rutas con `:id` | `validarId`: un UUID mal formado responde 400 `{ success: false, message: 'Identificador inválido' }` |

Las tres guardas van en el `preHandler` de cada ruta (`[authMiddleware, requirePermission(…), validarId]`),
no en un hook del plugin. Talento humano y facturación no tienen acceso.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/combustible/catalogos` | `combustible:read` | Vehículos y conductores para los selectores |
| GET | `/api/combustible/tanqueos` | `combustible:read` | Tanqueos filtrados y paginados, con su rendimiento y totales |
| GET | `/api/combustible/tanqueos/exportar` | `combustible:read` | Los mismos tanqueos en CSV para Excel |
| GET | `/api/combustible/rendimiento` | `combustible:read` | Rendimiento por vehículo en el periodo |
| GET | `/api/combustible/vehiculos/:id/contexto` | `combustible:read` | Tanqueo anterior y siguiente, para avisar antes de guardar |
| POST | `/api/combustible/tanqueos` | `combustible:full` | Registra un tanqueo |
| PUT | `/api/combustible/tanqueos/:id` | `combustible:full` | Corrige un tanqueo |
| DELETE | `/api/combustible/tanqueos/:id` | `combustible:full` | Retira un tanqueo (lógico) |
| POST | `/api/combustible/tanqueos/:id/comprobante` | `combustible:full` | Sube o reemplaza el comprobante |
| DELETE | `/api/combustible/tanqueos/:id/comprobante` | `combustible:full` | Quita el comprobante |
| GET | `/api/combustible/tanqueos/:id/comprobante/url` | `combustible:read` | URL firmada de 15 minutos |

Errores comunes (`responderError` en `combustible.routes.ts`):

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Rechazo de zod (query o body) | `{ "success": false, "message": "<primer error>", "details": ["campo: mensaje", "…"] }` |
| 404 / 409 | Error de dominio (`CombustibleError`) | `{ "success": false, "message": "…", "code": "…" }` |
| 500 | Cualquier otro fallo (va al log) | `{ "success": false, "message": "<mensaje fijo de la ruta>" }` |

Códigos de dominio: `VEHICULO_NO_ENCONTRADO` (404), `CONDUCTOR_NO_ENCONTRADO`
(404), `TANQUEO_NO_ENCONTRADO` (404), `SIN_COMPROBANTE` (404),
`TANQUEO_DUPLICADO` (409), `KM_RETROCEDE` (409), `KM_SUPERA_SIGUIENTE` (409). Los
del odómetro son 409 y no 400: el dato vale por sí solo; choca con otro tanqueo ya
guardado.

### Forma de un tanqueo

```json
{ "id": "uuid",
  "vehiculo": { "id": "uuid", "placa": "ABC123", "marca": "…", "linea": "…" },
  "conductor": { "id": "uuid", "nombre": "NOMBRE APELLIDO", "numero_identificacion": "…" },
  "fecha_hora": "2026-10-10T19:30:00.000Z", "kilometraje": 124700, "galones": 20.5, "valor_total": 330000,
  "precio_galon": 16097.56, "tipo_combustible": "DIESEL", "estacion": "…", "tanque_lleno": true,
  "medio_pago": "TARJETA", "observaciones": null,
  "comprobante": { "nombre": "factura.pdf", "mime": "application/pdf" },
  "creado_por": { "id": "uuid", "nombre": "…" }, "created_at": "…", "updated_at": "…",
  "rendimiento": { "estado": "medido", "km_recorridos": 410, "galones_tramo": 21.3, "rendimiento": 19.25,
                   "referencia": 18.9, "desviacion": 0.0185, "costo_km": 830.2 } }
```

`rendimiento.estado`: `medido` o `alerta` (cierra un tramo), `inicio` (un lleno que
no cierra tramo: el primero del vehículo o uno al mismo odómetro) o `parcial` (sus
galones se suman al siguiente lleno); en los dos últimos, el resto de campos de
`rendimiento` es `null`. `desviacion` es una fracción (−0,3 = 30 % por debajo de la
referencia). `conductor` y `comprobante` pueden ser `null`.

**Totales** (`resumen` en el listado, `totales` en rendimiento):
`{ tanqueos, galones, gasto, precio_galon, tramos, km_recorridos, rendimiento, costo_km, alertas }`.
`costo_km` se calcula sobre los tramos (lo pagado por el combustible que se
recorrió), no gasto del periodo ÷ km del periodo.

### Filtros (`GET` de tanqueos, exportar y rendimiento)

**Query** (`filtrosSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `vehiculo_id` | uuid | — | |
| `conductor_id` | uuid | — | Filtra las filas, no el historial con que se mide el rendimiento |
| `desde`, `hasta` | `YYYY-MM-DD` | — | Días de calendario en Colombia, incluidos |
| `solo_alertas` | `1` \| `true` | — | Solo tanqueos que cierran un tramo en alerta |
| `pagina` | entero ≥ 1 | `1` | Solo en el listado |
| `por_pagina` | 1–200 | `25` | Solo en el listado |

Se leen como mucho 40.000 tanqueos por consulta (`MAX_FILAS`); más que eso hay que
acotar por fechas.

### `GET /api/combustible/catalogos`

**Respuesta 200** — `data: { vehiculos, conductores }`:
`vehiculos: [{ id, placa, marca, linea, modelo, combustible, kilometraje, oculto }]`
(no eliminados, ocultos incluidos, por placa) y
`conductores: [{ id, nombre, apellido, numero_identificacion, estado }]` (no
eliminados, por nombre).

### `GET /api/combustible/tanqueos`

**Respuesta 200**

```json
{ "success": true,
  "data": [ { "…": "tanqueo" } ],
  "meta": { "total": 120, "pagina": 1, "por_pagina": 25, "truncado": false },
  "resumen": { "…": "totales" } }
```

Sin envoltorio `data` para `meta` y `resumen`: van al mismo nivel. Orden: fecha y
hora descendente. `meta.total` cuenta lo que queda tras `solo_alertas`; `resumen`
no depende de `solo_alertas` (el chip de alertas sigue diciendo cuántas hay cuando
ya se filtra por él). `truncado: true` si se alcanzó el tope de 40.000.

### `GET /api/combustible/tanqueos/exportar`

Mismos filtros; ignora `pagina`/`por_pagina` y exporta todo lo filtrado.

**Respuesta 200** — `text/csv; charset=utf-8`, con
`Content-Disposition: attachment; filename="tanqueos-<desde>_a_<hasta>.csv"` (solo la
fecha que venga si falta una; la de hoy en UTC si no viene ninguna) y
`Cache-Control: no-store`. Formato para Excel con
configuración regional de Colombia: separador `;`, coma decimal, BOM UTF-8 y fines
de línea CRLF. Las celdas que empiezan por `=`, `+`, `-`, `@`, tabulador o retorno
llevan un `'` delante para neutralizar fórmulas (estación y observaciones las
escribe cualquiera). Columnas: fecha, hora (de Bogotá), placa, conductor, documento,
odómetro, galones, valor, precio por galón, combustible, estación, tanque lleno,
medio de pago, datos del tramo (km, galones, rendimiento, referencia, desviación,
alerta, costo por km), comprobante, observaciones y quién lo registró.

### `GET /api/combustible/rendimiento`

**Respuesta 200** — `{ success, vehiculos, totales }` (sin `data`):

```json
{ "success": true,
  "vehiculos": [ { "vehiculo": { "id": "uuid", "placa": "ABC123", "marca": "…", "linea": "…", "modelo": "…" },
                   "tanqueos": 8, "galones": 160, "gasto": 2600000, "precio_galon": 16250, "tramos": 6,
                   "km_recorridos": 2900, "rendimiento": 18.1, "costo_km": 880, "alertas": 1,
                   "ultimo_km": 124700, "ultimo_tanqueo": "…",
                   "ultimo_tramo": { "rendimiento": 13.2, "referencia": 18.4, "desviacion": -0.28, "anomalo": true },
                   "rendimiento_historico": 18.3 } ],
  "totales": { "…": "totales" } }
```

Un elemento por vehículo con tanqueos en el periodo, primero los que tienen más
alertas y luego por placa. `rendimiento_historico` es el de toda la vida del
vehículo hasta el fin del periodo (contexto para un mes con pocos tramos).

### `GET /api/combustible/vehiculos/:id/contexto`

Lo que el formulario necesita para avisar antes de guardar.

**Query** (`contextoSchema`)

| Parámetro | Tipo | Descripción |
|---|---|---|
| `fecha_hora` | string | Instante del tanqueo que se está escribiendo; si falta o no se puede leer, ahora |
| `excluir` | uuid | El tanqueo que se está editando (no cuenta como su propio vecino) |

**Respuesta 200** — `data`:
`{ vehiculo: { id, placa, combustible, kilometraje_ficha }, anterior: { fecha_hora, kilometraje } | null, siguiente: { fecha_hora, kilometraje } | null }`.
`kilometraje_ficha` es el de la ficha del vehículo (lo alimentan los
preoperacionales). 404 `VEHICULO_NO_ENCONTRADO` si no existe o está en la papelera.

### `POST /api/combustible/tanqueos`

**Body** (`tanqueoSchema`; `''` cuenta como «no lo dijo» en los opcionales)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `vehiculo_id` | uuid | sí | Vehículo no eliminado |
| `conductor_id` | uuid | no | Conductor no eliminado |
| `fecha_hora` | string | sí | `datetime-local` (hora de Colombia) o ISO con zona; como mucho 1 h en el futuro |
| `kilometraje` | entero 0–9.999.999 | sí | Odómetro en km |
| `galones` | número > 0, ≤ 1000 | sí | |
| `valor_total` | número > 0, ≤ 100.000.000 | sí | |
| `tipo_combustible` | `DIESEL` \| `GASOLINA` | sí | |
| `tanque_lleno` | boolean | sí | Booleano JSON (`"true"` no vale) |
| `estacion` | string ≤ 255 | no | |
| `medio_pago` | enum | no | `EFECTIVO`, `TARJETA`, `TRANSFERENCIA`, `CREDITO_ESTACION`, `ANTICIPO` |
| `observaciones` | string ≤ 2000 | no | |

**Respuesta 201** — `{ success, data: tanqueo }`, ya con su rendimiento recalculado.

**Errores**: 400 (zod); 404 `VEHICULO_NO_ENCONTRADO` / `CONDUCTOR_NO_ENCONTRADO`;
409 `TANQUEO_DUPLICADO`, `KM_RETROCEDE` o `KM_SUPERA_SIGUIENTE` (el mensaje dice la
fecha y el km del vecino).

### `PUT /api/combustible/tanqueos/:id`

Mismo body que el alta, **completo** (no es parcial). Las comprobaciones de
duplicado y odómetro excluyen al propio tanqueo. Responde `{ success, data: tanqueo }`.
404 `TANQUEO_NO_ENCONTRADO` si no existe o está retirado; resto de errores como en
el alta.

### `DELETE /api/combustible/tanqueos/:id`

Retiro lógico (`deleted_at`). El tramo vecino se recalcula solo al leer. Responde
`{ success: true }`; 404 `TANQUEO_NO_ENCONTRADO`.

### `POST /api/combustible/tanqueos/:id/comprobante`

**Body** `multipart/form-data` con un archivo (se toma el primero, con cualquier
nombre de campo): PDF, PNG, JPG o WEBP, máx. 15 MB. Va aparte del JSON del tanqueo
para validar los datos con zod antes de subir nada a S3: un tanqueo rechazado no
deja un objeto huérfano en el bucket.

Sube a S3 en `combustible/<vehiculo_id>/<tanqueo_id>/<uuid><ext>` y guarda la key,
el tipo y el nombre. Si ya había comprobante, lo reemplaza; el objeto anterior se
queda en S3 (el bucket es la evidencia).

**Respuesta 200** — `{ success, data: tanqueo }`.

**Errores**: 400 `Falta el archivo` / `El comprobante debe ser PDF o imagen`; 413
`El comprobante supera 15 MB`; 404 `TANQUEO_NO_ENCONTRADO`; 500 si el cuerpo no es
multipart.

### `DELETE /api/combustible/tanqueos/:id/comprobante`

Vacía las columnas del comprobante (el objeto de S3 se conserva). Responde
`{ success, data: tanqueo }`; 404 `TANQUEO_NO_ENCONTRADO`.

### `GET /api/combustible/tanqueos/:id/comprobante/url`

**Respuesta 200** — `{ success, data: { url } }`, firmada por 15 minutos. 404
`TANQUEO_NO_ENCONTRADO` o `SIN_COMPROBANTE`.

## Efectos

- **S3** (ver [integraciones](../integraciones.md)): comprobantes bajo
  `combustible/<vehiculo_id>/`; nunca se borran del bucket.
- No toca `vehiculos.kilometraje`: el odómetro de los tanqueos no alimenta la ficha
  (eso lo hace el cron de preoperacionales, ver [vehiculos](./vehiculos.md)).
- **Registro de actividad**: hook global de [actividad](./actividad.md); subir o
  quitar el comprobante queda como «cambió el comprobante de un tanqueo de
  combustible».

## Observaciones

- `GET …/contexto` con una `fecha_hora` que no se puede leer usa la hora actual sin
  avisar.
- Un cuerpo que no es multipart en `POST …/comprobante` responde 500 genérico (el
  error del plugin no es de zod ni de dominio).
- Cada lectura carga, además de las filas filtradas (tope 40.000), el historial
  completo de sus vehículos hasta el fin del periodo, sin tope, para medir los
  tramos (`cargar()` en `combustible.service.ts`).
