# Incidentes

`/api/incidentes` · código en [`src/modules/incidentes/`](../../src/modules/incidentes/) · permiso [`incidentes`](../permisos.md#catálogo-de-módulos)

Accidentes de tránsito, incidentes y casi-accidentes, con su investigación según
la Res. 1401 de 2007 y su registro para el PESV (Res. 40595 de 2022). Reutiliza
la tabla `pesv_incident` (el radicado `INC-0007` sale de `consecutivo`, una
secuencia propia), con las evidencias en `incidente_evidencias` (archivos en
S3) y las acciones correctivas vinculadas en `incidente_acciones`. Las reglas
puras (transiciones, plazo, coherencia, qué falta para cerrar) están en
[`incidentes.dominio.ts`](../../src/modules/incidentes/incidentes.dominio.ts),
sin base de datos, para poder probarlas solas.

Reglas que un integrador necesita saber:

- **Estados**: `REPORTADO` → `EN_INVESTIGACION` → `CERRADO`, y `CERRADO` →
  `EN_INVESTIGACION` para reabrir. No hay atajo de reportado a cerrado: la
  Res. 1401 obliga a investigar también los incidentes.
- **Qué se escribe en cada estado**: el reporte y las evidencias, mientras no
  esté `CERRADO`; la investigación y las acciones, solo en `EN_INVESTIGACION`.
- **Plazo**: 15 días calendario desde el evento para investigar. Cada fila trae
  `plazo: { limite, dias_restantes, vencido }` (`dias_restantes` es nulo si
  está cerrado). «Hoy» es el día de Bogotá.
- **Coherencia del reporte**: se rechaza, no se corrige, porque cambiar el tipo
  cambia a quién se avisa y lo que cuentan los indicadores. Fecha no futura; un
  accidente de tránsito necesita gravedad; un casi-accidente no tiene gravedad
  ni lesionados; un incidente no tiene lesionados ni fallecidos; una gravedad
  con lesión pide `heridos ≥ 1`, `FATALIDAD` pide `fallecidos ≥ 1` y
  `SOLO_DANOS` no admite víctimas.
- **Para cerrar** (lo mínimo de la Res. 1401): fecha de investigación no
  anterior al evento; al menos una persona en el equipo investigador; causas
  inmediatas (actos o condiciones inseguras); causas básicas (factores
  personales o del trabajo); causa raíz (`causas_identificadas`); fecha de
  cierre no anterior al evento ni a la investigación y no futura; responsable
  del cierre. Las lecciones aprendidas y las acciones no bloquean.
- **Borrado lógico** del reporte y de las evidencias; el objeto de S3 se queda,
  porque es la evidencia de un accidente.
- Los formularios mandan `''` cuando un campo no se tocó: el esquema lo
  convierte en `null` (y en `0` para `heridos` y `fallecidos`).

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin). Un hook `preValidation` responde 400 `Identificador inválido` si `:id`, `:evId` o `:accionId` no son uuid |
| Lecturas | `incidentes:read`: Administración y HSEQ (con `full`), Operaciones, Mantenimiento y Talento Humano |
| Escrituras | `incidentes:full`: Administración y HSEQ |
| `GET /:id/acciones/buscar` | `incidentes:full`, aunque es lectura: sirve al flujo de vincular |
| `POST /:id/acciones` | `incidentes:full` **y** `acciones-correctivas:full`: la acción nace en ese módulo y no debe crearla por aquí quien no podría crearla por el suyo |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/incidentes` | `incidentes:read` | Lista paginada con filtros y resumen por estado |
| GET | `/api/incidentes/indicadores` | `incidentes:read` | Indicadores de siniestralidad |
| GET | `/api/incidentes/opciones` | `incidentes:read` | Vehículos y conductores para el formulario |
| GET | `/api/incidentes/servicios-candidatos` | `incidentes:read` | Servicios del vehículo o conductor alrededor de una fecha |
| GET | `/api/incidentes/:id` | `incidentes:read` | Detalle con investigación, cierre, evidencias y acciones |
| POST | `/api/incidentes` | `incidentes:full` | Registra un reporte y avisa |
| PUT | `/api/incidentes/:id` | `incidentes:full` | Corrige el reporte |
| PUT | `/api/incidentes/:id/investigacion` | `incidentes:full` | Guarda la investigación |
| POST | `/api/incidentes/:id/estado` | `incidentes:full` | Inicia la investigación, cierra o reabre |
| DELETE | `/api/incidentes/:id` | `incidentes:full` | Borrado lógico del reporte |
| POST | `/api/incidentes/:id/evidencias` | `incidentes:full` | Sube una evidencia a S3 |
| GET | `/api/incidentes/:id/evidencias/:evId/url` | `incidentes:read` | URL firmada de una evidencia |
| DELETE | `/api/incidentes/:id/evidencias/:evId` | `incidentes:full` | Borrado lógico de una evidencia |
| GET | `/api/incidentes/:id/acciones/buscar` | `incidentes:full` | Acciones correctivas que se pueden vincular |
| POST | `/api/incidentes/:id/acciones` | `incidentes:full` y `acciones-correctivas:full` | Crea una acción correctiva y la vincula |
| POST | `/api/incidentes/:id/acciones/vincular` | `incidentes:full` | Vincula una acción existente |
| DELETE | `/api/incidentes/:id/acciones/:accionId` | `incidentes:full` | Quita el vínculo con una acción |

### Errores

Salvo las comprobaciones que algunas rutas hacen a mano (uuid, fecha, tipo y
tamaño de archivo: 400 o 413 con `{ success: false, message }`), los errores
salen por la misma función, `responderError`:

| Código | Cuándo | Cuerpo |
|---|---|---|
| 422 | El body o la query no pasan zod | `{ success: false, message: <primer error>, details: ["campo: mensaje", …] }` |
| 400, 404, 409, 422 | Regla de negocio (`IncidenteError`) | `{ success: false, message, code, details? }` |
| 500 | Cualquier otro fallo | `{ success: false, message: "No fue posible …" }` |

| `code` | HTTP | Cuándo |
|---|---|---|
| `INCIDENTE_NO_ENCONTRADO` | 404 | No existe o está eliminado |
| `SERVICIO_INVALIDO`, `VEHICULO_INVALIDO`, `CONDUCTOR_INVALIDO`, `MUNICIPIO_INVALIDO` | 400 | La referencia no existe (o está eliminada) |
| `REPORTE_INCOHERENTE` | 422 | Falla la coherencia del reporte; `details` trae todas las reglas incumplidas |
| `INCIDENTE_CERRADO` | 409 | Editar el reporte o las evidencias de un incidente cerrado |
| `INVESTIGACION_NO_ABIERTA` | 409 | Investigación o acciones fuera de `EN_INVESTIGACION` |
| `FECHA_INVALIDA` | 422 | Investigación anterior al evento o con fecha futura |
| `TRANSICION_INVALIDA` | 409 | Transición no permitida, u otra persona cambió el estado antes |
| `INVESTIGACION_INCOMPLETA` | 422 | Falta algo para cerrar; `details` trae la lista |
| `EVIDENCIA_NO_ENCONTRADA` | 404 | |
| `NUMERO_OCUPADO` | 409 | El `accion_numero` pedido ya existe |
| `ACCION_NO_ENCONTRADA` | 404 | La acción a vincular no existe o está en la papelera |

### `GET /api/incidentes`

**Query** (zod `listarSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `q` | string ≤ 120 | — | Radicado (`INC-0007`, `inc 7` o `7`), lugar, descripción, número de informe, placa (sin espacios ni guiones), conductor (nombre, apellido o documento) o municipio |
| `tipo` | `ACCIDENTE_TRANSITO` \| `INCIDENTE` \| `CASI_ACCIDENTE` | — | |
| `estado` | `REPORTADO` \| `EN_INVESTIGACION` \| `CERRADO` | — | Se ignora con `plazo` |
| `severidad` | `SOLO_DANOS` \| `LESION_LEVE` \| `LESION_GRAVE` \| `FATALIDAD` | — | |
| `plazo` | `vencido` | — | Sin cerrar y con el plazo de 15 días ya vencido |
| `desde`, `hasta` | `YYYY-MM-DD` | — | Fecha del evento, ambas inclusive |
| `page` | entero ≥ 1 | `1` | |
| `limit` | entero 1–100 | `20` | |

**Respuesta 200** — sin envoltorio `data`; ordenada por fecha y consecutivo,
de la más reciente a la más antigua:

```json
{ "success": true,
  "items": [ { "id": "uuid", "codigo": "INC-0007", "consecutivo": 7, "tipo": "ACCIDENTE_TRANSITO", "estado": "REPORTADO",
               "fecha": "2026-10-01", "hora": "14:30", "lugar": "…", "severidad": "SOLO_DANOS", "heridos": 0, "fallecidos": 0,
               "numero_informe": null, "vehiculo": { "id": "uuid", "placa": "…", "marca": "…", "linea": "…" },
               "conductor": { "id": "uuid", "nombre": "…", "documento": "…" },
               "municipio": { "id": "uuid", "nombre": "…", "departamento": "…" },
               "evidencias": 2, "acciones": 1, "plazo": { "limite": "2026-10-16", "dias_restantes": 5, "vencido": false },
               "created_at": "…" } ],
  "pagination": { "page": 1, "limit": 20, "total": 31, "pages": 2 },
  "resumen": { "total": 40, "REPORTADO": 5, "EN_INVESTIGACION": 3, "CERRADO": 32, "vencidos": 2 } }
```

`evidencias` y `acciones` son conteos (sin borradas). `resumen` cuenta todo lo
vigente, no lo filtrado: son las pastillas de la cabecera.

### `GET /api/incidentes/:id`

`{ success, data: <detalle> }`. El detalle trae lo del listado más `trayecto`,
`tipo_evento`, `descripcion`, `terceros`, `autoridad`, `costo_directo`,
`costo_indirecto`, `servicio` (`{ id, ruta, fecha, estado, cliente }`),
`cliente`, `registrado_por`, `investigacion` (`realizada`, `iniciada_at` y los
campos de la investigación), `cierre` (`fecha_cierre`, `responsable_cierre`,
`observaciones_cierre`, `cerrado_por`), `acciones_vinculadas`
(`{ id, numero, descripcion, tipo, estado, aprobacion, creada_desde_incidente, vinculada_at }`)
y `updated_at`. Aquí `evidencias` es el arreglo
(`{ id, nombre, mimetype, tamano, descripcion, subido_por, created_at }`) y
`acciones` sigue siendo el conteo.

### `POST /api/incidentes` y `PUT /api/incidentes/:id`

**Body** (zod `crearIncidenteSchema`; editar manda el formulario entero, no un
parche, para que la coherencia se valide sobre el conjunto)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tipo` | `ACCIDENTE_TRANSITO` \| `INCIDENTE` \| `CASI_ACCIDENTE` | sí | |
| `fecha` | `YYYY-MM-DD` | sí | No futura |
| `hora` | `HH:MM` | no | |
| `lugar` | string 3–255 | sí | |
| `municipio_id`, `vehiculo_id`, `conductor_id`, `servicio_id` | uuid | no | Se comprueba que existan (y no estén eliminados). Con `servicio_id`, de él salen el cliente y, si faltan, el vehículo y el conductor |
| `trayecto` | `LABORAL` \| `IN_ITINERE` \| `MISION` \| `PARTICULAR` | no | `LABORAL` por defecto |
| `tipo_evento` | string ≤ 60 | no | `CHOQUE`, `VOLCAMIENTO`, `ATROPELLO`… (texto) |
| `descripcion` | string 10–5000 | sí | |
| `severidad` | `SOLO_DANOS` \| `LESION_LEVE` \| `LESION_GRAVE` \| `FATALIDAD` | según el tipo | En un casi-accidente se guarda `null` |
| `heridos`, `fallecidos` | entero 0–500 | no | Vacío → 0 |
| `terceros` | `[{ nombre, documento?, placa?, telefono?, aseguradora?, lesionado? }]` | no | Máximo 20; `terceros_involucrados` guarda cuántos |
| `autoridad` | string ≤ 120 | no | Quién atendió |
| `numero_informe` | string ≤ 60 | no | IPAT u otro informe |
| `costo_directo`, `costo_indirecto` | number ≥ 0 | no | |

`registrado_por` sale del token (solo al crear). `PUT` responde 409
`INCIDENTE_CERRADO` si está cerrado, y 422 `REPORTE_INCOHERENTE` si la fecha
nueva queda después de una investigación ya fechada.

**Respuesta** — 201 al crear y 200 al editar, con el detalle.

### `PUT /api/incidentes/:id/investigacion`

**Body** (zod `investigacionSchema`). Reemplaza la investigación entera: lo que
no llega queda vacío.

| Campo | Tipo | Notas |
|---|---|---|
| `fecha_investigacion` | `YYYY-MM-DD` | No anterior al evento ni futura (422 `FECHA_INVALIDA`) |
| `equipo_investigador` | `[{ nombre, cargo? }]` | Máximo 12; los que no tienen nombre se descartan |
| `actos_inseguros`, `condiciones_inseguras` | string ≤ 5000 | Causas inmediatas |
| `factores_personales`, `factores_trabajo` | string ≤ 5000 | Causas básicas |
| `analisis_porques` | string[] | Máximo 7, de hasta 1000 caracteres; los vacíos se descartan |
| `causas_identificadas` | string ≤ 3000 | Causa raíz |
| `lecciones_aprendidas` | string ≤ 5000 | |

409 `INVESTIGACION_NO_ABIERTA` fuera de `EN_INVESTIGACION`. Responde el detalle.

### `POST /api/incidentes/:id/estado`

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `accion` | `iniciar_investigacion` \| `cerrar` \| `reabrir` | sí | |
| `fecha_cierre` | `YYYY-MM-DD` | para cerrar | |
| `responsable_cierre` | string ≤ 255 | para cerrar | |
| `observaciones_cierre` | string ≤ 3000 | no | |

- `iniciar_investigacion`: pone `investigacion_iniciada_at` = ahora y, si no
  tenía, `fecha_investigacion` = hoy.
- `cerrar`: comprueba los mínimos (422 `INVESTIGACION_INCOMPLETA` con la lista
  en `details`), marca `investigacion_realizada` y guarda el cierre con
  `cerrado_por` = usuario del token.
- `reabrir`: borra los datos del cierre, para que no se lea como cerrado.

La escritura se condiciona al estado de origen: si dos personas pulsan a la
vez, la segunda recibe 409 `TRANSICION_INVALIDA`. Responde el detalle.

### `DELETE /api/incidentes/:id`

Borrado lógico; las evidencias y los vínculos se quedan. Responde
`{ success: true }`; 404 si no existe o ya estaba eliminado.

### `POST /api/incidentes/:id/evidencias`

`multipart/form-data` con un archivo (cualquier nombre de campo) y, opcional,
un campo `descripcion` (se recorta a 500 caracteres); el código pide mandar la
descripción antes del archivo. Se sube a S3 como
`incidentes/<id>/evidencias/<evId><extensión>`.

**Respuesta 201** — `{ "success": true, "data": { "id": "uuid" } }`.

**Errores**: 400 si el tipo no es PDF, PNG, JPG/JPEG o WEBP (según el
`mimetype` declarado) o si falta el archivo; 413 si pasa de 25 MB; 409
`INCIDENTE_CERRADO`; 404 si el incidente no existe.

### `GET /api/incidentes/:id/evidencias/:evId/url` y `DELETE /api/incidentes/:id/evidencias/:evId`

`GET` responde `{ success, data: { url } }` con una URL firmada de S3 válida 15
minutos; 404 `EVIDENCIA_NO_ENCONTRADA` si la evidencia o el incidente están
eliminados. `DELETE` marca la evidencia (el objeto de S3 se queda) y responde
`{ success: true }`; 409 si el incidente está cerrado, 404 si no existe.

### `GET /api/incidentes/:id/acciones/buscar`

Query `q` (se recorta a 120 caracteres). Hasta 10 acciones vigentes que aún no
están vinculadas a este incidente, por número o descripción, de la más nueva a
la más vieja: `{ success, data: [{ id, numero, descripcion, estado, fuente }] }`.

### `POST /api/incidentes/:id/acciones`

Crea la acción en el módulo de [acciones correctivas](./acciones-correctivas.md)
con `AccionesCorrectivasService.crear`, para que siga el mismo flujo de
aprobación y seguimiento que cualquier otra, y la vincula
(`creada_desde_incidente: true`).

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `descripcion_hallazgo` | string 10–5000 | sí | |
| `tipo_accion_ejecutar` | `CORRECTIVA` \| `PREVENTIVA` \| `MEJORA` | no | `CORRECTIVA` por defecto |
| `accion_numero` | string ≤ 50 | no | Sin él, `AC-<año>-<nnn>` (el primer número libre); ocupado → 409 `NUMERO_OCUPADO` |
| `tipo_hallazgo_detectado` | string ≤ 100 | no | Decide quién aprueba la acción |
| `valoracion_riesgo` | `ALTO` \| `MEDIO` \| `BAJO` | no | |
| `plan_accion` | string ≤ 3000 | no | Si llega, crea la causa 1 con este plan y, como análisis, la causa raíz de la investigación |
| `responsable_ejecucion` | string ≤ 255 | no | De esa causa |
| `fecha_limite_implementacion` | `YYYY-MM-DD` | no | De esa causa |

La acción nace con fuente «Investigación de Incidente/Accidente», proceso
«Gestión HSEQ», componente «Investigación INC-xxxx», el marco legal de las dos
resoluciones, el lugar del incidente y, como fecha del hallazgo, la de la
investigación (o hoy). Si el vínculo falla, la acción recién creada se manda a
la papelera. 409 `INVESTIGACION_NO_ABIERTA` fuera de investigación.

**Respuesta 201** — el detalle del incidente.

### `POST /api/incidentes/:id/acciones/vincular` y `DELETE /api/incidentes/:id/acciones/:accionId`

`vincular` recibe `{ "accion_id": "uuid" }` y es idempotente: vincular dos
veces no es error. 404 `ACCION_NO_ENCONTRADA` si la acción no existe o está en
la papelera. `DELETE` quita el vínculo (la acción no se toca) y no falla si no
estaba vinculada. Los dos responden 409 `INVESTIGACION_NO_ABIERTA` fuera de
investigación y devuelven el detalle.

### `GET /api/incidentes/opciones`

`{ success, data: { vehiculos: [{ id, placa, marca, linea }], conductores: [{ id, nombre, documento }] } }`,
solo vigentes. Es propio del módulo para no depender de los permisos de
servicios: HSEQ reporta accidentes aunque no despache servicios.

### `GET /api/incidentes/servicios-candidatos`

Query `fecha` (`YYYY-MM-DD`, obligatoria), `vehiculo_id` y `conductor_id`
(uuid). Hasta 20 servicios de ese vehículo o conductor entre el día anterior y
el siguiente (hora de Colombia): `[{ id, ruta, fecha, estado, cliente, placa }]`.
Sin vehículo ni conductor devuelve `[]`. 400 `Falta la fecha` o
`Identificador inválido`.

### `GET /api/incidentes/indicadores`

Query `meses` (3–36, por defecto 12).

```json
{ "success": true, "data": {
  "hoy": "2026-10-11", "desde": "2025-11-01", "meses": 12,
  "serie": [ { "mes": "2025-11", "ACCIDENTE_TRANSITO": 1, "INCIDENTE": 0, "CASI_ACCIDENTE": 2, "total": 3 } ],
  "dias_sin_accidentes": 40, "ultimo_accidente": "2026-09-01", "registro_desde": "2024-03-10",
  "totales": { "eventos": 20, "accidentes": 6, "incidentes": 8, "casi_accidentes": 6, "lesionados": 3, "fallecidos": 0, "costo_estimado": 12500000 },
  "por_gravedad": { "SOLO_DANOS": 5, "LESION_LEVE": 2, "LESION_GRAVE": 1, "FATALIDAD": 0, "SIN_LESION": 12 },
  "investigacion": { "abiertas": 3, "vencidas": 1, "cerradas": 15, "cerradas_a_tiempo": 12 },
  "por_100k_km": null, "motivo_sin_km": "…" } }
```

La serie incluye los meses sin eventos. La tasa por 100.000 km no se calcula a
propósito: el kilometraje de la flota todavía no es confiable, y se devuelve
`null` con el motivo en vez de una cifra engañosa.

## Efectos

- **Aviso del reporte**: al crear, notificación `GENERAL`
  (`referencia_tipo: 'incidente'`) a los usuarios activos de HSEQ y
  Administración, y de Talento Humano si hubo lesionados o fallecidos, menos
  quien reportó. Sale por socket `nueva-notificacion` y Web Push
  (`emitNotificacion`). Si el aviso falla, el reporte queda igual. Ver
  [notificaciones](./notificaciones.md) y [tiempo real](../tiempo-real.md).
- **Recordatorio de investigación** (cron `incidentes-investigacion`,
  [`src/jobs/incidentes-investigacion.cron.ts`](../../src/jobs/incidentes-investigacion.cron.ts)):
  todos los días a las 07:10 de America/Bogota busca los reportes sin cerrar con
  15 días o más desde el evento y avisa **una sola vez** a cada usuario de esas
  mismas áreas («Hoy vence la investigación» el día 15, «Investigación vencida»
  después). La huella es `referencia_tipo: 'incidente_investigacion_pendiente'`:
  correrlo dos veces no duplica, y si un día no corre el aviso sale al
  siguiente. Ver [tareas programadas](../tareas-programadas.md).
- **S3**: las evidencias, bajo `incidentes/<id>/evidencias/`.
- **Acciones correctivas**: `POST /:id/acciones` crea una acción en ese módulo.
- **Registro de actividad**: cada escritura con éxito deja fila en
  `registro_actividad` (ver [actividad](./actividad.md)).

## Observaciones

- El tipo de una evidencia se valida con el `mimetype` que declara el cliente,
  no con el contenido del archivo (`incidentes.routes.ts`).
- Un archivo que supera el tope global de multipart (200 MB) hace fallar
  `toBuffer()` con un error que no es `IncidenteError`: sale 500 en vez de 413.
- Dos `POST /:id/acciones` simultáneos sin número pueden calcular el mismo
  `AC-<año>-<nnn>`; el segundo falla con 500 (`siguienteNumeroAccion` cuenta y
  luego comprueba, sin bloqueo).
