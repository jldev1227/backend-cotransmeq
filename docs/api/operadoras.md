# Operadoras

`/api/operadoras` · código en [`src/modules/operadoras/`](../../src/modules/operadoras/) · permiso [`liquidaciones-servicios`](../permisos.md#catálogo-de-módulos) para escribir

Catálogo de operadoras petroleras (PAREX, GEOPARK…) a las que se atribuye una
liquidación de servicio. Reemplazó al campo de texto libre
`liquidacion_servicio.operadora`, que acumulaba variantes del mismo nombre.

La regla de todo el módulo es que el `codigo` se guarda **siempre normalizado**
(mayúsculas, sin espacios sobrantes, `normalizarCodigo()`): es la clave con la
que casan el backfill SQL, el seed y las altas por API. Dos códigos que solo se
diferencian en un espacio son el mismo código.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | sin permiso de módulo: el editor de liquidaciones lo carga para cualquiera del equipo |
| `POST`, `PUT`, `DELETE` | `liquidaciones-servicios:full` (`permisoPorMetodo` con `excepto` para `GET`) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/operadoras` | sesión | Lista las operadoras (solo activas por defecto) |
| POST | `/api/operadoras` | `liquidaciones-servicios:full` | Crea una operadora |
| PUT | `/api/operadoras/:id` | `liquidaciones-servicios:full` | Edita código, nombre, estado u orden |
| DELETE | `/api/operadoras/:id` | `liquidaciones-servicios:full` | Borra, o desactiva si ya tiene liquidaciones |

### `GET /api/operadoras`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `incluir_inactivas` | `'true'` \| ausente | ausente | Con `'true'` incluye las retiradas (`activo: false`) |

**Respuesta 200** — arreglo plano (sin envoltorio `data`), ordenado por `orden` y
luego por `codigo`:

```json
[
  { "id": "uuid", "codigo": "PAREX", "nombre": "Parex Resources", "activo": true, "orden": 0,
    "created_at": "…", "updated_at": "…" }
]
```

### `POST /api/operadoras`

**Body** (sin esquema de validación: el servicio toma lo que reconoce)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `codigo` | string | sí | Se normaliza; vacío tras normalizar → error |
| `nombre` | string | no | Si falta o queda vacío, se usa el código |
| `activo` | boolean | no | `true` por defecto |
| `orden` | number | no | `0` por defecto; orden del `<select>` |

**Respuesta 201** — la operadora creada.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 409 | Ya existe ese código normalizado | `{ "error": "Ya existe una operadora con el código X", "codigo": "X" }` |
| 500 | Código vacío y cualquier otro fallo | `{ "error": "<mensaje>" }` |

### `PUT /api/operadoras/:id`

Mismo body que el alta, todos los campos opcionales: solo se cambia lo que llega.
Cambiar el `codigo` pasa por la misma comprobación de duplicado (409).

### `DELETE /api/operadoras/:id`

No siempre borra. Si la operadora ya está en alguna liquidación de servicio,
la **desactiva** (la FK es `ON DELETE RESTRICT` a propósito: vaciar ese dato en
liquidaciones históricas perdería a quién se atribuyó el servicio). La respuesta
dice qué hizo, para que la interfaz no anuncie «eliminada» cuando la retiró:

```json
{ "accion": "desactivada", "liquidaciones": 12, "operadora": { "…": "…" } }
{ "accion": "eliminada", "liquidaciones": 0 }
```

## Observaciones

- Un `id` inexistente en `PUT` o `DELETE` responde **500** con
  `{ "error": "Operadora no encontrada" }`, no 404: el servicio lanza un `Error`
  genérico y el controlador no lo distingue.
- El body no se valida con esquema: un `orden` que no sea número llega tal cual
  a Prisma y falla con 500.
