# Estado de cuenta SIMIT

`/api/simit` · código en [`src/modules/simit/`](../../src/modules/simit/) · el panel se sirve desde [`dashboard`](./dashboard.md)

Consulta el estado de cuenta público del SIMIT para los vehículos y conductores
que tuvieron servicios en los últimos 30 días. Cada resultado se guarda como
historial inmutable en `simit_consultas`; el identificador de los conductores
se enmascara antes de persistirlo y devolverlo. El portal se consulta con
Chromium y Playwright; en Docker se usa el Chromium que ya instala la imagen.

Las consultas individuales registran primero `en_curso`, contestan sin esperar
al navegador y notifican el resultado mediante `simit:consulta:actualizada`.
Las consultas con obligaciones generan una alerta para usuarios activos de
HSEQ y Talento Humano, una vez por resultado y día.

## Acceso

| Rutas | Permiso |
|---|---|
| Historial, programación y consultas individuales de vehículos | `flota:read`; iniciar una consulta requiere `flota:full` |
| Historial y consultas individuales de conductores | `conductores:read`; iniciar una consulta requiere `conductores:full` |
| Editar programación, iniciar lote y consultar su progreso | `admin` (`requireAdmin`) |

El panel del dashboard lo ven Operaciones y Administración si tienen acceso a
`servicios`, `flota` y `conductores`. Solo Administración puede modificar el
horario e iniciar un lote manual.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/simit/programacion` | `flota:read` | Frecuencia y horarios actuales |
| PUT | `/api/simit/programacion` | `admin` | Guarda frecuencia y hora de inicio |
| POST | `/api/simit/vehiculos/:id/consultar` | `flota:full` | Inicia una consulta individual |
| POST | `/api/simit/conductores/:id/consultar` | `conductores:full` | Inicia una consulta individual |
| GET | `/api/simit/vehiculos/:id` | `flota:read` | Historial de una placa |
| GET | `/api/simit/conductores/:id` | `conductores:read` | Historial de un conductor |
| POST | `/api/simit/ejecutar-ahora` | `admin` | Inicia el lote manual en segundo plano |
| GET | `/api/simit/ejecuciones/:id` | `admin` | Estado y progreso del lote en memoria |

El `:id` de ficha debe ser UUID. La programación admite `cadaHoras` de
`1`, `2`, `3`, `4`, `6`, `8`, `12` o `24`, y `horaInicio` en formato `HH:mm`.
Por defecto consulta cada 24 horas desde las 08:00, hora de Colombia.

El cron recorre las fichas activas vinculadas a servicios realizados,
planillados o liquidados en la ventana de 30 días. Las ejecuciones de lote
recientes y su progreso viven en memoria; el historial de resultados sí queda
persistido en PostgreSQL. Un fallo al consultar una ficha queda registrado
como `error` y no detiene el resto del lote.

## Eventos

`simit:consulta:actualizada` se emite a todos los sockets con el tipo de ficha,
su id, el id de la consulta, la fecha y el estado. No incluye saldos ni detalle
de comparendos. Ver [tiempo real](../tiempo-real.md#consultas-simit).
