# Permisos

Qué puede hacer cada persona del equipo una vez autenticada: áreas, niveles,
módulos, la lista blanca por usuario y los permisos individuales. La fuente de
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

**Módulos.** Cada entrada de `ROUTE_PERMISSIONS` dice qué áreas tienen `full`,
`read` o `limited`. Un módulo con `general: true` da `full` a cualquier usuario
autenticado. Un módulo que **no está** en el mapa niega el acceso a todo el
mundo: añadir la guarda sin añadir el módulo deja la ruta en 403 para todos.

**Rol.** `usuarios.role` es el enum `enum_users_role`, heredado del backend
anterior: `admin`, `liquidador`, `facturador`, `aprobador`, `gestor_flota`,
`gestor_nomina`, `consulta`, `usuario` (default), `gestor_servicio`,
`gestor_planillas` y `kilometraje`. Hoy casi ninguno tiene efecto: el acceso
sale de las **áreas**, y el rol `admin` no abre módulos por sí mismo. `admin`
importa cuando hay lista blanca (la ignora) y en algunos chequeos propios de
controladores viejos (conductores, clientes, vehículos, actividad), que
documenta cada módulo; `gestor_nomina` solo decide quién recibe el aviso de
desprendible firmado.

## Catálogo de módulos

`F` = `full`, `R` = `read`, `L` = `limited`, `—` = sin acceso. ¹ `general: true`:
entra cualquier usuario autenticado con `full`.

| Módulo | Admin. | Oper. | Contab. | Fact. | T. H. | HSEQ | Mant. | Para qué |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `dashboard` ¹ | F | F | F | F | F | F | F | Panel de inicio |
| `actividad` ¹ | F | F | F | F | F | F | F | Actividad reciente del equipo |
| `perfil` ¹ | F | F | F | F | F | F | F | Mi perfil |
| `flota` ¹ | F | F | F | F | F | F | F | Gestión de flota vehicular |
| `conductores` ¹ | F | F | F | F | F | F | F | Gestión de conductores |
| `servicios` | F | F | — | R | R | R | — | Gestión de servicios de transporte |
| `recargos` | F | F | — | R | R | R | — | Gestión de recargos/planillas |
| `clientes` ¹ | F | F | F | F | F | F | F | Gestión de clientes/empresas |
| `sarlaft` | F | — | — | — | F | — | — | Formularios SARLAFT + PTEE (cumplimiento) |
| `solicitudes` | F | F | R | R | — | — | — | Solicitudes web (cotizaciones y servicios desde la landing) |
| `asistencias` | F | — | — | — | — | F | — | Formularios de asistencia |
| `acciones-correctivas` | F | — | — | — | — | F | — | Acciones correctivas y preventivas |
| `evaluaciones` | F | — | — | — | — | F | — | Evaluaciones de conductores |
| `salidas-nc` | F | F | — | — | — | F | — | Salidas no conformes |
| `formularios` | F | R | — | — | — | F | — | Formularios dinámicos (constructor, asignaciones y envíos) |
| `mis-formularios` ¹ | F | F | F | F | F | F | F | Diligenciar los formularios asignados a mí |
| `nomina` | F | — | — | F | F | — | — | Gestión de nómina |
| `viaticos` | F | F | R | — | — | — | — | Anticipos de viáticos y gastos de conductores |
| `extractos` | F | F | — | — | — | — | — | Extractos de contrato (FUEC) |
| `recorridos` | F | F | R | R | R | R | R | Canvas de recorridos y bonos de planilla |
| `liquidaciones-servicios` | F | F | — | L | — | — | — | Liquidaciones de servicios |
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

Notas sobre módulos concretos (el porqué está comentado en `permissions.ts`):

- `mis-formularios` va aparte de `formularios` a propósito: rellenar lo que te
  asignaron no puede exigir el permiso de publicar formularios. Qué asignación
  concreta ve cada uno lo deciden los destinatarios de la asignación, no este
  permiso.
- `recorridos` va aparte de `conductores` (que es `general`): la hoja alimenta
  bonos y pernoctes que terminan en la nómina, así que editarla es una
  operación contable. Marcar bonos pide además el permiso individual
  `bonos-planilla`.
- `formularios` incluye datos de salud, fatiga y firmas de conductores; por eso
  tiene llave propia y operaciones solo lee.
- Un módulo puede proteger sus lecturas solo con la sesión y pedir permiso
  únicamente para escribir (servicios, por ejemplo). Cada doc de
  [api/](./api/README.md) dice qué pide cada endpoint.

## Cómo se resuelve el acceso

`checkAccess(rol, áreas, módulo, listaBlanca)` devuelve `{ allowed, level }`:

```
¿el módulo existe en ROUTE_PERMISSIONS?           no → sin acceso
¿el usuario tiene lista blanca (permisos_rutas)?
    sí → ¿rol admin?                              sí → full
         ¿módulo 'perfil'?                        sí → full
         nivel = listaBlanca[módulo]              (sin clave → sin acceso)
    no → ¿módulo general?                         sí → full
         ¿alguna área en full / read / limited?   el primero que coincida, en ese orden
         ninguna                                  → sin acceso
```

Con varias áreas gana la de nivel más alto.

### Lista blanca por usuario (`permisos_rutas`)

`usuarios.permisos_rutas` es un JSON `{ "<módulo>": "full" | "read" | "limited" }`
que un administrador edita desde Usuarios. Si tiene al menos una clave válida,
**sustituye por completo** a las reglas por área: no suma ni resta, solo los
módulos listados son accesibles y con exactamente ese nivel. Un usuario de
administración con `{ "flota": "read" }` pierde todo lo demás y en flota solo
lee. Se diseñó así para que «¿por qué ve esto?» tenga una sola respuesta.

- `null`, `{}` o solo claves inválidas = sin lista blanca (se normaliza con
  `normalizarRutasOverride`: claves que no son módulos y niveles que no son
  `full|read|limited` se descartan sin error).
- Excepciones: `perfil` sigue accesible siempre (si no, no podría ni cambiar su
  contraseña) y el rol `admin` conserva acceso total (un admin bloqueado por su
  propio JSON no tendría cómo desbloquearse).
- `general: true` **no** exime: la gracia es poder recortar también lo que ve
  todo el mundo.
- **Cuidado con `sesiones`.** La administración de usuarios la protege
  `requireAdmin`, que pide `sesiones` con nivel `full`: un
  `{"sesiones": "full"}` en la lista blanca da poder para cambiar áreas, rol y
  permisos de cualquiera, incluidos los propios. Con `read` o `limited` no se
  pasa esa guarda, y ninguna otra ruta mira `sesiones` (ver
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
| `nomina` | Recibir el aviso de desprendible firmado por el conductor (también lo reciben `admin`, `gestor_nomina`, administración y talento humano; nunca quien es solo de operaciones) | `conductor-portal.routes.ts` |

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

La falta de sesión (401), los recortes de una lista blanca, `requireAdmin`,
`requireBonosPlanilla` y `requireRecorridosEdicion` se aplican en los dos modos.

## El frontend es un espejo

El frontend tiene una copia de este mapa en `src/lib/config/permissions.ts`,
que tiene que ser **idéntica**. Si divergen, el sidebar muestra una entrada que
la API rechaza con 403, o esconde algo a quien sí puede usarlo. Para no tener
que depender de la copia, el login y `GET /api/auth/profile` devuelven
`modulos_accesibles` ya resuelto por `getAccessibleModules`, el mismo código que
decide los 403; **hoy el frontend no lo usa** y resuelve con su copia.

Estado al 11 de octubre de 2026 (comparando los dos archivos):

- **El mapa** coincide salvo dos detalles sin efecto práctico: en el frontend
  falta `mantenimiento` en las listas `full` de `perfil`, `flota`, `conductores`
  y `clientes` (son `general` y dan `full` a todos igual), y no existe el módulo
  `contabilidad`, que ninguna pantalla usa.
- **La resolución no es idéntica.** El `checkAccess` del frontend no normaliza
  la lista blanca (una clave o un nivel inválido no se descarta) y trata distinto
  a un `admin` con lista blanca: el frontend la ignora y aplica sus áreas,
  mientras que el backend le da `full` en todo. En ese caso el sidebar puede
  esconder módulos que la API sí sirve.

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
