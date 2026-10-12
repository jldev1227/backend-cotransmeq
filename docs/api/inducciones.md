# Inducciones de visitantes

`/api/inducciones` · código en [`src/modules/inducciones/`](../../src/modules/inducciones/) · permiso [`asistencias`](../permisos.md#catálogo-de-módulos)

Registro de inducción o reinducción de visitantes (formato HSEQ-FR-66,
versión 1). El visitante lo llena desde su teléfono, sin sesión: sede visitada,
sus datos, su firma y la lista de temas que se le informaron. HSEQ lo consulta y
lo exporta desde la pantalla de Asistencias, por eso el módulo de permisos es
`asistencias` y no uno propio. Tabla `inducciones_visitantes` (id `cuid`, no
uuid).

Reglas que un integrador necesita saber:

- `sede`: `yopal`, `villanueva`, `ambas` o `lugar_prestacion`.
- `temas_informados` es una lista de 11 booleanos: `peligros_riesgos`,
  `normas_comportamiento`, `uso_epp`, `prohibicion_alcohol_drogas`,
  `manejo_residuos`, `uso_agua_energia`, `procedimiento_derrames`,
  `alarma_evacuacion`, `pasos_emergencia`, `numeros_emergencia` y
  `seguridad_vial`. Al crear, los que faltan valen `false` y las claves
  desconocidas se descartan. Las etiquetas legibles están en `TEMAS_LABELS`
  ([`inducciones.schema.ts`](../../src/modules/inducciones/inducciones.schema.ts)).
- `porcentaje_conformidad` lo calcula el servidor: temas en `true` sobre el
  total, redondeado.
- No hay borrado lógico: la tabla no tiene `deleted_at` y `DELETE` borra la fila.

## Acceso

| Operación | Guarda |
|---|---|
| `POST /inducciones` | `pública`: queda fuera de la guarda por `excepto`, que compara patrón **y** método (`/inducciones` + `POST`): el listado comparte patrón y sigue protegido. Sin token ni límite de intentos |
| Resto | `sesión` (`onRequest: authMiddleware` en cada ruta) y `permisoPorMetodo('asistencias')` en el plugin: `asistencias:read` en `GET`, `asistencias:full` en `PATCH` y `DELETE`. Administración y HSEQ |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/inducciones` | pública | Registra la inducción de un visitante |
| GET | `/api/inducciones` | `asistencias:read` | Lista paginada con filtros |
| GET | `/api/inducciones/estadisticas` | `asistencias:read` | Total, último mes, conformidad media y por sede |
| GET | `/api/inducciones/:id` | `asistencias:read` | Una inducción |
| PATCH | `/api/inducciones/:id` | `asistencias:full` | Corrige una inducción |
| DELETE | `/api/inducciones/:id` | `asistencias:full` | Borra una inducción |
| GET | `/api/inducciones/:id/exportar/excel` | `asistencias:read` | Excel del formato HSEQ-FR-66 |
| GET | `/api/inducciones/:id/exportar/pdf` | `asistencias:read` | Formato imprimible (HTML, no PDF) |

Las rutas declaran esquema JSON de Fastify (body, query, enums, `date-time`):
lo que no cumple sale 400 en el formato de Fastify
(`{ statusCode, error, message }`). Después valida zod y, si rechaza, el
controlador responde **500** con el detalle en `message`. Los errores propios
tienen la forma `{ "success": false, "message": "…" }`.

### `POST /api/inducciones`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `sede` | `yopal` \| `villanueva` \| `ambas` \| `lugar_prestacion` | sí | |
| `fecha` | ISO 8601 con `Z` | sí | zod `datetime()` no admite desfase (`-05:00`) |
| `visitante_nombre`, `visitante_cargo`, `visitante_entidad` | string 1–255 | sí | |
| `visitante_cedula` | string 1–50 | sí | |
| `visitante_firma` | string | sí | Imagen en base64 |
| `temas_informados` | objeto de booleanos | sí | Ver Reglas |
| `responsable_nombre`, `responsable_cargo` | string ≤ 255 | no | Responsable por parte de la empresa; los manda el cliente |
| `responsable_cedula` | string ≤ 50 | no | |
| `responsable_firma` | string | no | |
| `observaciones` | string | no | |

**Respuesta 201** — `{ "success": true, "message": "Inducción registrada exitosamente", "data": <registro> }`:
la fila completa (firma y cédula incluidas) con `fecha`, `created_at` y
`updated_at` en ISO.

**Errores**: 400 de Fastify; 500 si zod rechaza o falla la base.

### `GET /api/inducciones`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `sede` | enum de sedes | — | |
| `fecha_desde`, `fecha_hasta` | ISO 8601 con `Z` | — | Sobre `fecha`, ambos inclusive |
| `visitante_nombre`, `visitante_entidad` | string | — | Contiene, sin distinguir mayúsculas |
| `page` | entero ≥ 1 | `1` | |
| `limit` | entero 1–100 | `20` | |

**Respuesta 200** — ordenada por `fecha`, de la más reciente a la más antigua:

```json
{ "success": true,
  "data": [ { "id": "cm…", "sede": "yopal", "fecha": "2026-10-10T13:00:00.000Z", "visitante_nombre": "…",
              "visitante_cedula": "…", "visitante_firma": "data:image/png;base64,…", "temas_informados": { "uso_epp": true, "…": false },
              "porcentaje_conformidad": 91, "…": "…", "creado_por": null } ],
  "pagination": { "total": 40, "page": 1, "limit": 20, "totalPages": 2 } }
```

### `GET /api/inducciones/estadisticas`

```json
{ "success": true, "data": { "total": 40, "ultimo_mes": 6, "promedio_conformidad": 88,
  "por_sede": [ { "sede": "yopal", "cantidad": 25 } ] } }
```

`ultimo_mes` cuenta las de `fecha` en los últimos 30 días.

### `GET /api/inducciones/:id`

`{ success, data: <registro con creado_por> }`; 404 `Inducción no encontrada`.

### `PATCH /api/inducciones/:id`

Body: los campos del alta, todos opcionales; `temas_informados` puede ser
parcial. Solo se cambia lo que llega. Si llegan temas, el porcentaje se
recalcula sobre la mezcla de los guardados con los nuevos (pero ver
Observaciones). Responde 200 `{ success, message, data }`; 500 si zod rechaza o
la inducción no existe.

### `DELETE /api/inducciones/:id`

Borra la fila. `{ success, message }`; 500 si no existe.

### Exportaciones

- `GET /api/inducciones/:id/exportar/excel`: libro con cuatro hojas (Encabezado con código
  HSEQ-FR-66 y versión, Visitante, Temas informados con SÍ/NO, Resumen),
  `attachment; filename="induccion_<nombre>_<fecha>.xlsx"`.
- `GET /api/inducciones/:id/exportar/pdf`: pese al nombre devuelve **HTML**
  (`text/html; charset=utf-8`) como adjunto `induccion_<nombre>_<fecha>.html`,
  pensado para imprimir desde el navegador. Incluye la firma y la declaración
  del visitante («…que COTRANSMEQ S.A.S. me suministró la información…»).

Una inducción inexistente sale 500 `Inducción no encontrada` en las dos.

## Efectos

- **Sockets** (con `io.emit`, a todos los sockets conectados; ver
  [tiempo real](../tiempo-real.md)): `inducciones:created` y
  `inducciones:updated`, con `{ induccion, timestamp }`.
- **Registro de actividad**: `PATCH` y `DELETE` dejan fila en
  `registro_actividad`, contadas en el panel bajo `evaluaciones` (ver
  [actividad](./actividad.md)). El registro público no, porque no hay usuario.

## Observaciones

- **Alta pública sin freno**: `POST /inducciones` no tiene límite de intentos
  ni captcha; la respuesta 201 devuelve el registro completo y
  `inducciones:created` lo difunde a todos los sockets, cédula y firma
  incluidas (`inducciones.controller.ts`).
- `creado_por_id` nunca se llena: la ruta pública no pasa por
  `authMiddleware`, así que `request.user` no existe aunque el comentario diga
  que se toma del JWT si lo hay. Los datos del responsable los escribe el
  cliente.
- `PATCH` con `temas_informados` parcial calcula la conformidad sobre la mezcla,
  pero guarda solo los temas enviados: los omitidos desaparecen del JSON y la
  exportación los muestra como «no» (`inducciones.service.ts`).
- `DELETE` borra en duro, contra la regla de borrado lógico del repo.
- `exportar/pdf` interpola sin escapar los textos que llegaron del formulario
  público (nombre, cargo, entidad, observaciones) y usa la firma tal cual como
  `src` de la imagen (`inducciones.controller.ts`).
- Un rechazo de zod sale 500, no 400; `PATCH`, `DELETE` y las exportaciones de
  un id inexistente también salen 500 en vez de 404.
