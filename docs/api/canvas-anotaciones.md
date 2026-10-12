# Anotaciones de canvas

`/api/canvas-anotaciones` · código en [`src/modules/canvas-anotaciones/`](../../src/modules/canvas-anotaciones/) · sin permiso de módulo (solo sesión)

Notas libres que el equipo escribe en celdas de los canvas que **no** están
atadas a ningún campo de la base (`canvas_anotacion`): referencias,
recordatorios, valores de apoyo. Nunca entran en un total ni en una fórmula. Se
usan en los cuatro canvas del dominio de [terceros](./liquidaciones-terceros.md):
`cierres-finales`, `ocasional`, `adicionales` e `ingresos`.

Cada anotación se identifica por `(scope, anio, mes, sheet_key, ancla_tipo,
ancla_ref, offset_fila, columna)`. `sheet_key` es el id del cierre en
`cierres-finales` (una hoja por placa) y `''` en los libros anuales. El
anclaje es **relativo** para que la nota siga a su sección cuando la tabla
crece: `fila` cuenta filas con signo desde el final del bloque de ítems, `item`
se ancla al id de un ítem, `clave` a una celda que el builder declara por
nombre y `top` es la fila absoluta de la cabecera. Una anotación borrada
conserva la fila con `valor: null` para no perder el hilo de `version`.

Esta ruta solo hace la **carga inicial**: las escrituras van por socket
(`sheet:patch` con `entity_type: 'anotacion'`, compare-and-swap por `version`),
como el resto de celdas, para que los demás las vean al momento (ver
[tiempo real](../tiempo-real.md)).

## Acceso

| Operación | Guarda |
|---|---|
| `GET` | `sesión` (hook `onRequest` del plugin), sin permiso de módulo |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/canvas-anotaciones` | sesión | Anotaciones de un canvas en un año (o un mes) |

### `GET /api/canvas-anotaciones`

**Query**

| Parámetro | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `scope` | string | sí | `cierres-finales`, `ocasional`, `adicionales` o `ingresos` |
| `anio` | number | sí | |
| `mes` | number | no | Sin él, los 12 meses (libros anuales) |

**Respuesta 200** — agrupadas por mes y hoja, sin las borradas:

```json
{ "porMes": { "7": { "": [
  { "ancla_tipo": "fila", "ancla_ref": "", "offset_fila": -3, "columna": 5,
    "valor": "Pendiente soporte", "estilo": null, "version": 2, "sheet_key": "",
    "actualizado_por": { "id": "…", "nombre": "…" }, "updated_at": "…" } ] } } }
```

**Errores** — 400 `{ "error": "scope y anio son obligatorios" }`; cualquier otro
fallo (scope inválido, `anio` no numérico, error de base de datos) también sale
como 400 con el mensaje.

## Efectos

Ninguno: es solo lectura. Los snapshots del [ocasional](./liquidaciones-terceros-ocasional-snapshots.md)
guardan y restauran las anotaciones de su mes.

## Observaciones

- La lectura solo pide sesión: cualquier usuario del equipo, tenga o no acceso a
  `liquidaciones-terceros`, puede leer las notas de los canvas de cierres,
  ocasional, adicionales e ingresos con solo conocer `scope` y `anio`.
- Cualquier error se responde como 400, también los de servidor.
