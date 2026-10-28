# Encuestas

Módulo en `src/modules/encuestas/`. Cada empresa tiene sus propias tablas
`encuesta` y `encuesta_respuesta`. El constructor del panel publica un enlace
`/public/encuestas/<token>` con token aleatorio. El público no necesita sesión.

## Contrato y acceso

| Método | Ruta | Acceso | Uso |
|---|---|---|---|
| GET | `/api/encuestas` | `encuestas:read` | Lista con conteo de respuestas |
| POST | `/api/encuestas` | `encuestas:full` | Crea borrador |
| POST | `/api/encuestas/generar` | `encuestas:full` | Propone título y preguntas con el asistente IA; no guarda ni publica |
| GET | `/api/encuestas/:id` | `encuestas:read` | Detalle y preguntas |
| PUT | `/api/encuestas/:id` | `encuestas:full` | Edita un borrador, una encuesta publicada o cerrada |
| POST | `/api/encuestas/:id/publicar` | `encuestas:full` | Publica un borrador y abre el enlace |
| POST | `/api/encuestas/:id/cerrar` | `encuestas:full` | Deja de aceptar respuestas |
| POST | `/api/encuestas/:id/abrir` | `encuestas:full` | Reabre una encuesta cerrada si su fecha de cierre no venció |
| POST | `/api/encuestas/:id/duplicar` | `encuestas:full` | Crea un borrador con las mismas preguntas |
| DELETE | `/api/encuestas/:id` | `encuestas:full` | Archivo lógico; conserva respuestas |
| GET | `/api/encuestas/:id/resultados` | `encuestas:read` | Totales, gráficos y 50 respuestas por página |
| GET | `/api/encuestas/:id/exportar.xlsx` | `encuestas:read` | Respuestas con valores legibles y resumen |
| GET | `/api/encuestas/:id/exportar.pdf` | `encuestas:read` | Reporte resumido con distribuciones |
| GET | `/api/public/encuestas/:token` | pública | Preguntas y estado, sin respuestas |
| GET | `/api/public/encuestas/:token/eventos` | pública | SSE con cambios de estado o contenido; no incluye respuestas |
| POST | `/api/public/encuestas/:token/respuestas` | pública, límite por IP y token | Valida y guarda una respuesta |

`POST/PUT /api/encuestas` reciben título, descripción, mensaje final, modo de
nombre/correo (`NO`, `OPCIONAL`, `OBLIGATORIO`), política de origen,
fecha de cierre opcional y preguntas. Los tipos son texto corto/largo, opción
única/múltiple, sí/no, escala, NPS, número, fecha y correo. Cada pregunta y
opción lleva UUID estable. Las encuestas publicadas o cerradas se pueden editar.
Al guardar cambios se avisa a los formularios públicos activos por SSE; cada
participante conserva respuestas de preguntas sin cambios, debe contestar de
nuevo las preguntas nuevas o modificadas y se eliminan del formulario las
respuestas en curso de preguntas retiradas. El enlace vuelve a aceptar respuestas
al reabrir; una fecha de cierre vencida debe corregirse antes.

En una pregunta de opción única o múltiple se puede activar `permite_otro` y
definir `otro_etiqueta` (por defecto, `Otra (especificar)`). El formulario agrega
esa opción al final y solicita el texto al seleccionarla. La respuesta se guarda
como `{ opcion_ids: string[], otro_activo: boolean, otro_texto: string }`; la
selección única admite una opción o el texto abierto, y la múltiple admite ambas
cosas. También se puede crear una pregunta solo abierta con `TEXTO_CORTO` o
`TEXTO_LARGO`. Los resultados cuentan la opción abierta y muestran sus textos;
Excel y PDF conservan los valores legibles. Esta configuración vive dentro del
JSON de preguntas y no requiere migración de base de datos.

`POST /api/encuestas/generar` recibe `{ instrucciones }` (5 a 12.000 caracteres)
y devuelve `{ success, encuesta }` con título, descripción, mensaje final y
preguntas tipadas con UUID. Requiere permiso `encuestas:full`, utiliza el mismo
despliegue de Azure OpenAI del asistente y limita cada usuario a 12 propuestas
por cada 15 minutos. Solo propone contenido: el panel lo presenta para revisión
y quien crea la encuesta decide si lo incorpora, guarda o publica.

El `POST` público recibe `{ nombre?, correo?, dispositivo?, respuestas }`;
`respuestas` es un objeto indexado por UUID de pregunta. El servidor valida
obligatoriedad, tipo, escala y pertenencia de las opciones. No se confía en las
opciones enviadas por el navegador. Una encuesta cerrada o pasada de
`fecha_cierre` responde 409.

## Origen y privacidad

`registrar_origen=false` es el valor inicial: no se guarda IP ni huella.
Si se activa, el servidor compara valores HMAC SHA-256 por encuesta; no persiste
la IP ni el fingerprint original. La huella del dispositivo la calcula el
navegador; es una señal aproximada, no identidad. La IP se toma con
`ipCliente` y también es una señal aproximada, sobre todo con redes compartidas.

`politica_origen`:

- `PERMITIR`: conserva los hashes sin comparar y acepta todas las respuestas.
- `MARCAR`: acepta todas y señala coincidencias de IP o dispositivo al equipo.
- `BLOQUEAR_HUELLA`: bloquea un segundo envío desde el mismo dispositivo
  (409); una IP repetida nunca bloquea. Un lock transaccional evita dos envíos
  simultáneos desde la misma huella.

El público tiene un límite holgado de 120 envíos por 15 minutos por
`token + IP`. El panel recibe `encuestas:respuesta` con el ID de la encuesta
y de la respuesta, sin datos personales; consulta de nuevo con autorización.
El canal `encuestas:actualizada` notifica al panel autenticado; el enlace público
usa SSE y el evento solo indica fecha de actualización y estado. Reconexión y
refresco periódico recuperan eventos perdidos.

## Reportes

`GET /resultados?pagina=N` devuelve `total`, coincidencias, serie por día,
desglose por pregunta y las 50 respuestas más recientes de esa página. Para
opciones y escalas incluye totales y porcentajes; para números y escalas,
promedio; para NPS, el porcentaje de promotores menos detractores. Excel
contiene todas las respuestas y una hoja de resumen. PDF contiene distribuciones
y una muestra de texto; las respuestas completas están en Excel.

Migración: `prisma/migrations/20261027175200_encuestas/migration.sql`, en ambos
backends. Debe aplicarse por el procedimiento manual descrito en `AGENTS.md`.
