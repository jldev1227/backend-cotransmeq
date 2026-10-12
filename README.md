# backend-cotransmeq — API de Cotransmeq

API del dashboard administrativo, del portal del conductor y de las apps
móviles de Cotransmeq. Es **Fastify 4 + Prisma 5 sobre PostgreSQL** (no
NestJS, aunque el repo gemelo se llame `backend-nest`).

El mismo producto corre para Transmeralda en el repo gemelo
`backend-nest`. Todo cambio se aplica en los dos (ver [AGENTS.md](./AGENTS.md)).

## Arranque local

Requisitos: Node 20 (el de la imagen de Docker), PostgreSQL y un `.env` (parte
de `.env.example`; todas las variables están en
[docs/variables-de-entorno.md](./docs/variables-de-entorno.md)).

```bash
npm install
npx prisma generate
npm run dev          # tsx watch src/server.ts, en el PORT del .env (4000 en local)
```

`GET /` responde `{ "status": "ok" }` cuando está arriba.

> **No uses `prisma migrate dev` ni `prisma migrate deploy` contra una base con
> datos.** El historial de migraciones diverge de la base y esos comandos
> pueden borrarla. Las migraciones se aplican a mano: ver
> [docs/base-de-datos.md](./docs/base-de-datos.md).
>
> **`npm test` necesita la base de pruebas** (`npm run test:setup`). Nunca lo
> corras con el `DATABASE_URL` de una base real: ya borró datos una vez. Ver
> [docs/pruebas.md](./docs/pruebas.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga |
| `npm run typecheck` | `tsc --noEmit`; tiene que quedar en cero errores |
| `npm run build` / `npm start` | Compila a `dist/` y arranca la versión compilada |
| `npm run test:setup` / `npm test` / `npm run test:down` | Base de pruebas en Docker, pruebas, apagarla |
| `npm run test:nomina`, `test:formularios`, `test:declaracion-transporte` | Suites puras (sin base) que corre el CI |
| `npm run prisma:generate` | Regenera el cliente de Prisma |
| `npm run docs:inventario` | Regenera [docs/api/inventario.md](./docs/api/inventario.md) desde la app |
| `npm run docs:verificar` | Falla si alguna ruta no está documentada en `docs/api/` |

## Documentación

Empieza por [docs/README.md](./docs/README.md). Lo principal:

- [Arquitectura](./docs/arquitectura.md) — estructura, arranque, ciclo de una petición.
- [Autenticación](./docs/autenticacion.md), [middlewares](./docs/middlewares.md) y [permisos](./docs/permisos.md).
- [Referencia de la API](./docs/api/README.md) — un documento por módulo.
- [Tiempo real](./docs/tiempo-real.md), [tareas programadas](./docs/tareas-programadas.md) e [integraciones](./docs/integraciones.md).
- [Base de datos](./docs/base-de-datos.md), [variables de entorno](./docs/variables-de-entorno.md), [pruebas](./docs/pruebas.md) y [despliegue](./docs/despliegue.md).

Las convenciones de código y las trampas conocidas están en [AGENTS.md](./AGENTS.md).
