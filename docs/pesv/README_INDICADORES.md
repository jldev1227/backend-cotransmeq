# Indicadores PESV

## Contrato común

Cada indicador devuelve código, nombre, periodo, frecuencia, unidad, valor, meta, semáforo,
numerador, denominador, fórmula, cobertura, fuentes, fecha de corte e inconsistencias. Los
estados posibles son `OK`, `ALERTA`, `CRITICO` y `SIN_DATOS`.

## Matriz de indicadores

| # | Código | Cálculo | Frecuencia | Fuente principal |
|---:|---|---|---|---|
| 1 | `TSV` | Siniestros por nivel × 1.000.000 / km recorridos | Trimestral y acumulado | Siniestros + segmentos |
| 2 | `CSV` | Costos directos + indirectos por nivel de pérdida | Trimestral y acumulado | Siniestros |
| 3.1 | `RSVI` | Riesgos finales identificados − riesgos iniciales | Anual | Matriz de riesgos |
| 3.2 | `GRV` | Riesgos altos finales − riesgos altos iniciales | Anual | Matriz de riesgos |
| 4 | `CMP` | Metas logradas / metas definidas × 100 | Trimestral y acumulado | Metas PESV |
| 5 | `CPLAN` | Actividades ejecutadas / programadas × 100 | Trimestral y acumulado | Actividades PESV |
| 6 | `EJLC` | Días con exceso de jornada / días trabajados × 100 | Mensual y acumulado | Registro diario + regla vigente |
| 7 | `GVE` | Vehículos cubiertos por velocidad / vehículos usados × 100 | Mensual y acumulado | Programa + servicios |
| 8 | `ELVL` | Desplazamientos con exceso / desplazamientos totales × 100 | Mensual y acumulado | Eventos de velocidad + servicios |
| 9 | `IDP` | Vehículos inspeccionados / vehículos trabajados × 100 | Mensual y acumulado | Formularios + operación |
| 10 | `CPMVH` | Mantenimientos preventivos oportunos / programados × 100 | Trimestral y acumulado | Plan de mantenimiento |
| 11 | `CPFSV` | Capacitaciones ejecutadas / programadas × 100 | Trimestral y acumulado | Plan + Asistencias |
| 12 | `CPF` | Colaboradores capacitados / población objetivo × 100 | Trimestral y acumulado | Asistencias + población |
| 13 | `NCAC` | No conformidades gestionadas y cerradas / identificadas × 100 | Anual | Acciones Correctivas |

## Reglas de cálculo

- `TSV` se desagrega en fatalidad, lesión grave, lesión leve y choque simple, e incluye los
  eventos laborales e *in itinere* que correspondan al alcance del PESV.
- Los kilómetros provienen de segmentos válidos. Sin denominador confiable, `TSV` queda
  `SIN_DATOS` y muestra los recorridos sin kilometraje.
- El exceso de jornada consulta una política con `vigente_desde` y `vigente_hasta`; no usa
  una constante permanente en el código.
- `ELVL` requiere eventos individuales. Los totales mensuales históricos se muestran aparte y
  nunca se convierten artificialmente en desplazamientos.
- Para `IDP`, el numerador es un vehículo-fecha con al menos un envío válido de la asignación
  marcada como preoperacional. El denominador es un vehículo-fecha efectivamente trabajado.
- Una orden preventiva ejecutada después del vencimiento no cuenta como oportuna en `CPMVH`.
- La población de formación queda congelada por periodo para que altas posteriores no cambien
  retroactivamente el porcentaje.
- `NCAC` solo toma hallazgos de auditoría PESV; el cierre exige evidencia y eficacia aprobadas.

## Metas y semáforo

HSEQ configura meta, sentido (`MAYOR_ES_MEJOR` o `MENOR_ES_MEJOR`) y umbral de alerta por
ciclo. Sin meta aprobada, se calcula el valor pero no se declara cumplimiento. Todo resultado
almacena o exporta las variables usadas para su reproducción.

