# Salidas no conformes

`/api/salidas-nc` · código en [`src/modules/salidas-nc/`](../../src/modules/salidas-nc/) · permiso [`salidas-nc`](../permisos.md#catálogo-de-módulos) para escribir

Registro de salidas no conformes del servicio (SNC), según la cláusula 8.7 de
ISO 9001:2015: detección (sección 1), descripción y clasificación (2),
tratamiento aplicado (3), concesión del cliente (4) y verificación posterior a
la corrección (5). Tabla `salidas_no_conformes`, numerada por `numero_snc`, una
secuencia de la base (`autoincrement`) que el PDF muestra como `SNC-0007`. Puede
enlazar conductor, vehículo y cliente por id, además de los textos libres
(`conductor_nombre`, `vehiculo_placa`, `cliente_contrato`…).

Reglas que un integrador necesita saber:

- **El estado no se manda, se deriva** de `cumple_requisitos` en cada alta y
  cada edición: `true` → `CERRADA`; cualquier otro valor, incluido no
  mandarlo → `ABIERTA`. `EN_TRATAMIENTO` existe en el enum, pero esta API no lo
  asigna.
- No hay borrado lógico: `DELETE` borra la fila.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | sin permiso de módulo: basta la sesión |
| `POST`, `PUT`, `DELETE` | `salidas-nc:full` (constante `puedeEscribir` en cada ruta): Administración, Operaciones y HSEQ |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/salidas-nc` | sesión | Lista paginada con filtros |
| POST | `/api/salidas-nc` | `salidas-nc:full` | Registra una salida no conforme |
| GET | `/api/salidas-nc/estadisticas` | sesión | Conteos por clasificación, estado y tipo de detección |
| GET | `/api/salidas-nc/siguiente-numero` | sesión | Número que probablemente tendrá la siguiente SNC |
| GET | `/api/salidas-nc/:id` | sesión | Una SNC con sus relaciones |
| PUT | `/api/salidas-nc/:id` | `salidas-nc:full` | Edita una SNC |
| DELETE | `/api/salidas-nc/:id` | `salidas-nc:full` | Borra una SNC |
| GET | `/api/salidas-nc/:id/pdf` | sesión | PDF del registro |

Lo que no cumple el esquema JSON de una ruta sale 400 en el formato de Fastify
(`{ statusCode, error, message }`). Los errores del controlador tienen la forma
`{ "success": false, "message": "…" }`.

### `GET /api/salidas-nc`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | entero | `1` | |
| `limit` | entero | `10` | Sin tope |
| `clasificacion_nc`, `tipo_deteccion`, `tipo_salida_nc`, `estado` | string | — | Igualdad exacta con el valor del enum |
| `fecha_desde`, `fecha_hasta` | fecha | — | Sobre `fecha_deteccion`, ambos inclusive |
| `busqueda` | string | — | Contiene, sin distinguir mayúsculas: detectado por, conductor, descripción, área, placa o ruta |
| `sortBy` | `numero_snc` \| `fecha_deteccion` \| `detectado_por` \| `clasificacion_nc` \| `estado` | `numero_snc` | Lista blanca en el esquema y en el servicio |
| `sortOrder` | `asc` \| `desc` | `desc` | |

**Respuesta 200**

```json
{ "success": true, "data": {
  "salidas": [ { "id": "uuid", "numero_snc": 7, "fecha_deteccion": "…", "clasificacion_nc": "MAYOR", "estado": "ABIERTA", "…": "…",
                 "conductor": { "id": "uuid", "nombre": "…", "apellido": "…", "numero_identificacion": "…" },
                 "vehiculo": { "id": "uuid", "placa": "…", "marca": "…", "modelo": "…" },
                 "cliente": { "id": "uuid", "nombre": "…", "nit": "…" },
                 "creado_por": { "id": "uuid", "nombre": "…", "correo": "…" } } ],
  "total": 31, "page": 1, "limit": 10, "totalPages": 4 } }
```

**Errores**: 500 si falla la consulta (p. ej. un valor que no es del enum en
un filtro o una fecha que no se puede leer).

### `POST /api/salidas-nc`

**Body**. El esquema de la ruta declara las secciones 1 y 2 y las relaciones;
las secciones 3 a 5 no están en él, pero pasan (el esquema no cierra el
objeto) y el servicio las guarda.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `fecha_deteccion`, `fecha_evento` | `YYYY-MM-DD` | sí | |
| `detectado_por`, `area_proceso` | string | sí | |
| `tipo_deteccion` | `DURANTE_SERVICIO` \| `POST_SERVICIO` \| `AUDITORIA_INTERVENTORIA` \| `REPORTE_CLIENTE` \| `OTRO` | sí | |
| `tipo_deteccion_otro` | string | no | |
| `vehiculo_placa`, `ruta_trayecto`, `turno_horario`, `conductor_nombre`, `conductor_cedula`, `cliente_contrato`, `servicio_afectado` | string | no | Sección 1, texto libre |
| `descripcion_nc` | string | sí | |
| `clasificacion_nc` | `CRITICA` \| `MAYOR` \| `MENOR` | sí | |
| `tipo_salida_nc` | `GPS_SISTEMA_TECNOLOGICO` \| `INCUMPLIMIENTO_RUTA_HORARIO_DESTINO` \| `VEHICULO_DIFERENTE_SIN_APROBACION` \| `FALLA_MECANICA_ELECTRICA` \| `DOCUMENTACION_VENCIDA_INCOMPLETA` \| `CONDUCTOR_NO_APTO_INFRACCION_VIAL` \| `QUEJA_CLIENTE` \| `HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE` \| `PERSONAL_NO_AUTORIZADO_TRANSPORTADO` \| `OTRO` | sí | |
| `tipo_salida_nc_otro` | string | no | |
| `tratamiento_seleccionado` | `CORRECCION` \| `CONTENCION` \| `SUSPENSION` \| `CONCESION` | no | Sección 3 |
| `descripcion_accion_tomada`, `responsable_accion`, `autoridad_disposicion` | string | no | Sección 3 |
| `fecha_implementacion` | fecha | no | Sección 3 |
| `concesion_solicitada` | boolean | no | Sección 4 |
| `condiciones_concesion`, `concesion_cliente_nombre` | string | no | Sección 4 |
| `concesion_cliente_fecha` | fecha | no | Sección 4 |
| `concesion_medio` | `ESCRITO` \| `CORREO` \| `ACTA` | no | Sección 4 |
| `metodo_verificacion` | `REVISION_DOCUMENTAL` \| `VERIFICACION_OPERATIVA_CAMPO` \| `CONFIRMACION_GPS_PLATAFORMA` \| `CONFIRMACION_CLIENTE_INTERVENTOR` \| `OTRO` | no | Sección 5 |
| `metodo_verificacion_otro`, `resultado_verificacion`, `responsable_verificacion`, `firma_verificacion` | string | no | Sección 5 |
| `fecha_verificacion` | fecha | no | Sección 5 |
| `cumple_requisitos` | boolean | no | Sección 5; decide el `estado` |
| `conductor_id`, `vehiculo_id`, `cliente_id` | uuid | no | Relaciones |
| `observaciones` | string | no | |

`estado` se ignora si llega; `creado_por_id` sale del token. Los enums de las
secciones 3 a 5 no los valida el esquema: un valor fuera de lista lo rechaza
Prisma (400).

**Respuesta 201** — `{ success, message, data: <SNC con conductor, vehiculo, cliente y creado_por> }`.

**Errores**: 400 de Fastify; 400 ante cualquier fallo del servicio (un enum
inválido de las secciones 3 a 5, un id de relación que no existe…).

### `PUT /api/salidas-nc/:id`

Sin esquema de body: lo que llega va **entero** a Prisma, con las fechas
convertidas y el `estado` recalculado. Mandar solo un campo sin
`cumple_requisitos` deja la SNC en `ABIERTA` aunque estuviera `CERRADA`.
Responde 200 con la SNC y sus relaciones; 400 si no existe o Prisma rechaza
algún campo.

### `GET /api/salidas-nc/:id` y `DELETE /api/salidas-nc/:id`

`GET` responde `{ success, data: <SNC con relaciones> }` y 404 ante cualquier
fallo: inexistente, o un id que no es uuid (con el mensaje de Prisma). `DELETE`
borra la fila y responde `{ success, message }`; 400 si no existe.

### `GET /api/salidas-nc/:id/pdf`

PDF del registro, HTML paginado por Chromium (`pdfFromHtml`, plantilla
`snc-pdf.template.ts`, carta, márgenes de 10 mm) con la marca de la empresa:
`Content-Type: application/pdf`, `Content-Disposition: inline; filename="SNC-0007.pdf"`.
400 si la SNC no existe.

### `GET /api/salidas-nc/estadisticas` y `GET /api/salidas-nc/siguiente-numero`

```json
{ "success": true, "data": { "total": 31,
  "porClasificacion": [ { "clasificacion": "MAYOR", "count": 12 } ],
  "porEstado": [ { "estado": "ABIERTA", "count": 20 } ],
  "porTipoDeteccion": [ { "tipo": "DURANTE_SERVICIO", "count": 15 } ] } }
```

`siguiente-numero` responde `{ success, data: { numero } }` con el mayor
`numero_snc` más uno. Es informativo: el número real lo asigna la secuencia al
crear.

## Efectos

- **PDF**: se genera en cada petición; no se guarda.
- **Registro de actividad**: cada escritura con éxito deja fila en
  `registro_actividad` (ver [actividad](./actividad.md)).
- No emite sockets ni notificaciones.

## Observaciones

- Las lecturas solo piden sesión: cualquier usuario del equipo, también de
  áreas sin el módulo, ve las SNC con nombre y cédula de conductores y la firma
  de verificación. El comentario de las rutas lo justifica por `limited`, pero
  `salidas-nc` no da `read` ni `limited` a ningún área
  (`src/config/permissions.ts`).
- `PUT /:id` no valida el body: permite reescribir cualquier columna,
  `numero_snc` y `creado_por_id` incluidos (`salidas-nc.service.ts`).
- El `estado` se recalcula en cada `PUT` solo con `cumple_requisitos`: una
  edición parcial reabre una SNC cerrada.
- `DELETE` borra en duro, contra la regla de borrado lógico del repo.
- `siguiente-numero` no lee la secuencia: tras borrar la última SNC anuncia un
  número que la base ya no va a usar.
- `GET /:id` responde 404 para cualquier error y `PUT`, `DELETE` y `pdf`
  responden 400 para un id inexistente; `limit` no tiene tope.
