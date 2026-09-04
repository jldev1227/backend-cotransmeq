# Lo que se implementó, y en qué difiere del diseño

Este archivo es el registro de correspondencia entre la especificación de
`README_ARQUITECTURA_BACKEND.md` y lo que existe en el código. Se escribe porque
el diseño se hizo antes de inspeccionar el esquema real y varias decisiones
cambiaron al encontrarse con él; sin este documento, quien lea la especificación
buscaría campos que se llaman de otra forma o que no hicieron falta.

Fecha de implementación: 4 de septiembre de 2026.

## Correspondencia de modelos

| Diseño | Implementado | Nota |
|---|---|---|
| `pesv_cycle` | `pesv_cycle` | Igual. Se añadió `dias_por_vencer` como ventana por defecto del ciclo. |
| `pesv_requirement_status` | `pesv_requirement_status` | Igual, más `justificacion` (obligatoria en `NO_APLICA` y `NO_CUMPLE`). |
| `pesv_evidence` | `pesv_evidence` | Igual. La clave del soporte viaja en `descripcion` como `[clave]`; ver más abajo. |
| `pesv_evidence_review` | `pesv_evidence_review` | Igual. Sin `deleted_at`, a propósito. |
| `pesv_goal` | `pesv_goal` | Igual, más `indicador_codigo`, `sentido` y `umbral_alerta`, que el semáforo necesita. |
| `pesv_risk` | `pesv_risk` | Igual. |
| `pesv_program`, `pesv_program_vehicle` | Igual | |
| `pesv_incident` | `pesv_incident` | Igual. |
| `pesv_speed_event` | `pesv_speed_event` | Igual, más `business_date` calculada en servidor. |
| `pesv_training_plan` | `pesv_training_plan` | Igual, más `poblacion_snapshot_json` para congelar la población. |
| `vehicle_maintenance_plan`, `vehicle_maintenance_event` | Igual | |
| `transport_contract`, `fuec_extract` | Igual | Más `fuec_extract_driver` y `fuec_import_issue`. |
| — | `pesv_document_type_config` | **Nuevo.** La ventana de «próximo a vencer» es configurable por tipo, y sin una tabla no había dónde configurarla. |
| — | `pesv_jornada_policy` | **Nuevo.** `README_INDICADORES.md` exige que el límite de jornada tenga vigencia y no sea una constante; hacía falta la tabla. |
| — | `pesv_audit_log` | **Nuevo.** La trazabilidad del módulo estaba pedida pero sin modelo asignado. |

## Decisiones que difieren del diseño

### 1. La clave del soporte va en la descripción, no en una columna

`pesv_evidence` no tiene `soporte_clave`. La clave viaja al inicio de
`descripcion` como `[designacion] …` y `claveSoporteDe()` la extrae.

**Por qué.** El catálogo de los 24 pasos vive en código y sus claves pueden
renombrarse en una entrega futura. Una columna dedicada quedaría apuntando a una
clave inexistente sin que nada fallara, y la evidencia dejaría de contar en
silencio. Con este esquema, una clave obsoleta simplemente no casa y la
evidencia aparece como «sin soporte asignado» en la pantalla, que es visible.

### 2. `documento` se extiende; no se creó una tabla nueva

El diseño hablaba de «normalizar `documento`». Se hizo añadiendo columnas
(`tipo_documento`, `numero`, `emisor`, `fecha_expedicion`, `fecha_vencimiento`,
el eje de revisión, `tercero_id`, `contrato_id` y `deleted_at`).

`fecha_vigencia` **se conserva y se sigue leyendo**: `fecha_vencimiento` la
sustituye solo cuando está informada. Sin esa caída, los miles de documentos
cargados antes aparecerían todos como `SIN_FECHA` y la pantalla de alertas
nacería vacía.

`tercero_id`, `contrato_id` y `revisado_por_id` se crearon **sin clave foránea**.
La tabla arrastra filas cuyo `conductor_id` ya no existe en `conductores`; añadir
integridad referencial ahora exigiría depurarlas primero, y eso es una entrega
aparte. Los `join` se hacen a mano en `pesv-documentos.service.ts`.

`estado_revision` nace `PENDIENTE` para todo lo ya cargado. Es deliberado: esos
documentos no han pasado por revisión de HSEQ, y decir lo contrario sería
exactamente el problema que el módulo viene a resolver.

### 3. «Aportar» no es un nivel de la escala de permisos

`requirePermission` tiene la jerarquía `limited < read < full`. Pedir `'read'` en
los endpoints de lectura habría devuelto 403 a Operaciones, Mantenimiento y
Talento Humano —que tienen `limited` y son quienes más usan la pantalla—, y pedir
`'limited'` en los de escritura habría dejado escribir a Contabilidad y
Facturación.

La solución: los endpoints de lectura piden `'limited'` (el escalón más bajo, que
todos superan) y los de aporte añaden un segundo guarda, `exigirAporte()`, que
rechaza explícitamente el nivel `read`. Aportar no es «más» ni «menos» que leer:
es otra cosa, y por eso no cabe en una escala lineal.

La **revisión** tampoco es un nivel: `puedeRevisar()` exige área `hseq` o
`administracion`, y además `revisarEvidencia()` prohíbe aprobar lo que uno mismo
aportó (`AUTOAPROBACION_PROHIBIDA`, con código propio para que no se confunda con
una falta de permisos y alguien «lo arregle» ampliando el rol).

### 4. El permiso `pesv` dejó de ser `general: true`

Antes cualquier usuario autenticado tenía `full`. Ahora:

```
full     administracion, hseq
limited  operaciones, mantenimiento, talento_humano
read     contabilidad, facturacion
```

Espejo exacto en `cotransmeq-app/src/lib/config/permissions.ts`.

**El despliegue debe hacerse con `PERMISSIONS_MODE=warn`** unos días, leer los
rechazos que registra `permissions.middleware.ts` y solo entonces pasar a
`enforce`. Un usuario sin área asignada pierde el acceso al activarlo.

### 5. Las rutas heredadas no tenían autenticación

`pesvRoutes` no aplicaba `authMiddleware`: cualquiera con la URL leía el panel
completo —conductores, vehículos, clientes, siniestros— y podía escribir en
`dias_laborales_planillas`. `actividadesPesvRoutes` exigía sesión pero ningún
permiso de módulo. Ambas se corrigieron en esta entrega.

### 6. La tendencia se calcula, no se almacena

El diseño no lo especificaba. Se resolvió ejecutando los mismos calculadores
sobre el período anterior, al coste de duplicar las consultas.

**Por qué.** Un histórico de resultados almacenado se queda obsoleto en cuanto
alguien corrige un dato de origen, y la flecha de tendencia mentiría hasta el
siguiente recálculo sin que nada lo delatara. El overview desactiva la tendencia
(`conTendencia: false`) porque allí solo se necesitan los estados.

### 7. Lo que NO se activó

- **Integración RUNT.** Se reservaron `external_id`, `external_status`,
  `last_sync_at`, `request_snapshot` y `response_snapshot` en `fuec_extract` y no
  se usan. No hay norma vigente que la exija, ni servicio publicado, ni
  credenciales. El proyecto de resolución de 2026 que modifica el FUEC está
  publicado *para comentarios*; un proyecto no es una obligación vigente.
- **Exportación del expediente en ZIP.** `GET /pesv/centro/expediente` devuelve
  JSON. Los soportes se descargan uno a uno con URL firmada de 5 minutos. Un ZIP
  con todo dejaría copias sin caducidad de documentos con datos personales de
  conductores.
- **Migración de `preoperacionales` y `excesos_velocidad`.** Se conservan
  intactas y se exponen como serie `LEGACY`. Un booleano diario y un total
  mensual no prueban el evento; convertirlos en registros detallados sería
  inventarlos.

## Cómo aplicar la migración

El historial de migraciones **diverge de la base** en los dos despliegues, así
que `prisma migrate deploy` es destructivo aquí. El procedimiento es el de
`AGENTS.md`:

```bash
# 1. Recuento ANTES. La migración es aditiva y no debe tocar ninguna fila.
psql "$URL" -c "SELECT
  (SELECT count(*) FROM documento)          AS documentos,
  (SELECT count(*) FROM servicios)          AS servicios,
  (SELECT count(*) FROM actividades_pesv)   AS actividades,
  (SELECT count(*) FROM preoperacionales)   AS preoperacionales,
  (SELECT count(*) FROM excesos_velocidad)  AS excesos;"

# 2. Aplicar en transacción.
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f prisma/migrations/20260904100000_pesv_centro_cumplimiento/migration.sql

# 3. Mismo recuento DESPUÉS: los cinco números deben coincidir.

# 4. Registrar a mano en _prisma_migrations.
#    Si el SQL falló, REVIERTE el registro antes de reintentar, o queda anotada
#    una migración que no se aplicó.
```

La migración es idempotente: se puede reintentar entera. Se verificó aplicándola
tres veces seguidas sobre la misma base; la segunda y la tercera no crean nada y
los `INSERT` de catálogo llevan `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`.

**Se aplica en las dos bases**, la de Transmeralda y la de Cotransmeq. El archivo
de migración es idéntico en los dos repos.

## Puesta en marcha después de migrar

El módulo arranca honesto: sin ciclo no hay matriz, y sin insumos los indicadores
dicen `SIN_DATOS`. Para que empiece a medir hace falta, en este orden:

1. **Crear el ciclo del año** desde el encabezado del módulo. Siembra los 24
   pasos en `PENDIENTE` y engancha las actividades que ya existían para ese año.
2. **Etiquetar la asignación preoperacional**: poner `pesv_proposito =
   'PREOPERACIONAL'` en la asignación de Formularios que corresponda. Sin esto,
   el indicador IDP devuelve `SIN_DATOS` con el enlace a la pantalla de
   asignaciones. Es deliberado: contar cualquier formulario haría que una
   encuesta de clima acreditara la inspección de un vehículo.
3. **Definir metas** con `indicador_codigo`. Sin meta aprobada el indicador se
   calcula, pero el semáforo se queda en gris: declarar «OK» sin meta sería
   inventarse el criterio de aceptación.
4. **Revisar la política de jornada** sembrada (8 horas de conducción efectiva,
   vigente desde el 1 de enero). HSEQ debe validarla contra la jornada máxima
   legal y el reglamento interno antes de cerrar el ciclo.
5. **Crear el programa de velocidad** y declarar qué vehículos cubre: es el
   numerador del indicador GVE.
6. **Normalizar documentos**: asignar `tipo_documento` y `fecha_vencimiento` a
   los que no lo tengan, y revisarlos. Hasta entonces aparecen como
   `PENDIENTE` de revisión, que es lo que son.
7. **Importar los extractos** en simulación primero
   (`POST /pesv/centro/fuec/importar` con `{"simulacion": true}`), revisar el
   informe, y solo entonces con `{"simulacion": false}`.
