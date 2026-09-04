# Borrado lógico de liquidaciones de servicios

## Por qué existe esto

Una liquidación se restauró poniendo `deleted_at = NULL` y volvió **vacía**.
Sus `liquidacion_servicio_item` no tenían borrado lógico, así que la cascada
`ON DELETE CASCADE` los había borrado físicamente. Con ellos se fueron los
`liquidacion_tercero` que cuelgan de cada ítem, y de estos sus conceptos. Quedó
una cabecera con unos totales que no correspondían a ninguna fila.

Había una segunda vía de pérdida, más silenciosa: la edición y el autoguardado
reemplazaban los ítems con `deleteMany` + `createMany`. Cada guardado destruía
los anteriores, así que un payload vacío —una pestaña que se cierra antes de
hidratar, una respuesta que llega tarde— vaciaba la liquidación sin dejar rastro
ni dar error.

## Qué se marca y qué no

| Se marca con `deleted_at` | Por qué |
|---|---|
| `liquidacion_servicio_item` | El caso del incidente |
| `liquidacion_tercero` | Cuelga del ítem y de la cabecera |
| `liquidacion_tercero_concepto` | Tercer nivel del mismo árbol |
| `factura_liquidacion_item` | Pivote con datos propios |

| NO se toca | Por qué |
|---|---|
| `historial_estado_liquidacion` | Evidencia: es lo único que queda para reconstruir qué pasó |
| `*_snapshot` | Igual |
| `liquidacion_servicio_draft` | Temporal, su valor caduca |
| sesiones y tokens | Revocar **es** borrar; conservarlos sería un riesgo |

Las cascadas se dejan declaradas a propósito: siguen siendo la red de seguridad
si algún día se borra físicamente de verdad. Lo que cambia es que el flujo de la
aplicación ya no llega a un `DELETE`.

## Cómo se usa

```ts
import {
  eliminarLiquidacionServicio,
  restaurarLiquidacionServicio,
  estaEliminada,
} from '../lib/soft-delete/liquidacion-servicio'

// Marca la cabecera Y todo su árbol, en una transacción.
await eliminarLiquidacionServicio(id, { usuarioId, motivo: 'duplicada' })

// Devuelve todo lo que se marcó.
await restaurarLiquidacionServicio(id, { usuarioId })

// Antes de escribir: una liquidación eliminada no se edita.
if (await estaEliminada(id)) throw new Error('Restáurala primero')
```

Para editar los ítems, **nunca** `deleteMany` + `createMany`:

```ts
import { reconciliarItems } from '../lib/soft-delete/reconciliar-items'

await prisma.$transaction(async (tx) => {
  await reconciliarItems(tx, liquidacionId, items, {
    // Solo en el autoguardado: rechaza vaciar una liquidación que tenía ítems.
    rechazarVaciadoTotal: true,
  })
})
```

## Correlación de ítems

El frontend manda `id` para lo que ya está guardado y `client_key` (un UUID que
pone él) para las filas nuevas. La reconciliación empareja **por `id`, luego por
`client_key`, y nunca por posición**: `orden` cambia en cuanto alguien arrastra
una fila, y emparejar por índice de array mezclaría los datos de dos ítems
distintos sin que nada fallara.

Las filas anteriores a la migración tienen `client_key = NULL` y se correlacionan
por `id`. No hay que rellenarlas.

## Consultas

No hay middleware de Prisma que oculte filas: **los filtros son explícitos**. Un
middleware global habría escondido también lo que la auditoría necesita ver.

- Consulta normal → `where: { deleted_at: null }`
- Include de ítems → `items: { where: { deleted_at: null } }`
- Totales → solo ítems activos (`totalesDeItemsActivos`)
- Vista de eliminados → `deleted_at: { not: null }`, explícito

## Auditoría

Cada eliminación y restauración deja una fila en `auditoria.borrado_logico` con
entidad, registro, acción, usuario, motivo y cuántas filas relacionadas se
marcaron. Vive en el schema `auditoria`, que Prisma no gestiona, para que ninguna
migración futura proponga borrarla.

No sustituye a los datos operativos: es la última red.

## El árbol de terceros

`liquidacion_tercero_final_item`, `liquidacion_tercero_final_concepto` y
`liquidacion_ingreso_transmeralda_fila` **ya tenían** `deleted_at`, pero diez
sitios los borraban con `deleteMany` — incluido uno cuyo comentario afirmaba
conservar las filas «para auditoría» mientras borraba físicamente las activas en
cada guardado.

Los diez pasaron a `updateMany` con `deleted_at`. El `where` de todos ya traía
`deleted_at: null`, así que afectan exactamente a las mismas filas que antes: las
activas. Lo que cambia es que ahora se pueden recuperar.

## Qué comprueban los tests

`tests/soft-delete-liquidaciones.test.ts`, 15 casos. Los que más valen:

- Un ítem retirado **sigue existiendo** marcado, y vuelve al restaurar.
- Volver a añadirlo lo **restaura**, no lo duplica.
- Un autoguardado con lista vacía **se rechaza entero**; la edición explícita sí
  puede vaciar.
- Los totales solo suman ítems activos.
- El historial sobrevive intacto al borrado.
- La migración se puede ejecutar dos veces.

Comprobado que detectan el fallo: al reintroducir el `deleteMany` destructivo,
tres de ellos se ponen rojos.
