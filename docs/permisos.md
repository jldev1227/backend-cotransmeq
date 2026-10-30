# Permisos

Qué puede hacer cada persona del equipo una vez autenticada: áreas, niveles,
módulos, límites personalizados por ruta y permisos individuales. La fuente de
verdad es [`src/config/permissions.ts`](../src/config/permissions.ts); las
guardas que la aplican están en [middlewares.md](./middlewares.md) y la
identidad, en [autenticacion.md](./autenticacion.md).

Este sistema solo aplica a las personas del equipo (dashboard y app de
administrativos). Los conductores, las rutas públicas y el MCP se autorizan de
otra forma (el MCP hereda los permisos de su dueño).

## Conceptos

**Áreas.** Cada usuario tiene una o varias (`usuarios.area`, arreglo):
`administracion`, `operaciones`, `contabilidad`, `facturacion`,
`talento_humano`, `hseq` y `mantenimiento`. La lista canónica es `AREAS`;
úsala en esquemas y formularios en vez de repetir el literal (cuando se añadió
`mantenimiento` había cuatro copias y tres se olvidaron).

**Niveles**, de menor a mayor:

| Nivel | Significa |
|---|---|
| `limited` | Acceso parcial que define cada módulo (p. ej. facturación solo registra facturas en liquidaciones de servicios) |
| `read` | Consultar y exportar |
| `full` | Crear, editar y borrar |

Pedir `read` deja fuera a quien tiene `limited`. Por eso varios módulos piden
`limited` para leer.

**Módulos.** Cada entrada de `ROUTE_PERMISSIONS` dice explícitamente qué áreas
tienen `full`, `read` o `limited`. Un módulo que **no está** en el mapa niega el
acceso a todo el mundo: añadir la guarda sin añadir el módulo deja la ruta en
403 para todos.

**Rol.** `usuarios.role` es un campo heredado que se conserva por compatibilidad
con sesiones y clientes antiguos. No concede ni recorta acceso y no se modifica
desde la gestión actual de usuarios. Las áreas determinan el nivel base; los
límites por ruta pueden reducirlo.

## Catálogo de módulos

`F` = `full`, `R` = `read`, `L` = `limited`, `—` = sin acceso. El mapa se
resuelve por área; `role` no concede permisos.

| Módulo | Admin. | Oper. | Contab. | Fact. | T. H. | HSEQ | Mant. | Para qué |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `dashboard` | F | F | F | F | F | F | F | Panel de inicio |
| `actividad` | F | F | F | F | F | F | F | Actividad reciente del equipo |
| `perfil` | F | F | F | F | F | F | F | Mi perfil |
| `flota` | F | F | F | F | F | F | F | Gestión de flota vehicular |
| `conductores` | F | F | F | F | F | F | F | Gestión de conductores |
| `personal` | F | F | F | F | F | F | F | Directorio unificado de personal |
| `rastreo_servicios` | F | R | — | — | R | R | R | Seguimiento GPS consentido de servicios activos |
| `servicios` | F | F | — | R | R | R | — | Gestión de servicios de transporte |
| `recargos` | F | F | — | — | R | — | — | Gestión de recargos/planillas |
| `clientes` | F | F | F | F | F | F | F | Gestión de clientes/empresas |
| `sarlaft` | F | — | — | — | F | — | — | Formularios SARLAFT + PTEE (cumplimiento) |
| `solicitudes` | F | F | R | R | — | — | — | Solicitudes web (cotizaciones y servicios desde la landing) |
| `asistencias` | F | — | — | — | — | F | — | Formularios de asistencia |
| `encuestas` | F | F | R | — | R | F | — | Encuestas públicas, respuestas y reportes |
| `acciones-correctivas` | F | — | — | — | — | F | — | Acciones correctivas y preventivas |
| `evaluaciones` | F | — | — | — | — | F | — | Evaluaciones de conductores |
| `salidas-nc` | F | F | — | — | — | F | — | Salidas no conformes |
| `formularios` | F | R | — | — | — | F | — | Formularios dinámicos (constructor, asignaciones y envíos) |
| `mis-formularios` | F | F | F | F | F | F | F | Diligenciar los formularios asignados a mí |
| `nomina` | F | — | — | F | F | — | — | Gestión de nómina |
| `viaticos` | F | F | R | — | — | — | — | Anticipos de viáticos y gastos de conductores |
| `extractos` | F | F | — | — | — | — | — | Extractos de contrato (FUEC) |
| `recorridos` | F | R | R | R | R | R | R | Canvas de recorridos y días laborados; Administración edita |
| `liquidaciones-servicios` | F | F | — | L | — | — | — | Liquidaciones de servicios |
| `liquidaciones-servicios-seccion06` | F | R* | — | R | — | — | — | Hoja 4; Operaciones puede recibir edición individual |
| `liquidaciones-terceros` | F | F | L | L | — | — | — | Liquidaciones de terceros (propietarios) |
| `liquidaciones-terceros-adicionales` | F | F | L | L | — | — | — | Adicionales (unificados) de cierres finales de terceros |
| `certificados` | F | — | F | — | — | — | — | Certificados tributarios de terceros |
| `contabilidad` | F | — | F | — | — | — | — | Módulo de contabilidad |
| `terceros` | F | F | F | F | F | — | — | Gestión de terceros |
| `usuarios` | F | — | — | — | — | — | — | Gestión de usuarios del sistema |
| `sesiones` | F | — | — | — | — | — | — | Visualización de sesiones de usuarios |
| `mantenimiento` | F | R | — | — | — | R | F | Planes y órdenes de mantenimiento de la flota |
| `combustible` | F | F | R | — | — | R | F | Tanqueos y rendimiento de combustible |
| `incidentes` | F | R | — | — | R | F | R | Accidentes e incidentes con su investigación |
| `cartera` | F | R | F | F | — | — | — | Cuentas por cobrar, abonos y edades de cartera |
| `directorio` | F | — | — | — | — | — | — | Directorio del equipo — presencia e invitaciones |

`R*` indica el nivel base de Operaciones para la SECCIÓN 06; cualquier usuario
de Operaciones puede recibir `full` individualmente desde el modal de usuario.

Notas sobre módulos concretos (el porqué está comentado en `permissions.ts`):

- `mis-formularios` va aparte de `formularios` a propósito: rellenar lo que te
  asignaron no puede exigir el permiso de publicar formularios. Qué asignación
  concreta ve cada uno lo deciden los destinatarios de la asignación, no este
  permiso.
- `recorridos` va aparte de `conductores`: la hoja alimenta bonos y pernoctes
  que terminan en la nómina, así que editarla es una operación contable.
  Administración edita; Operaciones consulta por defecto y puede recibir
  `full` individualmente desde el modal de usuario. Marcar bonos pide además el
  permiso individual `bonos-planilla`.
- `formularios` incluye datos de salud, fatiga y firmas de conductores; por eso
  tiene llave propia y operaciones solo lee.
- Un módulo puede proteger sus lecturas solo con la sesión y pedir permiso
  únicamente para escribir (servicios, por ejemplo). Cada doc de
  [api/](./api/README.md) dice qué pide cada endpoint.

## Cómo se resuelve el acceso

`checkAccess(áreas, módulo, permisosRutas)` devuelve `{ allowed, level }`:

```
¿el módulo existe en ROUTE_PERMISSIONS?           no → sin acceso
¿el usuario tiene al menos un área?              no → sin acceso
¿alguna área tiene nivel en el módulo?             no → sin acceso
¿permisos_rutas es null?                          sí → conserva el nivel del área
  no → ¿el módulo está incluido?                  no → sin acceso
       nivel efectivo = menor entre área y ruta, salvo `elevableAreas` declaradas
         (actualmente Recorridos y Sección 06 para Operaciones), donde la ruta
         individual puede conceder `full`
¿módulo 'perfil'?                                  siempre accesible
```

Con varias áreas gana la de nivel más alto.

### Límites personalizados por ruta (`permisos_rutas`)

`usuarios.permisos_rutas` es un JSON `{ "<módulo>": "full" | "read" | "limited" }`
que se edita dentro del modal de usuario. El área sigue siendo la base: cada
entrada puede quitar una ruta o reducir su nivel. En las rutas marcadas con
`elevableAreas`, una asignación explícita puede elevar el nivel de un usuario
que ya tiene acceso base; actualmente Operaciones puede recibir `full` en
Recorridos y Sección 06. En los demás módulos no se eleva el nivel del área. Un usuario con área
Administración y `{ "flota": "read" }` conserva solo perfil y consulta Flota.

- `null` hereda del área; `{}` es una personalización vacía y deja solo
  `perfil`. El editor conserva ambos valores al guardar.
- `normalizarRutasOverride` descarta sin error claves desconocidas y niveles
  inválidos.
- `perfil` sigue accesible siempre para que la persona pueda actualizar su
  contraseña. El rol no evita una personalización.
- `recargos` admite el nivel `limited`: permite consultar planillas y adjuntar
  su soporte, pero las escrituras de datos siguen exigiendo `full`. Por áreas,
  solo administración y operaciones tienen `full`, y talento humano tiene `read`.
- Una denegación causada por una lista blanca devuelve **404** para ocultar la
  existencia de la ruta; las denegaciones por área conservan **403**.
- **Cuidado con `sesiones`.** La administración de usuarios la protege
  `requireAdmin`, que exige `sesiones:full` efectivo y el área Administración.
  La personalización no puede conceder ese acceso si el área no lo tiene (ver
  [middlewares.md](./middlewares.md#requireadmin)).
- Se lee de la base con caché de 30 s (`src/services/permisos-rutas.service.ts`)
  y la escritura desde Usuarios invalida la entrada, así que el cambio es
  inmediato. No viaja en el JWT a propósito.
- Si la consulta falla, se trata como «sin lista blanca»: un fallo de la base no
  debe convertir un 200 en un 403 masivo.

### Permisos individuales (`permisos`)

`usuarios.permisos` es un JSON de banderas independientes del área, que otorga un
administrador:

| Bandera | Qué habilita | Dónde se comprueba |
|---|---|---|
| `bonos-planilla` | Marcar y quitar bonos en el canvas de recorridos | `requireBonosPlanilla` |
| `nomina` | Módulo de nómina; además, los avisos web de desprendible se dirigen a Administración y Talento Humano con acceso efectivo a Nómina. El inbox y el push móvil del conductor se mantienen independientes. | `avisos-equipo.service.ts`, `conductor-portal.routes.ts` |

`PERMISOS_ADMIN` en `usuarios.service.ts` es el juego de banderas que se le pone
a un administrador. Es un `Record<string, boolean>` con claves que se llaman
igual que algunos modelos (`recargos: true`): no lo conviertas en un filtro de
Prisma por error.

En la tabla de conductores existe además la bandera `google_play_review` en el
`permisos` del **conductor**: marca la cuenta sintética que usa Google Play para
revisar la app ([autenticacion.md](./autenticacion.md#portal-del-conductor)).

## Modo de aplicación (`PERMISSIONS_MODE`)

| Valor | Efecto |
|---|---|
| `enforce` (default) | Responde 403 |
| `warn` | Deja pasar los rechazos **por área** y los registra como `[permisos:warn] MÉTODO ruta — usuario X (áreas: …) tiene nivel "…" y se requiere "…" en "módulo"` |

`warn` es una salida de emergencia: si un despliegue deja fuera a alguien que
sí debía entrar, se pone en el `.env` mientras se corrige el mapa. Antes de
volver a `enforce`, revisa los avisos en los logs del contenedor:

```bash
docker logs <contenedor-del-backend> 2>&1 | grep 'permisos:warn'
```

La falta de sesión (401), los recortes personalizados, `requireAdmin`,
`requireBonosPlanilla` y `requireRecorridosEdicion` se aplican en los dos modos.

## El frontend es un espejo

El frontend tiene una copia de este mapa en `src/lib/config/permissions.ts`,
que tiene que ser **idéntica**. Si divergen, el sidebar muestra una entrada que
la API rechaza con 403, o esconde algo a quien sí puede usarlo. Para no tener
que depender de la copia, el login y `GET /api/auth/profile` devuelven
`modulos_accesibles` ya resuelto por `getAccessibleModules`, el mismo código que
decide los 403; **hoy el frontend no lo usa** y resuelve con su copia.

El mapa y la resolución deben permanecer iguales: el frontend oculta rutas y
acciones según el nivel efectivo, y el backend repite la validación al recibir
cada petición.

## Quién usa estos permisos además de la API

- **Sockets**: el canvas de recorridos (`sheet:patch`) usa la misma
  comprobación que `requireRecorridosEdicion`.
- **Asistente y MCP**: las herramientas se filtran con `getAccessibleModules`
  del usuario (o del dueño del token), y las que escriben solo aparecen con
  nivel de escritura.
- **Panel de inicio**: `modules/dashboard/secciones.ts` elige qué secciones ver
  por área y módulo.

## Añadir un módulo

1. Entrada en `ROUTE_PERMISSIONS` de `src/config/permissions.ts`, con
   `description` y un comentario del porqué si las áreas no son evidentes.
2. La misma entrada en el `src/lib/config/permissions.ts` del frontend.
3. Guardas en el plugin del módulo (ver
   [middlewares.md](./middlewares.md#proteger-una-ruta-o-un-módulo-nuevo)).
4. Lo mismo en el repo gemelo: los dos mapas son idénticos entre Transmeralda y
   Cotransmeq.
5. Si el módulo necesita que los usuarios con lista blanca lo vean, un
   administrador tiene que añadírselo en su `permisos_rutas`.
