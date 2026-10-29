# Asistente de IA

`/api/asistente` · código en [`src/modules/asistente/`](../../src/modules/asistente/) · sin permiso de módulo ([sesión](../autenticacion.md)); cada herramienta exige el permiso del módulo que consulta o escribe

Chat del panel con un modelo de Azure OpenAI que, en vez de responder de
memoria, llama **herramientas** (function calling) que consultan la base y, unas
pocas, crean datos. Las mismas herramientas se exponen a Claude y ChatGPT por el
[servidor MCP](./mcp.md): viven en `herramientas.ts` (registro) y en un archivo
por módulo (`servicio-referencia.ts`, `liquidaciones.ts`, `formularios.ts`,
`recargos.ts`, `viaticos.ts`, `usuarios.ts`…), y no saben nada de HTTP ni de
Azure. El cliente es el SDK oficial de OpenAI contra el endpoint `…/openai/v1`
de Azure (`azure-openai.ts`), configurado con `AZURE_OPENAI_ENDPOINT`,
`AZURE_OPENAI_KEY` y `AZURE_OPENAI_DEPLOYMENT`, que se leen de `process.env` (no
están en `src/config/env.ts`). Sin ellas el backend arranca igual y el chat
responde con un evento de error.

**Permisos.** En cada conversación `cargarUsuarioAsistente` lee de la base las
áreas y `permisos_rutas` (no del JWT) y calcula los módulos accesibles con
`getAccessibleModules`, la misma regla que pinta el menú lateral. `puedeUsar`
decide qué herramientas se ofrecen y se vuelve a comprobar en cada llamada:

- `canales`: algunas solo existen en la app (`ir_a`, `guia_interactiva`,
  `abrir_ticket_servicio`, `abrir_desprendible`, que mueven la pantalla) y otras
  solo en el MCP (`search`, `fetch`); el resto, en los dos.
- `requiere`: el módulo que hay que poder ver, **con cualquier nivel** (`limited`
  incluido); `null` para las que valen para todos.
- `nivel`: las que escriben piden `full` sobre su módulo, lo mismo que la ruta REST
  equivalente.

**Acciones.** Seis herramientas escriben: `crear_servicio`, `crear_servicios`,
`duplicar_liquidacion`, `crear_recargo`, `registrar_recorridos` y
`crear_accion_correctiva`. Pasan por el mismo esquema zod y el mismo servicio que
el controlador REST, y emiten los mismos eventos de socket. Resuelven nombres
(cliente, municipio, conductor, placa) y, si algo no existe o es ambiguo,
devuelven candidatos sin crear nada. Exigen `confirmado: true`: el prompt obliga
al modelo a mostrar un resumen y pedir **una** confirmación, y el servidor, si el
último mensaje del usuario es un «sí» a una pregunta de confirmación del
asistente (`usuarioConfirmo`), le pone `confirmado: true` aunque el modelo lo
olvide. En los canvas de solo lectura (nómina, análisis y primas, cierres,
adicionales y ocasionales de terceros, recorridos) no se ofrece ninguna
herramienta que escriba; el canvas de liquidaciones de servicios conserva
`duplicar_liquidacion`.

## Acceso

| Rutas | Guarda |
|---|---|
| `GET /api/asistente/estado`, `POST /api/asistente/chat` | `sesión` (hook `preHandler` del plugin con `authMiddleware`) |
| Herramientas | `puedeUsar` por herramienta (tabla de abajo). `POST /api/asistente/chat` responde 401 si el usuario no existe o está inactivo |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/asistente/estado` | sesión | ¿Hay asistente configurado? |
| POST | `/api/asistente/chat` | sesión | Conversa; responde como Server-Sent Events |

### `GET /api/asistente/estado`

**Respuesta 200**: `{ "disponible": true }`, o `false` si falta alguna de las tres
variables de Azure. El frontend lo usa para decidir si pinta el botón.

### `POST /api/asistente/chat`

El servidor no guarda conversaciones: el cliente manda el historial en cada
petición.

**Body** (zod, `asistente.routes.ts`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `mensajes` | arreglo de 1 a 40 | sí | `{ "rol": "usuario" \| "asistente", "contenido": string ≤ 8000 }`. Al modelo solo llegan los 12 últimos |
| `contexto` | objeto | no | `{ "ruta"?: string ≤ 300, "titulo"?: string ≤ 120, "filtros"?: objeto }`: la pantalla en la que está el usuario. Entra en el prompt, decide el modo de solo lectura de los canvas y se pasa a las herramientas |

**Respuesta 200**: `Content-Type: text/event-stream` sobre el mismo `POST` (el
navegador lee el cuerpo con `fetch` y un *reader*; no hace falta `EventSource`).
La ruta usa `reply.hijack()` y copia a mano las cabeceras acumuladas, entre ellas
las de CORS. Cada evento es una línea `data: <JSON>` seguida de una línea vacía:

| `t` | Campos | Cuándo |
|---|---|---|
| `herramienta` | `nombre`, `etiqueta` | Antes de ejecutar una herramienta («Buscando conductores…») |
| `texto` | `d` | Un trozo de la respuesta (markdown) |
| `navegar` | `ruta` | Una herramienta (`ir_a`, `abrir_ticket_servicio`, `abrir_desprendible`) pide abrir una ruta interna ya validada contra los permisos |
| `guia` | `guia: { id, titulo, descripcion, ruta, pasos[] }`, `iniciar` | `guia_interactiva` encontró una guía paso a paso; `iniciar: true` la arranca sin botón |
| `fin` | — | Terminó la respuesta |
| `error` | `mensaje` | Asistente sin configurar, fallo de Azure o filtro de contenido de Azure (con un mensaje que pide reformular) |

Una vez abierto el stream, los errores llegan como evento `error` con HTTP 200.
Si el cliente corta la conexión, se aborta la llamada a Azure.

Por dentro: hasta 5 rondas de herramientas (las de una misma ronda en paralelo)
y una última llamada sin herramientas que obliga a contestar; streaming con
`max_completion_tokens: 20000` y `reasoning_effort: 'low'`. El resultado de cada
herramienta se recorta antes de dárselo al modelo (`recortar`): listas de 25
elementos por defecto, o el `limite` que pida el modelo hasta 500, o el
`salidaMaxima` de la herramienta; texto de 14 000 caracteres, ampliable según las
filas hasta 150 000.

**Errores antes del stream**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | El body no cumple el esquema | `{ "error": "Cuerpo inválido", "detalles": <error.flatten()> }` |
| 401 | Usuario inexistente o inactivo | `{ "error": "Usuario no válido" }` |

## Herramientas

| Herramientas | `requiere` | Canal |
|---|---|---|
| `pantallas_disponibles`, `buscar_municipios`, `mis_notificaciones`, `mis_capacitaciones` | — | app y MCP |
| `ir_a`, `guia_interactiva` | — | solo app |
| `search`, `fetch` | — (filtran por módulo por dentro) | solo MCP |
| `abrir_ticket_servicio` | `servicios` | solo app |
| `buscar_servicios`, `detalle_servicio`, `resumen_servicios`, `buscar_lugares` | `servicios` | app y MCP |
| `buscar_conductores` | `conductores` | app y MCP |
| `buscar_vehiculos` | `flota` | app y MCP |
| `buscar_clientes` | `clientes` | app y MCP |
| `buscar_terceros`, `detalle_tercero` | `terceros` | app y MCP |
| `buscar_liquidaciones`, `resumen_liquidaciones`, `detalle_liquidacion`, `tarifas_recorrido`, `buscar_facturas` | `liquidaciones-servicios` | app y MCP |
| `buscar_liquidaciones_terceros`, `cierres_terceros` | `liquidaciones-terceros` | app y MCP |
| `resumen_formularios`, `cumplimiento_formularios`, `buscar_envios_formulario`, `detalle_envio_formulario`, `campos_formulario`, `respuestas_campo_formulario` | `formularios` | app y MCP |
| `buscar_recargos`, `detalle_recargo` | `recargos` | app y MCP |
| `buscar_asistencias`, `detalle_asistencia` | `asistencias` | app y MCP |
| `recorridos_conductor`, `resumen_recorridos` | `recorridos` | app y MCP |
| `buscar_acciones_correctivas`, `detalle_accion_correctiva`, `estadisticas_acciones_correctivas` | `acciones-correctivas` | app y MCP |
| `buscar_sarlaft`, `detalle_sarlaft` | `sarlaft` | app y MCP |
| `buscar_anticipos_viaticos`, `detalle_anticipo_viaticos`, `buscar_gastos_viaticos`, `solicitudes_viaticos`, `saldo_viaticos_operaciones`, `resumen_viaticos` | `viaticos` | app y MCP |
| `buscar_nomina` | `nomina` | app y MCP |
| `abrir_desprendible` | `nomina` | solo app |
| `buscar_usuarios`, `detalle_usuario`, `invitaciones_equipo` | `usuarios` | app y MCP |

Las que escriben (`escribe: true`, `nivel: 'full'`):

| Herramienta | Exige | Qué hace por dentro |
|---|---|---|
| `crear_servicio`, `crear_servicios` | `servicios:full` | `createServicioSchema` + `ServiciosService.create` y `emitServicioCreado`. Cruza los puntos exactos con el historial de lugares; no asigna recursos ocupados sin `forzar_recursos_ocupados` |
| `duplicar_liquidacion` | `liquidaciones-servicios:full` | Copia una liquidación **en borrador** con `LiquidacionesServiciosService.crear`, emite `liquidacion-servicio-created` y manda la notificación de creación. Sin `liquidaciones-terceros`, la copia sale sin la parte de terceros |
| `crear_recargo` | `recargos:full` | `createRecargoSchema` + `RecargosService.create` y emite `recargo-creado` |
| `registrar_recorridos` | `recorridos:full` | `DiasLaboradosService.guardarRegistrosMasivos` (un mes por patrones; avisa si ya había registros en esas fechas) |
| `crear_accion_correctiva` | `acciones-correctivas:full` | `AccionesCorrectivasService.crear` |

Sin `confirmado: true` las seis responden un error al modelo y no escriben nada.
Las herramientas de `usuarios` son de solo lectura y nunca devuelven contraseñas,
tokens, hashes de sesión ni IP.

## Efectos

- Los de las acciones (tabla de arriba): eventos de socket y notificaciones de
  sus módulos (ver [tiempo real](../tiempo-real.md)).
- Llamadas a Azure OpenAI (ver [integraciones](../integraciones.md)).
- Nada de esto queda en `registro_actividad` (ver Observaciones).

## Observaciones

- **Lo que se crea por el asistente no queda en el registro de actividad.** Las
  acciones llaman a los servicios sin pasar por las rutas HTTP de su módulo, y
  `/api/asistente` y `/api/mcp` están excluidas del hook (ver
  [actividad](./actividad.md)).
- **Las acciones también están en el MCP.** El comentario de `acciones.ts` dice que
  «van solo por el canal de la app: el MCP sigue siendo de solo lectura», pero
  ninguna declara `canales`, así que `puedeUsar` las ofrece en los dos; las
  instrucciones del propio servidor MCP las enumeran (ver [mcp](./mcp.md)).
- **La confirmación es una salvaguarda de uso, no un control de acceso.** El
  historial lo manda el cliente, y con él `usuarioConfirmo` decide forzar
  `confirmado: true`. No da más permisos de los que el usuario ya tiene.
- **Sin límite de uso.** No hay tope de peticiones ni de consumo por usuario en
  `POST /api/asistente/chat`, y cada petición puede hacer hasta seis llamadas al
  modelo con `max_completion_tokens: 20000`.
- Cada llamada a una herramienta se registra en el log a nivel `info` con sus
  argumentos (`Asistente: herramienta`), que pueden llevar nombres, cédulas o
  placas (`asistente.service.ts`).
- `GET /api/asistente/estado` solo mira que existan las variables; un endpoint o
  una clave inválidos se descubren en el primer chat, como evento `error`.

## Diferencias con Transmeralda

- El prompt presenta al asistente con el nombre de cada empresa (`EMPRESA` en
  `asistente.service.ts`: `Cotransmeq` aquí).
- Aquí `modulos.ts` tiene la entrada `cartera` repetida: `pantallas_disponibles`
  y la lista de pantallas del prompt muestran «Cartera» dos veces. En
  Transmeralda aparece una sola.
