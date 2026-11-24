# Ocultos de conductores y vehículos

Ocultar desde Flota es un filtro operativo reversible. No elimina la ficha, sus
relaciones ni sus documentos: Flota conserva una vista de ocultos para
restaurarlos. Las rutas genéricas de conductores y vehículos no aceptan un
parámetro que vuelva a incluir esas fichas; solo la vista administrativa de
ocultos las consulta.

## Alcance operativo

El backend aplica el filtro al consultar, no al escribir el historial:

- Conductores y vehículos: listados, detalles operativos, selectores y opciones
  nuevas requieren `oculto = false`.
- Servicios y recargos: desaparecen si el conductor o el vehículo vinculado
  está oculto. También se excluyen sus agregados y estadísticas.
- Liquidaciones de servicios: una liquidación completa desaparece cuando
  cualquiera de sus ítems corresponde a un conductor o vehículo oculto. Esto
  incluye sus facturas y contadores derivados.
- Cierres finales de terceros: se oculta la hoja completa si su placa,
  cualquiera de las placas agrupadas, un ítem de origen, un concepto o la
  liquidación de servicios origen está relacionado con una entidad oculta.
  Así una liquidación compartida no filtra al resto de placas de la misma hoja.
- Nómina, recargos y canvas: se omiten las hojas del conductor oculto y los
  días copiados cuyo vehículo o placa esté oculto.
- Días laborados y recorridos: no aparecen registros ni recorridos vinculados
  a las fichas ocultas; tampoco pueden seleccionarse para crear registros
  nuevos.
- Extractos FUEC: los listados, el detalle administrativo y los selectores
  excluyen extractos vinculados por identificador o por los datos impresos de
  conductor, documento, vehículo o placa.
- Dashboard y actividad reciente: los indicadores, listados y opciones de
  filtros excluyen los registros relacionados, incluidos servicios,
  liquidaciones agrupadas y facturas asociadas.
- Snapshots: las vistas de nómina filtran las hojas ocultas y no permiten
  restaurarlas. El acceso a snapshots de cierres ocultos queda bloqueado. El
  snapshot persistido no se modifica.

Los filtros de lectura no cambian los cálculos históricos guardados ni borran
registros. Al restaurar la ficha, sus datos vuelven a aparecer según los
filtros normales de cada página.

## Límite legal

La verificación pública de un FUEC mediante QR sigue disponible para conservar
la verificabilidad del documento ya emitido. El ocultamiento afecta la
consulta operativa autenticada, no invalida un documento legal emitido.

## Implementación

`src/lib/ocultos-operativos.ts` centraliza la detección de relaciones ocultas
para que los listados, dashboards, actividad y canvas apliquen la misma regla.
No requiere migración: usa los campos `oculto` que ya existen en las tablas de
conductores y vehículos.

### Diferencias de Cotransmeq

No hay diferencias funcionales en esta regla. Se consulta la base y los datos
propios de Cotransmeq.
