# Referencia de la API

Un documento por módulo (`src/modules/<modulo>/` → `docs/api/<modulo>.md`) con
todos sus endpoints: guarda, parámetros, cuerpo, respuesta y errores. Aquí van
las convenciones comunes y el índice.

## Lo básico

| | |
|---|---|
| Producción | `https://api-cotransmeq.transmeralda.com` (detrás de Cloudflare) |
| Local | `http://localhost:4000` (el puerto sale de `PORT` en el `.env`; 4000 si no se define) |
| Prefijo | Todo cuelga de `/api`, salvo `GET /` (salud: `{ "status": "ok" }`) y `/assets/*` (logos estáticos) |
| Formato | JSON (`Content-Type: application/json`), salvo subidas `multipart/form-data` y descargas de archivos |
| Autenticación | `Authorization: Bearer <token>`; qué token pide cada ruta lo dice la columna «Acceso» de cada módulo. Ver [autenticacion.md](../autenticacion.md) |
| Permisos | Por área y módulo; ver [permisos.md](../permisos.md) |
| CORS | Solo los orígenes de la lista de `src/app.ts` y de `FRONTEND_URL`, con credenciales |

### Columna «Acceso»

| Valor | Significa |
|---|---|
| `pública` | Sin autenticación |
| `pública · token` | Sin sesión; la autoriza un token o código del enlace |
| `sesión` | Cualquier persona del equipo con sesión abierta |
| `<módulo>:<nivel>` | Sesión y al menos ese nivel en ese módulo (`limited` < `read` < `full`) |
| `algún(…)` | Basta uno de los permisos listados |
| `admin` | Nivel `full` en el módulo `sesiones` (administración): `requireAdmin` |
| `+ bonos-planilla` | Además, el permiso individual |
| `portal` | Token del portal del conductor |
| `x-cron-secret` / `x-recovery-token` / `token API` | Secretos de servicio y tokens del MCP |
| `· límite N/ventana` | La ruta tiene límite de intentos (429 al pasarse) |

## Respuestas

No hay un envoltorio único: cada módulo creció por su cuenta. Las formas que
vas a encontrar, y que cada endpoint documenta:

```jsonc
{ "success": true, "data": { … } }                    // la más común en módulos nuevos
{ "success": true, "data": [ … ], "pagination": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 } }
[ … ]  /  { … }                                        // el recurso tal cual, sin envoltorio
{ "success": false, "message": "…" }  /  { "error": "…" }   // errores, según el módulo
```

**Paginación.** Los listados grandes aceptan `page` y `limit` por query y
devuelven `pagination` (servicios, conductores…). Otros devuelven todo o usan
`meta`; lo dice cada endpoint.

**Errores.** El formato depende de quién rechace (guarda, esquema, límite o
controlador); la tabla completa está en
[middlewares.md](../middlewares.md#formato-de-los-errores). Códigos habituales:

| Código | Cuándo |
|---|---|
| 400 | Cuerpo o parámetros inválidos (esquema JSON de Fastify, zod o validación a mano) |
| 401 | Sin token, token inválido, de otro tipo, o sesión cerrada |
| 403 | Sin permiso sobre el módulo, nivel insuficiente o regla del controlador |
| 404 | El recurso no existe (o está borrado lógicamente) |
| 409 | Conflicto de negocio: duplicado, estado que no admite la operación |
| 429 | Límite de intentos; trae `Retry-After` |
| 500 | Error no previsto. Varios controladores devuelven 500 también para un «no encontrado» que el servicio lanza como `Error` genérico; los docs lo señalan en Observaciones |
| 503 | Función deshabilitada por configuración (p. ej. recuperación sin su secreto) |

## Tipos de dato

- **Identificadores**: UUID en casi todas las tablas.
- **Fechas y horas**: ISO 8601 en UTC (`2026-10-11T15:00:00.000Z`). Las fechas
  de negocio (día de un servicio, periodo de una liquidación) se guardan como
  fecha sin hora; al mostrarlas, ojo con el desfase de Bogotá (UTC−5): una
  medianoche UTC es el día anterior en Colombia.
- **Dinero**: pesos colombianos. Las columnas `Decimal` de Prisma se serializan
  como **string** en JSON salvo que el controlador las convierta con
  `Number()`; cada endpoint dice qué devuelve.
- **Borrado lógico**: lo que tiene `deleted_at` no sale en las lecturas. Ver
  [base-de-datos.md](../base-de-datos.md).

## Archivos

- **Subidas pequeñas** (firmas, logos, documentos): `multipart/form-data` a la
  API, hasta 200 MB por archivo.
- **Evidencias de formularios y adjuntos del portal**: el backend firma una URL
  de S3 y el cliente hace `PUT` directo al bucket; el checksum va en el query
  string. Si falla, revisa primero el CORS del bucket. Ver
  [integraciones.md](../integraciones.md).
- **Descargas** (PDF, Excel, ZIP): el nombre viene en `Content-Disposition`.
  Para leerlo desde el navegador la ruta tiene que exponer la cabecera
  (`Access-Control-Expose-Headers: Content-Disposition`). Hoy solo lo hace el
  Excel de [liquidaciones-servicios](./liquidaciones-servicios.md): la
  configuración de CORS de `app.ts` no declara `exposedHeaders`, así que en las
  demás descargas el frontend usa un nombre de respaldo.

## Tiempo real

Muchas escrituras emiten eventos de Socket.IO para que las pantallas abiertas se
actualicen. Cada módulo los lista en «Efectos»; el catálogo completo está en
[tiempo-real.md](../tiempo-real.md).

## Módulos

### Plataforma y equipo

| Módulo | Qué cubre |
|---|---|
| [auth](./auth.md) | Login, logout, perfil propio, firma, cambio y recuperación de contraseña |
| [usuarios](./usuarios.md) | Usuarios, áreas, lista blanca y permisos individuales |
| [sesiones](./sesiones.md) | Sesiones abiertas y cierre remoto |
| [invitaciones](./invitaciones.md) | Alta de usuarios por invitación |
| [app-usuarios](./app-usuarios.md) | Enlace y sesión de la app móvil de administrativos |
| [dashboard](./dashboard.md) | Panel de inicio por secciones |
| [actividad](./actividad.md) | Registro de actividad del equipo |
| [notificaciones](./notificaciones.md) | Campana y Web Push |
| [asistente](./asistente.md) | Asistente de IA del dashboard |
| [mcp](./mcp.md) | Servidor MCP y tokens personales |

### Operación

| Módulo | Qué cubre |
|---|---|
| [servicios](./servicios.md) | Servicios de transporte: programación, estados, enlace público |
| [recargos](./recargos.md) | Planillas y recargos de conductores |
| [extractos](./extractos.md) | Extractos de contrato (FUEC) con firma y QR |
| [clientes](./clientes.md) | Clientes y empresas |
| [operadoras](./operadoras.md) | Catálogo de operadoras petroleras |
| [municipios](./municipios.md) | Catálogo de municipios |
| [custom-places](./custom-places.md) | Lugares propios (pozos, campamentos) para el mapa |
| [maps](./maps.md) | Autocompletado de lugares para la app |
| [solicitudes-web](./solicitudes-web.md) | Formulario público de la landing y su bandeja |

### Flota y personas

| Módulo | Qué cubre |
|---|---|
| [vehiculos](./vehiculos.md) | Flota |
| [vehiculos-documentos](./vehiculos-documentos.md) | Documentos de vehículos con vencimiento |
| [conductores](./conductores.md) | Conductores |
| [conductores-documentos](./conductores-documentos.md) | Documentos de conductores con vencimiento |
| [simit](./simit.md) | Estado de cuenta e historial de consultas SIMIT |
| [mantenimiento](./mantenimiento.md) | Planes y órdenes de mantenimiento |
| [combustible](./combustible.md) | Tanqueos y rendimiento |
| [terceros](./terceros.md) | Propietarios y proveedores |
| [documentos](./documentos.md) | Documentos y desprendibles compartidos |

### Portal del conductor

| Módulo | Qué cubre |
|---|---|
| [conductor-portal](./conductor-portal.md) | Acceso por enlace, desprendibles, servicios, viáticos, FUEC |
| [dias-laborados](./dias-laborados.md) | Reporte de días laborados |

### Nómina y recorridos

| Módulo | Qué cubre |
|---|---|
| [liquidaciones](./liquidaciones.md) | Nómina de conductores, desprendibles y su firma |
| [nomina-canvas](./nomina-canvas.md) | Canvas de nómina |
| [primas](./primas.md) | Primas |
| [recorridos-canvas](./recorridos-canvas.md) | Canvas de recorridos y bonos |

### Liquidaciones de servicios y finanzas

| Módulo | Qué cubre |
|---|---|
| [liquidaciones-servicios](./liquidaciones-servicios.md) | Liquidación de servicios a clientes, estados, Excel |
| [facturacion-liquidaciones](./facturacion-liquidaciones.md) | Facturación de liquidaciones |
| [cartera](./cartera.md) | Cuentas por cobrar y abonos |
| [contabilidad](./contabilidad.md) | Contabilidad |
| [certificados-tributarios](./certificados-tributarios.md) | Certificados tributarios y su portal para terceros |
| [viaticos](./viaticos.md) | Anticipos, gastos y solicitudes de viáticos |

### Cierres de terceros

| Módulo | Qué cubre |
|---|---|
| [liquidaciones-terceros](./liquidaciones-terceros.md) | Punto de entrada: cómo se reparte el dominio |
| [liquidaciones-terceros-descuentos](./liquidaciones-terceros-descuentos.md) | Cierres, borradores y descuentos |
| [liquidaciones-terceros-ocasional](./liquidaciones-terceros-ocasional.md) | Liquidación ocasional |
| [liquidaciones-terceros-adicionales](./liquidaciones-terceros-adicionales.md) | Adicionales de cierres finales |
| [liquidaciones-terceros-ingresos](./liquidaciones-terceros-ingresos.md) | Ingresos |
| [liquidaciones-terceros-pagos](./liquidaciones-terceros-pagos.md) | Pagos |
| [liquidaciones-terceros-envios](./liquidaciones-terceros-envios.md) | Envíos por correo |
| [liquidaciones-terceros-pdf](./liquidaciones-terceros-pdf.md) | PDF de los cierres |
| [liquidaciones-terceros-snapshots](./liquidaciones-terceros-snapshots.md) | Versiones del canvas de cierres |
| [liquidaciones-terceros-ocasional-snapshots](./liquidaciones-terceros-ocasional-snapshots.md) | Versiones del ocasional |
| [liquidaciones-terceros-adicionales-snapshots](./liquidaciones-terceros-adicionales-snapshots.md) | Versiones de adicionales |
| [liquidaciones-chat](./liquidaciones-chat.md) | Chat de una liquidación |
| [canvas-anotaciones](./canvas-anotaciones.md) | Anotaciones de los canvas |
| [pdf](./pdf.md) | Exportación a PDF de los canvas |

### Formularios y HSEQ

| Módulo | Qué cubre |
|---|---|
| [formularios-dinamicos](./formularios-dinamicos.md) | Constructor, asignaciones, envíos; portal y «mis formularios» |
| [encuestas](./encuestas.md) | Encuestas públicas configurables, respuestas, resultados y exportaciones |
| [formularios-sarlaft](./formularios-sarlaft.md) | Formularios públicos SARLAFT + PTEE |
| [mis-capacitaciones](./mis-capacitaciones.md) | Capacitaciones del usuario |
| [asistencias](./asistencias.md) | Formularios de asistencia |
| [evaluaciones](./evaluaciones.md) | Evaluaciones |
| [inducciones](./inducciones.md) | Inducciones y registro de visitantes |
| [acciones-correctivas](./acciones-correctivas.md) | Acciones correctivas y preventivas |
| [salidas-nc](./salidas-nc.md) | Salidas no conformes |
| [incidentes](./incidentes.md) | Accidentes e incidentes |

El listado exhaustivo de rutas, con el archivo donde se declara cada una, está
en [inventario.md](./inventario.md) (generado).

## Mantener esta referencia

- `npm run docs:inventario` regenera [inventario.md](./inventario.md) a partir de
  la app real (arranca `buildApp()` en memoria, sin abrir puerto).
- `npm run docs:verificar` falla si una ruta del código no aparece en el doc de
  su módulo, o si un doc nombra una ruta que ya no existe. Córrelo antes de
  subir un cambio que toque rutas.
- Un endpoint nuevo se documenta en el doc de su módulo con el mismo formato:
  fila en la tabla de endpoints y, si recibe datos, su sección con Query/Body,
  respuesta y errores. [operadoras.md](./operadoras.md) es el ejemplo de
  referencia.
- Los dos backends tienen casi las mismas rutas; las diferencias se anotan al
  final del doc de cada módulo.
