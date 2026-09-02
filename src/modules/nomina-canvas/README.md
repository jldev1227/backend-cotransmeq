# Canvas de nómina

Genera el libro de nómina de un periodo a partir de lo que ya hay en la base:
una hoja por conductor, en orden alfabético, con la misma estructura que los
Excel que hasta ahora se montaban a mano.

## Por qué existe

La nómina se armaba dos veces. Alguien construía un Excel por conductor —27
archivos en agosto de 2026, repartidos en cuatro carpetas— y después esa misma
información se re-tecleaba en `/dashboard/nomina`. Pero la app ya tenía los
datos: `recargos_planillas → dias_laborales_planillas → detalles_recargos_dias`
guarda exactamente lo que la hoja calcula a mano, con los mismos siete tipos de
recargo y con el porcentaje y el valor-hora congelados por fecha.

## Piezas

| Archivo | Qué hace |
|---|---|
| `nomina-canvas.service.ts` | Arma el libro del periodo desde las planillas |
| `nomina-canvas.types.ts` | Forma del DTO; colores y nombres de los recargos |
| `nomina-estado.service.ts` | Máquina de estados con reversión y auditoría |
| `nomina-patch.service.ts` | Edición celda a celda con compare-and-swap |
| `nomina-snapshots.service.ts` | Versiones del periodo, diff y restauración |
| `nomina-envios.service.ts` | Constancia de cada intento de envío |
| `desprendible.template.ts` | El documento en HTML, para Puppeteer |
| `../../queue/envio-nomina-queue.service.ts` | Cola de envío con progreso |
| `../../lib/nomina/` | El cálculo puro (ver su propio README) |

## El periodo no es el mes

La nómina va **del día 21 del mes anterior al 20 del actual**, pero
`recargos_planillas` se indexa por mes natural y `dias_laborales_planillas.dia`
es un `Int` 1-31. Un periodo cruza siempre dos meses de planilla y hay que
unirlos: eso es `lib/nomina/periodo.ts`.

El día de corte es **un parámetro** (`?desde=21`), no una constante, y está a la
vista en la barra del canvas. Está deducido de los archivos de agosto de 2026,
no de ninguna regla escrita, así que si algún mes se liquida distinto se cambia
ahí en vez de tocar código.

## Qué se puede editar

Casi nada, y es a propósito. Los días, las horas, el desglose por empresa, las
siete filas de recargo y el reparto entre desprendible y disponibilidad son
DERIVADOS de las planillas. Solo se registra binding —y por tanto solo es
editable— en los conceptos del desprendible que una persona teclea.

Es **default-deny**: una celda sin binding no se puede escribir, así que la hoja
puede crecer sin que nadie tenga que acordarse de añadir nada a una lista negra.
Si una cifra de recargos está mal, lo que se corrige es la planilla en
`/dashboard/recargos`; el canvas se actualiza solo.

Encima de eso hay un segundo corte por estado: una liquidación `APROBADA`,
`PAGADA` o `ANULADA` no se toca aunque la celda tenga binding.

## Estados

```
BORRADOR  → LIQUIDADA, ANULADA
LIQUIDADA → APROBADA, BORRADOR (reversión), ANULADA
APROBADA  → PAGADA, LIQUIDADA (reversión), ANULADA
PAGADA    → ANULADA
ANULADA   → (terminal, exige motivo)
```

`APROBADA` y `PAGADA` son de Administración, y el guard va en las dos
direcciones: entrar y salir. Con solo el de salida, aprobar lo podría hacer
cualquiera y la cadena de aprobación no significaría nada.

`liquidaciones.estado_flujo` es la columna nueva; `estado` (el enum
`Pendiente|Liquidado`) se mantiene sincronizado para no romper lo que ya lo lee.

**Espejo:** `ingreso-svelte/src/lib/editor/builders/nomina-estado.ts`. Está
duplicado a propósito y protegido por `tests/nomina-builder.test.ts`, que LEE
este archivo y falla si las dos matrices divergen.

## El PDF que estaba roto

`generatePayslipPdfBuffer()` devolvía un documento que decía literalmente
«Test PDF - Empty Content», con un comentario de «bypassing full content
generation for testing». O sea que `GET /liquidaciones/:id/pdf-desprendible` y
`POST /liquidaciones/generate-payslips-zip` llevaban tiempo entregando
documentos vacíos: una descarga masiva de treinta desprendibles producía
treinta copias del marcador de posición.

Ahora renderiza `desprendible.template.ts` con Puppeteer. De paso se arregló el
ZIP, que enganchaba los listeners de `archiver` DESPUÉS de `finalize()` —los
primeros trozos se emitían sin nadie escuchando— y no tenía manejador de
`error`, que en `archiver` llega por evento y sin él tumba el proceso.

⚠️ **Quedan dos desprendibles distintos.** El portal del conductor y el modal
del dashboard siguen generando el suyo en el navegador con pdfmake
(`ingreso-svelte/src/lib/utils/pdfDesprendible.ts`, 1.556 líneas). Los datos son
los mismos —salen de la misma liquidación— pero la maquetación no. Apuntar esos
dos flujos a `/pdf-desprendible` es el paso siguiente y deja un solo documento.

## Espejo en cotransmeq

De este módulo, en `backend-cotransmeq` está **solo lo que allí tiene sentido**:

| Pieza | cotransmeq | Por qué |
|---|---|---|
| `lib/nomina/` (cálculo puro) | ✅ idéntico | Sin dependencias |
| `desprendible.template.ts` | ✅ idéntico | Por eso el `prelude` es parámetro |
| Arreglo del PDF y del ZIP | ✅ aplicado | Es un fallo, y estaba en los dos |
| El canvas | ❌ no | Ver abajo |

`cotransmeq-app` **no tiene Univer**: ni dependencias `@univerjs/*`, ni
`src/lib/editor/univer`, ni `src/lib/components/univer`, ni ninguna ruta
`canvas`. Llevar el canvas allí no es aplicar el mismo parche — es portar antes
toda la infraestructura de canvas (engine, shell, barra, carril, host, guard,
sesión colaborativa, bindings y permisos de celda), que es un trabajo mayor que
este módulo. Queda como decisión aparte.

La única diferencia entre las dos copias de la plantilla es el `prelude`: aquí
lleva las fuentes embebidas y los tokens de color del módulo de terceros; allí
no existe ese módulo y el documento sale con las fuentes del sistema.
