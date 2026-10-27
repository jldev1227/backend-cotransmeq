# Liquidaciones de nómina

`/api/liquidaciones`, `/api/configuraciones-liquidacion`, `/api/firmas/liquidacion`, `/api/desprendible-firma` · código en [`src/modules/liquidaciones/`](../../src/modules/liquidaciones/) · permiso [`nomina`](../permisos.md#catálogo-de-módulos)

La nómina de los conductores: una fila de `liquidaciones` por conductor y periodo,
con sus hijas (`bonificaciones`, `pernotes`, `recargos`, `anticipos`,
`mantenimientos`, `liquidacion_vehiculo`) y la firma del conductor sobre su
desprendible (`firmas_desprendibles`). No confundir con
[`liquidaciones-servicios`](./liquidaciones-servicios.md) ni con los cierres de
terceros. Este módulo es el CRUD original, el «de formulario»; el
[canvas de nómina](./nomina-canvas.md) trabaja sobre las mismas filas y añade la
máquina de estados, la generación de borradores en lote y el envío con
constancia. También viven aquí las `configuraciones_liquidacion` (bonos y
parámetros, una fila por concepto y año) y las rutas públicas de firma del
desprendible por token.

Reglas que un integrador necesita saber:

- **El servidor no calcula la liquidación en este CRUD.** `POST` y `PUT` guardan
  los totales tal como llegan: el formulario los calcula en el navegador. Las
  cifras que sí salen del servidor son las del canvas.
- **El periodo es texto.** `periodo_start`/`periodo_end` son `VarChar` (ISO que
  se compara como cadena) y la API los repite como `periodo_inicio`/`periodo_fin`.
- **Dos estados conviven.** `estado` es el enum viejo `Pendiente|Liquidado`, el
  único que escribe este módulo; `estado_flujo` (BORRADOR → LIQUIDADA → APROBADA
  → PAGADA → FIRMADA, o ANULADA) es el del canvas: aquí se devuelve en las
  lecturas, pero ninguna escritura lo cambia ni lo respeta (ver Observaciones).
- **Borrado lógico.** `DELETE` marca `deleted_at` solo en la liquidación y no
  toca las siete tablas hijas: entre ellas está la firma del conductor, que es la
  prueba de que recibió su pago. Editar marca las hijas anteriores y crea las
  nuevas; todas las lecturas filtran `deleted_at IS NULL`.
- **Qué PDF sale de aquí.** El desprendible que reciben canvas, dashboard,
  portal, enlace firmado y app móvil lo genera pdfmake en el navegador (el
  diseño 2 es el principal desde el 10-oct-2026). El PDF de este backend
  (Puppeteer) solo sale por `GET /api/liquidaciones/:id/pdf-desprendible`, el
  ZIP masivo y `GET /api/desprendible-firma/:token/pdf`. Su maquetación la
  decide `DESPRENDIBLE_LAYOUT` (`nuevo` por defecto, `clasico` para volver),
  leída una sola vez en `nomina-canvas/desprendible.render.ts`; la nueva agrupa
  los recargos en OTROS / PAREX / GEOPARK y la clásica los nombra por cliente.
  Los importes se leen de la liquidación guardada, no se recalculan.
- **Firma pública.** Nómina genera un token por liquidación
  (`POST /api/desprendible-firma/generar`); el conductor abre el enlace, sube su
  firma y solo entonces puede ver los datos y el PDF.

## Acceso

| Operación | Guarda |
|---|---|
| `/api/liquidaciones*`, `/api/configuraciones-liquidacion*`, `/api/firmas/liquidacion/:id` | `sesión` (hook `onRequest`) y `permisoPorMetodo('nomina')`: `nomina:read` en `GET`, `nomina:full` en `POST`/`PUT`/`PATCH`/`DELETE` |
| `GET /api/liquidaciones/preview-recargos` | Excluida de `nomina` con `excepto`; pide `recargos:read` en la propia ruta (la usa la pantalla de Recargos: operaciones y hseq, sin nómina) |
| `POST /api/liquidaciones/preview-desprendibles` | `nomina:full` aunque solo lee: es `POST` |
| `POST /api/desprendible-firma/generar` | `sesión` y `nomina:full` en el `preHandler` de la ruta (el plugin no tiene hooks) |
| `GET /api/desprendible-firma/:token`, `/:token/datos`, `/:token/pdf`; `POST /:token/firmar` | `pública · token`: hex de 64 caracteres (`randomBytes(32)`) guardado en `firmas_desprendibles.token`. Se comprueba que exista y, salvo en `/datos`, que no haya pasado `expires_at`. `/datos` y `/pdf` exigen además que ya haya firma. Sin límite de intentos |

Ningún controlador recorta campos por nivel `limited` ni comprueba dueño del recurso.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones` | `nomina:read` | Lista paginada con filtros y estadísticas |
| GET | `/api/liquidaciones/analisis` | `nomina:read` | Listado para el análisis antiguo (sustituido por `GET /api/nomina/analisis`) |
| GET | `/api/liquidaciones/preview-recargos` | `recargos:read` | Valora los recargos de las planillas de un conductor en un periodo |
| GET | `/api/liquidaciones/:id` | `nomina:read` | Una liquidación con hijas y firmas en base64 |
| POST | `/api/liquidaciones` | `nomina:full` | Crea una liquidación con sus detalles |
| PUT | `/api/liquidaciones/:id` | `nomina:full` | Actualiza y rehace los detalles que llegan |
| DELETE | `/api/liquidaciones/:id` | `nomina:full` | Borrado lógico |
| POST | `/api/liquidaciones/:id/recargos/:recargoId/revertir-override` | `nomina:full` | Descarta un recargo manual que pisaba uno automático |
| GET | `/api/liquidaciones/:id/pdf-desprendible` | `nomina:read` | PDF del desprendible generado en el servidor |
| POST | `/api/liquidaciones/generate-payslips-zip` | `nomina:full` | ZIP con los PDF de varias liquidaciones |
| POST | `/api/liquidaciones/preview-desprendibles` | `nomina:full` | Quién recibiría el correo y quién no |
| POST | `/api/liquidaciones/enviar-desprendibles` | `nomina:full` | Correo al conductor con enlace al portal (envío antiguo, síncrono) |
| PATCH | `/api/liquidaciones/desprendible-visible` | `nomina:full` | Publica u oculta desprendibles en el portal |
| PATCH | `/api/liquidaciones/desprendible-tablas-visible` | `nomina:full` | Muestra u oculta las tablas de recargos (`mostrar_recargos`) |
| GET | `/api/firmas/liquidacion/:id` | `nomina:read` | Firmas activas con URL de S3 de 15 min |
| GET | `/api/configuraciones-liquidacion` | `nomina:read` | Configuraciones activas, de un año o de todos |
| GET | `/api/configuraciones-liquidacion/activas` | `nomina:read` | Las activas de un año (por defecto el actual) |
| GET | `/api/configuraciones-liquidacion/anios` | `nomina:read` | Años con configuraciones activas |
| POST | `/api/configuraciones-liquidacion` | `nomina:full` | Crea una configuración |
| POST | `/api/configuraciones-liquidacion/duplicar` | `nomina:full` | Copia las de un año a otro |
| PUT | `/api/configuraciones-liquidacion/:id` | `nomina:full` | Edita nombre, valor o tipo |
| DELETE | `/api/configuraciones-liquidacion/:id` | `nomina:full` | Borrado lógico |
| POST | `/api/desprendible-firma/generar` | `nomina:full` | Crea o rota el token de firma de cada liquidación |
| GET | `/api/desprendible-firma/:token` | `pública · token` | Valida el enlace |
| POST | `/api/desprendible-firma/:token/firmar` | `pública · token` | Sube la imagen de la firma |
| GET | `/api/desprendible-firma/:token/datos` | `pública · token` | Liquidación completa, después de firmar |
| GET | `/api/desprendible-firma/:token/pdf` | `pública · token` | PDF del servidor, después de firmar |

### `GET /api/liquidaciones`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | entero | `1` | |
| `limit` | entero | `20` | Sin tope |
| `search` | string | — | Nombre, apellido o cédula del conductor, sin distinguir mayúsculas |
| `conductor_id` | uuid | — | |
| `estado` | `Pendiente` \| `Liquidado` | — | El enum viejo, no `estado_flujo`. Otro valor hace fallar a Prisma (500) |
| `nomina_month` | `YYYY-MM` | — | Prefijo de `periodo_end` |
| `sortBy` | `periodo` \| `conductor` \| `monto` \| `estado` \| `firmado` | `periodo` | Cualquier otro valor ordena por `periodo_end` descendente |
| `sortOrder` | `asc` \| `desc` | `desc` | |

**Respuesta 200**

```json
{
  "success": true,
  "data": [
    { "id": "uuid", "periodo_inicio": "2026-08-21", "periodo_fin": "2026-09-20",
      "estado": "Liquidado", "estado_flujo": "PAGADA", "desprendible_visible": true,
      "conductor": { "id": "…", "nombre": "Nombre Apellido", "cedula": "…", "email": "…",
                     "telefono": "…", "cargo": "…", "salario_base": "…" },
      "vehiculos": [ { "id": "…", "placa": "…", "marca": "…", "modelo": "…", "clase_vehiculo": "…" } ],
      "sueldo_total": 0, "total_devengado": 0, "total_deducido": 0, "neto_pagado": 0,
      "bonificaciones": [], "pernotes": [], "recargos": [], "anticipos": [], "mantenimientos": [],
      "firmas_desprendibles": [ { "id": "…" } ], "…": "…" }
  ],
  "pagination": { "total": 0, "page": 1, "limit": 20, "totalPages": 0, "hasNext": false, "hasPrev": false },
  "stats": { "totalRegistros": 0, "totalPendientes": 0, "montoTotal": 0, "totalVisibles": 0, "totalFirmados": 0 }
}
```

Cada fila es la de la base más los alias de periodo, los `Decimal` convertidos a
número, `pernotes[].fechas` como arreglo (en la base es un JSON en texto) y tres
derivados: `total_devengado = sueldo_total + salud + pension + total_anticipos`,
`total_deducido = salud + pension + total_anticipos` y `neto_pagado = sueldo_total`.
`totalPendientes` cuenta el enum viejo (`estado = Pendiente`).

**Errores:** 500 `{ "success": false, "message": "Error al obtener liquidaciones", "error": "<mensaje>" }`.

### `GET /api/liquidaciones/analisis`

Query `page`, `limit` y `noLimit` (`'true'` devuelve todas). No admite los
filtros del listado. La respuesta anida el resultado entero del listado:
`{ "success": true, "data": { "liquidaciones": [...], "pagination": {...}, "stats": {...} } }`.
La pantalla de análisis usa ahora `GET /api/nomina/analisis`.

### `GET /api/liquidaciones/preview-recargos`

**Query** (los tres obligatorios; si falta alguno, 400)

| Parámetro | Tipo | Descripción |
|---|---|---|
| `conductor_id` | uuid | |
| `periodo_inicio` | `YYYY-MM-DD` | |
| `periodo_fin` | `YYYY-MM-DD` | |

Lee las planillas vivas del conductor (`recargos_planillas`) de los meses que
toca el periodo y se queda con los días dentro del rango. Las **horas** salen
tal cual de `detalles_recargos_dias` (activos); el **valor** se recalcula con la
configuración salarial y el porcentaje del tipo de recargo vigentes en la fecha
de cada día (la específica de la empresa si existe; si no, la base). El valor
hora es `salario_basico / horas_mensuales_base` sin redondear. Las horas extra,
los tipos con `adicional` y `RD` se pagan «todo incluido» (base + %); el resto,
solo el porcentaje sobre la base. Los días de disponibilidad no suman horas ni
recargos.

**Respuesta 200**

```json
{
  "success": true,
  "data": {
    "conductor_id": "…",
    "periodo": { "inicio": "2026-08-21", "fin": "2026-09-20" },
    "configuracion_salarial_base": { "id": "…", "salario_basico": 0, "valor_hora_trabajador": 0, "horas_mensuales_base": 210, "sede": "…", "paga_dias_festivos": true, "porcentaje_festivos": 75 },
    "configuracion_salarial": { "…": "alias del anterior" },
    "resumen": { "total_planillas": 0, "total_dias_trabajados": 0, "total_horas_trabajadas": 0, "total_recargos": 0, "total_festivos": 0, "total_general": 0 },
    "resumen_tipos": [ { "codigo": "HED", "nombre": "…", "porcentaje": 25, "totalHoras": 0, "valorHoraBase": 0, "valorTotal": 0 } ],
    "planillas": [
      { "planilla_id": "…", "numero_planilla": "…", "vehiculo": { "placa": "…" }, "empresa": { "id": "…", "nombre": "…" },
        "mes": 9, "año": 2026, "total_dias": 0, "total_horas": 0, "total_valor": 0, "total_festivos": 0,
        "configuracion_salarial": { "…": "…" },
        "dias": [ { "dia": 3, "fecha": "…", "tipo_dia": "Normal", "disponibilidad": false, "total_horas": 0,
                    "recargos": [ { "tipo_codigo": "HED", "porcentaje": 25, "horas": 0, "valor_hora_base": 0, "valor_hora_calculada": 0, "valor_total": 0 } ],
                    "total_valor_dia": 0 } ] }
    ]
  }
}
```

`resumen_tipos` agrupa por (código, porcentaje): un periodo que cruza un cambio
de tarifa sale en dos filas. Orden: HED, HEN, HEFD, HEFN, RN, RD, RNDF.

Es la fuente que tenían las tablas del desprendible antes del canvas; el canvas
las arma ahora desde su propia copia de días
(`GET /api/nomina/liquidaciones/:id/desprendible-data`), que es lo que se paga.

### `GET /api/liquidaciones/:id`

**Respuesta 200** — `{ "success": true, "data": … }` con lo mismo que una fila
del listado más `creado_por`, `actualizado_por` y `liquidado_por`
(`{ id, nombre, email }`), `conductor.genero` y `firmas_desprendibles` completas.

- Cada firma trae `presignedUrl` con la imagen como **data URL base64** (se
  descarga de S3 en el servidor para que el PDF la incruste sin CORS).
- Si no hay firma válida, busca una firma de prima del mismo conductor de ±1 mes
  respecto a `periodo_fin` y la devuelve como única firma, marcada con
  `origen_fallback: 'prima'` y `prima_origen_id`.

Es la misma función (`obtenerLiquidacionConFirmas`) que usa el
[portal del conductor](./conductor-portal.md), para que el desprendible salga
igual se imprima por donde se imprima.

**Errores:** 404 `{ "success": false, "message": "Liquidación no encontrada" }`
(también si está retirada); 500.

### `POST /api/liquidaciones`

**Body** (sin esquema de validación: el servicio toma lo que reconoce)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `conductor_id` | uuid | sí | 400 si falta |
| `periodo_inicio`, `periodo_fin` | string | sí | 400 si falta alguno. Se guardan tal cual |
| `estado` | string | no | `'Liquidado'`; cualquier otro valor guarda `Pendiente`. `estado_flujo` queda en su valor por defecto, `BORRADOR` |
| `dias_laborados`, `dias_laborados_villanueva`, `dias_laborados_anual` | number | no | `0` por defecto |
| `salario_base` | number | no | Se guarda en `salario_devengado` |
| `sueldo_total`, `salud`, `pension`, `cesantias`, `interes_cesantias`, `auxilio_transporte`, `total_bonificaciones`, `total_pernotes`, `total_recargos`, `total_anticipos`, `total_vacaciones`, `valor_incapacidad`, `disponibilidad` | number | no | Totales ya calculados por el cliente; `0` por defecto |
| `no_descontar_salud`, `no_descontar_pension`, `descontar_transporte` | boolean | no | Fuerzan a `0` `salud`, `pension` y `auxilio_transporte` |
| `ajuste_valor`, `ajuste_por_dia_flag` | number, boolean | no | Van a `ajuste_salarial` y `ajuste_salarial_por_dia` |
| `ajuste_parex`, `ajuste_parex_recargos_completos`, `ajuste_parex_valor` | boolean, boolean, number | no | `ajuste_parex` guarda `ajuste_parex_valor` solo si alguna de las dos marcas viene activa |
| `ajuste_geopark`, `ajuste_geopark_valor` | boolean, number | no | Igual que PAREX, con una sola marca |
| `ajuste_recargos_config`, `conceptos_adicionales` | JSON | no | Se guardan tal cual. El rótulo de cada concepto adicional va en su `observaciones` |
| `dias_ajuste_deducciones` | number \| null | no | `null` es «sin decidir», distinto de `0` |
| `descontar_salud_salario`, `descontar_pension_salario` | boolean | no | |
| `periodo_vacaciones_inicio`, `periodo_vacaciones_fin`, `periodo_incapacidad_inicio`, `periodo_incapacidad_fin` | string | no | |
| `observaciones` | string | no | |
| `vehiculos` | uuid[] | no | Filas de `liquidacion_vehiculo` |
| `detalles_vehiculos` | array | no | Por vehículo (`vehiculo.value` es su id): `bonos[]` (`name`, `values`, `value`), `mantenimientos[]` (`values`, `value`), `pernotes[]` (`empresa_id`, `cantidad`, `valor`, `fechas[]`) y `recargos[]` manuales (`empresa_id`, `valor`, `mes`, `pag_cliente`, `porcentaje_propietario`, `origen_planilla_id`) |
| `recargos_preview` | array | no | Grupos de `preview-recargos` con `incluir`, `vehiculo_id`, `empresa_id`, `mes`, `emisor`, `valor`, `origen_planilla_id`, `numero_planilla`; se guardan como recargos automáticos |
| `anticipos` | array | no | `valor`, `fecha`, `concepto` |

- Pernotes y recargos sin `empresa_id` se descartan (un pernote con contenido
  deja un aviso en el log).
- Un recargo manual con `origen_planilla_id`, o que coincide con un automático
  de la misma liquidación por (vehículo, empresa, mes), se guarda como
  *override* (`es_override: true`).
- De `recargos_preview` solo cuentan los grupos con `incluir !== false`. Se
  deduplican por (vehículo, empresa, mes, emisor), porque el cliente manda una
  entrada por planilla con el total del grupo, y se escriben con *upsert* por
  (`liquidacion_id`, `origen_planilla_id`).

**Respuesta 201** — `{ "success": true, "data": <liquidación>, "message": "Liquidación creada correctamente" }`;
la liquidación con la forma de `GET /:id`, pero sin las firmas en base64.

**Errores:** 400 (conductor o periodo); 500 `{ success: false, message, error }` ante cualquier fallo de Prisma (un id inexistente, un tipo que no casa).

### `PUT /api/liquidaciones/:id`

Mismo body que el alta, todo opcional. Lo que no llega conserva lo guardado,
salvo estas excepciones: las fechas de vacaciones e incapacidad pasan a `null`,
`ajuste_parex` y `ajuste_geopark` vuelven a `0` si no llega su marca, y las
marcas `no_descontar_*`/`descontar_transporte` siguen forzando sus ceros.
`estado` solo cambia con `'Liquidado'` o `'Pendiente'`.

Las hijas se rehacen por bloques, y solo el bloque que llega:

- `vehiculos` presente: marca las filas de `liquidacion_vehiculo` y crea las nuevas.
- `anticipos` presente: marca los vivos y crea los enviados.
- `detalles_vehiculos` presente: marca bonificaciones, mantenimientos, pernotes
  y **todos** los recargos (también los automáticos), escribe
  `total_bonificaciones`, `total_pernotes` y `total_recargos` (`0` si no llegan) y
  vuelve a crear. `recargos_preview` solo se procesa dentro de este bloque.

**Respuesta 200** — `{ success: true, data, message }`. **Errores:** 404 si no existe o está retirada; 500.

### `DELETE /api/liquidaciones/:id`

Marca `deleted_at` en la liquidación y nada más. Una ya retirada da 404, no un
segundo «eliminada». Respuesta `{ "success": true, "message": "Liquidación eliminada correctamente" }`.

### `POST /api/liquidaciones/:id/recargos/:recargoId/revertir-override`

Descarta un recargo manual que pisaba uno automático: borra el manual y vuelve a
poner `incluir: true` en los automáticos de la misma planilla de origen, en una
transacción. Devuelve la liquidación como `POST`.

**Errores:** 404 `Recargo no encontrado`; 400 `Este recargo no es un override`
(no tiene `es_override` u `origen_planilla_id`); 500 si el recargo es de otra
liquidación (`El recargo no pertenece a esta liquidación` no casa con el 404 del
controlador).

### `GET /api/liquidaciones/:id/pdf-desprendible`

PDF tamaño carta renderizado con Puppeteer desde la plantilla vigente
(`DESPRENDIBLE_LAYOUT`), con la firma activa si la hay (URL de S3 fresca de 15
min). `Content-Type: application/pdf`,
`Content-Disposition: attachment; filename="Desprendible_<NOMBRE>_<PERIODO>.pdf"`.
Razón social y NIT salen de `liquidaciones.es_cotransmeq` (ver Observaciones).
**Errores:** 500 ante cualquier fallo, también si la liquidación no existe.

### `POST /api/liquidaciones/generate-payslips-zip`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `liquidationIds` | string[] | sí | En inglés, a diferencia del resto del módulo. Vacío → 400 |
| `socketId` | string | no | Socket que recibe el progreso |

Genera los PDF uno a uno (cada uno abre una pestaña de Chromium) y solo después
arma el ZIP; dos desprendibles con el mismo nombre de archivo se renombran con
`_2`, `_3`. Un PDF que falla no aborta el lote: se omite del ZIP y solo se
avisa por socket. Respuesta `application/zip`, `payslips.zip`.

**Errores:** 400 sin ids; 500 si no sale ningún PDF (`No se pudo generar ningún desprendible…`) o ante otro fallo; con `socketId`, el 500 también emite `progress:error`.

### `POST /api/liquidaciones/preview-desprendibles`

**Body** (esquema de Fastify: 400 con su formato si no cumple)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `liquidacionIds` | string[] | sí | 1 a 100 |

**Respuesta 200**

```json
{ "success": true,
  "data": { "total": 2, "canSend": 1, "cannotSend": 1,
            "items": [ { "liquidacionId": "…", "conductor": "Nombre Apellido", "email": "…",
                         "periodo_inicio": "…", "periodo_fin": "…", "sueldo_total": "…", "estado": "Liquidado", "canSend": true } ] } }
```

Solo liquidaciones vivas, ordenadas por `periodo_end` descendente; `canSend` es «el conductor tiene correo».

### `POST /api/liquidaciones/enviar-desprendibles`

Mismo body y esquema que el preview (`liquidacionIds`, 1 a 100). Envía en serie,
dentro de la petición, un correo por liquidación con el enlace al portal:
`<EMAIL_FRONTEND_URL>/public/portal?token=<token>&desprendible=<id>&tab=desprendibles`.
El token sale de `tokenPortalVigente` (`portal-token.service.ts`), el mismo que
usa la cola de envíos de nómina: el token del portal vigente más largo del
conductor (solo `tipo: 'conductor_portal'` firmado con el `JWT_SECRET` actual,
nunca el del reporte de días laborados) o uno nuevo de 30 días.

**Respuesta 200**

```json
{ "success": true, "message": "1 email(s) enviado(s), 1 error(es)",
  "data": { "enviados": 1, "errores": 1, "total": 2,
            "resultados": [ { "liquidacionId": "…", "conductor": "…", "email": "…", "status": "enviado" },
                            { "liquidacionId": "…", "conductor": "…", "status": "error", "message": "Conductor sin email registrado" } ] } }
```

**Errores:** 404 si ninguna liquidación existe; 400 de Fastify; 500. Es el envío
antiguo: el del canvas (`POST /api/nomina/envios/lote`) va por cola y deja constancia.

### `PATCH /api/liquidaciones/desprendible-visible`

**Body** (esquema de Fastify)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `liquidacionIds` | string[] | sí | 1 a 500 |
| `visible` | boolean | sí | Valor de `desprendible_visible`: si el conductor ve el desprendible en el portal |

Actualiza todas las liquidaciones de la lista, **también las retiradas** (no
filtra `deleted_at`). Respuesta `{ success: true, message, data: { updated, visible } }`,
con `updated` = filas cambiadas, retiradas incluidas.

### `PATCH /api/liquidaciones/desprendible-tablas-visible`

Body `liquidacionIds` (string[], obligatorio y no vacío: si no, 400 `liquidacionIds es requerido`)
y `visible`. Sin esquema: `visible` no se valida y va directo a `mostrar_recargos`
(si las páginas de recargos salen en el desprendible). Como la anterior, no
filtra `deleted_at`: también cambia liquidaciones retiradas.
Respuesta `{ success: true, message, data: { count, visible } }`, donde `count`
es el número de ids enviados, no el de filas cambiadas.

### `GET /api/firmas/liquidacion/:id`

Firmas de la liquidación con `estado = 'Activa'` y una imagen subida
(`firma_s3_key` distinto de `''` y `'pending'`), de la más reciente a la más
antigua. Cada una es la fila completa más `presignedUrl` (URL de S3 de 900 s, o
`null` si no se pudo firmar). Respuesta `{ success: true, data: [...] }`; una
liquidación sin firmas o inexistente da arreglo vacío.

### `GET /api/configuraciones-liquidacion`

Query `anio` (entero, opcional). Devuelve las activas (`activo: true`) de ese año
o de todos, ordenadas por año descendente y nombre, con `valor` como número:
`{ success: true, data: [ { id, nombre, valor, tipo, anio, activo, created_at, updated_at, deleted_at } ] }`.

### `GET /api/configuraciones-liquidacion/activas`

Igual que la anterior, pero `anio` es por defecto el año en curso del servidor y
lo valida un esquema de Fastify (entero entre 2000 y 2100; si no, 400 con el
formato de Fastify). Su descripción la ata a las casillas de bonos de planilla,
pero el canvas de recorridos lee sus columnas de `GET /api/recorridos/canvas/bonos`.

### `GET /api/configuraciones-liquidacion/anios`

`{ success: true, data: [2026, 2025] }`: años distintos con configuraciones activas, del más reciente al más antiguo.

### `POST /api/configuraciones-liquidacion`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | string | sí | No se comprueba duplicado por año |
| `valor` | number | sí | `0` vale |
| `tipo` | enum | sí | `enum_configuraciones_liquidacion_tipo`: `BONO`, `CONFIGURACION`, `PARAMETRO`, `OTROS`, `VALOR_NUMERICO`, `PORCENTAJE`, `MONTO_FIJO`, `BOOLEAN`, `MULTIPLICADOR`, `DESCUENTO`. Otro valor → 500 |
| `anio` | entero | sí | |

Solo las de tipo `VALOR_NUMERICO` aparecen como columna de bono en el canvas de
recorridos. **Respuesta 201** `{ success: true, data }`. **Errores:** 400 si falta un campo (`Se requiere nombre, valor, tipo y anio`); 500.

### `POST /api/configuraciones-liquidacion/duplicar`

Body `anio_origen` y `anio_destino` (enteros, obligatorios). Copia nombre, valor y
tipo de cada configuración activa del año origen. **Respuesta 201**
`{ success: true, data: [nuevas], message: "Se duplicaron N configuraciones del año X al año Y" }`.
**Errores:** todos son 400 `{ success: false, message }`: faltan años, el destino
ya tiene configuraciones activas, el origen no tiene, o cualquier otro fallo.

### `PUT /api/configuraciones-liquidacion/:id`

Body con `nombre`, `valor` y `tipo`, todos opcionales: solo cambia lo que llega
(`anio` y `activo` no se editan aquí). Respuesta `{ success: true, data }`.
**Errores:** 404 `Configuración no encontrada`; 500. Cambiar `valor` no toca los
bonos ya marcados en recorridos, que guardan el suyo, pero sí lo que pagan los
borradores de nómina que se generen después: el generador usa el valor vigente.

### `DELETE /api/configuraciones-liquidacion/:id`

Borrado lógico: `activo: false` y `deleted_at`. Respuesta
`{ success: true, message: "Configuración eliminada correctamente" }`; 404 si no existe.

### `POST /api/desprendible-firma/generar`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `liquidacion_ids` | string[] | sí | No vacío (si no, 400) |
| `expires_days` | number | no | `365` por defecto; no se valida |

Por cada liquidación viva con conductor: si ya hay registro para
(liquidación, conductor) se le pone un token nuevo y nuevo `expires_at` (el
enlace anterior deja de servir; si ya estaba firmada, **sigue firmada**); si no,
crea la fila con `firma_url: 'pending'` y `firma_s3_key: ''`. La ruta solo
devuelve el token: el enlace y su envío los arma el cliente.

**Respuesta 200**

```json
{ "success": true,
  "data": [ { "liquidacion_id": "…", "conductor_id": "…", "token": "<64 hex>", "expires_at": "…", "created": true },
            { "liquidacion_id": "…", "conductor_id": "…", "token": "…", "expires_at": "…", "updated": true },
            { "liquidacion_id": "…", "error": "Liquidación no encontrada o sin conductor" } ] }
```

### `GET /api/desprendible-firma/:token`

```json
{ "success": true,
  "data": { "id": "…", "token": "…", "ya_firmo": false, "expires_at": "…",
            "conductor": { "nombre": "Nombre Apellido", "numero_identificacion": "…" },
            "liquidacion": { "id": "…", "periodo_inicio": "…", "periodo_fin": "…" } } }
```

`ya_firmo` es «`firma_url` distinto de `''` y de `'pending'`».
**Errores:** 404 `Enlace inválido o no existe.`; 410 `Este enlace ha expirado.`; 500.

### `POST /api/desprendible-firma/:token/firmar`

`multipart/form-data` con la imagen de la firma: se toma el primer archivo, sin
mirar el nombre del campo. Se sube a S3 como
`firmas_desprendibles/<liquidacion_id>/<conductor_id>/<uuid>.png` con el
`mimetype` recibido, y se guardan `firma_url` (URL firmada de un año),
`firma_s3_key`, `ip_address` (primer valor de `x-forwarded-for` o la IP de la
conexión), `user_agent` y `fecha_firma`.

**Respuesta 200** — `{ success: true, message: "Firma registrada exitosamente.", data: { firma_url, s3_key } }`.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | No llegó archivo |
| 404 | Token inexistente |
| 410 | Enlace expirado |
| 409 | Ya estaba firmado |
| 500 | Fallo de S3 o de base; una petición que no es multipart también acaba aquí |

### `GET /api/desprendible-firma/:token/datos`

Solo después de firmar (403 `Debe firmar primero para ver el desprendible.`).

```json
{ "success": true,
  "data": {
    "liquidacion": { "…": "como GET /api/liquidaciones/:id, sin las firmas en base64" },
    "recargos": { "…": "la respuesta de preview-recargos, o null si falló" },
    "dataParaPdf": { "planillas": [ { "…": "planilla de preview-recargos", "_categoria": "pagar" } ] },
    "firma": { "presignedUrl": "<URL de S3, 1 h>", "fecha_firma": "…" },
    "firmasPrima": [ { "id": "…", "liquidacion_id": "…", "firma_s3_key": "…", "fecha_firma": "…",
                       "periodo_inicio": "…", "periodo_fin": "…", "presignedUrl": "…" } ] } }
```

`dataParaPdf` son las planillas ya clasificadas para el PDF, con la misma
estructura que usan el modal del dashboard y el portal
(`LiquidacionesService.buildDataParaPdf`): `_categoria: 'pagar'` para las que
casan con un recargo guardado por vehículo, empresa y mes; `'bono_aparte'` para
las de GEOLAB, RED SALUD e INGENIERIA ESPECIALIZADA, que se reconocen como bono
aparte y no suman al total; `'no_pagar'` para las que solo tienen días de
disponibilidad o recorridos sin recargo; y, sin `_categoria`, una planilla
sintética por cada recargo guardado que no casa con ninguna planilla con días.
Sale `{ planillas: [] }` si `mostrar_recargos` es falso, si falta conductor o
periodo, o si falla el cálculo.

`firmasPrima`, pese al nombre, son las firmas de **otros desprendibles** del
mismo conductor cuyo `periodo_end` cae a ±1 mes. **Errores:** 404 token; 403; 500
(incluida una liquidación retirada).

### `GET /api/desprendible-firma/:token/pdf`

El mismo PDF que `GET /api/liquidaciones/:id/pdf-desprendible`, en línea
(`Content-Disposition: inline`, `Cache-Control: private, no-store`). Exige
enlace vigente y firma. **Errores:** 404; 410; 403; 500 `{ success: false, message }`.

## Efectos

- **Correo.** `enviar-desprendibles` usa `EmailService.sendDesprendibleNotification`:
  remitente `Cotransmeq <noreply@cotransmeq.com>` y copia oculta a
  `NOTIF_BCC_EMAIL` si está configurada. Puede crear una fila en
  `conductor_token` (ver [autenticación](../autenticacion.md)). No deja
  constancia en `nomina_envio`.
- **Socket.** `generate-payslips-zip` con `socketId` emite a ese socket
  `progress:start` `{ total }`, `progress:update` `{ current, total }` por
  documento, `progress:error` `{ message }` por cada PDF que falla y
  `progress:complete` `{ generados, fallidos: [{ id, error }] }`. Ver
  [tiempo real](../tiempo-real.md).
- **S3.** Imágenes de firma en `firmas_desprendibles/…`. Las lecturas firman
  URLs (15 min en `/firmas/liquidacion/:id` y en el PDF, 1 h en `/datos`) o
  descargan la imagen como base64 (`GET /api/liquidaciones/:id`).
- **PDF.** Puppeteer (`services/pdf.service.ts`), un documento cada vez. En este
  repo la plantilla se renderiza sin `prelude`: fuentes del sistema y los
  valores por defecto de cada `var(--tpdf-*)`, con el logo y los colores de
  Cotransmeq de `nomina-canvas/desprendible.template.ts`.
- Este módulo no escribe historial de estados: lo hace el canvas
  (`historial_estado_liquidacion_nomina`).

## Observaciones

- **El CRUD ignora la máquina de estados del canvas.**
  `PUT /api/liquidaciones/:id`, `DELETE /api/liquidaciones/:id` y
  `revertir-override` no miran `estado_flujo`: reescriben o retiran una
  liquidación APROBADA, PAGADA o FIRMADA que el canvas tiene
  bloqueada (`DELETE /api/nomina/liquidaciones/:id` solo admite BORRADOR). Además
  no suben `liquidaciones.version`, así que un canvas abierto no se entera y su
  siguiente *patch* no choca, y `PUT` cambia `estado` sin tocar `estado_flujo`, con
  lo que los dos pueden quedar contradiciéndose. `liquidaciones.service.ts`.
- `revertir-override` **borra en duro** el recargo manual
  (`prisma.recargos.delete`), contra la regla de borrado lógico del repo, y no
  filtra `deleted_at`. `liquidaciones.service.ts`.
- `GET /api/liquidaciones/:id/pdf-desprendible` responde 500 cuando la
  liquidación no existe; el ZIP solo cuenta los fallidos por socket: sin
  `socketId`, la respuesta no dice qué desprendibles faltan. `liquidaciones.controller.ts`.
- `stats.totalFirmados` y `sortBy=firmado` cuentan cualquier fila de
  `firmas_desprendibles`, también las `pending` que crea `/desprendible-firma/generar`.
  `liquidaciones.service.ts`.
- `GET /api/liquidaciones/analisis?noLimit=true` devuelve todas las
  liquidaciones con todas sus hijas, y `pagination.totalPages` sale `null`
  (`Math.ceil(total / undefined)`).
- Body de `POST`/`PUT /api/liquidaciones` sin esquema: un tipo que no casa llega
  a Prisma y sale como 500.
- **Firma pública** (`desprendible-firma.routes.ts`):
  - `GET /:token/datos` no comprueba `expires_at`: un enlace firmado sigue
    sirviendo los datos después de vencer.
  - Ninguna ruta mira `firmas_desprendibles.estado` (`Revocada`, `Expirada`) ni
    si la liquidación está retirada (en `/datos` y `/pdf` eso acaba en 500).
  - `/firmar` acepta cualquier archivo y tipo, hasta el límite global de 200 MB
    de `@fastify/multipart`, y lo guarda con extensión `.png`.
  - `/firmar` no exige que la liquidación esté PAGADA ni la pasa a FIRMADA, a
    diferencia de la firma del portal del conductor, que hace las dos cosas.
  - `/datos` devuelve la liquidación entera: `firmas_desprendibles` con sus
    tokens, IP y *user agent*, y los correos de quien creó, editó y liquidó.
  - `/generar` comenta «si ya estaba firmado, resetear para que pueda firmar de
    nuevo», pero conserva la firma; `expires_days` no se valida, y `fecha_firma`
    se rellena al crear el token, así que no sirve para saber si se firmó.
- `enviar-desprendibles` arma el enlace con `EMAIL_FRONTEND_URL` y, si falta,
  con `http://localhost:5173`; el envío del canvas usa `getEmailFrontendUrl()`,
  que cae a la primera URL de `FRONTEND_URL`.
- `desprendible-visible` y `desprendible-tablas-visible` no filtran
  `deleted_at`: publican, ocultan o cambian las tablas de liquidaciones
  retiradas, que ninguna lectura devuelve. `liquidaciones.routes.ts`.
- `desprendible-tablas-visible` no tiene esquema: `visible` puede llegar como
  cualquier cosa y `count` no refleja las filas cambiadas.
- **El desprendible del servidor identifica la empresa según
  `liquidaciones.es_cotransmeq`.** Con `false` (el valor por defecto) imprime
  SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S. y NIT 901983227; con `true`,
  COOPERATIVA DE TRANSPORTADORES DEL META Y CASANARE y NIT 892099216-1. Afecta a
  `pdf-desprendible`, al ZIP y al PDF del enlace de firma, no al desprendible de
  pdfmake. `liquidaciones.service.ts` (`datosDesprendible`).
- `PUT /api/configuraciones-liquidacion/:id` encuentra y edita también
  configuraciones retiradas (busca sin filtrar `deleted_at`).
- El respaldo de firma de `GET /api/liquidaciones/:id` toma firmas de primas sin
  mirar si la prima está retirada.

## Diferencias con Transmeralda

- `GET /api/desprendible-firma/:token/datos` no devuelve `dataParaPdf`:
  `LiquidacionesService.buildDataParaPdf` solo existe en este repo.
- `PATCH /api/liquidaciones/desprendible-visible` y
  `PATCH /api/liquidaciones/desprendible-tablas-visible` filtran `deleted_at`:
  solo cambian liquidaciones vivas, y `updated` no cuenta las retiradas.
- El PDF del servidor lleva como `prelude` las fuentes embebidas y los tokens de
  color del módulo `liquidaciones-terceros-pdf`, y el logo y los colores de
  Transmeralda.
