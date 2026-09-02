# Cálculo de nómina

Funciones puras, sin Prisma y sin Fastify. Todo entra por parámetro y todo
sale en el resultado, para poder contrastarlas contra los Excel sin levantar
la app ni tocar la base.

| Archivo | Qué hace |
|---|---|
| `liquidar.ts` | Liquidación de un conductor: devengos, IBC, deducciones, neto |
| `periodo.ts` | Aritmética del periodo 21→20, semanas y texto de días por empresa |
| `../../scripts/nomina-contraste-excel.ts` | Contraste contra los Excel reales (`npm run nomina:contraste`) |

Tests: `npm run test:nomina`. Usan `vitest.nomina.config.ts`, que **no** carga
`tests/setup.ts` — ese setup abre una conexión Prisma real nada más
importarse. Aquí no se toca la base ni para saludarla.

## Procedencia

`liquidar.ts` es el port de `calcularTotales()`, que vivía en el navegador
(`ingreso-svelte/src/lib/components/nomina/LiquidacionFormComplete.svelte:1165-1520`)
y cuyo resultado el backend guardaba sin recalcular. El formulario sigue
usando su copia: esto no lo reemplaza todavía, lo consume el canvas.

Lo único que cambia respecto al original es que los UUID de PAREX y Geopark y
el 8 % del ajuste, que allí eran literales repetidos en tres archivos, aquí
son parámetros (`ParametrosNomina`).

## Contraste contra los Excel de agosto 2026

```
npm run nomina:contraste "~/Downloads/NOMINA AGOSTO 2026" "~/Downloads/NOMINA GEOPARK AGOSTO 2026" \
                         "~/Downloads/NOMINA PAREX AGOSTO 2026" "~/Downloads/NOMINA VILLANUEVA AGOSTO 2026"
```

27 archivos, un conductor por archivo. Resultado de la primera pasada:

**Devengos — 27 de 27 cuadran al peso.** El bruto que suma `liquidarNomina()`
es idéntico al `Total Devengado` de la hoja. En tres de ellas ese total
incluye un ajuste a neto pactado que la hoja no rotula (ver más abajo).

**IBC — 24 de 27 hojas descuentan exactamente el 4 % de la base que
declaran**, y la fórmula de esa base coincide con la portada. Ejemplo de
`LeonardoAlvarez` (Parex):

```
Base Prestacional = X25 + X26 + Y38 + X45 + (M25/30*6)
                  = salario + vacaciones + recargos Parex + disponibilidad
                    + 6 días de ajuste salarial
```

que es punto por punto el IBC de `liquidar.ts`
(`salarioDevengado + totalVacaciones + ajusteParaBase + recargosAjusteParaBase
+ recargosGeoparkParaBase`), con `diasAjusteDeducciones = 6`.

La base varía por conductor: en la mayoría es solo el salario devengado; en
los de Geopark y Parex se amplía con recargos y ajuste. Eso depende de
interruptores que están en la base de datos, no en la hoja, así que el script
lo reporta pero no lo aprueba ni lo suspende.

El `BONO ADICIONAL - NO SALARIAL` **no cotiza**, en línea con su nombre y con
lo que hacen las hojas: en los archivos que lo llevan, la base declarada es
solo el salario devengado. `liquidar.ts` ya se comporta así — los bonos y los
conceptos adicionales suman al bruto y se quedan fuera del IBC.

### Neto pactado: una celda sin etiqueta en 3 hojas

`EdisonJimenez`, `JorgeJaramillo` y `OmarSoraca` usan el maquetado antiguo (el
de la transición de la Ley 2466) y comparten una construcción que conviene
conocer antes de replicarla:

```
TOTAL DEVENGADO = AF26 + AF27 + AF28 + AF29 + AG37
                   │      │      │      │      └── 140.072 tecleado a mano, SIN etiqueta
                   salario, vacaciones, auxilio, bono adicional
NETO A PAGAR    = TOTAL DEVENGADO − TOTAL DEDUCCIONES
```

`AG37` está en una columna donde no hay ningún concepto y no lleva rótulo, así
que no aparece como línea del desprendible. Su valor es justo el que hace
falta para que el neto caiga en una cifra redonda:

| Archivo | Conceptos | Celda AG37 | Deducciones | Neto |
|---|---|---|---|---|
| EdisonJimenez | 3.200.000 | +140.072 | −140.072 | **3.200.000** |
| JorgeJaramillo | 3.200.000 | +140.072 | −140.072 | **3.200.000** |
| OmarSoraca | 3.480.000 | +360.072 | −140.072 | **3.700.000** |

O sea: se pacta un neto, se infla el devengado con un importe sin nombre y las
deducciones quedan neutralizadas. En los dos primeros el conductor cobra
exactamente el bruto; en el tercero, 220.000 por encima.

No es un fallo de `liquidar.ts` — el cálculo suma bien lo que la hoja declara.
Es una práctica del proceso manual: se pacta un neto con el conductor y se
cuadra hacia atrás.

**Decidido:** el neto pactado se mantiene, pero deja de ser una celda anónima.
En el canvas es un concepto con nombre —`AJUSTE A NETO PACTADO`— que aparece
como línea del desprendible y se puede auditar. No hace falta tocar
`liquidar.ts`: encaja tal cual en `conceptosAdicionales`, que ya suma al bruto
y no entra al IBC, que es justo el tratamiento que le dan los Excel.

El script lo reconoce y lo lista aparte en vez de darlo por fallo: cuando el
`Total Devengado` de una hoja supera la suma de sus propios conceptos, la
diferencia se reporta como ajuste a neto pactado.

## Comportamiento heredado que se portó tal cual

Dos cosas de `calcularTotales()` que parecen descuidos pero se han copiado
literalmente, porque cambiarlas aquí y no en el formulario haría que las dos
pantallas dieran netos distintos para la misma liquidación. Van marcadas en el
código con `⚠ FIEL AL ORIGINAL` y tienen test propio en `liquidar.spec.ts`:

1. **Las vacaciones deducidas de fechas cotizan pero no se pagan.** El bruto
   suma `valorVacaciones` (el importe tecleado a mano), no `totalVacaciones`.
   Si el usuario pone fechas en vez de importe, las vacaciones entran al IBC y
   no al bruto.
2. **El 8 % de PAREX/Geopark se calcula, se devuelve y se guarda en su columna
   de `liquidaciones`, pero no entra al bruto.** Lo que sí entra al IBC es el
   100 % de los recargos de esas empresas, que es otra cosa.

Ninguna de las dos se corrige sin decidir antes cuál es la versión buena, y la
corrección va en los dos sitios a la vez.
