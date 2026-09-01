# backend-cotransmeq

API de Cotransmeq. **Es Fastify, no NestJS** — pese al gemelo llamado
`backend-nest`, la única dependencia de Nest es `@nestjs/schedule`. Prisma sobre
PostgreSQL.

## Este proyecto tiene un gemelo

El mismo producto corre para dos empresas, en cuatro repos:

| | Transmeralda | Cotransmeq |
|---|---|---|
| Backend | `backend-nest` | `backend-cotransmeq` |
| Frontend | `ingreso-svelte` | `cotransmeq-app` |

**Todo arreglo o funcionalidad se aplica en los dos.** No es opcional ni hay que
preguntarlo: un fix que solo aterriza en uno reaparece como incidencia en el otro
días después, cuando ya se dio por resuelto.

Esto **incluye lo que no es código**: migraciones y `UPDATE` de datos van contra
las dos bases, y los cambios de infraestructura (CORS de bucket, variables de
entorno) se aplican dos veces. Cada despliegue tiene su propio bucket S3, su
propia base y su propio origen; un fallo que solo aparece en uno casi siempre es
config divergente, no código.

Los archivos del módulo de formularios son idénticos entre repos. Al replicar,
**aplica el mismo parche** en vez de copiar el archivo entero, y verifica con
`diff` al terminar.

## Convenciones

**Comentarios que explican el porqué, en español.** El repo documenta decisiones,
no mecánica. `/** */` para la interfaz de una función; `///` para una nota pegada a
la línea que la necesita. Lo valioso es el motivo y lo que se rompió antes:

```ts
/// `ChecksumMode: 'ENABLED'` es obligatorio: sin él S3 NO devuelve
/// `ChecksumSHA256` aunque el objeto se haya subido con checksum, y la
/// verificación fallaría siempre por «no hay checksum».
```

**Errores de dominio con código, no strings sueltos.** `FormError` con un código de
`domain/errors.ts`, que mapea a HTTP en un solo sitio. El código viaja al cliente y
la outbox del portal decide con él si reintenta.

## Comandos

```bash
npm run dev              # tsx watch src/server.ts, en :4000
npx tsc --noEmit         # ← antes de dar nada por hecho
npm run prisma:generate
npm run prisma:deploy
```

`tsc --noEmit` arrastra errores preexistentes en `liquidaciones.service.ts` y en
generación de PDF. Filtra por los archivos que tocaste:

```bash
npx tsc --noEmit 2>&1 | grep -i "<tu-archivo>"
```

## Migraciones Prisma

**La `DATABASE_URL` del `.env` apunta a la base local (PG 18, puerto 5433), no a
Railway.** Es a propósito. Cuando apuntaba a producción, cada `prisma migrate dev`
de desarrollo migraba producción, y en esa base Prisma solo sabía ofrecer un
**reset** — por eso se vaciaban las filas de `formularios_asistencia` cada cierto
tiempo. La tabla no era el objetivo de nada: era daño colateral del reset.

Tres cosas lo causaban, y las tres están arregladas:

1. **El historial no era reconstruible.** 27 migraciones creaban 63 de las 116
   tablas y no había migración inicial, así que Prisma no podía levantar la
   shadow database y concluía «drift» siempre. Resuelto con
   `prisma/migrations/00000000000000_baseline`, generado del esquema real.
2. **Una migración muerta** (`09-01-2026-add-event-details`, 0 pasos aplicados
   desde el 2026-07-30) bloqueaba por sí sola cualquier `migrate deploy`.
3. **27 foreign keys duplicadas** — cada relación con una constraint `fk_*`
   legada y otra canónica, de aplicar el mismo SQL dos veces a mano. Prisma solo
   modela una por relación y chocaba al renombrar. Las depura
   `20260826055900_depurar_fks_duplicadas`.

Además, el `schema.prisma` llevaba tiempo por detrás de su propia base: le
faltaban 15 modelos cuyas tablas sí existían. Se puso al día desde el gemelo.

- Las 27 migraciones históricas están en `prisma/migrations-archivo/` y los
  `.sql` sueltos en `prisma/legacy-sql/`. **Ya están aplicadas: no volver a
  correrlas.** Se conservan como registro, no como historial ejecutable.
- **Producción solo recibe `prisma migrate deploy`.** Nunca `migrate dev`, ni
  siquiera «para ver qué diría»: el diagnóstico ya incluye la propuesta de reset.
- Antes de cualquier migración contra Railway, un dump:
  `pg_dump "$RAILWAY_URL" -Fc -f railway_$(date +%Y%m%d_%H%M).dump` con el cliente
  de PG 18 (el de PG 17 no puede leer un servidor 18.6).
- Levantar la base local:
  ```bash
  /opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /opt/homebrew/var/postgresql@18 \
    -o "-p 5433" -l /opt/homebrew/var/log/postgresql@18.log start
  ```

### Divergencias deliberadas frente al gemelo

El `schema.prisma` es el de Transmeralda salvo tres puntos, y los tres tienen
motivo:

- **Sin `bonificaciones_backup`**: tabla residual de una migración de datos de
  allí, sin código que la use y que aquí no existe.
- **Con `recargos_planillas.imported_from_transmeralda_{id,at}`**: 45 filas con
  valor. Es la trazabilidad de la importación de recargos desde Transmeralda.
- **`tipo_servicio_tarifa_enum` sin `@map`**: aquí las etiquetas están escritas
  con guiones bajos y allí con espacios. El identificador de Prisma es el mismo
  en ambos, así que el código no cambia; poner los `@map` obligaría a reescribir
  las 66 filas existentes.

### Dos bugs de Prisma que muerden al generar migraciones

- **`RENAME CONSTRAINT`** lo mete junto a otros subcomandos en un mismo
  `ALTER TABLE`, y Postgres no lo admite. Si una migración generada falla con
  `syntax error at or near ","`, separa el `RENAME CONSTRAINT` en su propia
  sentencia.
- **`DROP INDEX` sobre un índice que respalda una UNIQUE**: Postgres exige
  soltar la constraint. Y ojo, la shadow database puede tenerlo como índice
  suelto mientras la base real lo tiene como constraint — cúbrelo con un bloque
  `DO` que mire `pg_constraint` primero, o el replay de la shadow falla.

## Formularios dinámicos

El módulo del que depende que un conductor no pierda una inspección.

**Un borrador y un envío guardan las respuestas en columnas distintas y
disjuntas.** `escribirRespuestasCrudas` mete el valor envuelto en `value_json`
(`{draftValue}` / `{draftOptionValues}`) sin tipar ni validar, a propósito: un
número a medio teclear (`"12,"`) no es un decimal válido y rechazarlo perdería lo
que el conductor llevaba escrito. Un envío entregado usa las columnas tipadas y
`form_answer_options`. Cualquier consulta SQL o informe que lea respuestas **tiene
que cubrir las dos formas**, o los borradores saldrán vacíos aunque tengan cientos
de respuestas. Por la API ya no hace falta: `toAnswerDto()` deshace la envoltura.

**Las políticas de límite se cuentan sobre `SUBMITTED`.** Cuidado con
`verificarLimite()`: si `periodKey` es nulo —que es lo que da la frecuencia
`ON_DEMAND`— no filtra por fecha, así que `ONE_PER_CONTEXT` significa «uno por
vehículo **para siempre**», no por día. Hoy todas las asignaciones están en
`UNLIMITED` para esquivarlo.

**Las subidas de evidencia no pasan por la API.** El teléfono hace `PUT` directo a
una URL prefirmada de S3. Al firmarla, el checksum se iza al query string y **no**
debe reenviarse como cabecera: SigV4 exige que toda cabecera `x-amz-*` esté
firmada, y una que no lo esté hace que S3 rechace la petición entera. Si una
subida falla, comprueba el **CORS del bucket** antes que la firma: un preflight
rechazado hace que `fetch` lance sin llegar a AWS, y en DevTools se ve igual que
un problema de firma.

**Un `SignatureDoesNotMatch` de S3 trae el `CanonicalRequest` completo en el XML.**
Recalcula la firma en local con el secreto del `.env`: si coincide con
`SignatureProvided`, el canonical está bien y el problema es que el secreto no
corresponde a esa access key (confírmalo con `aws sts get-caller-identity`).

## Documentos PDF

Los PDF de liquidaciones los renderiza Puppeteer desde un template
(`liquidaciones-terceros-pdf/`). Los tokens visuales viven en `pdf-tokens.ts` y son
**espejo exacto** del fichero homónimo del frontend; `pdf-tokens.spec.ts` lee el
del frontend y falla si divergen. Es la única forma de enterarse: una divergencia
no rompe nada, simplemente el preview se ve de un color y el PDF de otro, y nadie
lo nota hasta que el cliente compara.

Los documentos de **formularios dinámicos** no siguen este camino: se imprimen
desde el cliente. Reimplementar aquí los diecinueve tipos de campo daría un segundo
renderizador que divergiría del primero.
