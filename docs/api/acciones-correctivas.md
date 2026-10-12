# Acciones correctivas y preventivas

`/api/acciones-correctivas` · código en [`src/modules/acciones-correctivas/`](../../src/modules/acciones-correctivas/) · permiso [`acciones-correctivas`](../permisos.md#catálogo-de-módulos) para escribir

Registro de hallazgos de HSEQ y de las acciones correctivas, preventivas o de
mejora que los tratan. La entidad es `acciones_correctivas_preventivas`,
identificada para las personas por `accion_numero` (único, texto libre:
`AC-2026-007`, `12`…). De ella cuelgan:

- `causas_accion_correctiva`: los «por qué» del análisis, cada uno con su plan
  de acción, responsable, fecha límite, seguimiento y cierre propio. `orden` es
  único dentro de la acción.
- `seguimientos_causa`: la trazabilidad de cada causa, una fila por seguimiento.
- `seguimientos_correccion_inmediata`, `ciclos_seguimiento_eficacia`,
  `evidencias_eficacia_cierre` y el JSON `evaluaciones_eficacia`.
- `aprobaciones_accion`: **una** aprobación vigente por acción.

Reglas que un integrador necesita saber:

- **Papelera**: `DELETE /:id` marca `deleted_at`; la acción vuelve con
  `restaurar` o desaparece con `DELETE /:id/permanente`, que exige que ya esté
  en la papelera y borra en cascada todo lo que cuelga de ella (incluidos sus
  vínculos con [incidentes](./incidentes.md)). `GET /:id` de una acción en la
  papelera responde 404 y `PUT /:id` responde 400.
- **Aprobación del plan (paso 4)**: no hay paso de «inicializar». Aprueba o
  rechaza el usuario del token, y el servidor comprueba que su `cargo` (texto
  libre de `usuarios`) corresponda al rol que pide el tipo de hallazgo:
  `NC_MAYOR` → `Gerencia`; `NC_MENOR`, `OBSERVACION` y `MEJORA` →
  `CoordinadorHSEQ`. El tipo sale de `hallazgo_tipo` (enum) o, si está vacío,
  de la etiqueta heredada `tipo_hallazgo_detectado` normalizada («NC Mayor»,
  «No conformidad menor», «Oportunidad de Mejora»…). Una acción aprobada no se
  vuelve a aprobar ni se rechaza; `reset` archiva la aprobación (no la borra:
  es la constancia de una decisión) y deja `estado_aprobacion = PENDIENTE`.
- **Estado global (paso 5)**: `EN_PROCESO`, `VENCIDA`, `CUMPLIDA` o
  `REPLANTEADA`. `calcular-estado` lo deduce de las causas; `estado-global` lo
  fija a mano.
- **Revisión cada 15 días**: el listado calcula en el servidor la «próxima
  revisión» de cada acción (última actividad + 15 días, con «hoy» en Bogotá).
  La regla de `acciones-correctivas.revision.ts` es copia exacta de la que usa
  el detalle en el frontend (`dashboard-utils.ts`): si cambia en un lado, hay
  que cambiarla en el otro.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | sin permiso de módulo: basta la sesión |
| `POST`, `PUT`, `DELETE` | `acciones-correctivas:full` (constante `puedeEscribir` en cada ruta): Administración y HSEQ. Incluye las dos rutas de IA, que son `POST` |
| `aprobaciones/aprobar` y `aprobaciones/rechazar` | además, usuario activo y `cargo` que corresponda al rol esperado (400 si no; lo comprueba el servicio) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/acciones-correctivas` | sesión | Lista paginada con filtros y el resumen del tablero |
| POST | `/api/acciones-correctivas` | `acciones-correctivas:full` | Crea una acción, con sus causas y seguimientos si vienen |
| GET | `/api/acciones-correctivas/estadisticas` | sesión | Conteos globales por tipo, riesgo y estado |
| GET | `/api/acciones-correctivas/numero/:accion_numero` | sesión | Acción completa por número |
| GET | `/api/acciones-correctivas/:id` | sesión | Acción completa por id |
| PUT | `/api/acciones-correctivas/:id` | `acciones-correctivas:full` | Edita la acción; las listas que lleguen se reemplazan |
| DELETE | `/api/acciones-correctivas/:id` | `acciones-correctivas:full` | Mueve a la papelera |
| POST | `/api/acciones-correctivas/:id/restaurar` | `acciones-correctivas:full` | Saca de la papelera |
| DELETE | `/api/acciones-correctivas/:id/permanente` | `acciones-correctivas:full` | Borra en duro una acción de la papelera |
| POST | `/api/acciones-correctivas/:id/duplicar` | `acciones-correctivas:full` | Copia independiente con número nuevo |
| POST | `/api/acciones-correctivas/upload` | `acciones-correctivas:full` | Sube un adjunto a S3 |
| POST | `/api/acciones-correctivas/:id/causas` | `acciones-correctivas:full` | Añade una causa |
| PUT | `/api/acciones-correctivas/:id/causas/:causaId` | `acciones-correctivas:full` | Edita una causa |
| GET | `/api/acciones-correctivas/:id/causas/:causaId/seguimientos` | sesión | Trazabilidad de una causa |
| POST | `/api/acciones-correctivas/:id/causas/:causaId/seguimientos` | `acciones-correctivas:full` | Registra un seguimiento y actualiza la causa |
| POST | `/api/acciones-correctivas/causas/:causa_id/cierre` | `acciones-correctivas:full` | Cierra una causa cumplida tras evaluar su eficacia |
| GET | `/api/acciones-correctivas/:id/validar-cierre` | sesión | Dice si todas las causas están cerradas con eficacia |
| GET | `/api/acciones-correctivas/:id/aprobaciones` | sesión | Aprobación vigente y rol que debe aprobar |
| POST | `/api/acciones-correctivas/:id/aprobaciones/aprobar` | `acciones-correctivas:full` + cargo | Aprueba el plan de acción |
| POST | `/api/acciones-correctivas/:id/aprobaciones/rechazar` | `acciones-correctivas:full` + cargo | Rechaza el plan de acción |
| POST | `/api/acciones-correctivas/:id/aprobaciones/reset` | `acciones-correctivas:full` | Archiva la aprobación y vuelve a `PENDIENTE` |
| POST | `/api/acciones-correctivas/:id/calcular-estado` | `acciones-correctivas:full` | Recalcula el estado global desde las causas |
| POST | `/api/acciones-correctivas/:id/estado-global` | `acciones-correctivas:full` | Fija el estado global a mano |
| POST | `/api/acciones-correctivas/sugerencias-ia` | `acciones-correctivas:full` | Sugerencias de IA para el plan de una causa |
| POST | `/api/acciones-correctivas/causas/:causa_id/sugerencias-seguimiento` | `acciones-correctivas:full` | Sugerencias de IA para el seguimiento |
| GET | `/api/acciones-correctivas/:id/exportar-pdf` | sesión | PDF de la acción |

Todas las rutas declaran esquema JSON de Fastify: un `:id`, `:causaId` o
`:causa_id` que no sea uuid, un enum fuera de lista o una fecha `format: date`
mal escrita se rechazan con 400 en el formato de Fastify
(`{ statusCode, error, message }`). Los errores del controlador tienen la forma
`{ "success": false, "message": "…" }`.

### `GET /api/acciones-correctivas`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | entero ≥ 1 | `1` | |
| `limit` | entero 1–100 | `20` | |
| `estado_global` | `EN_PROCESO` \| `VENCIDA` \| `CUMPLIDA` \| `REPLANTEADA` | — | Faceta: `resumen.por_estado` se cuenta sin ella |
| `revision` | `vencidas` \| `proximas` | — | Panel de revisión, calculado por fila. `vencidas` incluye las que tocan hoy; `proximas`, las lejanas y las que nunca tuvieron actividad; las cerradas no caen en ninguno |
| `tipo_accion_ejecutar` | string | — | Igualdad exacta (`CORRECTIVA`, `PREVENTIVA`, `MEJORA`) |
| `estado_seguimiento` | string | — | Acciones con alguna causa en ese estado (`En Proceso`, `Cumplida`, `Vencida`…). No está en el esquema de la ruta, pero pasa |
| `valoracion_riesgo` | string | — | Igualdad exacta |
| `fecha_desde`, `fecha_hasta` | `YYYY-MM-DD` | — | Sobre `fecha_identificacion_hallazgo`, ambos inclusive |
| `busqueda` | string | — | Contiene, sin distinguir mayúsculas: número, descripción, sede o responsable de la acción o de alguna causa |
| `ultimos_90_dias` | boolean | — | Solo las creadas en los últimos 90 días |
| `incluir_eliminados` | boolean | — | Con `true` devuelve **solo** la papelera |
| `sortBy` | string | `created_at` | Lista blanca: `accion_numero`, `descripcion_hallazgo`, `tipo_accion_ejecutar`, `estado_accion`, `estado_global`, `valoracion_riesgo`, `responsable_ejecucion`, `fecha_limite_cierre_accion`, `fecha_identificacion_hallazgo`, `created_at`. Otro valor cae a `created_at`; el `id` desempata |
| `sortOrder` | `asc` \| `desc` | `desc` | |

`estado_accion_planeada` está declarado en el esquema de la ruta, pero el
servicio no lo lee.

**Respuesta 200**

```json
{ "success": true, "data": {
  "acciones": [ { "id": "uuid", "accion_numero": "AC-2026-007", "estado_global": "EN_PROCESO", "…": "…",
                  "causas": [ { "id": "uuid", "orden": 1, "analisis_causa": "…", "estado_seguimiento": "En Proceso", "…": "…" } ],
                  "seguimientos_correccion": [ "…los 3 más recientes" ],
                  "usuarios": { "id": "uuid", "nombre": "…", "correo": "…" },
                  "registrado_por": null } ],
  "total": 57, "page": 1, "limit": 24, "totalPages": 3,
  "resumen": {
    "total_estados": 57,
    "por_estado": { "EN_PROCESO": 40, "VENCIDA": 5, "CUMPLIDA": 10, "REPLANTEADA": 2 },
    "proximas_vencer": 3,
    "revisiones": {
      "vencidas": [ { "id": "uuid", "accion_numero": "…", "responsable_ejecucion": "…",
                      "ultimaFecha": "2026-09-20", "proximaFecha": "2026-10-05", "diasHasta": -6, "estado": "vencida" } ],
      "proximas": [ "…" ] },
    "causas": { "total": 80, "en_proceso": 50, "vencida": 10, "cumplida": 20 },
    "por_tipo": { "CORRECTIVA": 30, "Sin tipo": 2 } } } }
```

`resumen` se calcula sobre todo el filtro, no sobre la página. Cada faceta se
cuenta sin su propio filtro: `total_estados` y `por_estado` ignoran
`estado_global`; `revisiones` ignora `revision` (vencidas de la más atrasada a
la menos, próximas de la más cercana a la más lejana). El resto es del
resultado; `proximas_vencer` cuenta las acciones cuya
`fecha_limite_cierre_accion` cae en los próximos 7 días.

**Errores**: 500 si falla la consulta.

### `POST /api/acciones-correctivas`

**Body**. El esquema de la ruta lleva `additionalProperties: true`, pero lo
que se escribe lo decide la lista blanca `CAMPOS_EDITABLES_ACCION` de
[`acciones-correctivas.campos.ts`](../../src/modules/acciones-correctivas/acciones-correctivas.campos.ts)
(las columnas que edita el formulario) más las cuatro listas anidadas; todo
lo demás se **descarta en silencio**. En particular no se escriben por aquí
`estado_aprobacion` (es de `aprobaciones/*`), `estado_global`,
`fecha_actualizacion_estado`, `observaciones` y `registrado_por_id` (de
`estado-global`/`calcular-estado`), `hallazgo_tipo` (decide quién aprueba),
`creado_por_id` (del token), `deleted_at` (papelera) ni los `pesv_*`. Tipos
completos en `CreateAccionCorrectivaInput` de
[`acciones-correctivas.service.ts`](../../src/modules/acciones-correctivas/acciones-correctivas.service.ts).

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `accion_numero` | string | sí | Único; repetido → 400 |
| `tipo_hallazgo_detectado` | string | no | Etiqueta legible («NC Mayor», «NC Menor», «Observación», «Oportunidad de Mejora»; acepta valores históricos). Decide quién aprueba si `hallazgo_tipo` está vacío |
| `tipo_accion_ejecutar` | `CORRECTIVA` \| `PREVENTIVA` \| `MEJORA` | no | |
| `valoracion_riesgo` | `ALTO` \| `MEDIO` \| `BAJO` | no | |
| `evaluacion_cierre_eficaz` | `EFICAZ` \| `NO EFICAZ` \| `PARCIAL` | no | |
| `fecha_identificacion_hallazgo`, `fecha_implementacion`, `fecha_limite_evaluacion_eficacia`, `fecha_cierre_definitivo`, `fecha_reapertura` | `YYYY-MM-DD` | no | |
| `requiere_actualizar_matriz`, `aplica_correccion_inmediata`, `aplica_reapertura` | boolean o `'true'`/`'false'` | no | El texto se convierte |
| Textos del hallazgo, la corrección y el cierre | string | no | `lugar_sede`, `proceso_origen_hallazgo`, `fuente_genero_hallazgo`, `descripcion_hallazgo`, `responsable_correccion`, `responsable_cierre`… (lista completa en `CAMPOS_EDITABLES_ACCION`) |
| `accion_origen_reapertura` | string | no | Número de la acción reabierta; lo pone la reapertura |
| `causas` | arreglo | no | `orden`, `analisis_causa`, `es_causa_raiz`, `descripcion_plan_accion`, `responsable_ejecucion`, `fecha_limite_implementacion`, `estado_seguimiento` y `seguimientos[]`. El último seguimiento con fecha fija la fecha, las observaciones y el estado de la causa |
| `seguimientos_correccion` | arreglo | no | Las filas sin `fecha_seguimiento` se descartan |
| `ciclos_eficacia` | arreglo | no | Ídem |
| `evidencias_eficacia` | arreglo | no | |
| `evaluaciones_eficacia` | JSON | no | Se guarda tal cual |
| `created_at` | fecha | no | Fija la fecha de creación; por defecto, ahora |

`creado_por_id` sale siempre del token (uno en el body se pisa). El
formulario manda además `replanteo_correccion`, que no es columna: se descarta
(antes hacía fallar el alta con el error de Prisma).

**Respuesta 201** — `{ "success": true, "message": "…", "data": <acción completa> }`.
La «acción completa» es la fila con `causas` (y sus `seguimientos`),
`seguimientos_correccion`, `ciclos_eficacia`, `evidencias_eficacia`,
`aprobaciones` (con `aprobador`), `usuarios` (quien la creó) y `registrado_por`.

**Errores**: 400 si el número ya existe (`Ya existe una acción con el número X`)
y ante cualquier otro fallo del servicio, incluidos los de Prisma.

### `PUT /api/acciones-correctivas/:id`

Mismo body que el alta, todo opcional, con la misma lista blanca: lo que no
está en `CAMPOS_EDITABLES_ACCION` (ni es una de las cuatro listas) se descarta.
El esquema solo declara tres campos, así que las fechas aquí no exigen
`YYYY-MM-DD` (basta que `new Date` las entienda).

- Cambiar `accion_numero` a uno de otra acción → 400.
- Una fecha vacía, nula o inválida se **descarta** antes de guardar: por esta
  ruta no se puede borrar una fecha ya puesta.
- `causas`, `seguimientos_correccion`, `ciclos_eficacia` y
  `evidencias_eficacia` **reemplazan la lista entera** cuando llegan (se borra
  todo y se crea de nuevo); si no llegan, no se tocan. Ver Observaciones.
- Acción inexistente o en la papelera → 400.

**Respuesta 200** — la acción completa.

### `GET /api/acciones-correctivas/:id` y `GET /api/acciones-correctivas/numero/:accion_numero`

`{ "success": true, "data": <acción completa> }`. 404 con
`Acción no encontrada`, o con `Acción eliminada. Restaúrela desde la papelera.`
en la búsqueda por id. La búsqueda por número sí devuelve acciones de la
papelera.

### `DELETE /api/acciones-correctivas/:id`, `POST /api/acciones-correctivas/:id/restaurar` y `DELETE /api/acciones-correctivas/:id/permanente`

- `DELETE /api/acciones-correctivas/:id`: marca `deleted_at`. 400 si no existe o ya estaba en la papelera.
  Responde `{ success, message }`.
- `restaurar`: quita la marca y el sufijo `_Eliminado` del número si lo tiene.
  400 si no estaba en la papelera. Devuelve la acción completa.
- `permanente`: borrado físico, solo de una acción ya en la papelera (400 si
  no). Arrastra en cascada causas, seguimientos, ciclos, evidencias,
  aprobaciones y vínculos con incidentes.

### `POST /api/acciones-correctivas/:id/duplicar`

Crea una copia independiente con número `<original>-<AAAA-MM-DD>` (fecha local
del servidor) más `_Eliminado` si la original está en la papelera; en ese caso
la copia también nace en la papelera, porque se copia `deleted_at`. Copia
causas con sus seguimientos, corrección, ciclos y evidencias; no copia la
aprobación, pero sí `estado_aprobacion` y `estado_global`. `creado_por_id` es
el usuario del token. Duplicar la misma acción dos veces el mismo día choca con
el número único → 400.

**Respuesta 201** — la acción nueva, completa.

### `POST /api/acciones-correctivas/upload`

`multipart/form-data`; se toma el primer archivo, con cualquier nombre de
campo. No hay filtro de tipo ni de tamaño propio (solo el tope global de
multipart, 200 MB). Se guarda en S3 como
`acciones-correctivas/adjuntos/<uuid>.<extensión>`.

**Respuesta 200**

```json
{ "success": true, "data": { "key": "acciones-correctivas/adjuntos/….pdf", "url": "https://…", "filename": "acta.pdf", "mimetype": "application/pdf" } }
```

`url` es una URL firmada de 7 días. Qué se guarda luego en los campos
`adjunto_url` lo decide el cliente.

**Errores**: 400 `{ "error": "No se envió ningún archivo" }` (otra forma que el
resto); 500 si falla S3.

### `GET /api/acciones-correctivas/estadisticas`

```json
{ "success": true, "data": {
  "total": 57,
  "por_tipo": { "CORRECTIVA": 30, "Sin tipo": 2 },
  "por_riesgo": { "ALTO": 5, "Sin valoración": 3 },
  "por_estado": { "En Proceso": 40, "Vencidas": 5, "Cumplidas": 10, "Replanteadas": 2 },
  "por_estado_causas": { "En Proceso": 50, "Cumplida": 20 },
  "proximas_vencer": 4,
  "causas_cerradas_eficazmente": 12,
  "causas_pendientes_cierre": 6 } }
```

`por_estado` agrupa `estado_global` con etiquetas legibles. `proximas_vencer`
cuenta causas no cumplidas con fecha límite en los próximos 30 días;
`causas_pendientes_cierre`, causas `Cumplida` sin `fecha_cierre` o sin
evaluación. Cuenta también las acciones de la papelera.

### `POST /api/acciones-correctivas/:id/causas`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `orden` | entero ≥ 1 | sí | Único dentro de la acción (repetido → 400) |
| `analisis_causa` | string no vacío | sí | El «por qué» |
| `descripcion_plan_accion` | string | no | |
| `responsable_ejecucion` | string | no | |
| `fecha_limite_implementacion` | `YYYY-MM-DD` | no | |
| `estado_seguimiento` | `En Proceso` \| `Cumplida` \| `Vencida` | no | `En Proceso` por defecto |

**Respuesta 201** — `{ success, message, data: <causa> }`. **Errores**: 404 si
la acción no existe; 400 en lo demás.

### `PUT /api/acciones-correctivas/:id/causas/:causaId`

Solo se aplican estos campos, y solo los que llegan: `analisis_causa`,
`descripcion_plan_accion`, `responsable_ejecucion`,
`fecha_limite_implementacion`, `estado_seguimiento` (`En Proceso`, `Cumplida`
o `Vencida`), `descripcion_observaciones`, `fecha_seguimiento`,
`fecha_evaluacion_eficacia`, `criterio_evaluacion_eficacia`,
`analisis_evidencias_cierre`, `evaluacion_cierre_eficaz`,
`soporte_cierre_eficaz`, `fecha_cierre`, `responsable_cierre` y `sugerencia_ia`
(JSON: donde el cliente guarda la sugerencia de la IA). Aquí una fecha vacía sí
borra la que había.

**Respuesta 200** — la causa. **Errores**: 404 si la causa no es de esa
acción; 400 en lo demás.

### `GET /api/acciones-correctivas/:id/causas/:causaId/seguimientos` y `POST` del mismo recurso

`GET` devuelve los seguimientos de la causa, del más reciente al más antiguo,
con `registrado_por` (`{ id, nombre, correo }`).

`POST` registra uno:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `fecha_seguimiento` | `YYYY-MM-DD` | sí | |
| `estado_accion` | `Cumplidas` \| `En Proceso` \| `Vencidas` \| `Replanteada` | sí | |
| `descripcion_observaciones` | string | no | |
| `evaluacion_eficaz` | `EFICAZ` \| `NO EFICAZ` | no | |
| `replanteo` | objeto | no | JSON libre |
| `responsable_seguimiento`, `cargo_responsable_seguimiento` | string | no | |

En una transacción crea la fila (`registrado_por_id` = usuario del token) y
actualiza la causa: `fecha_seguimiento`, `descripcion_observaciones` (se
reemplaza; queda nula si no llega) y `estado_seguimiento`, que pasa a
`Cumplida` con `Cumplidas`, a `Vencida` con `Vencidas` y a `En Proceso` en los
demás casos, `Replanteada` incluida.

**Respuesta 201** — el seguimiento. **Errores**: 404 si la causa no es de esa
acción; 400 en lo demás.

### `POST /api/acciones-correctivas/causas/:causa_id/cierre`

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `fecha_evaluacion_eficacia` | `YYYY-MM-DD` | sí | |
| `criterio_evaluacion_eficacia` | string | sí | |
| `analisis_evidencias_cierre` | string | sí | |
| `evaluacion_cierre_eficaz` | `EFICAZ` \| `NO EFICAZ` | sí | |
| `responsable_cierre` | string | sí | |
| `soporte_cierre_eficaz` | string | no | |

La causa tiene que estar en `Cumplida`. `fecha_cierre` la pone el servidor
(ahora). **Respuesta 200** — la causa cerrada. **Errores**: 400 si la causa no
existe o no está cumplida.

### `GET /api/acciones-correctivas/:id/validar-cierre`

```json
{ "success": true, "data": { "todas_cerradas": false, "causas_pendientes": 1,
  "detalle_pendientes": [ { "orden": 2, "analisis_causa": "…", "estado": "Sin evaluar" } ] } }
```

Una causa está pendiente si no tiene `fecha_cierre`, no tiene evaluación o la
evaluación es `NO EFICAZ`. No comprueba que la acción exista.

### `GET /api/acciones-correctivas/:id/aprobaciones`

```json
{ "success": true, "data": {
  "hallazgoTipo": { "hallazgo_tipo": "NC_MENOR", "tipo_hallazgo_detectado": "NC Menor", "estado_aprobacion": "PENDIENTE" },
  "rolEsperado": "CoordinadorHSEQ",
  "approval": null } }
```

`hallazgoTipo` trae esos tres campos de la acción, no solo el tipo. `approval`
es la aprobación vigente (`{ id, rol, estado, fecha, comentario, aprobador: { id, nombre, correo, cargo } }`)
o `null`. Con un id que no existe responde 200 con todo nulo.

### `POST /api/acciones-correctivas/:id/aprobaciones/aprobar` y `…/rechazar`

Body: `{ "comentario": "…" }`, opcional al aprobar y obligatorio (no vacío) al
rechazar. Crean o actualizan la aprobación vigente con `rol`, `estado`
(`APROBADO` o `RECHAZADO`), `aprobador_id` = usuario del token, `fecha` y
comentario, y copian el estado a `estado_aprobacion` de la acción. Una acción
rechazada se puede aprobar después.

El cargo se normaliza (sin tildes, minúsculas, sin signos) y vale si es igual a
alguna equivalencia **o la contiene**:

| Rol | Equivalencias |
|---|---|
| `Gerencia` | gerencia, gerente, gerente general, representante de la direccion, representante legal, direccion general, direccion, alta direccion |
| `CoordinadorHSEQ` | coordinador hseq, coordinadora hseq, coord hseq, hseq, coordinacion hseq, jefe hseq, lider hseq, responsable hseq |

**Respuesta 200** — la aprobación con `aprobador`.

**Errores** (todos 400, `{ success: false, message }`): acción no encontrada; tipo
de hallazgo sin aprobador definido; usuario inexistente o inactivo
(`Usuario no autorizado`); cargo que no corresponde
(`Su cargo "X" no corresponde al rol requerido "Gerencia".`); acción ya
aprobada; al rechazar, comentario vacío.

### `POST /api/acciones-correctivas/:id/aprobaciones/reset`

Marca `deleted_at` en la aprobación vigente (la unicidad por acción es parcial,
así que la archivada no estorba a la siguiente) y deja la acción en
`PENDIENTE`. Pensado para cuando cambia el tipo de hallazgo. Responde
`{ success, message }`; 400 si la acción no existe.

### `POST /api/acciones-correctivas/:id/calcular-estado`

Aplica estas reglas en orden y escribe `estado_global` y
`fecha_actualizacion_estado` solo si el estado cambia:

1. Alguna causa `Replanteada` → `REPLANTEADA`.
2. Alguna causa `Vencida` → `VENCIDA`.
3. Todas las causas (al menos una) cerradas con `EFICAZ` → `CUMPLIDA`.
4. `fecha_limite_cierre_accion` ya pasada → `VENCIDA`.
5. Si no, `EN_PROCESO`.

**Respuesta 200** — `{ success, message, data: { estado_anterior, estado_nuevo } }`.
400 si la acción no existe.

### `POST /api/acciones-correctivas/:id/estado-global`

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `estado_global` | `EN_PROCESO` \| `VENCIDA` \| `CUMPLIDA` \| `REPLANTEADA` | sí | |
| `observaciones` | string | no | Reemplaza `observaciones` de la acción |

Pone `fecha_actualizacion_estado` = hoy y `registrado_por_id` = usuario del
token (un `registrado_por_id` en el body se ignora). **Respuesta 200** — la
acción completa.
400 si no existe o está en la papelera.

### `POST /api/acciones-correctivas/sugerencias-ia`

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `analisis_causa` | string | sí | El «por qué» a resolver |
| `orden_causa` | entero | sí | 1.er, 2.º… por qué |
| `descripcion_hallazgo` | string | sí | Contexto |
| `tipo_accion` | `CORRECTIVA` \| `PREVENTIVA` \| `MEJORA` | sí | |
| `valoracion_riesgo` | `ALTO` \| `MEDIO` \| `BAJO` | sí | |
| `lugar_sede`, `proceso_origen` | string | no | |

**Respuesta 200** — `data` con `plan_accion_sugerido`,
`responsables_recomendados[]`, `plazo_recomendado_dias`,
`criterios_evaluacion[]`, `indicadores_seguimiento[]`,
`riesgos_implementacion[]`, `recursos_necesarios[]` y `mejores_practicas[]`. El
servidor valida esa forma (listas no vacías, plan de 50 caracteres o más, plazo
positivo) antes de devolverla. Nada se guarda.

**Errores**: 500 `{ success: false, message }` si la IA no responde, responde
con error o devuelve algo que no cumple la forma, y también si faltan
`MINISTRAL_API_KEY` o `MINISTRAL_ENDPOINT` (el mensaje lo dice).

### `POST /api/acciones-correctivas/causas/:causa_id/sugerencias-seguimiento`

Body: `plan_accion` y `estado_actual` (obligatorios), `observaciones`
(opcional). **Respuesta 200** — `data: { recomendaciones[], proximos_pasos[], alertas[] }`.
Si la IA falla devuelve sugerencias genéricas con una alerta «Error al
consultar IA…»; solo responde 500 cuando faltan `MINISTRAL_API_KEY` o
`MINISTRAL_ENDPOINT`. `causa_id` se valida como uuid pero no se usa.

### `GET /api/acciones-correctivas/:id/exportar-pdf`

PDF generado en memoria con pdfkit (`pdf-generator-acciones.service.ts`):
`Content-Type: application/pdf`,
`Content-Disposition: attachment; filename="accion-correctiva-<número>.pdf"`
(número rellenado con ceros a tres cifras). Cualquier error, incluida una
acción inexistente o en la papelera, sale 500.

## Efectos

- **Recordatorios** (cron `acciones-correctivas`,
  [`src/jobs/acciones-correctivas.cron.ts`](../../src/jobs/acciones-correctivas.cron.ts)):
  todos los días a las 08:00 de America/Bogota. Para cada acción sin cierre
  definitivo eficaz toma la última fecha de actividad (implementación,
  seguimiento de la acción, de la corrección, de los ciclos y de las causas) y,
  cuando se cumplen 15, 30, 45… días, crea una notificación
  `ACCION_CORRECTIVA_RECORDATORIO` para cada usuario `role: admin` y para quien
  creó la acción, salvo quienes son de Operaciones sin HSEQ ni Administración;
  una por usuario y día. Sale por socket `nueva-notificacion` y Web Push
  (`emitNotificacion`). Ver [tareas programadas](../tareas-programadas.md) y
  [notificaciones](./notificaciones.md).
- **IA** (Azure, modelo Ministral): las dos rutas de sugerencias llaman a
  `POST {MINISTRAL_ENDPOINT}/chat/completions?api-version=2024-05-01-preview`
  con `MINISTRAL_API_KEY` y `MINISTRAL_MODEL_NAME` (por defecto
  `Ministral-3B-2`). El prompt incluye la lista fija de cargos de la estructura
  de Cotransmeq (constante `CARGOS_TRANSMERALDA` en `ia-sugerencias.service.ts`,
  que conserva el nombre del repo original) para que los responsables
  sugeridos existan. El controlador crea `IAsugerenciasService` en la primera
  petición que lo usa (`servicioIA()`), no al importarse: su constructor lanza
  si faltan `MINISTRAL_API_KEY` o `MINISTRAL_ENDPOINT`, y así sin ellas el
  backend arranca y solo fallan estas dos rutas. Ver
  [integraciones](../integraciones.md).
- **S3**: `upload` escribe en `acciones-correctivas/adjuntos/`.
- **Otras altas**: el [asistente](./asistente.md) y la investigación de
  [incidentes](./incidentes.md) crean acciones con
  `AccionesCorrectivasService.crear` y las numeran con `siguienteNumeroAccion`
  (`AC-<año>-<nnn>`, el primer número libre del año).
- **Registro de actividad**: cada escritura con éxito deja una fila en
  `registro_actividad` (hook global, ver [actividad](./actividad.md)).

## Observaciones

- `reset` se describe como «uso admin», pero solo pide
  `acciones-correctivas:full` y no mira el cargo (`acciones-correctivas.routes.ts`).
- La equivalencia de cargos usa `includes`: cualquier cargo que contenga
  `hseq` o `direccion` cuenta (un «Auxiliar HSEQ» aprueba como coordinador)
  (`cargoCorrespondeARol`).
- Las lecturas (detalle, aprobaciones, seguimientos, PDF) solo piden sesión.
  El comentario de las rutas lo justifica por el nivel `limited`, pero este
  módulo no da `read` ni `limited` a ningún área: cualquier usuario del equipo
  lee lo que no puede escribir (`src/config/permissions.ts`).
- `PUT /:id` con `causas` borra y recrea todas las causas: la cascada se lleva
  los `seguimientos_causa`, y `buildCausaCreate` no copia los datos de cierre
  de la causa (`fecha_cierre`, `evaluacion_cierre_eficaz`, `criterio_…`,
  `responsable_cierre`…) ni `sugerencia_ia`; de los seguimientos anidados se
  pierden `evaluacion_eficaz` y `registrado_por_id`. Es el
  `deleteMany` + `create` que el repo desaconseja (`acciones-correctivas.service.ts`).
- Un seguimiento `Replanteada` deja la causa en `En Proceso`, así que
  `calcular-estado` no llega a `REPLANTEADA` por esa vía; solo un `PUT /:id`
  con `causas` puede dejar una causa en `Replanteada`.
- Códigos poco fiables: casi todo fallo sale 400 (también los de Prisma);
  `exportar-pdf` de una acción inexistente responde 500 (el `if (!accion)` no
  se alcanza porque el servicio lanza antes); `aprobaciones` de un id
  inexistente responde 200 con nulos; `validar-cierre` de una acción
  inexistente o sin causas dice `todas_cerradas: true`.
- `estadisticas` y el cron no filtran `deleted_at`: las acciones de la
  papelera cuentan y siguen recibiendo recordatorios.
- `upload` no limita tipo ni tamaño del archivo.
