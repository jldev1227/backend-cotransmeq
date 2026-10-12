# Documentos de vehículos (hoja de vida)

`/api/vehiculos/:id/documentos` y `/api/vehiculos/documentos/catalogo` · código en [`src/modules/vehiculos-documentos/`](../../src/modules/vehiculos-documentos/) · permiso [`flota`](../permisos.md#catálogo-de-módulos) para escribir

Documentos de la hoja de vida de cada vehículo (SOAT, tecnomecánica, pólizas,
tarjeta de operación, tarjeta de propiedad…), guardados en la tabla `documento`
(columna `vehiculo_id`) con el archivo en S3. El catálogo es fijo y vive solo en
`catalogo.ts`: 22 categorías en tres grupos (`vigencias`, `legales`, `operacion`),
cada una con `vence` (lleva vencimiento y entra a los avisos), `puedeNoAplicar`
(p. ej. la tecnomecánica de un vehículo nuevo), `cicloMeses` (solo para sugerir la
fecha) y `paraConductor` (lo que ve el conductor en la app). Las claves son las que
ya traía la tabla y no se renombran.

Reglas que hay que conocer para leer bien los datos:

- **Versiones.** Subir un documento deja las filas `vigente`/`no_aplica` anteriores
  de esa categoría como `reemplazado`, que es el historial. El documento **actual**
  es la fila `vigente` o `no_aplica` de vencimiento más lejano (y, a igualdad, la
  más reciente): la carga de 2025 dejó varias filas `vigente` por categoría y así
  se leen bien sin migrarlas.
- **Vencimiento efectivo**: `fecha_vencimiento`; si falta,
  `metadata.fechaVigenciaOriginal`; si falta, `fecha_vigencia`. La carga de 2025
  guardó `fecha_vigencia` un día corrida y el valor bueno quedó en la metadata.
- **Estado por categoría**, calculado al leer con la fecha de hoy en Colombia:
  `faltante`, `no_aplica`, `cargado` (categoría que no vence), `sin_fecha`,
  `vencido`, `por_vencer` (30 días o menos) o `vigente`.

Los documentos también se cargan con el importador
`scripts/importar-documentos-vehiculos.ts` (carpeta de OneDrive «02. VEHICULOS»),
que usa el mismo servicio con `origen: 'onedrive_2026'`; ninguna ruta lo invoca.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | sin permiso de módulo (como el resto de `flota`) |
| `POST`, `PATCH`, `DELETE` | `flota:full` (`flota` es `general: true`: solo deja fuera a quien tenga lista blanca sin ese nivel) |
| Rutas con `:id` o `:docId` | hook `preValidation`: un UUID mal formado responde 400 `{ success: false, message: 'Identificador inválido' }` antes de mirar el permiso |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/vehiculos/documentos/catalogo` | sesión | Catálogo de categorías |
| GET | `/api/vehiculos/:id/documentos` | sesión | Estado de cada categoría, con el actual y el historial |
| POST | `/api/vehiculos/:id/documentos` | `flota:full` | Sube una versión nueva (o marca «no aplica») |
| PATCH | `/api/vehiculos/:id/documentos/:docId` | `flota:full` | Corrige fechas, número o emisor |
| DELETE | `/api/vehiculos/:id/documentos/:docId` | `flota:full` | Borra una versión (lógico) |
| GET | `/api/vehiculos/:id/documentos/:docId/url` | sesión | URL firmada de 15 minutos |

Las respuestas de error de este módulo tienen la forma
`{ success: false, message }`, con el mensaje del error tal cual (también en los
500).

### `GET /api/vehiculos/documentos/catalogo`

**Respuesta 200** — `{ success, data }` con `CATEGORIAS_DOCUMENTO`:
`[{ clave, etiqueta, grupo, vence, puedeNoAplicar?, cicloMeses?, paraConductor? }]`.

### `GET /api/vehiculos/:id/documentos`

**Respuesta 200**

```json
{ "success": true, "data": {
  "hoy": "2026-10-11",
  "categorias": [
    { "clave": "SOAT", "etiqueta": "SOAT", "grupo": "vigencias", "vence": true, "cicloMeses": 12, "paraConductor": true,
      "actual": { "…": "documento" }, "estado": "por_vencer", "dias": 12, "historial": [ { "…": "documento" } ] }
  ],
  "resumen": { "vencidos": 0, "por_vencer": 1, "faltantes": 2, "al_dia": 5, "total": 8 } } }
```

- Cada **documento**: `{ id, categoria, nombre, mimetype, size, estado, tiene_archivo,
  fecha_vencimiento, fecha_expedicion, numero, emisor, origen, creado }`.
  `fecha_vencimiento` es la efectiva (`YYYY-MM-DD`); `origen` es `app`,
  `carga_2025` (filas con `metadata.uploadSession`), `onedrive_2026` u otro valor
  de `metadata.origen`. No expone la key de S3: el archivo se abre con `…/url`.
- `dias`: días hasta el vencimiento (negativo si ya pasó); `null` si no aplica.
- `resumen` cuenta solo las categorías que vencen; `al_dia` = `vigente` + `no_aplica`.
- Solo salen las categorías del catálogo: filas con otra `categoria` no aparecen.

No comprueba que el vehículo exista: un id válido pero inexistente devuelve 200
con todas las categorías en `faltante`.

### `POST /api/vehiculos/:id/documentos`

**Body** `multipart/form-data`. El comentario de la ruta pide los campos antes del
archivo; el controlador lee todas las partes antes de procesar.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `categoria` | string | sí | Clave del catálogo |
| `archivo` | PDF, PNG, JPG o WEBP | sí, salvo `no_aplica` | Máx. 25 MB. Se toma cualquier parte de tipo archivo, sin mirar el nombre del campo; si llegan varias, queda la última |
| `fecha_vencimiento` | `YYYY-MM-DD` | no | Solo se guarda si la categoría vence y no es «no aplica». Otro formato → 400 |
| `fecha_expedicion` | `YYYY-MM-DD` | no | No se valida el formato |
| `numero`, `emisor` | string | no | `''` = sin dato |
| `no_aplica` | `'true'` | no | Solo en categorías con `puedeNoAplicar` |

El vehículo tiene que existir y no estar en la papelera. El archivo sube a S3 en
`vehiculos/<vehiculoId>/documentos/<CATEGORIA>/<docId><ext>`; después, en una
transacción, las filas actuales de la categoría pasan a `reemplazado` y se crea la
nueva (`vigente` o `no_aplica`, con `metadata.origen = 'app'` y
`metadata.subido_por`). `fecha_vencimiento` se escribe también en `fecha_vigencia`.

**Respuesta 200** (no 201) — `{ success, data: documento }`.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | `Solo PDF o imagen`, `Categoría de documento desconocida`, `<etiqueta> no admite «no aplica»`, `Falta el archivo`, `Fecha de vencimiento inválida` |
| 404 | `Vehículo no encontrado` (no existe o está en la papelera) |
| 406 | El cuerpo no es multipart (`the request is not multipart`) |
| 413 | `El archivo supera 25 MB` |
| 500 | Cualquier otro fallo, con el mensaje interno |

### `PATCH /api/vehiculos/:id/documentos/:docId`

Corrige datos sin cambiar el archivo, la categoría ni el estado.

**Body** (JSON, sin esquema de validación)

| Campo | Tipo | Notas |
|---|---|---|
| `fecha_vencimiento` | `YYYY-MM-DD` \| `''` \| `null` | Escribe `fecha_vencimiento` y `fecha_vigencia` |
| `fecha_expedicion` | `YYYY-MM-DD` \| `''` \| `null` | |
| `numero`, `emisor` | string \| `''` \| `null` | |

Campo ausente = no se toca; `''` o `null` = se vacía.

**Respuesta 200** — `{ success, data: documento }`. 404 `Documento no encontrado`
si no existe, está borrado o es de otro vehículo.

### `DELETE /api/vehiculos/:id/documentos/:docId`

Borrado lógico (`deleted_at`). Si la versión borrada era la actual y no queda otra
`vigente`/`no_aplica` en la categoría, la `reemplazado` más reciente (por
vencimiento y luego por fecha de carga) vuelve a `vigente`: borrar un SOAT subido
por error no deja la categoría vacía. El objeto de S3 se conserva.

Responde `{ success: true }`; 404 `Documento no encontrado`.

### `GET /api/vehiculos/:id/documentos/:docId/url`

**Respuesta 200** — `{ success, data: { url } }`, URL de S3 firmada por 15 minutos.
404 `Documento sin archivo` si no existe, está borrado o es un «no aplica» sin
soporte.

## Efectos

- **S3** (ver [integraciones](../integraciones.md)): objetos bajo
  `vehiculos/<id>/documentos/`. Nada se borra del bucket, ni al reemplazar ni al
  eliminar.
- **Cron `vencimientos-documentos`** (`src/jobs/vencimientos-documentos.cron.ts`,
  todos los días a las 7:00 de Bogotá): toma el documento actual de cada vehículo y
  categoría que vence y avisa a las áreas `mantenimiento`, `hseq` y
  `administracion` a los 30, 15, 7 y 0 días, y hasta 3 días después de vencido.
  Un aviso por umbral (huella `docveh:<CATEGORIA>:<vence>:<umbral>` en
  `notificacion.referencia_tipo`); deja fuera vehículos ocultos o en la papelera.
  Las notificaciones salen también por socket (ver
  [tareas programadas](../tareas-programadas.md)).
- **App del conductor**: las categorías `paraConductor` se muestran en el portal a
  través de `conductor-portal/extractos-portal.service.ts`, que usa este mismo
  servicio.
- **Registro de actividad**: hook global de [actividad](./actividad.md).

## Observaciones

- `PATCH` no valida las fechas: una que no sea `YYYY-MM-DD` llega a Prisma como
  fecha inválida y responde 500 con el mensaje de Prisma. En `POST`, una
  `fecha_expedicion` inválida falla igual, pero **después** de subir el archivo:
  queda un objeto huérfano en S3 (`vehiculos-documentos.service.ts`).
- `PATCH` acepta `fecha_vencimiento` en categorías que no vencen (no consulta el
  catálogo).
- Los 500 devuelven el mensaje interno del error (`responderError` en
  `vehiculos-documentos.routes.ts`), incluido el de Prisma.
- Leer pide solo sesión: cualquier usuario del equipo puede pedir la URL firmada de
  cualquier documento de vehículo.
