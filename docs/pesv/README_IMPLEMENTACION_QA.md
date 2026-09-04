# Implementación, migración y QA

## Fases

### 1. Núcleo de cumplimiento

- Crear ciclo, catálogo de 24 pasos, responsables y permisos.
- Implementar evidencia, carga S3, revisión y auditoría.
- Sembrar el ciclo Avanzado del año vigente sin declarar pasos cumplidos automáticamente.

### 2. Normalización operacional

- Normalizar documentos de conductores, vehículos y contratos.
- Etiquetar Formularios PESV y adoptar sus envíos como preoperacionales.
- Cambiar jornada/kilometraje a registros diarios segmentados.
- Añadir riesgos, metas, programas, siniestros, velocidad y mantenimiento técnico.

### 3. Contratos y FUEC

- Crear modelos relacionales e importador idempotente del TXT.
- Conciliar entidades y guardar PDFs/snapshots.
- Vincular servicios y exponer estados de cobertura.

### 4. Indicadores y dashboard

- Implementar y probar cada calculador antes de incluirlo en el overview.
- Exponer inconsistencias y procedencia.
- Migrar el frontend por vistas y retirar las escrituras manuales obsoletas.

### 5. Despliegue

- Ejecutar backfill con conteos antes/después.
- Validar una muestra con HSEQ, Operaciones, Mantenimiento y Talento Humano.
- Desplegar backend compatible, luego frontend, y finalmente desactivar escrituras legacy.
- Repetir migraciones, configuración, pruebas y despliegue en Cotransmeq.

## Pruebas mínimas

- Unitarias de fórmulas, semáforos, periodos y cobertura.
- Turnos normales y cruzando medianoche; kilómetros nulos, iguales, negativos y válidos.
- Envíos de formularios borrador, entregado, anulado y sustituido.
- Deduplicación por vehículo-fecha en preoperacionales.
- Vigencias documentales y ventana configurable de 30 días.
- Siniestros por severidad, *in itinere* y costos.
- Mantenimiento temprano, oportuno, tardío y sin soporte.
- FUEC sin contrato, vencido o con vehículo/conductor diferente.
- Evidencia pendiente, aprobada, rechazada, reemplazada y vencida.
- Permisos de lectura, contribución y revisión; prohibición de autoaprobación.
- Importaciones repetidas sin duplicados.
- Soft delete y preservación de snapshots e historial.
- Contrato de tipos entre backend y frontend.
- E2E de filtros URL, navegación profunda y estados `SIN_DATOS`.

## Compatibilidad y datos existentes

- Las actividades se migran al ciclo de su campo `anio`.
- `preoperacionales` y `excesos_velocidad` se exponen como series históricas con origen
  `LEGACY`; no se inventan eventos detallados.
- Los endpoints actuales se conservan hasta que la nueva ruta deje de llamarlos.
- Las migraciones son aditivas. La eliminación de columnas o tablas requiere una entrega
  posterior y verificación de que ningún consumidor las usa.
- Se preservan todos los cambios locales ajenos al PESV.

## Definición de terminado

- Los 24 pasos aparecen y pueden demostrar sus evidencias.
- Los 13 indicadores reproducen sus variables o explican exactamente qué dato falta.
- Toda alerta enlaza una acción o registro concreto.
- HSEQ puede aprobar y auditar sin acceso directo a la base.
- Un servicio permite verificar conductor, vehículo, documentos, contrato, FUEC,
  preoperacional y desplazamiento.
- TypeScript, Svelte checks, pruebas API/E2E y verificación de migraciones pasan en los cuatro
  repos del producto.

