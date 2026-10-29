# Liquidaciones de servicios

`/api/liquidaciones-servicios` · código en [`src/modules/liquidaciones-servicios/`](../../src/modules/liquidaciones-servicios/) · permiso [`liquidaciones-servicios`](../permisos.md#catálogo-de-módulos)

Liquidación mensual de los servicios prestados a un cliente (formatos OP-FR-07 y
OP-FR-06): cabecera `liquidacion_servicio` con sus totales, ítems
`liquidacion_servicio_item` (un renglón por servicio o concepto), terceros del
servicio (`liquidacion_tercero`, ver [liquidaciones-terceros](./liquidaciones-terceros.md))
e historial `historial_estado_liquidacion`. Aquí viven también las tarifas por
cliente y año (`tarifas_servicios`), la configuración del liquidador de
recargos y el borrador previo del editor. La factura que cobra una liquidación
se registra en [facturacion-liquidaciones](./facturacion-liquidaciones.md) y su
cobro en [cartera](./cartera.md).

Reglas que un integrador necesita saber:

- **Estados**: `BORRADOR` → `LIQUIDADA` → `APROBADA` → `FACTURADA`, y `ANULADA`.
  `PATCH /:id/estado` solo acepta las transiciones de la tabla de
  `estado-transiciones.ts` (ver ese endpoint). Aprobar, cambiar el estado de
  una `APROBADA` o `FACTURADA`, reactivar una `ANULADA` y editar una
  `APROBADA`, `FACTURADA` o `ANULADA` es solo del área `administracion` (lo
  comprueba el controlador). `FACTURADA` la pone **solo** el registro de la
  factura ([facturacion-liquidaciones](./facturacion-liquidaciones.md)), nunca
  esta API.
- **Confirmada o no**: una fila nacida del autoguardado tiene
  `confirmada_at = null` y no existe para nadie más que su autor: no sale en el
  listado, en las estadísticas ni en el canvas hasta el primer guardado
  explícito (`POST` o `PUT`). Es lo que separa el autoguardado del «Registrar».
- **Los totales los calcula el servidor** a partir de los ítems:
  `valor_final = cantidad × valor_unitario − descuento`;
  `subtotal = Σ valor_final + valor_transporte_adicional + valor_recargos + valor_pernoctes`;
  `total = subtotal + IVA`. `valor_recargos` sí llega ya calculado por el
  liquidador del frontend.
- **Borrado lógico** del árbol entero (ítems, terceros, conceptos y pivotes de
  factura); el historial no se toca. Las lecturas filtran `deleted_at: null`
  también en los ítems (con las excepciones de Observaciones). Ver
  [borrado lógico de liquidaciones](../borrado-logico-liquidaciones.md).
- **Historial**: cada creación, edición y cambio de estado deja una fila con
  `accion` (`creacion`, `edicion`, `cambio_estado`), `snapshot` (cabecera e
  ítems vivos en ese momento) y `motivo`. El autoguardado solo deja la de su
  nacimiento.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-servicios:limited` (`permisoPorMetodo` con `lectura: 'limited'`): Administración, Operaciones y Facturación |
| `POST`, `PUT`, `PATCH`, `DELETE` | `liquidaciones-servicios:full`: Administración y Operaciones. Los campos de Hoja 4 además requieren `liquidaciones-servicios-seccion06:full` |
| `PUT /:id` sobre `APROBADA`, `FACTURADA` o `ANULADA` | además, área `administracion` (403 si no) |
| `PATCH /:id/estado` a `APROBADA`, o desde `APROBADA`/`FACTURADA`/`ANULADA` | además, área `administracion` (403 si no) |
| Borradores (`/draft`, `/autoguardado`) | el dueño sale siempre de la sesión: cada usuario solo ve y pisa los suyos |
| `GET /` con `incluir_no_confirmadas=true` | las no confirmadas ajenas solo para el área `administracion`; el resto recibe solo las propias |

Contabilidad no tiene acceso a este módulo.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones-servicios/tarifas` | `liquidaciones-servicios:limited` | Lista tarifas por cliente y año |
| POST | `/api/liquidaciones-servicios/tarifas` | `liquidaciones-servicios:full` | Crea la tarifa de un cliente para un año (o reactiva la desactivada) |
| PUT | `/api/liquidaciones-servicios/tarifas/:id` | `liquidaciones-servicios:full` | Edita valores o reactiva una tarifa |
| DELETE | `/api/liquidaciones-servicios/tarifas/:id` | `liquidaciones-servicios:full` | Desactiva una tarifa (`activo: false`) |
| POST | `/api/liquidaciones-servicios/draft` | `liquidaciones-servicios:full` | Guarda o pisa el borrador previo del usuario |
| GET | `/api/liquidaciones-servicios/draft` | `liquidaciones-servicios:limited` | Borrador previo de una liquidación que aún no existe |
| DELETE | `/api/liquidaciones-servicios/draft` | `liquidaciones-servicios:full` | Descarta ese borrador |
| GET | `/api/liquidaciones-servicios/:id/draft` | `liquidaciones-servicios:limited` | Borrador previo del usuario sobre una liquidación existente |
| DELETE | `/api/liquidaciones-servicios/:id/draft` | `liquidaciones-servicios:full` | Descarta ese borrador |
| POST | `/api/liquidaciones-servicios/autoguardado` | `liquidaciones-servicios:full` | Crea o actualiza la liquidación como `BORRADOR` sin confirmar |
| GET | `/api/liquidaciones-servicios/check-consecutivo/:consecutivo` | `liquidaciones-servicios:limited` | ¿Está libre el consecutivo? |
| GET | `/api/liquidaciones-servicios/preview` | `liquidaciones-servicios:limited` | Vista previa calculada desde servicios y planillas (hoy falla siempre, ver Observaciones) |
| GET | `/api/liquidaciones-servicios/servicios-disponibles` | `liquidaciones-servicios:limited` | Servicios del cliente en el mes, listos para liquidar |
| GET | `/api/liquidaciones-servicios/tipos-recargo` | `liquidaciones-servicios:limited` | Tipos de recargo activos (hoja 3 / liquidador) |
| GET | `/api/liquidaciones-servicios/config-liquidador` | `liquidaciones-servicios:limited` | Configuración del liquidador de recargos (la crea si no hay) |
| PUT | `/api/liquidaciones-servicios/config-liquidador` | `liquidaciones-servicios:full` | Cambia esa configuración |
| GET | `/api/liquidaciones-servicios/estadisticas` | `liquidaciones-servicios:limited` | Conteo y monto por estado |
| GET | `/api/liquidaciones-servicios` | `liquidaciones-servicios:limited` | Listado paginado con filtros de columna y metadatos |
| POST | `/api/liquidaciones-servicios` | `liquidaciones-servicios:full` | Registra una liquidación (nace confirmada, en `BORRADOR`) |
| GET | `/api/liquidaciones-servicios/eliminadas` | `liquidaciones-servicios:limited` | Papelera |
| GET | `/api/liquidaciones-servicios/:id` | `liquidaciones-servicios:limited` | Una liquidación con ítems y terceros vivos |
| PUT | `/api/liquidaciones-servicios/:id` | `liquidaciones-servicios:full` (+ administración según estado); Hoja 4 requiere además `liquidaciones-servicios-seccion06:full` | Edita; confirma si venía del autoguardado |
| DELETE | `/api/liquidaciones-servicios/:id` | `liquidaciones-servicios:full` | Borrado lógico del árbol |
| PATCH | `/api/liquidaciones-servicios/:id/estado` | `liquidaciones-servicios:full` (+ administración según estado) | Cambia el estado |
| GET | `/api/liquidaciones-servicios/:id/historial` | `liquidaciones-servicios:limited` | Historial de estados y ediciones |
| GET | `/api/liquidaciones-servicios/:id/csv` | `liquidaciones-servicios:limited` | Descarga el **Excel** (.xlsx) de la liquidación |
| PATCH | `/api/liquidaciones-servicios/:id/restaurar` | `liquidaciones-servicios:full` | Restaura una eliminada y su árbol |

Las rutas fijas (`/draft`, `/autoguardado`, `/eliminadas`…) están declaradas antes
de `/:id` a propósito: Fastify resuelve por orden y `draft` casaría con `:id`.

### `GET /api/liquidaciones-servicios/tarifas`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `cliente_id` | uuid | — | Mal formado → 400 `{ "error": "Cliente inválido" }` |
| `operadora` | string | — | `PAREX` \| `GEOPARK` |
| `anio` | number | — | |
| `incluir_inactivas` | `'1'` \| `'true'` | ausente | Solo cuenta si hay algún otro filtro |

Sin ningún filtro devuelve **todas** (activas e inactivas); con alguno, solo las
activas salvo `incluir_inactivas`.

**Respuesta 200** — arreglo plano de `tarifas_servicios`, ordenado por `anio`
desc y `operadora`, con el cliente en `empresas: { id, nombre, nit }`. Los
`Decimal` salen como string.

### `POST /api/liquidaciones-servicios/tarifas`

**Body** (zod, `tarifas.schema.ts`; los números admiten string)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cliente_id` | uuid | sí | El cliente debe existir (404 si no) |
| `operadora` | `'PAREX'` \| `'GEOPARK'` | sí | Qué tabla de precios aplica |
| `anio` | entero 2000–2100 | sí | Una tarifa por cliente y año (`@@unique([cliente_id, anio])`) |
| `valor_24h`, `valor_12h` | number > 0 | sí | |
| `valor_hora`, `valor_km` | number ≥ 0 | sí | |
| `km_dia` | entero 0–5000 | no | `150` por defecto |
| `valor_pernocte` | number ≥ 0 | no | `0` por defecto |

Si ya existe una tarifa **desactivada** de ese cliente y año, la reactiva con los
valores nuevos en vez de chocar con el único.

**Respuesta 201** — la tarifa.

**Errores** (formato `{ error, details? }`)

| Código | Cuándo |
|---|---|
| 400 | Falla la validación (`details` con un mensaje por campo) |
| 404 | Cliente no encontrado |
| 409 | Ya hay una tarifa **activa** de ese cliente y año: hay que editarla |
| 500 | Otro fallo: `{ "error": "No se pudo guardar la tarifa" }` |

### `PUT /api/liquidaciones-servicios/tarifas/:id` y `DELETE /api/liquidaciones-servicios/tarifas/:id`

`:id` tiene que ser un uuid (400 `Tarifa inválida`). El `PUT` acepta los mismos
campos que el alta salvo `cliente_id`, todos opcionales, más `activo: boolean`;
un cuerpo vacío es 400 (`No hay cambios que guardar`). El `DELETE` no borra:
pone `activo: false` y responde `{ "message": "Tarifa desactivada exitosamente" }`.
Id inexistente → 404; cambiar el `anio` a uno ocupado → 409.

### Borrador previo: `POST /api/liquidaciones-servicios/draft`, `GET`/`DELETE /api/liquidaciones-servicios/draft` y `GET`/`DELETE /api/liquidaciones-servicios/:id/draft`

Guarda lo que el editor lleva escrito mientras todavía no puede existir la fila
real (falta cliente o consecutivo). Es privado de quien lo escribe y hay como
mucho uno por usuario y liquidación (índices únicos parciales). Sin `:id` se
refiere a la liquidación «nueva» (`liquidacion_id = null`).

**Body del `POST`**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `payload` | JSON | sí | Lo que arma el editor; se guarda tal cual. Sin él → 400 |
| `liquidacion_id` | uuid \| null | no | `null`/ausente = liquidación que aún no existe |

**Respuestas**: el `POST` devuelve `{ ok: true, id, version }` (la versión sube
en cada guardado); el `GET`, `{ id, payload, version, updated_at }` o **`null`
con 200** si no hay borrador; el `DELETE`, `{ ok: true, eliminados }` (borrar uno
que no existe no es error). Los borradores no tienen borrado lógico.

### `POST /api/liquidaciones-servicios/autoguardado`

Crea o actualiza la liquidación real como `BORRADOR` sin confirmar. A diferencia
de `POST /` y `PUT /:id`, **no** emite `liquidacion-servicio-created/updated`, no
notifica a los aprobadores y no deja snapshot salvo al nacer.

**Body**: el mismo de `POST /api/liquidaciones-servicios` más:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cliente_key` | uuid | no | Clave de idempotencia por sesión de edición: dos autoguardados en vuelo con la misma clave no crean dos liquidaciones |
| `borrador_id` | uuid | no | Sin él se **crea**; con él se **actualiza** esa liquidación |
| `base_version` | number | no | Versión que el editor cree tener (compare-and-swap) |

Al crear, borra el borrador previo «nuevo» del usuario. Al actualizar, solo
aplica si la fila sigue en `BORRADOR`, no está eliminada y (si llega
`base_version`) la versión coincide; los ítems se reconcilian como en
[`PUT /:id`](#put-apiliquidaciones-serviciosid) y un autoguardado **sin ítems**
sobre una liquidación que los tiene se rechaza.

**Respuesta 200**

```json
{ "id": "uuid", "consecutivo": "LS-2026-0042", "estado": "BORRADOR", "version": 3,
  "updated_at": "…", "creada": false, "confirmada_at": null }
```

(`confirmada_at` solo viene al actualizar.)

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 409 | No se aplicó el compare-and-swap | `{ "error": "…", "motivo": "version" \| "estado" \| "borrada", "servidor": { id, consecutivo, estado, version, updated_at, deleted_at, actualizado_por } \| null }` |
| 409 | El consecutivo ya está en uso | `{ "error": "Ese consecutivo ya está en uso por otra liquidación. Cámbialo antes de registrar." }` |
| 500 | Lo demás, incluido el autoguardado sin ítems (`ReconciliacionVacia`) | `{ "error": "<mensaje>" }` |

### `GET /api/liquidaciones-servicios/check-consecutivo/:consecutivo`

**Query**: `excludeId` (opcional), el id de la liquidación que se está editando.
**Respuesta 200**: `{ "available": true | false }`. Solo mira liquidaciones no
eliminadas (ver Observaciones).

### `GET /api/liquidaciones-servicios/preview`

**Query**: `cliente_id`, `mes`, `anio` obligatorios (400 si falta alguno);
`tarifa_id` (sin él, 500 con «Debe seleccionar una tarifa…»); `servicio_ids`
(lista separada por comas). Toma los servicios `realizado`, `planilla_asignada` o
`liquidado` del cliente en el mes y arma un ítem por servicio (12 h / 24 h según
duración, o el `valor` manual del servicio) con el detalle de recargos de su
planilla según la configuración salarial vigente. Devolvería
`{ cliente, tarifa, config_salarial, mes, anio, items, totales }`, pero hoy
responde siempre 500 (ver Observaciones).

### `GET /api/liquidaciones-servicios/servicios-disponibles`

**Query**: `cliente_id`, `mes`, `anio`, obligatorios (400 si falta alguno).
**Respuesta 200** — arreglo plano de servicios no eliminados del cliente en ese
mes con estado `realizado` o `planilla_asignada`, con conductor, vehículo,
municipios de origen y destino y sus planillas vivas
(`{ id, numero_planilla, mes, a_o }`).

### `GET /api/liquidaciones-servicios/tipos-recargo`

Arreglo de `tipos_recargos` activos y no eliminados, por `orden_calculo`:
`{ id, codigo, nombre, porcentaje (number), es_hora_extra, adicional, categoria, orden_calculo, vigencia_desde, vigencia_hasta }`.

### `GET /api/liquidaciones-servicios/config-liquidador` y `PUT /api/liquidaciones-servicios/config-liquidador`

Configuración única (la fila activa de `configuracion_liquidacion_servicio`). El
`GET` la **crea** con valores por defecto si no existe. Los dos responden:

```json
{ "id": "uuid", "salario_basico": 2358886, "cargo": "Conductor", "valor_hora_override": 0,
  "conductor_adicional": 73693, "pct_seg_social": 22.96, "pct_prestaciones": 21.83,
  "pct_admin": 8, "prueba_covid": 0 }
```

El `PUT` acepta esos mismos campos (sin `id`), todos opcionales y sin esquema:
solo cambia los que llegan. Cualquier fallo responde **400** `{ error }`.

### `GET /api/liquidaciones-servicios/estadisticas`

Sobre las liquidaciones confirmadas y no eliminadas:
`{ "total": 120, "por_estado": [{ "estado": "LIQUIDADA", "cantidad": 8 }], "monto_total": 0 }`.

### `GET /api/liquidaciones-servicios`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | number | `1` | |
| `limit` | number | `10` | Tope 500. `0` = todas en una página |
| `busqueda` | string | — | Consecutivo, factura activa (acepta `#` delante), cliente (nombre o NIT), OSI, operadora, observaciones, liquidador o creador, placa y planilla de ítems vivos |
| `cliente_id`, `estado`, `anio` | string | — | Filtros exactos |
| `mes` | number \| nombre | — | Acepta `3` o `MARZO` |
| `placa` | string | — | Compara sin guiones ni espacios (`KSQ-992` = `KSQ992`) |
| `liquidador_id` | uuid | — | Liquidó **o** creó |
| `consecutivos`, `estados`, `cliente_nombres`, `liquidador_nombres`, `facturas`, `placas` | lista separada por comas | — | Filtros de columna |
| `periodos` | `m-aaaa,…` | — | P. ej. `1-2026,2-2026` |
| `sortBy` | `consecutivo` \| `cliente` \| `periodo` \| `estado` \| `total` \| `items` \| `fecha` \| `tercero` \| `factura` | `created_at` desc | `items` ordena por `total`; `factura` usa orden natural (`FE-99` antes que `FE-100`) |
| `sortDir` | `asc` \| `desc` | `desc` | |
| `include_items` | `'true'` | — | Cada fila trae sus ítems vivos completos (canvas de historial) |
| `incluir_no_confirmadas` | `'true'` | — | Ver Acceso |

`usuario_id` y el permiso de ver no confirmadas ajenas los pone el controlador
desde la sesión; los del query string se ignoran.

**Respuesta 200**

```json
{
  "liquidaciones": [
    { "id": "uuid", "consecutivo": "LS-2026-0042", "estado": "LIQUIDADA", "mes": 9, "anio": 2026,
      "total": 15400000, "cliente": { "id": "…", "nombre": "…", "nit": "…" },
      "creado_por": { "…": "…" }, "liquidado_por": null, "aprobado_por": null,
      "total_items": 12, "placas": ["ABC123"],
      "factura_items": [{ "factura": { "id": "…", "numero_factura": "FE-123", "estado": "ACTIVA" } }],
      "items": "solo con include_items" }
  ],
  "total": 37, "totalPages": 4, "page": 1,
  "metadata": { "globalTotal": 0, "globalCount": 0, "estadoCounts": { "LIQUIDADA": 8 },
    "clientes": [], "liquidadores": [], "consecutivos": [], "periodos": [{ "mes": 9, "anio": 2026 }],
    "facturas": [], "estados": [], "placas": [] }
}
```

Los montos salen como número. `metadata` se calcula con todos los filtros salvo
el de estado (los conteos por estado siguen completos y `globalTotal` se recorta a
los estados elegidos); cada lista de valores excluye su propio filtro para los
desplegables en cascada.

### `POST /api/liquidaciones-servicios`

Registra una liquidación: nace en `BORRADOR` y **confirmada**.

**Body** (sin esquema de validación; ver `CrearLiquidacionInput` en el servicio)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cliente_id` | uuid | sí | |
| `mes`, `anio` | number | sí | |
| `items` | arreglo | sí | Ver abajo. Sin él, 500 |
| `consecutivo` | string | no | Si falta: `LS-<anio>-<NNNN>`, el siguiente del año |
| `porcentaje_iva` | number | no | `0` por defecto |
| `valor_recargos` | number | no | Ya calculado por el liquidador |
| `valor_transporte_adicional`, `valor_pernoctes` | number | no | Suman al subtotal |
| `valor_unitario_pernoctes`, `cantidad_pernoctes` | number | no | Informativos |
| `recargos_data` | JSON | no | Hoja de recargos. Sus `terceroRows` con `vr_unit × cant > 0` ponen `tercero_liquidado: true`; sus `rows` son la hoja 2 del Excel |
| `observaciones`, `osi` | string | no | |
| `operadora_id` u `operadora` | uuid / string | no | Se resuelve contra el catálogo de [operadoras](./operadoras.md) y se guardan la FK y el texto; un texto fuera del catálogo se guarda sin FK |
| `terceros_items` | arreglo | no | Terceros del servicio; `src_index` = posición del ítem al que pertenecen. Se guardan con `LiquidacionesTercerosService.guardar` |

Cada ítem: `placa`, `fecha_inicial`, `fecha_final`, `recorrido`, `tipo_servicio`
(clave del enum `tipo_servicio_tarifa_enum`, p. ej.
`TRANSPORTE_DE_PERSONAL_EN_CAMIONETA`), `cantidad`, `valor_unitario`,
`porcentaje_descuento`, `numero_planilla`, `servicio_id`, `recargo_planilla_id`,
`tercero_id`. `subtotal` y `valor_final` los calcula el servidor; los campos de
pernoctes por ítem y `recargos_detalle` no se copian.

Cada ítem puede traer además `id` (el id de servidor de un ítem ya guardado; el
editor lo tiene como `server_id`) y `client_key` (la clave que el editor pone a
cada fila). Son lo que empareja las filas al guardar (ver `PUT /:id`). En el
alta, aquí y en la del autoguardado, el `id` se descarta (`sinIdDeCliente`: una
liquidación nueva no tiene ítems propios, y un `id` que llegue es de otra, al
duplicar por ejemplo, y chocaría con la clave primaria); la `client_key` se
guarda.

**Respuesta 201** — la liquidación con `cliente`, `creado_por` e `items` vivos
(los `Decimal` como string).

**Errores**: 409 si el consecutivo ya existe (mensaje legible, no el volcado de
Prisma); 500 `{ error }` para lo demás.

### `GET /api/liquidaciones-servicios/eliminadas`

**Query**: `page` (1), `limit` (10), `busqueda` (como el listado, sin ítems).
**Respuesta 200**: `{ liquidaciones, total, totalPages, page }`, por fecha de
eliminación descendente.

### `GET /api/liquidaciones-servicios/:id`

La liquidación no eliminada con `cliente` (nombre, NIT, representante, teléfono,
dirección), `creado_por`, `actualizado_por`, `liquidado_por`, `aprobado_por`,
`items` y `terceros_items` vivos (con su `tercero`), montos como número. Eliminada
o inexistente → 404 `{ "error": "Liquidación de servicio no encontrada" }`.

### `PUT /api/liquidaciones-servicios/:id`

Mismo body que el alta. Si la liquidación venía del autoguardado, este es su
primer guardado explícito: se confirma y el evento es `created`, no `updated`.
Los ítems se reconcilian (`reconciliarItems`,
`src/lib/soft-delete/reconciliar-items.ts`): cada entrada se empareja con un
ítem guardado por `id` y, si no, por `client_key`, nunca por posición, así que
el ítem conserva su id de un guardado al siguiente; lo que no llega se marca con `deleted_at` y un ítem marcado que
vuelve a llegar se restaura. Un ítem guardado no se empareja dos veces: una
entrada repetida (mismo `id` o misma `client_key`) entra como ítem nuevo, y una
`client_key` ya usada en ese guardado se guarda como `null`. Aquí sí se puede
vaciar la lista. Después de reconciliar se releen los ítems vivos, por `orden`:
son los que trae la respuesta y a los que se enlazan los `terceros_items` (su
`src_index` es la posición en esa lista).

Los campos de la SECCIÓN 06 requieren `liquidaciones-servicios-seccion06:full`.
Sin lectura de ese permiso, la API oculta los terceros, sus filas JSON y las
relaciones `tercero_id` en detalle, borradores, historial y listados; las
escrituras conservan los valores existentes y Socket.IO no los emite.

**Respuesta 200** — la liquidación más `factura_recalculada`: si estaba
`FACTURADA` y el total cambió, el servidor actualiza el pivote y el
`valor_total` de su factura activa y devuelve
`{ factura_id, numero_factura, valor_anterior, valor_nuevo }`; si no, `null`.

**Errores**

| Código | Cuándo |
|---|---|
| 403 | Está `APROBADA`, `FACTURADA` o `ANULADA` y el usuario no es del área `administracion` |
| 404 | No existe o está eliminada |
| 409 | El consecutivo choca con otra liquidación |
| 500 | Otro fallo |

### `DELETE /api/liquidaciones-servicios/:id`

Borrado lógico de la cabecera, ítems, terceros, conceptos y pivotes de factura, en
una transacción, con registro en `auditoria.borrado_logico`. Se niega si la
liquidación está en una factura activa (hay que anularla antes).

**Respuesta 200**:
`{ "message": "…", "relacionadas": { "liquidacion_id": "…", "items": 12, "terceros": 3, "conceptos": 0, "items_factura": 0 } }`.

**Errores**: todos salen como 500 `{ error }` (inexistente, ya eliminada, con
factura activa).

### `PATCH /api/liquidaciones-servicios/:id/estado`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `estado` | `BORRADOR` \| `LIQUIDADA` \| `APROBADA` \| `ANULADA` | sí | Otro valor → 400 `ESTADO_INVALIDO`. `FACTURADA` es del enum pero no es destino de esta ruta (409) |
| `motivo_anulacion` | string no vacío | al anular | Se guarda al anular; cualquier otro estado lo borra |

**Transiciones** (`TRANSICIONES_LIQUIDACION_SERVICIO` en
[`estado-transiciones.ts`](../../src/modules/liquidaciones-servicios/estado-transiciones.ts);
las valida también `LiquidacionesServiciosService.cambiarEstado`, así que
ningún llamador se las salta):

| Desde | Hacia | Además |
|---|---|---|
| `BORRADOR` | `LIQUIDADA`, `ANULADA` | — |
| `LIQUIDADA` | `APROBADA`, `BORRADOR`, `ANULADA` | `APROBADA` solo Administración |
| `APROBADA` | `LIQUIDADA`, `BORRADOR`, `ANULADA` | Solo Administración (salir de `APROBADA`) |
| `FACTURADA` | `APROBADA` | Solo Administración y sin factura activa (409 `FACTURA_ACTIVA` si la hay) |
| `ANULADA` | `BORRADOR` | Solo Administración (reactivar) |

`FACTURADA` no es destino de nadie aquí: la pone la facturación al meter la
liquidación en una factura. Mandar el mismo estado que ya tiene también es una
transición inválida (no deja otra fila en el historial). El `UPDATE` lleva el
estado leído en el `WHERE`: si otro usuario lo cambió entretanto, 409
`ESTADO_CAMBIADO` y no se aplica.

Lo que hace cada destino: `LIQUIDADA` firma `liquidado_por` y
`fecha_liquidacion`; `APROBADA` firma `aprobado_por` y `fecha_aprobacion`;
`BORRADOR` limpia liquidador y aprobación. Cada cambio deja snapshot en el
historial.

**Respuesta 200** — la liquidación con `cliente`, `liquidado_por`,
`aprobado_por` y `creado_por`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | `estado` fuera del enum, o anular sin `motivo_anulacion` | `{ "code": "ESTADO_INVALIDO" \| "FALTA_MOTIVO", "error": "…" }` |
| 403 | Aprobar, mover una `APROBADA`/`FACTURADA` o reactivar una `ANULADA` sin ser del área `administracion` | `{ error }` |
| 404 | Inexistente o en la papelera | `{ error }` |
| 409 | Sacar de `FACTURADA` una liquidación que sigue en una factura activa (se comprueba antes que la tabla) | `{ "code": "FACTURA_ACTIVA", "error": "…", "factura": { id, numero_factura, fecha_facturacion, facturado_por, liquidaciones_en_factura } }` |
| 409 | Transición fuera de la tabla (incluido pedir `FACTURADA` o el mismo estado) | `{ "code": "TRANSICION_INVALIDA", "error": "Una liquidación anulada no puede pasar a aprobada. Desde ahí solo puede pasar a: borrador." }` |
| 409 | Otro usuario cambió el estado entre la lectura y el `UPDATE` | `{ "code": "ESTADO_CAMBIADO", "error": "…" }` |
| 500 | Otro fallo | `{ error }` |

Para el 409 la salida es anular la factura o quitar la liquidación de ella
(`PATCH /api/facturacion-liquidaciones/:id/anular` o
`DELETE /api/facturacion-liquidaciones/:id/items/:liquidacionId`).

### `GET /api/liquidaciones-servicios/:id/historial`

Arreglo plano, del más reciente al más antiguo:
`{ id, estado_anterior, estado_nuevo, accion, motivo, snapshot, created_at, usuario: { id, nombre, correo } }`.
Las filas que escribe la facturación no traen `snapshot` y su `accion` es la
por defecto (`cambio_estado`). Un id inexistente devuelve `[]`.

### `GET /api/liquidaciones-servicios/:id/csv`

El nombre de la ruta se conserva por compatibilidad, pero **no devuelve CSV**:
devuelve un libro **.xlsx** generado con ExcelJS (`excel-liquidacion.ts`), con
la marca de SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S. (razón social, NIT, logo y
color, de `excel-marca.ts`). Tres hojas:

1. **Liquidación**: encabezado, ítems vivos y totales (recargos, pernoctes, IVA, total).
2. **Recargos (horas)**: solo si `recargos_data.rows` trae filas.
3. **Trazabilidad**: el historial de estados y ediciones.

**Respuesta 200** — el binario, con
`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`Content-Disposition: attachment; filename="Liquidacion_<consecutivo>_<cliente>_<MES-anio>.xlsx"`
(ASCII) y `Access-Control-Expose-Headers: Content-Disposition`, para que el
frontend pueda leer el nombre en una petición entre orígenes.

**Errores**: 400 si el id no tiene forma de uuid; 404 si no existe o está
eliminada; 500 `{ "error": "No se pudo generar el Excel de la liquidación" }`.

### `PATCH /api/liquidaciones-servicios/:id/restaurar`

**Body** (opcional): `{ "motivo": "…" }`, que solo va a la auditoría (se recorta a
500 caracteres). Restaura la cabecera y todo lo marcado con ella; los pivotes de
factura solo si su factura no está eliminada.

**Respuesta 200**: `{ message, relacionadas, liquidacion }`.
**Errores**: 404 si no existe; 409 si no está eliminada.

## Efectos

- **Socket** (a todos los clientes, con `_evento` de metadatos):
  `liquidacion-servicio-created` (alta, primer guardado de un autoguardado y
  restauración), `liquidacion-servicio-updated` (edición y cambio de estado, con
  `estado_anterior`/`estado_nuevo`), `liquidacion-servicio-deleted` (`{ id }`) y
  `liquidacion-servicio-borrador` (cada autoguardado; hoy no lo escucha nadie).
  Editar una `FACTURADA` cuyo total cambia emite además `facturacion-updated`.
  Ver [tiempo real](../tiempo-real.md).
- **Notificaciones** (campana, socket `nueva-notificacion` al room del usuario y
  Web Push) a los aprobadores —usuarios activos del área `administracion`—
  menos quien actúa: `LIQUIDACION_CREADA` al registrar,
  `LIQUIDACION_ACTUALIZADA` en cada `PUT`, `LIQUIDACION_PENDIENTE` al pasar a
  `LIQUIDADA`, y aviso al pasar a `BORRADOR`. El creador recibe
  `LIQUIDACION_ANULADA` al anularse y aviso de devolución a borrador; creador y
  liquidador, el de aprobación.
- **Push a la app de gestión** (`enviarPushUsuarios`, canal `liquidaciones`,
  ruta `/gestion/liquidacion/:id`) en los cambios a `LIQUIDADA`, `APROBADA`,
  `BORRADOR` y `ANULADA`.
- **Historial** `historial_estado_liquidacion` con snapshot; **auditoría** en
  `auditoria.borrado_logico` al eliminar y restaurar.
- **Registro de actividad**: el hook global apunta las escrituras que terminan
  bien; excluye `/api/liquidaciones-servicios/autoguardado` y
  `/api/liquidaciones-servicios/draft`.

## Observaciones

- **`GET /preview` responde siempre 500.** `previewLiquidacion` devuelve en
  `totales` dos identificadores que no existen en su ámbito
  (`valor_unitario_pernoctes`, `cantidad_pernoctes`); el archivo lleva
  `// @ts-nocheck`, así que `tsc` no lo ve y en ejecución es un `ReferenceError`.
  Además no filtra `deleted_at` de los servicios. (`liquidaciones-servicios.service.ts`)
- **Autoguardado sin ítems deja la cabecera descuadrada**: el `updateMany` de la
  cabecera (totales en cero, `version + 1`) se confirma en una transacción y la
  reconciliación que lo rechaza va en otra, así que el 500 llega con la cabecera
  ya cambiada y los ítems intactos.
- **Ítems retirados en lecturas del listado**: el filtro `placa` usa SQL crudo
  sin `deleted_at IS NULL` en los ítems, y `factura_items` del listado (y el
  orden `sortBy=factura`) no filtra el `deleted_at` del pivote, así que una
  liquidación quitada de una factura activa sigue mostrando esa factura.
- **Papelera**: `GET /eliminadas` pasa el query tal cual al servicio, de modo que
  `usuario_id` y `puede_ver_no_confirmadas_ajenas` sí se pueden mandar por URL
  (al contrario que en el listado). Además `placas` sale siempre vacío y
  `total_items` cuenta también los ítems retirados en ediciones anteriores.
- **Consecutivo**: `check-consecutivo` y la generación automática ignoran las
  eliminadas, pero el `@unique` de `consecutivo` es global: pueden dar por libre
  (o generar) uno que ocupa una liquidación en la papelera, y el guardado falla
  con 409.
- **`DELETE /:id`**: todo error sale como 500, y el controlador no pasa el
  usuario al servicio, así que la auditoría del borrado queda sin `usuario_id`.
- En `PUT /:id` una liquidación eliminada da 404 (`obtenerPorId` ya la filtra):
  el 403 «está eliminada» del controlador y el 409 `LIQUIDACION_ELIMINADA` del
  servicio no se alcanzan.
- Las comprobaciones de «Administración» miran el **área** `administracion`; un
  usuario con `role: admin` sin esa área no puede aprobar ni editar una
  aprobada, aunque en el listado sí ve las no confirmadas ajenas.
- `GET /config-liquidador` escribe (crea la fila si falta) con permiso de
  lectura; `PUT /config-liquidador`, `POST /` y `PUT /:id` no validan el body
  (un `items` ausente es un 500 por `TypeError`).
- `actualizar` imprime con `console.log` el body completo y la fila previa en
  cada `PUT`.
- `limpiarDraftsViejos` (barrido de borradores de más de 30 días) no lo llama
  ningún cron: la tabla `liquidacion_servicio_draft` solo crece.
