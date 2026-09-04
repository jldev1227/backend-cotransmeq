# Arquitectura backend PESV

## Modelos nuevos

- `pesv_cycle`: año, nivel, vigencia, líder, versión y estado.
- `pesv_requirement_status`: ciclo, paso 1–24, responsable, plazo, estado y notas.
- `pesv_evidence`: requisito, origen, snapshot, archivo, vigencia, revisión y borrado lógico.
- `pesv_evidence_review`: historial inmutable de decisiones de HSEQ.
- `pesv_goal`: línea base, meta, unidad, fecha, responsable y resultado.
- `pesv_risk`: proceso, actor, peligro, exposición, probabilidad, consecuencia y controles.
- `pesv_program` y `pesv_program_vehicle`: programas críticos y cobertura de flota.
- `pesv_incident`: siniestro, tipo de trayecto, severidad, costos e investigación.
- `pesv_speed_event`: instante, límite, velocidad, vehículo, conductor, servicio y fuente.
- `pesv_training_plan`: evento planificado, población, asistencia y evaluación asociadas.
- `vehicle_maintenance_plan` y `vehicle_maintenance_event`: programación y hoja de vida.
- `transport_contract` y `fuec_extract`: contrato de transporte y extracto expedido.

Todos los datos creados por usuarios incluyen autor, fechas y `deleted_at` cuando su retiro deba
ser recuperable. Revisiones, snapshots, firmas e historial no se eliminan.

## Extensiones

- `actividades_pesv`: `cycle_id`, `step_number`, `program_id`, `goal_id`, periodo planificado
  y requisito de evidencia al completar.
- `documento`: tipo normalizado, número, emisor, expedición, vencimiento, revisión y relación
  correcta con conductor, vehículo o contrato.
- `form_definition` o asignación: propósito PESV y paso asociado.
- `acciones_correctivas_preventivas`: ciclo, paso y origen de auditoría PESV.
- `servicio`: contrato y FUEC aplicables.

## API

### Lectura consolidada

- `GET /pesv/overview?year=`
- `GET /pesv/compliance?year=&phase=&status=&area=`
- `GET /pesv/indicators?year=&quarter=&month=`
- `GET /pesv/operations?from=&to=&vehicleId=&driverId=&clientId=`
- `GET /pesv/document-alerts?cutoff=&ownerType=`
- `GET /pesv/fuec-coverage?from=&to=&status=`

### Gestión

- CRUD de `/pesv/cycles`, `/pesv/risks`, `/pesv/goals`, `/pesv/programs`,
  `/pesv/incidents`, `/pesv/speed-events` y planes de formación/mantenimiento.
- `PATCH /pesv/compliance/:step` para responsable, plazo, notas y transición permitida.
- `POST /pesv/evidences/presign`, `POST /pesv/evidences` y
  `PATCH /pesv/evidences/:id/review`.
- `DELETE /pesv/evidences/:id` realiza borrado lógico y conserva las revisiones.

Los endpoints actuales permanecen durante la transición como adaptadores. No se añaden nuevas
escrituras a `preoperacionales` ni a los agregados mensuales de velocidad después del corte.

## Respuesta de indicador

```ts
interface PesvIndicatorResult {
  code: string;
  period: { year: number; quarter?: number; month?: number };
  status: 'OK' | 'ALERTA' | 'CRITICO' | 'SIN_DATOS';
  value: number | null;
  unit: 'PERCENT' | 'RATE' | 'COUNT' | 'CURRENCY';
  target: number | null;
  numerator: number | null;
  denominator: number | null;
  formula: string;
  dataCoverage: { expected: number; valid: number; excluded: number };
  sources: Array<{ domain: string; recordIds: string[]; cutoffAt: string }>;
  issues: Array<{ code: string; count: number; actionUrl?: string }>;
}
```

## Seguridad y archivos

- `pesvRoutes` y `actividadesPesvRoutes` deben exigir autenticación y permiso `pesv`.
- HSEQ y Administración tienen `full` y capacidad de revisión.
- Operaciones, Mantenimiento y Talento Humano tienen `limited`: aportan donde el requisito les
  fue asignado, pero no aprueban su propia evidencia.
- Los demás permisos autorizados son `read`.
- Las subidas usan URL prefirmada, checksum y confirmación antes de crear la evidencia.
- Los enlaces a fuentes respetan el permiso del módulo fuente; PESV no amplía acceso sensible.

## Cálculo y rendimiento

Los agregadores viven en servicios puros por indicador y se prueban sin Fastify. El overview
ejecuta consultas independientes en paralelo y devuelve una única fecha de corte. Se añaden
índices por ciclo/paso, fecha/vehículo, fecha/conductor, estado de revisión y vencimiento. No se
cachea un resultado si contiene evidencia pendiente o fuentes modificadas después del corte.

