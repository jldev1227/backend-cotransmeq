# Extractos de contrato (FUEC)

`/api/extractos` y `/api/public/extractos` · código en [`src/modules/extractos/`](../../src/modules/extractos/) · permiso [`extractos`](../permisos.md#catálogo-de-módulos)

El extracto de contrato (FUEC, formato `OP-FR-01` v1) es el documento que
acompaña a un vehículo en la vía: contratante, número de contrato, objeto,
origen-destino, convenio de colaboración, vigencia, vehículo y hasta tres
conductores. Vive en `fuec_extract` (conductores en `fuec_extract_driver`). Lo
que se repite de un extracto a otro está en catálogos: contratantes
(`fuec_contratante`, uno por contratante con su número de contrato y su
responsable) y textos frecuentes de objeto, convenio y origen-destino
(`fuec_catalogo`, ordenados por uso). Las constantes de la empresa (razón
social SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S., NIT, dirección, prefijo)
están en `fuec.config.ts`.

Reglas que un integrador necesita saber:

- **Un extracto emitido no cambia.** Al emitir se guarda una instantánea de lo
  impreso (`snapshot_json`) firmada con HMAC-SHA512 (`fuec-firma.ts`) y un
  código de verificación de 12 caracteres (sin `0`, `O`, `1` ni `I`, para
  teclearlo desde el papel) que va en el QR. La «huella» que se imprime son los
  primeros 16 hex de la firma. Para corregir se emite otro con `reemplaza_a_id`
  y el anterior queda anulado.
- **Número** (Resolución 6652/2019, art. 4): prefijo de nueve dígitos
  (territorial 550, resolución de habilitación 3115 y año 25, es decir
  `550311525`) + año de expedición + número de contrato a cuatro dígitos +
  consecutivo a cuatro dígitos. El consecutivo es global (máximo + 1) y se
  toma bajo un candado de Postgres para que dos emisiones simultáneas no lo
  repitan.
- **Estado** (calculado, no guardado): `ANULADO` si tiene `anulado_at`;
  `VENCIDO` si `vigencia_hasta` es anterior a hoy en Bogotá; `POR_VENCER` si
  vence en los próximos 7 días; `VIGENTE` en otro caso.
- Emitir actualiza las fichas con lo digitado (salvo `actualizar_fichas:
  false`): en el vehículo, número interno y tarjeta de operación, y modelo,
  marca, clase y empresa afiliadora si estaban vacíos; en el conductor, la
  vigencia de la licencia y la cédula si faltaba y nadie más la tiene.
- El convenio se imprime `N/A` si viene vacío o es la propia empresa
  (variantes en `FUEC.afiliacion_propia`).
- Al emitir, cada conductor vinculado por `conductor_id` recibe un aviso
  `FUEC_EMITIDO` en `conductor_notification` y un intento de push por el canal
  Android `extractos`. El aviso abre `/extractos/:id` en la app del conductor.
  El buzón se guarda antes del push; si no hay dispositivo, queda pendiente
  para la siguiente sincronización. Conductores sin ficha vinculada no pueden
  recibirlo. Una falla de avisos no revierte el documento firmado.
- Cada usuario activo del área Operaciones con acceso a Extractos, incluido el
  creador si pertenece al área, recibe un aviso `GENERAL` en `notificacion` con
  `referencia_tipo: 'extracto'`, el id del FUEC, el nombre de quien lo emitió y
  el consecutivo. Se entrega por `nueva-notificacion` a su campana y abre el
  detalle del FUEC en la app móvil o el dashboard web.

## Acceso

| Operación | Guarda |
|---|---|
| `GET /api/public/extractos/:codigo` | `pública · token`: el código de verificación del QR. Límite 120 por IP por minuto (`crearLimitador` + `preHandlerLimite`, IP de `ipCliente`) |
| Resto | `sesión` (hook `onRequest` del plugin) |
| `GET` del panel | `extractos:read` |
| `POST`, `PUT`, `DELETE` | `extractos:full` |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/extractos` | `extractos:read` | Lista paginada con filtros y conteos por estado |
| GET | `/api/extractos/anios` | `extractos:read` | Años con extractos |
| GET | `/api/extractos/opciones` | `extractos:read` | Todo lo que necesita el formulario de emisión |
| GET | `/api/extractos/contratantes` | `extractos:read` | Catálogo de contratantes |
| POST | `/api/extractos/contratantes` | `extractos:full` | Crea un contratante |
| PUT | `/api/extractos/contratantes/:id` | `extractos:full` | Edita un contratante |
| DELETE | `/api/extractos/contratantes/:id` | `extractos:full` | Retira un contratante (borrado lógico) |
| GET | `/api/extractos/catalogo` | `extractos:read` | Textos frecuentes de un tipo |
| DELETE | `/api/extractos/catalogo/:id` | `extractos:full` | Retira un texto del catálogo |
| GET | `/api/extractos/:id` | `extractos:read` | Detalle de un extracto |
| POST | `/api/extractos` | `extractos:full` | Emite (y firma) un extracto |
| POST | `/api/extractos/:id/anular` | `extractos:full` | Anula un extracto |
| GET | `/api/public/extractos/:codigo` | pública · token · límite 120/min por IP | Validación pública (QR) |

**Errores comunes**: un error de dominio responde con su código y
`{ success: false, message, code? }`; uno de zod, **400**
`{ success: false, message: <primer error>, code: 'VALIDACION' }`; cualquier
otro, **500** `{ success: false, message }` con un texto fijo por ruta.

### Forma de un extracto

`GET /:id`, `POST` y `POST /:id/anular` devuelven `{ success: true, data }` con:

```json
{ "id": "uuid", "consecutivo": 312, "numero_completo": "550311525202600240312", "estado": "VIGENTE",
  "contratante_id": "uuid", "contratante_nombre": "…", "contratante_nit": "…", "contrato_numero": "24",
  "objeto_contrato": "…", "origen_destino": "…", "convenio": "N/A",
  "vigencia_desde": "2026-10-01", "vigencia_hasta": "2026-10-31",
  "vehiculo_id": "uuid", "placa": "ABC123", "modelo": "…", "marca": "…", "clase": "…",
  "numero_interno": "…", "tarjeta_operacion": "…",
  "conductores": [ { "id": "uuid", "conductor_id": "uuid", "nombre": "…", "cedula": "…", "licencia_vigencia": "…", "orden": 1 } ],
  "responsable": { "nombre": "…", "cedula": "…", "telefono": "…", "direccion": "…" },
  "codigo_verificacion": "ABCDEFGH2345", "huella": "1A2B-3C4D-5E6F-7A8B", "firmado": true,
  "emitido_at": "…", "source": "MANUAL", "creado_por": { "id": "uuid", "nombre": "…" },
  "anulado_at": null, "anulado_por": null, "motivo_anulacion": null,
  "reemplaza_a": null, "reemplazado_por": [], "snapshot": { "…": "…" } }
```

En el ejemplo, `550311525` + `2026` + contrato `0024` + consecutivo `0312`.
`snapshot` es lo que se firmó.

### `GET /api/extractos`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `q` | string | — | Número completo, placa, contratante, origen-destino, nombre de conductor o, si son solo dígitos, el consecutivo |
| `placa` | string | — | Igualdad tras normalizar (mayúsculas, sin separadores) |
| `contratante_id` | uuid | — | |
| `estado` | `todos` \| `vigentes` \| `por_vencer` \| `vencidos` \| `anulados` | `todos` | |
| `anio` | entero 2000–2100 | — | Año de `vigencia_desde` |
| `page`, `limit` | entero | `1`, `25` | `limit` hasta 100 |

**Respuesta 200**: `{ success, data: [<extracto>], total, page, limit, conteos: { todos, vigentes, por_vencer, vencidos, anulados } }`,
por consecutivo descendente. Los conteos aplican los mismos filtros salvo el de
estado; `por_vencer` es un subconjunto de `vigentes`.

### `GET /api/extractos/anios` · `GET /api/extractos/opciones`

`anios`: `{ success, data: [2026, 2025] }`.

`opciones` devuelve en una llamada: `empresa` (las constantes de
`fuec.config.ts`, sin la lista de afiliación propia), `hoy`, `siguiente_consecutivo`, `anio`,
`vigencia_defecto` (`{ desde: hoy, hasta: hoy + 30 días }`), `contratantes`,
`catalogos` (`{ OBJETO, CONVENIO, ORIGEN_DESTINO }`), `vehiculos` y
`conductores` no eliminados ni ocultos (los conductores con cédula y vigencia
de licencia).

### `GET /api/extractos/contratantes` · `POST` · `PUT /:id` · `DELETE /:id`

`GET` acepta `q` (nombre o NIT que contiene, o número de contrato exacto) y
devuelve hasta 500, los más usados primero:

```json
{ "id": "uuid", "nombre": "…", "nit": "…", "numero_contrato": "24", "cliente_id": null,
  "responsable": { "nombre": "…", "cedula": "…", "telefono": "…", "direccion": "…" },
  "usos": 12, "ultimo_uso_at": "…" }
```

**Body** de alta y edición

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | string 2–255 | sí | Se colapsan los espacios |
| `nit` | string ≤ 50 | no | |
| `numero_contrato` | string ≤ 40 | no | |
| `cliente_id` | uuid | no | Cliente del sistema, si lo es |
| `responsable` | `{ nombre, cedula, telefono, direccion }` | no | |

`POST` responde **201** y **409** `{ code: 'DUPLICADO' }` si ya hay uno con el
mismo nombre normalizado (sin tildes, mayúsculas, espacios simples). `PUT` y
`DELETE` responden **404** si no existe o está retirado; `DELETE` responde
`{ success: true }`.

### `GET /api/extractos/catalogo` · `DELETE /api/extractos/catalogo/:id`

`GET` exige `tipo` = `OBJETO`, `CONVENIO` u `ORIGEN_DESTINO` (si no, **400**) y
devuelve hasta 300 `{ id, tipo, texto, usos }`, los más usados primero. `DELETE`
retira la entrada (**404** si no existe); vuelve sola la próxima vez que un
extracto use ese texto.

### `GET /api/extractos/:id`

El extracto. **404** `{ success: false, message: 'Extracto no encontrado', code: 'NO_ENCONTRADO' }`.

### `POST /api/extractos`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `contratante` | objeto | sí | Los campos del contratante (`nombre` obligatorio) más `id` opcional. Se toma por `id`, si no por nombre normalizado, si no se crea; siempre se le copian los datos digitados y suma un uso |
| `contrato_numero` | string ≤ 40 | no | Si falta, el `numero_contrato` del contratante; uno de los dos es obligatorio |
| `objeto_contrato` | string 3–2000 | sí | Suma un uso en el catálogo |
| `origen_destino` | string 3–500 | sí | Ídem |
| `convenio` | string ≤ 255 | no | `N/A` si es vacío o la propia empresa |
| `vigencia_desde`, `vigencia_hasta` | `AAAA-MM-DD` | sí | La final no puede ser anterior a la inicial |
| `vehiculo` | objeto | sí | `placa` (obligatoria, al menos 5 caracteres alfanuméricos tras normalizar), `id`, `modelo`, `marca`, `clase`, `numero_interno`, `tarjeta_operacion`. Lo que falte se toma de la ficha |
| `conductores` | arreglo de 1 a 3 | sí | `{ id?, nombre (≥ 3), cedula?, licencia_vigencia? }`. El nombre se imprime en mayúsculas; cédula y vigencia, si faltan, salen de la ficha |
| `reemplaza_a_id` | uuid | no | El extracto que este corrige; queda anulado con el motivo «Reemplazado por el No. …» |
| `actualizar_fichas` | boolean | no | `true` por defecto |

**Respuesta 201**: el extracto emitido.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | Lo que rechaza zod o las reglas de arriba (`code: 'VALIDACION'` en las de zod) |
| 404 | El extracto de `reemplaza_a_id` no existe |
| 409 | Ese extracto ya estaba anulado (`code: 'YA_ANULADO'`) |

### `POST /api/extractos/:id/anular`

**Body**: `motivo` (string, al menos 5 letras tras limpiar espacios; hasta 500).
Responde el extracto anulado. **400** sin motivo suficiente; **404** si no
existe; **409** `YA_ANULADO`.

### `GET /api/public/extractos/:codigo`

La página a la que lleva el QR. No necesita sesión.

```json
{ "success": true, "data": {
  "numero": "…", "consecutivo": 312, "estado": "VIGENTE", "firma_valida": true, "huella": "1A2B-3C4D-5E6F-7A8B",
  "emitido_at": "…", "empresa": { "razon_social": "SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.", "nit": "901.983.227" },
  "contratante": "…", "contrato_numero": "0024", "objeto_contrato": "…", "origen_destino": "…", "convenio": "N/A",
  "vigencia_desde": "2026-10-01", "vigencia_hasta": "2026-10-31",
  "vehiculo": { "placa": "…", "modelo": "…", "marca": "…", "clase": "…", "numero_interno": "…", "tarjeta_operacion": "…" },
  "conductores": [ { "nombre": "…", "cedula": "••••••1234", "licencia_vigencia": "…" } ],
  "anulado": null, "reemplazado_por": null } }
```

Las cédulas van enmascaradas (solo los cuatro últimos dígitos). `firma_valida`
recalcula el HMAC de la instantánea guardada. **404**
`{ success: false, message, code: 'NO_ENCONTRADO' }` si el código no tiene el
formato (8 a 24 de `A-Z`, `2-9`) o no existe; **429** al pasar el límite (ver
[autenticación](../autenticacion.md#límites-de-intentos)).

## Efectos

Emitir escribe en el extracto, el contratante, los catálogos y,
salvo `actualizar_fichas: false`, en las fichas del vehículo y los conductores;
con `reemplaza_a_id`, anula el reemplazado en la misma transacción. Después
crea los avisos a conductores y a Operaciones descritos arriba; un fallo de
notificaciones no revierte la emisión.

## Observaciones

- **La firma no cubre lo que se muestra.** `firma_valida` comprueba el HMAC de
  `snapshot_json`, pero la validación pública arma la respuesta con las
  columnas del extracto (`contratante_nombre`, vigencia, placa…). Un cambio
  directo en esas columnas deja `firma_valida: true` y muestra el dato
  cambiado (`extractos.service.ts`, `verificarPublico`).
- **Secreto de la firma.** `fuec-firma.ts` lee `FUEC_FIRMA_SECRET` y, si no
  está, usa `JWT_SECRET`; ninguna de las dos se declara para esto en
  `src/config/env.ts`. Rotar el secreto en uso deja todos los extractos ya
  emitidos con `firma_valida: false`.
- `PUT /contratantes/:id` no comprueba si el nombre nuevo choca con otro
  contratante (el alta sí).
- `GET /contratantes` y `GET /catalogo` cortan en 500 y 300 filas sin
  paginación.
