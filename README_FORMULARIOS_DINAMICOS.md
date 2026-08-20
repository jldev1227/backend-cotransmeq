# Backend de formularios dinámicos

La especificación canónica del módulo está en el repositorio frontend y cubre conjuntamente backend, frontend, base de datos, offline y semillas:

- [Índice general](../ingreso-svelte/README_FORMULARIOS_DINAMICOS.md)
- [Arquitectura y dominio](../ingreso-svelte/docs/formularios-dinamicos/README_ARQUITECTURA.md)
- [Modelo de datos y SQL manual](../ingreso-svelte/docs/formularios-dinamicos/README_DATABASE.md)
- [Contrato REST y Socket.IO](../ingreso-svelte/docs/formularios-dinamicos/README_API_SOCKET.md)
- [Inventario de semillas HSEQ](../ingreso-svelte/docs/formularios-dinamicos/README_SEEDS_HSEQ.md)
- [Secuencia de implementación para Claude](../ingreso-svelte/docs/formularios-dinamicos/README_IMPLEMENTACION_CLAUDE.md)

## Límite técnico

El módulo nuevo no reutiliza ni migra las tablas legacy de evaluaciones. Se implementa en `src/modules/formularios-dinamicos/` y registra rutas bajo `/api`.

El SQL de la especificación es una propuesta para ejecución manual del usuario. El agente no debe leer `DATABASE_URL`, conectarse con PSQL, ejecutar migraciones, `db push`, `db pull` ni Prisma Studio. Al implementar el schema debe seguir exactamente las restricciones de `AGENTS.md`.

## Resultado backend mínimo

- Definiciones y versiones inmutables al publicar.
- Constructor draft con revisión optimista.
- Asignaciones autorizadas por conductor/vehículo/sede/grupo.
- Submissions tipados, repetibles, con adjuntos y auditoría.
- POST idempotente por `client_submission_id`.
- Portal autenticado por magic link sin aceptar identidad desde payload.
- Eventos Socket.IO como invalidación/notificación; HTTP es fuente de verdad.
- Trece artefactos de semilla en DRAFT, sin cargarlos ni publicarlos automáticamente.

