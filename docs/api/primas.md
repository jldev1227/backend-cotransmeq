# Primas

`/api/primas` · código en [`src/modules/primas/`](../../src/modules/primas/) · permiso [`nomina`](../permisos.md#catálogo-de-módulos)

La liquidación de la prima de servicios de cada conductor: una fila de `primas`
por conductor, mes y año, con el valor (`prima`, y `prima_pendiente` si queda
saldo), la base con que se calculó (`sueldo_basico`, `auxilio_transporte`,
`sueldo_variable`, `total_base_liquidacion`), los días trabajados y un estado
`Pendiente|Pagado`. El servidor no calcula nada: guarda lo que manda el cliente.

El conductor ve y firma su prima en el [portal](./conductor-portal.md)
(`firmas_primas`, fuera de este módulo); aquí solo se lee esa firma para
incrustarla en el PDF. Firma de prima y firma de desprendible se respaldan una a
otra: si una prima no tiene la suya, `firma-enriquecida` usa la del desprendible
de nómina del mismo conductor a ±1 mes, y `GET /api/liquidaciones/:id` hace lo
mismo al revés.

Borrado lógico (`deleted_at`): una prima retirada no se lista, no se abre, no se
edita ni se envía, y retirarla dos veces da 404 (así no se pisa la fecha real
del retiro).

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest`) y `permisoPorMetodo('nomina')` en el plugin |
| `GET` | `nomina:read` |
| `POST`, `PUT`, `DELETE` | `nomina:full` |

Hasta oct-2026 este archivo solo pedía sesión. No hay chequeos adicionales en el
controlador.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/primas` | `nomina:read` | Lista paginada con filtros y estadísticas |
| GET | `/api/primas/buscar` | `nomina:read` | Primas de un conductor, opcionalmente de un mes o año |
| GET | `/api/primas/:id` | `nomina:read` | Una prima |
| GET | `/api/primas/:id/firma-enriquecida` | `nomina:read` | Firma de la prima en base64, con respaldo en la de nómina |
| POST | `/api/primas` | `nomina:full` | Crea una prima |
| PUT | `/api/primas/:id` | `nomina:full` | Edita una prima |
| DELETE | `/api/primas/:id` | `nomina:full` | Borrado lógico |
| POST | `/api/primas/enviar` | `nomina:full` | Correo al conductor con enlace al portal |

### `GET /api/primas`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | entero | `1` | |
| `limit` | entero | `20` | Sin tope |
| `search` | string | — | Nombre, apellido o cédula del conductor, sin distinguir mayúsculas |
| `conductor_id` | uuid | — | |
| `mes`, `anio` | entero | — | |
| `estado` | `Pendiente` \| `Pagado` | — | Otro valor hace fallar a Prisma (500) |
| `sortBy` | `prima` \| `mes` \| `anio` \| `estado` \| `conductor` | `created_at` | Cualquier otro valor ordena por `created_at` descendente |
| `sortOrder` | `asc` \| `desc` | `desc` | |

**Respuesta 200**

```json
{ "success": true,
  "data": {
    "primas": [ { "id": "uuid", "conductor_id": "…", "mes": 6, "anio": 2026, "prima": 0, "prima_pendiente": null,
                  "tiempo_trabajado_dias": 180, "sueldo_basico": 0, "auxilio_transporte": 0, "sueldo_variable": 0,
                  "total_base_liquidacion": 0, "observaciones": null, "estado": "Pendiente",
                  "firmado": true, "firmas_primas_count": 1,
                  "conductor": { "id": "…", "nombre": "…", "apellido": "…", "cedula": "…", "email": "…" } } ],
    "stats": { "total": 0, "totalPendientes": 0, "totalPagados": 0, "montoTotal": 0 },
    "pagination": { "total": 0, "page": 1, "limit": 20, "totalPages": 0, "hasNext": false, "hasPrev": false } } }
```

Los `Decimal` salen como número (o `null`). `firmado` y `firmas_primas_count`
cuentan solo firmas con imagen (`firma_url` distinto de `''` y de `'pending'`).

**Errores:** 500 `{ success: false, message: "Error al obtener primas", error }`.

### `GET /api/primas/buscar`

**Query**

| Parámetro | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `conductor_id` | uuid | sí | 400 `El conductor_id es requerido` si falta |
| `mes`, `anio` | entero | no | |

Sin paginar, del periodo más reciente al más antiguo. Respuesta
`{ success: true, data: [...] }` con la misma forma de fila que el listado, pero
sin `firmado` ni `firmas_primas_count`.

### `GET /api/primas/:id`

`{ success: true, data }` con la prima, `conductor` ampliado (`telefono`,
`cargo`, `sede_trabajo`) y `creado_por`/`actualizado_por` (`{ id, nombre, email }`).
**Errores:** 404 `{ success: false, message: "Prima no encontrada" }`, también si está retirada; 500.

### `GET /api/primas/:id/firma-enriquecida`

Pensada para el PDF del dashboard. Orden de búsqueda:

1. La firma propia más reciente de la prima (`firmas_primas` con imagen).
2. Si no hay o no se puede leer de S3: una firma de desprendible del mismo
   conductor cuya liquidación termina en el mes de la prima o en uno de los dos
   contiguos.

**Respuesta 200**

```json
{ "success": true,
  "data": { "presignedUrl": "data:image/png;base64,…", "fecha_firma": "…", "origen": "prima", "liquidacion_id": null } }
```

`presignedUrl` es, pese al nombre, la imagen como data URL base64. `origen` es
`prima` o `nomina` (entonces `liquidacion_id` dice de qué desprendible salió).
Sin ninguna firma, `data: null`. **Errores:** 404 si la prima no existe o está retirada; 500.

### `POST /api/primas`

**Body** (sin esquema de validación: el servicio toma lo que reconoce)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `conductor_id` | uuid | sí | 400 `El conductor es requerido` |
| `mes`, `anio` | entero | sí | 400 `El mes y el año son requeridos`. `mes` no se valida contra 1–12 |
| `prima` | number | no | `0` por defecto; pasa tal cual a Prisma |
| `prima_pendiente` | number \| null | no | |
| `tiempo_trabajado_dias`, `sueldo_basico`, `auxilio_transporte`, `sueldo_variable`, `total_base_liquidacion` | number \| null | no | `null` por defecto |
| `observaciones` | string | no | |
| `estado` | string | no | `'Pagado'`; cualquier otro valor guarda `Pendiente` |

**Respuesta 201** — `{ success: true, data: <como GET /:id>, message: "Prima creada correctamente" }`.
**Errores:** 400; 500 `{ success: false, message, error }` (por ejemplo, un `conductor_id` inexistente).

### `PUT /api/primas/:id`

Los mismos campos, todos opcionales: solo cambia lo que llega, y `null` vacía los
opcionales numéricos. `estado` distinto de `'Pagado'` guarda `Pendiente`.
Registra `actualizado_por_id`. Respuesta `{ success: true, data, message }`.
**Errores:** 404 si no existe o está retirada; 500.

### `DELETE /api/primas/:id`

Marca `deleted_at`. Respuesta `{ "success": true, "message": "Prima eliminada correctamente" }`.
**Errores:** 404 si no existe o ya estaba retirada; 500.

### `POST /api/primas/enviar`

**Body** (esquema de Fastify: 400 con su formato si no cumple)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `primasIds` | string[] | sí | 1 a 100 |

Envía en serie, dentro de la petición, un correo por prima viva con el enlace
`<FRONTEND_URL>/public/portal?token=<token>&prima=<id>&tab=primas`. El token
sale de `tokenPortalVigente` (`portal-token.service.ts`): el token del portal
vigente más largo del conductor (solo `tipo: 'conductor_portal'` firmado con el
`JWT_SECRET` actual, nunca el del reporte de días laborados) o uno nuevo de 30
días.

**Respuesta 200**

```json
{ "success": true, "message": "1 email(s) enviado(s), 1 error(es)",
  "data": { "enviados": 1, "errores": 1, "total": 2,
            "resultados": [ { "primaId": "…", "conductor": "…", "email": "…", "status": "enviado" },
                            { "primaId": "…", "conductor": "…", "email": null, "status": "error", "message": "El conductor no tiene email registrado" } ] } }
```

**Errores:** 404 `No se encontraron primas` si ninguna existe; 400 de Fastify; 500.

## Efectos

- **Correo.** `EmailService.sendPrimaNotification`: remitente
  `Cotransmeq <noreply@cotransmeq.com>` y copia oculta a `NOTIF_BCC_EMAIL`
  si está configurada. No queda constancia del envío.
- **Tokens.** `enviar` puede crear filas en `conductor_token` (ver
  [autenticación](../autenticacion.md)).
- **S3.** `firma-enriquecida` descarga la imagen de la firma para devolverla en base64.

## Observaciones

- `enviar` arma el enlace con `env.FRONTEND_URL` tal cual, que es la lista de
  orígenes de CORS separada por comas (`app.ts`). Con más de un origen
  configurado el enlace sale roto; los envíos de nómina usan
  `EMAIL_FRONTEND_URL` o `getEmailFrontendUrl()`. `primas.routes.ts`.
- `enviar` manda los correos seguidos, sin pausa: la cola de nómina espera
  800 ms entre envíos porque Resend corta a dos peticiones por segundo, así que
  un lote grande puede acabar con errores por límite. No hay reintento ni constancia.
- Body de `POST`/`PUT` sin esquema: `mes` fuera de 1–12 se guarda, y un importe
  que no es número llega a Prisma y sale como 500. `primas.service.ts`.
- El respaldo de `firma-enriquecida` toma firmas de desprendibles sin mirar si
  su liquidación está retirada. `primas.service.ts`.
