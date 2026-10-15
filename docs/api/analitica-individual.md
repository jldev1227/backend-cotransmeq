# Analítica individual

### `GET /api/analitica-individual/:tipo/:id`

Devuelve indicadores de una ficha individual para `conductor`, `vehiculo`, `cliente` o
`tercero`. Requiere sesión y los parámetros de consulta `desde` y `hasta` en formato
`AAAA-MM-DD`.

Para `tipo=cliente`, `historico=1` consulta todos los servicios, planillas,
recargos y tramos registrados sin filtrar por fechas. Las zonas, el mapa y las
métricas comparten ese alcance; `desde` y `hasta` siguen siendo obligatorios
para mantener el contrato de la ruta. La frecuencia semanal histórica usa
el tiempo transcurrido desde el primer servicio o planilla.

La métrica `servicios_desplazamientos` evita duplicados: una planilla con `servicio_id`
cuenta como el mismo servicio; una planilla sin servicio y un servicio sin planilla cuentan
como movimientos independientes.

Los valores se calculan al consultar y respetan el período. Los cierres y liquidaciones
históricos se leen tal como quedaron; cambiar el propietario vigente de un vehículo no los
reescribe.

El conductor incluye jornadas, días con y sin registro, nómina, recargos, bonificaciones,
formularios, preoperacionales, asistencias, evaluaciones, mantenimientos y el FUEC vigente o
el último vencido. El vehículo incluye rotación de conductores, órdenes y días de
mantenimiento, actas de entrega, formularios, kilometraje, recargos y vigencia documental.
`preoperacionales` cuenta asignaciones con propósito PESV o nombre de preoperacional, incluso
si una asignación histórica carece de propósito. `detalle.preoperacionales` contiene id,
nombre y fecha de cada envío del período. `extractos_vencidos` se limita a los FUEC que
vencieron dentro del período. Conductor, vehículo y cliente devuelven `fuecs_vigentes` con
extractos vigentes a la fecha actual de Bogotá, enlazables por id.
El conductor incluye hasta 30 registros en `fuecs_vencidos_periodo`; el vehículo
incluye sus cinco últimos extractos en `fuecs_recientes`.
Los recargos se filtran por su mes operativo (`AAAA-MM`), no por la fecha en la que se creó
la fila. El cliente incluye frecuencia semanal, sede, datos faltantes, zonas y rutas
georreferenciadas. Para clientes también devuelve `zonas_historicas`, agregadas por
servicio para todo el historial disponible. Las ubicaciones usan coordenadas exactas del
servicio y recurren al centro del municipio cuando no hay punto exacto. El tercero incluye
vehículos vigentes, notas y liquidaciones finales.
