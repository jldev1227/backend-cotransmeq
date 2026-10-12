# Documentos de conductores (hoja de vida)

`/api/conductores/:id/documentos` y `/api/conductores/documentos/catalogo` · código en [`src/modules/conductores-documentos/`](../../src/modules/conductores-documentos/) · permiso [`conductores`](../permisos.md#catálogo-de-módulos)

Hoja de vida documental del conductor: el soporte de lo que piden el PESV
(Res. 40595 de 2022) y el Decreto 1079 de 2015 para transporte especial —licencia
vigente, exámenes, cursos, seguridad social al día, consultas SIMIT y de
antecedentes, cédula, contrato…—. Usa la misma tabla `documento` que los
documentos de vehículos (columna `conductor_id`), con el archivo en S3, y calca sus
reglas (ver [vehiculos-documentos](./vehiculos-documentos.md)):

- **Versiones**: subir deja las filas `vigente`/`no_aplica` anteriores de la
  categoría como `reemplazado` (historial). El documento **actual** es la fila
  `vigente`/`no_aplica` de vencimiento más lejano y, a igualdad, la más reciente.
- **Vencimiento efectivo**: `fecha_vencimiento`, luego
  `metadata.fechaVigenciaOriginal`, luego `fecha_vigencia` (la carga de 2025 guardó
  esta última un día corrida).
- Solo se leen y escriben las categorías del catálogo: la `FOTO_PERFIL` vive en la
  misma tabla pero la gestiona la ficha del [conductor](./conductores.md).

El catálogo vive solo en `catalogo.ts`: 18 categorías en tres grupos
(`vigencias`, `identificacion`, `laboral`). Cada una puede llevar `vence`,
`requerido` (sin fecha, pero cuenta como faltante si no está), `puedeNoAplicar`,
`cicloMeses` (solo para sugerir la fecha), `diasAviso` (desde cuántos días antes
pasa a «por vencer»: 30 por defecto, 7 en seguridad social y SIMIT, que son
mensual y trimestral), `etiquetaFecha` (consultas como SIMIT o antecedentes, que no
vencen sino que toca repetir) y `pideCategoriaLicencia`.

**La licencia se sincroniza con la ficha.** Subir o corregir la `LICENCIA` vigente
copia su vencimiento y su categoría (`A1`…`C3`) a `conductores.vencimiento_licencia`
y `categoria_licencia`, que son lo que leen el FUEC y el panel de talento humano. Al
leer, la fecha de la ficha manda sobre la del documento: una licencia con fecha en
la ficha y sin archivo sigue contando como vigente.

**Los PDF se comprimen** con Ghostscript (`compresion.ts`): los de 300 KB o más
pasan por `gs` con `/ebook`, y el resultado solo se usa si ahorra al menos un 15 %.
Si `gs` no está, falla o tarda más de 60 s, se sube el original: comprimir nunca es
motivo de rechazo. La imagen de producción instala `ghostscript` en el `Dockerfile`.
Las reglas de vigencia y avisos viven en `vigencia.ts`, sin Prisma ni S3, para que
la pestaña y el cron decidan con las mismas funciones.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `conductores:read`: a diferencia de la ficha, aquí hay exámenes médicos y antecedentes, y un acceso `limited` no debe abrirlos |
| `POST`, `PATCH`, `DELETE` | `conductores:full` |
| Rutas con `:id` o `:docId` | hook `preValidation`: un UUID mal formado responde 400 `{ success: false, message: 'Identificador inválido' }` antes de mirar el permiso |

`conductores` es `general: true`: cualquier usuario autenticado tiene `full`. Las
guardas `read` y `full` solo cambian algo para quien tenga lista blanca
(`permisos_rutas`).

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/conductores/documentos/catalogo` | `conductores:read` | Catálogo de categorías |
| GET | `/api/conductores/:id/documentos` | `conductores:read` | Estado de cada categoría, con el actual y el historial |
| POST | `/api/conductores/:id/documentos` | `conductores:full` | Sube una versión nueva (o marca «no aplica») |
| PATCH | `/api/conductores/:id/documentos/:docId` | `conductores:full` | Corrige fechas, número, emisor o categoría de licencia |
| DELETE | `/api/conductores/:id/documentos/:docId` | `conductores:full` | Borra una versión (lógico) |
| GET | `/api/conductores/:id/documentos/:docId/url` | `conductores:read` | URL firmada de 15 minutos |

Errores comunes del módulo (`responderError` en `conductores-documentos.routes.ts`):
un rechazo de zod responde 400 `{ success: false, message }` con el primer mensaje;
un error de dominio, su código con `{ success: false, message }`; cualquier otro
fallo, 500 `{ success: false, message: 'Error interno' }` (el detalle va al log).

### `GET /api/conductores/documentos/catalogo`

**Respuesta 200** — `{ success, data }` con `CATEGORIAS_DOCUMENTO_CONDUCTOR`:
`[{ clave, etiqueta, grupo, vence, requerido?, puedeNoAplicar?, cicloMeses?, diasAviso?, etiquetaFecha?, pideCategoriaLicencia? }]`.

### `GET /api/conductores/:id/documentos`

**Respuesta 200**

```json
{ "success": true, "data": {
  "hoy": "2026-10-11",
  "categorias": [
    { "clave": "LICENCIA", "etiqueta": "Licencia de conducción", "grupo": "vigencias", "vence": true,
      "cicloMeses": 36, "pideCategoriaLicencia": true,
      "actual": { "…": "documento" }, "estado": "vigente", "dias": 400, "vencimiento": "2027-11-15",
      "historial": [ { "…": "documento" } ], "categoria_licencia": "C2" }
  ],
  "resumen": { "vencidos": 0, "por_vencer": 1, "faltantes": 3, "sin_fecha": 0, "al_dia": 7, "total": 11 } } }
```

- Cada **documento**: `{ id, categoria, nombre, mimetype, size, estado, tiene_archivo,
  fecha_vencimiento, fecha_expedicion, numero, emisor, categoria_licencia, origen, creado }`
  (`categoria_licencia` sale de la metadata; `origen` es `app`, `carga_2025` u
  otro valor de `metadata.origen`).
- `estado` de la categoría: `no_aplica`, `cargado` / `faltante` (las que no vencen),
  `sin_fecha`, `vencido`, `por_vencer` (dentro de su `diasAviso`) o `vigente`.
- `vencimiento`: la fecha efectiva de la categoría. En la licencia sale de la ficha
  si la tiene, aunque no haya archivo; el cliente la usa en vez de
  `actual.fecha_vencimiento`. (No se llama `vence` porque pisaría el booleano del
  catálogo.)
- `categoria_licencia` (solo en `LICENCIA`): la de la ficha del conductor.
- `resumen` cuenta lo obligatorio (lo que vence y lo `requerido`); `al_dia` =
  `vigente` + `cargado` + `no_aplica`.

**Errores**: 404 `Conductor no encontrado` si no existe o está en la papelera.

### `POST /api/conductores/:id/documentos`

**Body** `multipart/form-data`. Los campos se validan con zod (`subirSchema`); `''`
equivale a «sin dato». El comentario de la ruta pide los campos antes del archivo;
el controlador lee todas las partes antes de procesar.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `categoria` | string | sí | Clave del catálogo |
| `archivo` | PDF, PNG, JPG o WEBP | sí, salvo `no_aplica` | Máx. 25 MB. Se toma cualquier parte de tipo archivo; si llegan varias, queda la última |
| `fecha_vencimiento` | `YYYY-MM-DD` | no | Se ignora si la categoría no vence o es «no aplica» |
| `fecha_expedicion` | `YYYY-MM-DD` | no | |
| `numero` | string ≤ 80 | no | |
| `emisor` | string ≤ 255 | no | |
| `categoria_licencia` | `A1`, `A2`, `B1`, `B2`, `B3`, `C1`, `C2`, `C3` | no | Solo se guarda en `LICENCIA` |
| `no_aplica` | `'true'` | no | Solo en categorías con `puedeNoAplicar` |

El conductor tiene que existir y no estar en la papelera. Si es PDF, se comprime;
`size` es el tamaño subido y `metadata.size_original` guarda el original cuando hubo
ahorro. El archivo va a S3 en
`conductores/<conductorId>/documentos/<CATEGORIA>/<docId><ext>` (la misma ruta de la
carga de 2025). Después, en una transacción: las filas actuales de la categoría
pasan a `reemplazado`, se crea la nueva (`metadata.origen = 'app'`,
`metadata.subido_por`) y, si es la licencia con fecha o categoría, se copian a la
ficha.

**Respuesta 200** (no 201) — `{ success, data: documento }`.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | `Solo PDF o imagen`, rechazo de zod (`Falta la categoría`, `Fecha YYYY-MM-DD`, `Categoría de licencia no válida`…), `Categoría de documento desconocida`, `<etiqueta> no admite «no aplica»`, `Falta el archivo` |
| 404 | `Conductor no encontrado` |
| 406 | El cuerpo no es multipart (`the request is not multipart`) |
| 413 | `El archivo supera 25 MB` |
| 500 | `Error interno` |

### `PATCH /api/conductores/:id/documentos/:docId`

Corrige datos sin cambiar el archivo, la categoría ni el estado.

**Body** (JSON, zod `actualizarSchema` en modo `strict`: un campo desconocido → 400)

| Campo | Tipo | Notas |
|---|---|---|
| `fecha_vencimiento` | `YYYY-MM-DD` \| `null` | Escribe `fecha_vencimiento` y `fecha_vigencia` |
| `fecha_expedicion` | `YYYY-MM-DD` \| `null` | |
| `numero` | string ≤ 80 \| `null` | `''` también vacía |
| `emisor` | string ≤ 255 \| `null` | `''` también vacía |
| `categoria_licencia` | `A1`…`C3` \| `null` | Solo tiene efecto en documentos `LICENCIA` (se guarda en la metadata) |

Campo ausente = no se toca. Si el documento es la `LICENCIA` vigente, la fecha y la
categoría nuevas se copian también a la ficha; corregir una licencia vieja del
historial no toca la ficha (no puede devolver el FUEC a esa fecha).

**Respuesta 200** — `{ success, data: documento }`. 404 `Documento no encontrado`
si no existe, está borrado, es de otro conductor o no es una categoría del catálogo.

### `DELETE /api/conductores/:id/documentos/:docId`

Borrado lógico (`deleted_at`). Si era la versión actual y no queda otra
`vigente`/`no_aplica` en la categoría, la `reemplazado` más reciente vuelve a
`vigente`; si es una licencia con fecha, esa fecha (y su categoría, si la tiene en
la metadata) vuelve a la ficha. Si no queda ninguna, la ficha conserva la fecha que
tenía: pudo venir del formulario del conductor y no hay otra mejor. El objeto de S3
se conserva.

Responde `{ success: true }`; 404 `Documento no encontrado`.

### `GET /api/conductores/:id/documentos/:docId/url`

**Respuesta 200** — `{ success, data: { url } }`, URL de S3 firmada por 15 minutos.
404 `Documento sin archivo` si no existe, está borrado o es un «no aplica» sin
soporte.

## Efectos

- **S3** (ver [integraciones](../integraciones.md)): objetos bajo
  `conductores/<id>/documentos/`; nada se borra del bucket.
- **Ghostscript**: un proceso hijo asíncrono por PDF de 300 KB o más, con archivos
  temporales en el directorio temporal del sistema que se borran al terminar.
- **Ficha del conductor**: la licencia escribe `vencimiento_licencia` y
  `categoria_licencia`.
- **Cron `vencimientos-documentos-conductor`**
  (`src/jobs/vencimientos-documentos-conductor.cron.ts`, todos los días a las 7:00 de
  Bogotá): avisa a las áreas `talento_humano`, `hseq` y `administracion` en los
  umbrales de 30, 15, 7 y 0 días que caben en el `diasAviso` de cada categoría, y
  hasta 3 días después de vencido; uno por umbral (huella
  `doccond:<CATEGORIA>:<vence>:<umbral>`). La licencia se toma de
  `conductores.vencimiento_licencia` aunque no haya archivo. Solo conductores no
  ocultos, fuera de la papelera y que no estén `inactivo`, `retirado` ni
  `desvinculado`. Las notificaciones salen también por socket (ver
  [tareas programadas](../tareas-programadas.md)).
- **Registro de actividad**: hook global de [actividad](./actividad.md).

## Observaciones

- Filas de `documento` del conductor con una `categoria` que no está en el catálogo
  (aparte de `FOTO_PERFIL`) no salen en el listado ni se pueden corregir, borrar ni
  abrir por esta API.
- `PATCH` acepta `fecha_vencimiento` en categorías que no vencen (no consulta el
  catálogo).
- Como `conductores` es `general: true`, la guarda `read` que pide el comentario de
  la ruta para proteger exámenes y antecedentes solo deja fuera a usuarios con lista
  blanca: cualquier otra persona del equipo los lee.
