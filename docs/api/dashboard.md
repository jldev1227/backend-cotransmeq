# Panel de inicio

`/api/dashboard` · código en [`src/modules/dashboard/`](../../src/modules/dashboard/) · permiso [`dashboard`](../permisos.md#catálogo-de-módulos) (general); escribir la seguridad social por defecto pide [`conductores`](../permisos.md#catálogo-de-módulos) `full`

El panel de `/dashboard` se arma por **secciones**, una por área, y cada sección
se pide por separado: la página pinta las tarjetas con su esqueleto y las va
llenando, en vez de esperar a la consulta más lenta. Una sección se muestra si
pasa dos filtros, los dos obligatorios (`secciones.ts`):

- **área**: la sección está pensada para esas áreas; `role: 'admin'` las ve todas;
- **módulos**: el usuario tiene acceso (cualquier nivel, lista blanca incluida) a
  **todos** los módulos de los que salen sus datos. El panel no puede ser una
  puerta trasera a datos que la pantalla del módulo le niega.

| Sección (`id`) | Título | Áreas | Módulos que exige |
|---|---|---|---|
| `operaciones` | Operaciones | `operaciones`, `administracion` | `servicios` |
| `hseq` | HSEQ | `hseq`, `administracion` | `formularios`, `conductores` |
| `mantenimiento` | Mantenimiento | `mantenimiento`, `administracion` | `flota`, `mantenimiento` |
| `talento_humano` | Talento humano | `talento_humano`, `administracion` | `conductores` |
| `facturacion` | Financiero | `facturacion`, `administracion` | `liquidaciones-servicios` |
| `contabilidad` | Contabilidad | `contabilidad`, `administracion` | `terceros` |

Dentro de cada sección, los bloques que leen de **otro** módulo se omiten uno a
uno si el usuario no lo tiene (la clave no aparece en la respuesta). Conviven dos
clases de cifras: las del **periodo** elegido y las de **ahora** (quién está en
servicio, qué falta por cerrar), que no dependen del periodo. El periodo es un
rango de días en hora de Colombia (UTC-5 fijo, `periodo.ts`).

El módulo guarda además la **seguridad social por defecto** de la empresa (EPS,
fondo de pensión y ARL) en `configuracion_empresa` con la clave
`seguridad_social_defecto`, y la puede aplicar a los conductores **vinculados**
que no la tienen. «Vinculado» es un conductor no borrado ni oculto, con tipo de
contrato y fecha de ingreso, y que no esté `inactivo`, `retirado` ni
`desvinculado`.

## Acceso

| Rutas | Guarda |
|---|---|
| `GET /api/dashboard/secciones`, `GET /api/dashboard/secciones/:id`, `GET /api/dashboard/talento-humano/seguridad-social` | `dashboard:read` (`onRequest: authMiddleware` + `preHandler: requirePermission('dashboard')` en la ruta). `dashboard` es `general: true`: entra cualquiera con sesión, salvo quien tenga lista blanca sin `dashboard` (con `read` o más) |
| `PUT /api/dashboard/talento-humano/seguridad-social`, `POST /api/dashboard/talento-humano/seguridad-social/aplicar` | `conductores:full`, porque escribe en las fichas. `conductores` también es `general: true` (ver Observaciones) |
| Dentro de `secciones/:id` | el controlador recalcula las secciones visibles del usuario; una que no le toca responde 404 |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/dashboard/secciones` | `dashboard:read` | Secciones que le tocan al usuario y sus módulos accesibles |
| GET | `/api/dashboard/secciones/:id` | `dashboard:read` | Datos de una sección para un periodo |
| GET | `/api/dashboard/talento-humano/seguridad-social` | `dashboard:read` | Seguridad social por defecto de la empresa |
| PUT | `/api/dashboard/talento-humano/seguridad-social` | `conductores:full` | Guarda la seguridad social por defecto |
| POST | `/api/dashboard/talento-humano/seguridad-social/aplicar` | `conductores:full` | La aplica a los vinculados que no la tienen |

### `GET /api/dashboard/secciones`

**Respuesta 200**

```json
{
  "success": true,
  "data": {
    "secciones": [
      { "id": "operaciones", "titulo": "Operaciones", "descripcion": "…", "disponible": true }
    ],
    "modulos": { "dashboard": "full", "servicios": "full", "recargos": "read" }
  }
}
```

`disponible` dice si la sección ya tiene constructor (hoy, las seis). `modulos` es
`getAccessibleModules` con la lista blanca del usuario.

### `GET /api/dashboard/secciones/:id`

**Parámetro**: `id`, uno de `operaciones`, `hseq`, `mantenimiento`,
`talento_humano`, `facturacion`, `contabilidad`.

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `desde` | `YYYY-MM-DD` | primer día del mes en curso | Inclusive. Un valor con otro formato se ignora |
| `hasta` | `YYYY-MM-DD` | último día del mes en curso | Inclusive. Si queda antes de `desde`, se intercambian; el rango se corta a 400 días |

**Respuesta 200**: `{ "success": true, "data": { "periodo": { "desde", "hasta", "dias" }, …bloques } }`.
Cada elemento de lista trae un `enlace` a la pantalla del frontend.

| Sección | Bloques siempre | Bloques condicionados (módulo) |
|---|---|---|
| `operaciones` | `kpis` (servicios y valor del periodo, `por_estado`, `ahora` con conductores y vehículos en servicio, programados, disponibles y en mantenimiento), `servicios_por_dia`, `hora_realizacion` (distribución por hora, promedio circular y pico de 3 h), `clientes_frecuentes` (8, sin cancelados), `sin_cerrar` (en curso de hace más de 7 días: total y 20) | `planillas_sin_dias` (`recargos`), `horas_laboradas` (`recargos` o `recorridos`: cobertura por hora, de las planillas o, si no hay, de los recorridos), `liquidaciones_pendientes` (`liquidaciones-servicios`: BORRADOR, LIQUIDADA y APROBADA, y las 8 últimas) |
| `hseq` | `kpis`, `en_servicio` (conductores en servicio, con su servicio en curso y si hicieron el preoperacional hoy), `preoperacionales` (HSEQ-FR-08 y HSEQ-FR-09 entregados, por día y por hora), `ranking_formularios`, `dias_laborados` (10), `descansos` (ciclo 21-9 en una ventana de 45 días) | `fatiga` (`recargos`: horas por jornada, jornadas de más de 12 h, racha sin descanso y sueño reportado), `horas_laboradas` (`recargos` o `recorridos`), `hora_realizacion` (`servicios`) |
| `mantenimiento` | `kpis`, `planes` (vencidos, próximos, órdenes abiertas, costo del mes), `enlaces`, `estado_vehiculos` (último preoperacional por placa con ítems en Malo), `items_malos`, `placas_con_novedades`, `mantenimientos`, `kilometraje`, `vencimientos` (documentos vencidos o que vencen en 30 días) | sin bloques condicionados; con `formularios` los enlaces abren el envío completo y sin él, el resumen de la pantalla de Mantenimiento |
| `talento_humano` | `kpis`, `pendientes` (datos faltantes de la ficha de los vinculados), `sin_contrato`, `licencias` (vencidas o que vencen en 60 días), `seguridad_social` (`defecto`, `sin_dato`, `puede_editar` = `conductores` con `full`), `dias_laborados`, `descansos` | `nomina` (`nomina`: liquidaciones en estado Liquidado del periodo, los 12 mejor pagados y los últimos 6 periodos) |
| `facturacion` | `kpis` (por facturar, por aprobar, facturado y anuladas), `por_facturar` (30 liquidaciones APROBADAS), `facturado_mes_a_mes` (6 meses), `ranking_clientes`, `finanzas` (ingresos liquidados y facturados, costos identificados por fuente, margen estimado, cartera de las facturas del periodo) | costos por `liquidaciones-terceros`, `nomina`, `viaticos`, `combustible` y `mantenimiento` solo aparecen con acceso al módulo correspondiente; `previstas_pagar`, `terceros_mes_a_mes`, `ranking_terceros` y `ranking_placas` requieren `liquidaciones-terceros`; la cartera requiere `cartera` |
| `contabilidad` | `kpis` (terceros sin identificación o sin contacto), `terceros_incompletos` (40) | el mismo bloque de terceros (`liquidaciones-terceros`) |

Las fórmulas y fuentes de cada cifra están comentadas en su `seccion-*.ts`.

El margen es **estimado**, no un estado de resultados contable: compara el total de
liquidaciones de servicio no anuladas (por mes de servicio) con cierres aprobados o
pagados a terceros, nómina neta liquidada, viáticos legalizados, gastos de empresa
clasificados como oficina/bancarios/otros/servicios profesionales, combustible y
órdenes ejecutadas de mantenimiento, según los permisos disponibles. Se marca como
parcial si falta acceso a alguna fuente. Los gastos directos a conductores y la
categoría de mantenimiento pagada por viáticos se presentan aparte para no duplicar
nómina u órdenes. También puede haber cruces entre pagos a terceros, combustible y
mantenimiento si un mismo costo se registró en varios módulos. No suma gastos fijos
ni impuestos que no estén registrados ahí.
Las facturas se cuentan por fecha de registro; las liquidaciones y cierres por mes de
servicio; el resto por la fecha registrada en cada módulo.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 404 | `id` desconocido o sección que no le toca al usuario | `{ "success": false, "message": "Esa sección no está disponible para tu usuario." }` |
| 200 | Sección sin constructor (hoy ninguna) | `{ "success": true, "data": null, "message": "Sección en construcción" }` |
| 500 | Falló alguna consulta | `{ "success": false, "message": "No se pudo armar la sección" }` |

### `GET /api/dashboard/talento-humano/seguridad-social`

**Respuesta 200**: `{ "success": true, "data": { "eps": "…", "fondo_pension": "…", "arl": "…" } }`
(cada uno `null` si no está configurado).

### `PUT /api/dashboard/talento-humano/seguridad-social`

**Body** (zod)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `eps` | string \| null | no | `trim`, máximo 120 |
| `fondo_pension` | string \| null | no | `trim`, máximo 120 |
| `arl` | string \| null | no | `trim`, máximo 120 |

Reemplaza el valor entero: un campo que no llega o llega vacío se guarda como
`null`. Guarda también `actualizado_por_id`.

**Respuesta 200**: `{ "success": true, "data": { "eps", "fondo_pension", "arl" } }`.

**Errores**: 400 `{ "success": false, "message": "Datos inválidos", "details": <error.flatten()> }`.

### `POST /api/dashboard/talento-humano/seguridad-social/aplicar`

Sin body. Por cada campo configurado ejecuta un `UPDATE` sobre `conductores`
(los vinculados con ese campo `NULL` o vacío) y pone su `updated_at` a ahora.

**Respuesta 200**:
`{ "success": true, "data": { "eps": 12, "fondo_pension": 3, "arl": 0 }, "message": "Seguridad social aplicada a los vinculados que no la tenían" }`
(cuántos conductores cambió cada campo).

**Errores**: 400 `{ "success": false, "message": "Primero guarda la EPS, el fondo de pensión o la ARL por defecto." }`
si no hay nada guardado.

## Efectos

- `configuracion_empresa` (upsert de `seguridad_social_defecto`) y `conductores`
  (SQL directo, sin pasar por el servicio de conductores: no emite eventos de
  socket).
- `registro_actividad`: las dos escrituras quedan en el módulo `conductores`, con
  las frases «cambió la seguridad social por defecto de la empresa» y «completó la
  seguridad social de los conductores vinculados» (ver [actividad](./actividad.md)).

## Observaciones

- **`conductores:full` no restringe en la práctica.** `conductores` es
  `general: true`, así que cualquier usuario del equipo sin lista blanca puede
  cambiar la seguridad social por defecto y aplicarla a todos los vinculados,
  aunque el comentario de `dashboard.routes.ts` la presenta como reservada.
- **Enlaces a pantallas que no existen.** `ranking_placas` enlaza a
  `/dashboard/flota/<id>` y `ranking_terceros` y `terceros_incompletos` a
  `/dashboard/terceros/<id>`, rutas que no existen en los dos frontends (solo hay
  `/dashboard/flota` y `/dashboard/terceros`); la sección de mantenimiento ya usa
  `/dashboard/flota?vehiculo=<id>` (`seccion-facturacion.ts`).
- **Algunos bloques leen de otro módulo sin comprobarlo**, en contra de la regla
  de `secciones.ts`: en HSEQ, `en_servicio` (servicios) y `dias_laborados` /
  `descansos` (recorridos); en talento humano, `dias_laborados` y `descansos`. Con
  las reglas por área coincide, pero con una lista blanca el panel muestra datos
  de un módulo que la persona no tiene (`seccion-hseq.ts`,
  `seccion-talento-humano.ts`).
- El `PUT` no admite cambios parciales: mandar solo `eps` borra el fondo y la ARL
  guardados.
