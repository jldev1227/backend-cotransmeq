# Tiempo real (Socket.IO)

Cómo funciona Socket.IO en el servidor: quién puede conectarse, a qué salas
entra cada cliente, qué hace cada gateway y el catálogo completo de eventos que
el backend emite y escucha. Léelo antes de emitir un evento nuevo, de renombrar
uno, de tocar un canvas colaborativo o de cambiar `SOCKET_AUTH_MODE`. La
autenticación HTTP está en [autenticacion.md](./autenticacion.md) y las colas
que informan su progreso por socket, en
[tareas-programadas.md](./tareas-programadas.md).

## Piezas

| Archivo | Qué hace |
|---|---|
| [sockets/index.ts](../src/sockets/index.ts) | `initSockets(server)`: crea el servidor, instala la autenticación, atiende presencia y evaluaciones, registra los gateways y conecta los emisores de las colas. Exporta `getIo()` (lanza si Socket.IO no está montado), `emitToUser`, `emitNotificacion`, `emitLiquidacionServicio`, `emitFacturacionLiquidacion`, `emitLiquidacionTercero` y `eventoMeta` |
| [sockets/auth.ts](../src/sockets/auth.ts) | Verificación del handshake, `getSocketUser`, `resolveActor`, `corsOrigins` |
| [sockets/sheet.gateway.ts](../src/sockets/sheet.gateway.ts) y [sheet-rooms.ts](../src/sockets/sheet-rooms.ts) | Canvas de Univer (`sheet:*`): presencia, parches por celda con versión optimista, reversiones y altas o bajas de hojas |
| [sockets/liquidacion-tercero.gateway.ts](../src/sockets/liquidacion-tercero.gateway.ts) | Edición colaborativa de un cierre final (`row:*`, `typing`, `focus`) |
| [liquidaciones-chat.gateway.ts](../src/modules/liquidaciones-chat/liquidaciones-chat.gateway.ts) | Sala de chat de una liquidación de tercero |
| [formularios-dinamicos.gateway.ts](../src/modules/formularios-dinamicos/formularios-dinamicos.gateway.ts) | Salas del portal del conductor y del panel de formularios |
| [queue/borrador-queue.gateway.ts](../src/queue/borrador-queue.gateway.ts), [queue/bulk-save-liquidacion-tercero.gateway.ts](../src/queue/bulk-save-liquidacion-tercero.gateway.ts) | Cancelación de trabajos de cola desde el cliente |
| `*.events.ts` | Tablas `EVENTOS_*` y emisores de dominio: [servicios](../src/modules/servicios/servicios.events.ts), [vehículos](../src/modules/vehiculos/vehiculos.events.ts), [clientes](../src/modules/clientes/clientes.events.ts); los de formularios en `FORM_EVENTS` ([formularios-dinamicos.events.ts](../src/modules/formularios-dinamicos/formularios-dinamicos.events.ts)) |

Socket.IO se monta en `server.ts` **después** del `listen`, sobre el mismo
servidor HTTP y en la ruta por defecto (`/socket.io`). Cualquier emisor puede
correr antes de eso (un cron, un script, un test sin servidor): por eso todos
resuelven `getIo()` en el momento de emitir y atrapan el error.

## Configuración del servidor

| Opción | Valor | Por qué |
|---|---|---|
| `cors.origin` | `SOCKET_CORS_ORIGINS` (separados por coma); vacío → `'*'` | Lista propia, distinta de la del API REST. Conviene fijarla |
| `connectionStateRecovery.maxDisconnectionDuration` | 2 min | Un corte breve recupera id, salas y los paquetes perdidos. Sin esto el cliente volvía «conectado» con la pantalla desfasada |
| `connectionStateRecovery.skipMiddlewares` | `false` (el defecto es `true`) | Un socket recuperado vuelve a pasar por la verificación del token |
| `pingInterval` / `pingTimeout` | 25 s / 20 s | Los valores por defecto, escritos para que quien los toque sepa qué cambia: bajarlos detecta caídas antes pero provoca desconexiones falsas en móvil |
| `connectTimeout` | 20 s | El cliente se rinde a los 10 s (`HANDSHAKE_TIMEOUT` del frontend) |

La recuperación de estado vive en la memoria del proceso: si el que se reinicia
es el backend, no hay nada que recuperar y todos los clientes entran como
nuevos. Por eso el frontend avisa a sus stores en cada reconexión y vuelve a
unirse a sus salas.

## Autenticación

[auth.ts](../src/sockets/auth.ts) instala un middleware de handshake. Toma el
token de `handshake.auth.token`, de la cabecera `Authorization: Bearer` o del
query `?token=` y lo resuelve con `identidadDelToken`:

| Token | Resultado |
|---|---|
| Del equipo (sin `tipo` o `app_usuario`) con la sesión abierta | Identidad de equipo en `socket.data.user`: `id`, `name` (nombre, o el correo), `correo`, `area` (arreglo) y `role`, **leídos de la base** con la misma comprobación que `authMiddleware` (`usuarioDeSesion`, caché de 30 s). Un `app_usuario` necesita además su enlace vigente (`sesionAppVigente`) |
| Del portal (`conductor_portal`) registrado y vigente | Conecta sin identidad de equipo (`socket.data.user` vacío), con `socket.data.portalConductorId` para presencia móvil. El gateway de formularios lo verifica por su cuenta en `forms:join` |
| Cualquier otro: sesión cerrada o vencida, usuario inactivo, enlace de la app revocado, tokens de impresión o de días laborados, firma inválida | Token inválido |

`SocketUser.area` admite también un string por compatibilidad con tokens
viejos, pero lo que deja el handshake es siempre el arreglo de la base.

`SOCKET_AUTH_MODE`:

| Modo | Sin token o con token inválido | Identidad de un evento |
|---|---|---|
| `off` | Pasa; no se instala el middleware | La del payload |
| `permissive` | Pasa sin identidad, y deja un aviso en el log (con el total de conexiones sin token) | La del token; si no hay identidad, la del payload |
| `enforce` (**el default**) | Rechaza el handshake (`unauthorized`), también si la base no responde al verificar la sesión | Solo la del token |

`enforce` es el default desde octubre de 2026: los dos clientes del front
mandan el token en cada intento de conexión. `permissive` queda como salida de
emergencia en el `.env`; mientras esté puesto, un socket sin token recibe todos
los `io.emit`. La suite de pruebas corre en `enforce` (`.env.test`). Qué valor
tiene producción no se ve en el repo: se decide en el `.env` del servidor.

**La identidad sale siempre del token, nunca del payload.** Los handlers usan
`resolveActor(socket, payloadUser)`, que prefiere el token y solo cae al `user`
del payload mientras el modo no sea `enforce`, o `getSocketUser(socket)`, que
no admite respaldo. La regla existe porque `join-dashboard` aceptaba el
`userId` que le mandaran y cualquiera podía entrar a la sala privada de otro;
y porque el `user` del payload se persistía en `actualizado_por_id`. Tampoco se
vuelcan los headers del handshake al log: llevan el `Authorization`.

El token del portal tiene que conectar, porque el portal recibe así sus avisos
de formularios (`tests/sockets-enforce.test.ts` lo fija), pero no da
identidad: los handlers que piden identidad de equipo lo tratan como a un
socket sin token. Como cualquier socket conectado, sí recibe lo que se emite a
todos (`io.emit`), también en `enforce`.

Lo que el handshake **no** hace, a diferencia de `authMiddleware`:

- **Volver a mirar en cada evento.** La identidad se resuelve una vez, al
  conectar. Cerrar la sesión no corta un socket ya abierto: el servidor emite
  `sesion-cerrada` a la sala del usuario para que su cliente se desconecte. Un
  cambio de áreas o rol tampoco llega al socket hasta que se reconecta; la
  reconexión sí vuelve a pasar por el handshake (`skipMiddlewares: false`).

## Salas

| Sala | Quién entra y cómo | Qué viaja por ella |
|---|---|---|
| `user-<usuarioId>` | `join-dashboard`; el id sale del token (el del payload solo es respaldo fuera de `enforce`) | `nueva-notificacion`, `sesion-cerrada`, progreso de las colas, `asistencias:export:*`, `certificados:import-progress`, `recargos-bulk-recalc:*` |
| `evaluacion-<evaluacionId>` | `join-evaluacion`; exige identidad del token | `nueva-respuesta`, `respuesta-actualizada` (con el nombre del evaluado) |
| `sheet:<scope>:<anio>` | `sheet:join` con `adicionales`, `ocasional` o `ingresos` (libros anuales o de periodo con presencia por año) | Protocolo `sheet:*` |
| `sheet:<scope>:<anio>:<mes>` | `sheet:join` con `cierres-finales`, `nomina` o `recorridos` (libros de periodo) | Protocolo `sheet:*`, `borrador-nomina:item`, `envio-nomina:item`, `envio-liquidacion:actualizado` |
| `sheet:servicios-historial` | `sheet:join` con `servicios-historial`; sala global, ignora el año | Presencia del histórico de liquidaciones de servicios |
| `row:<tabla>:<id>` | `join-room` (en la práctica `row:liquidacion-tercero-final:<cierreId>`; el ocasional emite a `row:liquidacion-tercero-ocasional:<id>`) | `row:updated`, `presence:update`, `typing`, `typing:stop`, `focus` |
| `chat:liquidacion-tercero:<liquidacionId>` | `chat:join` | Mensajes, presencia, escritura y recordatorios del chat |
| `forms:admin` | `forms:join-admin`; comprueba el permiso del módulo `formularios` con `checkAccess` y la lista blanca de `permisos_rutas` | Eventos `forms:*` del panel |
| `conductor:<conductorId>:forms` | `forms:join`, solo con token del portal; el id sale del token y el evento no lleva parámetros | Eventos `forms:*` del conductor |
| `<socket.id>` | Implícita: el cliente manda su `socketId` en la petición del ZIP de desprendibles | `progress:*` |
| `certificados-import` | Nadie se une; es el destino de respaldo cuando una importación no tiene usuario | `certificados:import-progress` |

La granularidad de las salas `sheet:*` está explicada en
[sheet-rooms.ts](../src/sockets/sheet-rooms.ts): los libros anuales comparten
sala por año (presencia de libro), y los de periodo llevan mes para no difundir
cada parche de doce meses a todos los conectados del año.

**Pendiente conocido: permiso por recurso.** `join-evaluacion`, `sheet:join`,
`join-room` y `chat:join` exigen identidad, pero no comprueban si ese usuario
puede ver *esa* evaluación, *ese* libro, *ese* cierre o *esa* liquidación:
basta conocer el uuid o el periodo. Falta decidir la regla de negocio (autoría,
área). `config/permissions.ts` no tiene módulo para evaluaciones, y llamar a
`checkAccess` con un módulo inexistente deniega a todos.

## Gateways

### Presencia y sala privada (`sockets/index.ts`)

`join-dashboard` une el socket a `user-<id>`, lo apunta en un `Set` de usuarios
conectados y difunde `usuarios-online` con la lista completa a todos;
`leave-dashboard` y `disconnect` lo sacan. En una conexión recuperada la sala
vuelve sola, pero el `Set` no (el `disconnect` anterior ya lo sacó), así que se
repone a mano. `GET /api/usuarios/online-ids` (solo administradores) y el
listado de usuarios leen ese mismo `Set` (`getOnlineUserIds`).

### Canvas de Univer (`sheet.gateway.ts`)

```
C→S  sheet:join    { scope, anio, mes, sheet_id }
C→S  sheet:leave   { scope, anio, mes }
C→S  sheet:active  { scope, anio, mes, sheet_id }       ← solo actualiza presencia
C→S  sheet:patch   { scope, anio, mes, entity_type, entity_id, field, value,
                     base_version, epoch, request_id, cierre_id? }

S→emisor  sheet:patch:ack | sheet:patch:conflict | sheet:patch:error   (con request_id)
S→resto   sheet:patch:applied   ← socket.to(sala): EXCLUYE al emisor
S→todos   sheet:presence { room, users }
```

- **Versión optimista.** `base_version` convierte cada parche en un
  compare-and-swap: si otro escribió antes, la respuesta es `conflict` con la
  fila del servidor para que el cliente repinte en vez de perder el dato.
- **Epoch.** Revertir un snapshot incrementa el *epoch* del periodo (en
  memoria) y emite `sheet:reverted`; todo parche en vuelo con el epoch viejo se
  rechaza como `conflict` con `reason: 'epoch'`, en vez de reintroducir valores
  de antes de la reversión.
- **`applied` excluye al emisor** (`socket.to`). El gateway viejo usaba
  `io.to` y cada cliente recibía el eco de su propio guardado.
- **Qué acepta cada scope:**

| Scope | `entity_type` | Qué hace |
|---|---|---|
| todos | `anotacion` | Celda fuera de la tabla: capa de anotaciones (`canvas-anotaciones`), anclada a fila relativa, ítem, clave o cabecera |
| `adicionales` | `adicional` | `LiquidacionesTercerosAdicionalesService.actualizarCampo` |
| `cierres-finales` | `concepto`, `item`, `adicional` | `CierreFinalCeldasService`; la respuesta trae `rows` en plural porque un cambio cascadea (prestaciones, impuestos, totales). Exige `cierre_id` |
| `ingresos` | `fila` + `incluir_adicional` | **Solo retransmite**, no escribe: quien marca ya guarda el mes por HTTP y una segunda escritura competiría con ese reemplazo |
| `nomina` | `liquidacion` | `NominaPatchService`; el `applied` lleva los totales recalculados |
| `recorridos` | `segmento`, `dia` | `RecorridosPatchService`, que **comprueba el permiso del módulo `recorridos`** (los sockets no pasan por `requirePermission`) |
| `ocasional`, `servicios-historial` | — | `sheet:patch:error`: el ocasional sigue guardando por HTTP |

- **Eventos que dispara el servidor** (funciones exportadas, a toda la sala,
  emisor incluido porque la petición REST no conoce su socket):
  `sheet:reverted`, `sheet:sheet-added` (lo emite la cola de borradores al
  crear cada cierre), `sheet:sheet-removed`, `sheet:estado-changed` (el cliente
  **tiene** que bloquear la hoja: el servidor rechaza parches sobre cierres que
  ya no son borrador), `sheet:hoja-color` y `sheet:invalidate` (cambios de
  geometría que no caben en un parche de celda; lleva `by` para que el autor no
  se recargue a sí mismo).

### Cierres finales celda a celda (`liquidacion-tercero.gateway.ts`)

Lo usa la vista individual de un cierre. `join-room { table, id, user }` une a
`row:<table>:<id>` y difunde `presence:update`. `row:save { table, id, changes,
requestId }` escribe según `table`: `liquidacion-tercero-final` (campos del
cierre), `-concepto` (reemplaza los conceptos, deduplicando por tipo, concepto,
conductor y propietario), `-adicionales`, `-propietario-overrides` y
`-propietarios`. Tras guardar:

- `row:updated` a la sala del cierre (todos deben ver el cambio) y
  `row:updated:global` a **todos** los conectados (el historial refresca la
  fila aunque no esté en la sala);
- `save-success` o `save-error` **solo al emisor**. Antes iban a la sala y el
  acuse de uno ponía «Guardado» en el indicador de los demás.

La rama mensual que vivía aquí era inalcanzable y se quitó; su sustituto es el
gateway `sheet:*`.

### Chat de liquidaciones

`chat:join`, `chat:leave` y `chat:typing` llegan por socket; los mensajes y
recordatorios se escriben por REST (`/api/liquidaciones-terceros/:id/chat/…`,
con permiso del módulo) y el controlador los difunde a la sala:
`chat:message`, `chat:recordatorio:nuevo`, `chat:recordatorio:estado`.

### Formularios dinámicos

Dos reglas, cada una por un fallo concreto: se emite **solo después del
commit** (emitir dentro de la transacción hacía que el cliente releyera datos
que todavía no existían, o que un rollback deshacía), y **el payload no lleva
datos**: ids, `revision` y `occurredAt`, más un `eventId` para deduplicar tras
una reconexión. El evento invalida; HTTP sigue siendo la autoridad. Meter
respuestas en el socket lo convertiría en un canal de datos de salud sin
control de permisos por sala.

## Emitir un evento

1. **Después del commit**, fuera de cualquier `$transaction`.
2. **`getIo()` de `src/sockets`, y el emisor nunca lanza.** `getIo()` lanza si
   Socket.IO no está montado (tests, scripts, arranque); un aviso que no sale
   no debe deshacer una operación que ya se guardó. Sigue el patrón de
   `emitir()` en [servicios.events.ts](../src/modules/servicios/servicios.events.ts)
   o de `avisarRecargos()` en `recargos.controller.ts`. No uses
   `request.server.io`: nadie decora `io` en la instancia de Fastify, así que es
   `undefined` y un `if (io)` se salta la emisión en silencio.
3. **Nombre literal**, nunca interpolado: un nombre construido en tiempo de
   ejecución no se puede buscar ni cruzar con el frontend (el test de contrato
   falla). Para un dominio nuevo, declara los nombres en una tabla
   `export const EVENTOS_<DOMINIO> = { … } as const` dentro de
   `<modulo>.events.ts`.
4. **No renombres** los que existen, aunque mezclen convenciones
   (`servicio:creado`, `vehiculo-creado`, `cliente:created`): los dictó el
   frontend que ya escuchaba, y unificarlos por estética deja las páginas mudas.
5. **Piensa el destino.** La mayoría de los eventos de dominio son `io.emit` a
   **todos** los conectados y llevan la entidad completa (un servicio, la URL
   firmada de la foto de un conductor, la respuesta de una asistencia). Con
   `SOCKET_AUTH_MODE=permissive` eso incluye sockets sin token. Lo personal va
   a `user-<id>` o a una sala con control de acceso. Una entidad que pueda traer
   filas de conductores o usuarios pasa antes por `sinCredenciales`
   ([sin-credenciales.ts](../src/lib/sin-credenciales.ts)), como hacen los
   emisores de servicios y recargos, para que el hash de la contraseña no
   llegue a todos.
6. Los eventos de liquidaciones y facturas llevan además el sobre `_evento`
   (`eventoMeta`: tipo, scope, actor, etiqueta, estados y `ts` del servidor)
   para el feed de actividad, separado de los campos de la entidad.

## Catálogo de eventos

Generado leyendo el código (`.emit(`, `this.emit(…)` de las colas, helpers
`emit*` y tablas `EVENTOS_*`). C→S = el cliente lo emite y el servidor lo
escucha; S→C = lo emite el servidor. «Todos» = `io.emit` a cualquier socket
conectado.

### Conexión, presencia y sesión

| Evento | Dir. | Destino | Origen | Payload / notas |
|---|---|---|---|---|
| `ping` / `pong` | C→S / S→C | emisor | `sockets/index.ts` | Latencia |
| `join-dashboard` / `leave-dashboard` | C→S | — | `sockets/index.ts` | `userIdPedido` (solo respaldo) |
| `usuarios-online` | S→C | todos | `sockets/index.ts` | Lista de ids conectados |
| `mobile-presence:join` / `mobile-presence:leave` | C→S | — | `EVENTOS_PRESENCIA_MOVIL` | La app declara iOS o Android; la identidad sale exclusivamente del token móvil validado |
| `mobile-presence:changed` | S→C | todos | `EVENTOS_PRESENCIA_MOVIL` | Sin datos personales; Equipo vuelve a consultar `GET /api/sesiones/app-movil`, protegido para rol admin |
| `nueva-notificacion` | S→C | `user-<id>` | `emitNotificacion` (crons, servicios, facturación, viáticos…) | La fila de `notificacion`. Sin `usuario_id` cae a todos con aviso en el log. También dispara el Web Push |
| `sesion-cerrada` | S→C | `user-<id>` | `sesiones.controller.ts` | `{ motivo }` |
| `usuario-deshabilitado` | S→C | todos | `usuarios.controller.ts` | `{ usuarioId }` |

### Servicios, flota, clientes y conductores

| Evento | Dir. | Destino | Origen | Payload / notas |
|---|---|---|---|---|
| `servicio:creado`, `servicio:actualizado`, `servicio:cancelado` | S→C | todos | `EVENTOS_SERVICIO` | La entidad |
| `servicio:estado-actualizado` | S→C | todos | `EVENTOS_SERVICIO` | `{ servicio, estadoAnterior }` |
| `servicio:numero-planilla-actualizado` | S→C | todos | `EVENTOS_SERVICIO` | `{ id, servicio }` |
| `servicio:eliminado` | S→C | todos | `EVENTOS_SERVICIO` | Solo `{ id }` |
| `vehiculo-creado`, `vehiculo-actualizado` / `vehiculo-eliminado` | S→C | todos | `EVENTOS_VEHICULO` | Entidad / `{ id }` |
| `vehiculo:oculto`, `vehiculos:actualizacion-masiva` | S→C | todos | `vehiculos.controller.ts` | `{ id, oculto }` / `{ accion, count }` |
| `cliente:created`, `cliente:updated` / `cliente:deleted` | S→C | todos | `EVENTOS_CLIENTE` | Entidad / `{ id }` |
| `cliente:oculto`, `clientes:actualizacion-masiva` | S→C | todos | `clientes.controller.ts` | Ídem |
| `conductor:foto-actualizada` | S→C | todos | `conductores.controller.ts` | `{ conductorId, fotoUrl, fotoUrlFirmada }` |
| `conductor:oculto`, `conductores:actualizacion-masiva` | S→C | todos | `conductores.controller.ts` | `{ id, oculto }` / `{ accion, count }` |

Ningún `servicio:*` lleva la fila entera del conductor: cada operación lo trae
con un `select` de campos de ficha (los cambios de estado, la cancelación y la
planilla, con el mismo del detalle, `CONDUCTOR_DE_SERVICIO`), y `emitir()` pasa
el payload por `sinCredenciales`.

El cierre automático de servicios (cron `cerrar-servicios-con-planilla`)
**no emite** `servicio:*`: los cambios que hace solo se ven al recargar.

### Recargos, planillas y días laborados

| Evento | Dir. | Destino | Origen | Payload / notas |
|---|---|---|---|---|
| `recargo-creado`, `recargo-actualizado` | S→C | todos | `recargos.controller.ts` (`avisarRecargos`) | `{ recargoId, valor_pagar }`: el id y el valor a pagar, no la planilla |
| `recargo-creado` | S→C | todos | El asistente de IA (`asistente/recargos.ts`, con `getIO()`) | `{ recargoId, valor_pagar }`, igual que el controlador |
| `recargo-eliminado`, `recargo-restaurado` | S→C | todos | `recargos.controller.ts` (`avisarRecargos`) | `{ recargoId }` |
| `recargos-eliminados`, `recargos-restaurados` | S→C | todos | `recargos.controller.ts` (`avisarRecargos`) | `{ recargoIds, cantidad }` |
| `recargos-estado-actualizado` | S→C | todos | `recargos.controller.ts` (`avisarRecargos`) | `{ recargoIds, estado, cantidad }` |
| `recargo-recalculado` | S→C | todos (`POST /:id/recalcular`) o `user-<id>` (cada planilla del recálculo masivo) | `recargos.controller.ts` (`avisarRecargos`) y `recargos.service.ts` | `{ recargoId, conductorId, empresaId, mes, año, recargo: { planilla, breakdown }, valor_pagar, timestamp }` |
| `recargos-bulk-recalc:progress`, `recargos-bulk-recalc:done` | S→C | `user-<id>` | `recargos.service.ts` | Si la sala está vacía, se emite a **todos** con `targetUserId` para que el cliente filtre |
| `config-salario-creada`, `config-salario-actualizada` / `config-salario-eliminada` | S→C | todos | `recargos.routes.ts` (`avisarRecargos`) | `{ configId, config }` / `{ configId }` |
| `recargos-importados-transmeralda` | S→C | todos | `recargos.controller.ts` (`avisarRecargos`), al terminar la importación desde la base de Transmeralda | `{ importadas, omitidas, errores }`, para que los canvas se refresquen |
| `dias-laborados:registro-actualizado` | S→C | todos | días laborados y portal del conductor | `{ conductor_id, fecha, tipo, … }` |
| `dias-laborados:bonos-actualizados` | S→C | todos | `bonos.controller.ts` | `{ created, deleted, … }` |

Los eventos REST de recargos salen por `avisarRecargos()`
(`recargos.controller.ts`, que también usa `recargos.routes.ts`): `getIo()`
dentro de un `try/catch`, para que un aviso que no sale no deshaga una
operación ya guardada, y el payload pasado por `sinCredenciales`.
`recargo-creado` y `recargo-actualizado` llevan solo el id y el valor a pagar,
no la planilla.

### Asistencias, inducciones, evaluaciones y certificados

| Evento | Dir. | Destino | Origen | Payload / notas |
|---|---|---|---|---|
| `asistencias:formulario:created`, `:updated`, `:disabled` | S→C | todos | `asistencias.controller.ts` | `{ formulario, timestamp }`. `updated`/`disabled` se eligen con un ternario: están en `EMITIDOS_INDIRECTAMENTE` del test de contrato |
| `asistencias:respuesta:created` | S→C | todos | asistencias y capacitaciones del portal | `{ respuesta, formularioId, … }` |
| `encuestas:respuesta` | S→C | todos | `encuestas.service.ts` | `{ encuestaId, respuestaId, occurredAt }`, sin contenido; el panel vuelve a consultar por REST con permiso |
| `asistencias:export:progress`, `asistencias:export:done` | S→C | `user-<id>` | exportación ZIP | `{ jobId, current, total, … }` |
| `inducciones:created`, `inducciones:updated` | S→C | todos | `inducciones.controller.ts` | `{ induccion, timestamp }` |
| `join-evaluacion` / `leave-evaluacion` | C→S | — | `sockets/index.ts` | `evaluacionId` |
| `nueva-respuesta`, `respuesta-actualizada` | S→C | `evaluacion-<id>` | `registrar-resultado.ts`, `evaluacion.controller.ts` | El resultado, con el nombre del evaluado |
| `certificados:import-progress` | S→C | `user-<id>` | `certificados.import.service.ts` | `{ jobId, phase, processed, total, … }` |
| `progress:start`, `progress:update`, `progress:complete`, `progress:error` | S→C | `<socketId>` | ZIP de desprendibles (`liquidaciones.service.ts`) | `{ total }`, `{ current, total }`… |

### Consultas SIMIT

| Evento | Dir. | Destino | Origen | Payload / notas |
|---|---|---|---|---|
| `simit:consulta:actualizada` | S→C | todos | `simit.events.ts` | `{ tipo, entidad_id, consulta_id, consultado_at, estado_consulta }`; no incluye saldo ni detalle de comparendos |

### Liquidaciones de servicios y facturación

| Evento | Dir. | Destino | Origen | Payload / notas |
|---|---|---|---|---|
| `liquidacion-servicio-created`, `-updated`, `-deleted` | S→C | todos | `liquidaciones-servicios.controller.ts`, asistente | Entidad + `_evento`; `deleted` solo con el id |
| `liquidacion-servicio-borrador` | S→C | todos | autoguardado | `{ id, consecutivo, estado, version }`. **Hoy no lo escucha nadie**, a propósito: el autoguardado no debe repintar la hoja de los demás |
| `liquidacion-servicio-facturada` | S→C | todos | `facturacion-liquidaciones.controller.ts` | Entidad + `_evento` |
| `facturacion-created`, `facturacion-updated`, `facturacion-anulada` | S→C | todos | `facturacion-liquidaciones.controller.ts`; `facturacion-updated` también desde liquidaciones de servicios (al recalcular una factura) y desde `cartera.routes.ts` | Factura + `_evento` |

### Liquidaciones de terceros (cierres, ocasional, adicionales)

| Evento | Dir. | Destino | Origen | Payload / notas |
|---|---|---|---|---|
| `liquidacion-tercero:created` | S→C | todos | `guardarBorrador` de descuentos | `{ id, placa, consecutivo, mes, anio, estado, total_pagar, … }` |
| `liquidacion-tercero-updated` | S→C | todos | `liquidaciones-terceros.controller.ts` (guardar los terceros de una liquidación de servicio) | `{ liquidacion_id, consecutivo, mes, anio, total_items }` + `_evento` |
| `liquidacion-tercero-ocasional:cerrada`, `:deleted` | S→C | todos | servicio del ocasional | |
| `join-room` / `leave-room` | C→S | — | gateway de cierres | `{ table, id, user }` |
| `row:save` | C→S | — | gateway de cierres | `{ table, id, changes, requestId }` |
| `save-success` / `save-error` | S→C | emisor | gateway de cierres | `{ id, table }` / `{ table, id, requestId, error }` |
| `row:updated` | S→C | `row:<tabla>:<id>` | gateway, descuentos (refresco de ítems), traslado de ítems, ocasional | `{ id, changes, updatedBy, updatedById?, updatedAt }`. Sin `updatedById` el cliente lo aplica aunque sea suyo |
| `row:updated:global` | S→C | todos | gateway, ocasional, adicionales | Ídem, para listados que no están en la sala |
| `presence:update` | S→C | `row:<tabla>:<id>` | gateway de cierres | `{ room, users }` |
| `typing:start`, `typing:stop`, `field:focus` | C→S | — | gateway de cierres | `{ table, id, field }` |
| `typing`, `typing:stop`, `focus` | S→C | `row:<tabla>:<id>` | gateway de cierres | `{ field, userId, userName }` |

### Canvas (`sheet:*`)

| Evento | Dir. | Destino | Notas |
|---|---|---|---|
| `sheet:join`, `sheet:leave`, `sheet:active`, `sheet:patch` | C→S | — | Ver el protocolo arriba |
| `sheet:patch:ack`, `sheet:patch:conflict`, `sheet:patch:error` | S→C | emisor | Llevan el `request_id` del parche |
| `sheet:patch:applied` | S→C | sala menos el emisor | Valor ya resuelto por el servidor, `version`, `by` |
| `sheet:presence` | S→C | sala | `{ room, users: [{ id, name, mes, sheetId, joinedAt }] }` |
| `sheet:reverted` | S→C | sala | `{ scope, anio, mes, version, epoch, by }` |
| `sheet:sheet-added` | S→C | sala del periodo | Lo emite la cola de borradores de cierres |
| `sheet:sheet-removed`, `sheet:estado-changed`, `sheet:hoja-color` | S→C | sala de `cierres-finales` | `cierre_id` y lo que cambió |
| `sheet:invalidate` | S→C | sala | `{ scope, anio, mes, cierre_id, accion, by }`; también desde el servicio de adicionales |

### Chat de liquidaciones

| Evento | Dir. | Destino | Notas |
|---|---|---|---|
| `chat:join`, `chat:leave` | C→S | — | `{ liquidacionId, user }` |
| `chat:typing` | C→S y S→C | sala del chat | Reenvía `{ userId, name, typing }` **tal como llegan** |
| `chat:presence` | S→C | sala | `{ users }` |
| `chat:message` | S→C | sala | El mensaje guardado por REST |
| `chat:recordatorio:nuevo`, `chat:recordatorio:estado` | S→C | sala (la de la liquidación de origen) | El recordatorio |

### Formularios dinámicos (`FORM_EVENTS`)

| Evento | Dir. | Destino | Payload |
|---|---|---|---|
| `forms:join`, `forms:leave`, `forms:join-admin`, `forms:leave-admin` | C→S | — | Sin parámetros; responden por *ack* `{ ok, room?, error? }` |
| `forms:assignment.changed` | S→C | `forms:admin` + conductores afectados | `{ assignmentId, versionId, formId, status }` |
| `forms:version.published` | S→C | `forms:admin` + conductores | `{ formId, versionId, versionNumber, revision }` |
| `forms:submission.accepted` | S→C | conductor + `forms:admin` | `{ submissionId, clientSubmissionId, assignmentId, businessDate, idempotentReplay }` |
| `forms:submission.voided` | S→C | conductor + `forms:admin` | `{ submissionId, assignmentId }` |
| `forms:attachment.ready` | S→C | conductor | `{ submissionId, attachmentId, clientAttachmentId }` |

Todos llevan además `eventId` y `occurredAt`.

### Colas

| Evento | Dir. | Destino | Cola |
|---|---|---|---|
| `borrador:queued`, `:locked`, `:start`, `:progress`, `:complete`, `:cancelled`, `:error` | S→C | `user-<id>` | Borradores de cierres finales |
| `borrador:cancel` | C→S | — | `{ job_id }`; solo cancela el dueño |
| `borrador-nomina:queued`, `:start`, `:progress`, `:complete`, `:cancelled`, `:error` | S→C | `user-<id>` | Borradores de nómina |
| `borrador-nomina:item` | S→C | `sheet:nomina:<anio>:<mes>` | Un conductor generado, para los canvas abiertos |
| `liquidaciones-terceros-save-bulk:start`, `:progress`, `:done` | S→C | `user-<id>` | Guardado masivo de cierres |
| `liquidaciones-terceros-save-bulk:cancel` | C→S | — | `{ jobId }` |
| `envio-liq:queued`, `:start`, `:progress`, `:item`, `:complete`, `:cancelled`, `:error` | S→C | `user-<id>` | Envíos por correo de liquidaciones de terceros |
| `envio-liquidacion:actualizado` | S→C | sala del libro (`sheet:ingresos:<anio>`, `sheet:ocasional:<anio>` o `sheet:cierres-finales:<anio>:<mes>`) | `ENVIADO`/`ERROR` de cada hoja |
| `envio-nomina:queued`, `:start`, `:progress`, `:complete`, `:cancelled`, `:error` | S→C | `user-<id>` | Envíos de desprendibles |
| `envio-nomina:item` | S→C | `sheet:nomina:<anio>:<mes>` | `ENVIADO`/`ERROR` de cada desprendible |

Los de nómina y envíos de liquidaciones se cancelan por REST, no por socket
(ver [tareas-programadas.md](./tareas-programadas.md#colas-en-memoria)).

## Pruebas que protegen esto

- **`tests/contrato-eventos.test.ts`** cruza, leyendo el texto del código, lo
  que el backend emite (`.emit(`, colas, helpers `emit*` y tablas `EVENTOS_*`)
  contra lo que el frontend hermano escucha (`../cotransmeq-app/src`). Falla si
  un listener del frontend espera un evento que nadie emite, si un nombre no
  encaja en ninguna de las convenciones admitidas (`dominio:accion`,
  `dominio:sub:accion`, kebab plano, `forms:x.y`) o si algún evento se
  construye interpolando. Los emitidos sin consumidor solo se listan, sin
  fallar. Las excepciones que el escaneo textual no puede ver van en
  `EMITIDOS_INDIRECTAMENTE`, con su motivo. Necesita el repo del frontend
  clonado al lado. No hay registro espejo en el frontend a propósito: duplicar
  la lista en dos sitios era el problema. Al ser textual, no ve si la emisión
  llega a ejecutarse.
- **`tests/sockets-dominio-integracion.test.ts`** levanta Fastify y Socket.IO de
  verdad, conecta un cliente real y comprueba que un POST, un cambio de estado
  y un DELETE por la API producen `servicio:creado`,
  `servicio:estado-actualizado` (con el estado anterior), `servicio:eliminado`
  (solo con el id) y `cliente:created`. Existe porque Servicios pasó meses sin
  emitir nada con seis listeners esperando en el frontend, y un test del emisor
  habría seguido en verde.
- `tests/eventos-dominio.test.ts` (forma del payload de cada emisor),
  `tests/sockets-seguridad.test.ts` (nadie entra a la sala privada de otro ni a
  una evaluación sin identidad) y `tests/sockets-enforce.test.ts` (qué tokens
  acepta el handshake en `enforce`).

## Riesgos conocidos

- **Permiso por recurso** en `join-evaluacion`, `sheet:join`, `join-room` y
  `chat:join`: pendiente (ver [Salas](#salas)).
- **Permiso de módulo en `sheet:patch`.** Solo `recorridos` lo comprueba. Los
  parches de `nomina`, `cierres-finales`, `adicionales` y las anotaciones solo
  exigen identidad, y en `permissive` esa identidad puede venir del payload.
- **Payloads sin validar.** Casi todos los handlers desestructuran el payload
  sin valor por defecto (`sheet:join`, `sheet:leave`, `sheet:active`,
  `join-room`, `leave-room`, `row:save`, `typing:*`, `field:focus`, `chat:*`,
  `borrador:cancel`, `liquidaciones-terceros-save-bulk:cancel`), y `chat:join`
  además lee `user.name` del payload aunque la identidad venga del token. Un
  evento emitido sin argumentos lanza dentro del listener; Socket.IO lo invoca
  desde un `process.nextTick` y no hay manejador de `uncaughtException`, así
  que, según se lee el código, eso tumba el proceso (y con él las colas en
  memoria). Los clientes propios siempre mandan el payload; uno hecho a mano
  no tiene por qué. `sheet:patch` (con `payload?.` y `try/catch`) y los
  `forms:*` (que ignoran el payload) no tienen el problema.
- **`chat:typing`** no exige identidad ni estar en la sala, y reenvía el
  `userId` y el `name` del payload.

## Diferencias con Transmeralda

Los archivos de `src/sockets/`, los gateways, las colas y los `*.events.ts` son
idénticos en `backend-nest`, y los eventos REST de recargos salen igual allí,
con `avisarRecargos`. Diferencias:

- Transmeralda no tiene `recargos-importados-transmeralda` (no importa recargos
  de otra base).
- Su test de contrato lee el frontend en `../ingreso-svelte`.
- Tiene además `tests/canvas-servicios-sockets.test.ts` (presencia y eventos
  del canvas de liquidaciones de servicios), que aquí no existe.
