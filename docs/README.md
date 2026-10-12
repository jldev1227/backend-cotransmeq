# Documentación técnica del backend

API de Cotransmeq: Fastify 4 + Prisma 5 sobre PostgreSQL. Estos documentos
describen el código tal como está; si algo no coincide, manda el código y hay
que corregir el documento.

## Por dónde empezar

| Si vas a… | Lee |
|---|---|
| Entender el proyecto | [arquitectura.md](./arquitectura.md) |
| Consumir la API desde el front o una app | [api/README.md](./api/README.md) y [autenticacion.md](./autenticacion.md) |
| Añadir o cambiar un endpoint | [middlewares.md](./middlewares.md), [permisos.md](./permisos.md) y el doc del módulo en [api/](./api/README.md) |
| Dar o quitar acceso a alguien | [permisos.md](./permisos.md) |
| Tocar el esquema o los datos | [base-de-datos.md](./base-de-datos.md) |
| Emitir o escuchar eventos en vivo | [tiempo-real.md](./tiempo-real.md) |
| Añadir un cron o una cola | [tareas-programadas.md](./tareas-programadas.md) |
| Configurar correo, S3, push, IA o mapas | [integraciones.md](./integraciones.md) y [variables-de-entorno.md](./variables-de-entorno.md) |
| Correr las pruebas | [pruebas.md](./pruebas.md) |
| Desplegar | [despliegue.md](./despliegue.md) |

## Documentos

**Base**

- [arquitectura.md](./arquitectura.md) — stack, estructura de carpetas, anatomía de un módulo, arranque, apagado ordenado, ciclo de una petición, logs y errores.
- [autenticacion.md](./autenticacion.md) — credenciales que acepta la API (equipo, app, portal del conductor, enlaces públicos, MCP, secretos de servicio), sesiones y límites de intentos.
- [middlewares.md](./middlewares.md) — orden de los hooks, catálogo de guardas, lo que dejan en el request, formatos de error y cómo proteger una ruta nueva.
- [permisos.md](./permisos.md) — áreas, niveles, catálogo de módulos, lista blanca por usuario, permisos individuales y `PERMISSIONS_MODE`.

**Referencia de la API**

- [api/README.md](./api/README.md) — convenciones e índice por dominio.
- `api/<modulo>.md` — un documento por carpeta de `src/modules/`.
- [api/inventario.md](./api/inventario.md) — todas las rutas con su archivo (generado).

**Funcionamiento**

- [tiempo-real.md](./tiempo-real.md) — Socket.IO: autenticación, salas y catálogo de eventos.
- [tareas-programadas.md](./tareas-programadas.md) — crons, rutas disparadas por cron y colas en memoria.
- [integraciones.md](./integraciones.md) — S3, correo, Web Push, IA, MCP, PDF, mapas, Sentry.
- [base-de-datos.md](./base-de-datos.md) — modelos por dominio, convenciones, borrado lógico y cómo aplicar migraciones.
- [variables-de-entorno.md](./variables-de-entorno.md) — todas las variables, con su default y qué pasa si faltan.
- [pruebas.md](./pruebas.md) — suites, base de pruebas y CI.
- [despliegue.md](./despliegue.md) — imagen de Docker, workflow, migraciones en producción y comprobaciones.

**Por dominio** (anteriores, siguen vigentes)

- [borrado-logico-liquidaciones.md](./borrado-logico-liquidaciones.md) — el borrado lógico de liquidaciones y por qué.
- [pesv/](./pesv/README.md) — Plan Estratégico de Seguridad Vial: arquitectura, contratos FUEC, indicadores, requisitos.
- [sarlaft-declaracion-empresa-transporte/](./sarlaft-declaracion-empresa-transporte/README.md) — declaración SARLAFT de empresa de transporte: plantillas, mapeo y pruebas de correo.

Las convenciones de código y las trampas conocidas están en
[AGENTS.md](../AGENTS.md).

## Documentos sueltos de la raíz

La raíz del repo tiene documentos de cambios puntuales (`README_*.md`,
`README_COMPLETO.md`, `CHANGELOG_AUDITORIA_Y_FIXES.md`,
`RAILWAY_*.md`, `DEPLOY_READY.md`, `LISTO_PARA_RAILWAY.md`,
`API_DOCUMENTATION.md`, `CRON_SERVICIOS.md`, `RUTOGRAMA_README.md`,
`SARLAFT_PTEE.md`, `TESTS_*.md`…). Son históricos: sirven para entender cómo
se llegó a algo, pero varios describen comportamiento que ya cambió
(`API_DOCUMENTATION.md` solo cubre tres CRUDs; los de Railway describen un
despliegue que ya no es el actual). Lo vigente está en esta carpeta.
`SECURITY.md` (qué archivos con secretos no se suben nunca) sigue valiendo como
guía.

## Mantener la documentación

- Un cambio de comportamiento lleva su cambio de documento en el mismo commit.
- `npm run docs:verificar` comprueba que cada ruta del código esté en el doc de
  su módulo y que ningún doc nombre rutas que ya no existen.
  `npm run docs:inventario` regenera el inventario.
- Lo mismo en `backend-nest`: los documentos son gemelos y cada uno
  anota sus diferencias al final.
