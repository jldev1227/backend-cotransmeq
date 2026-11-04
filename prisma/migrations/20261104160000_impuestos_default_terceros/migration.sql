-- La liquidación puede existir sin filas de impuestos si esta configuración falta.
-- Los conflictos conservan la tarifa que ya haya definido cada empresa.
INSERT INTO "configuracion_descuento_tercero" (
  "id", "categoria", "concepto", "nombre", "porcentaje", "base_calculo",
  "activo", "orden", "created_at", "updated_at"
) VALUES
  ('8d9fe25a-3a4f-4c57-a08f-6c4b5131f001', 'IMPUESTO', 'RETENCION_ICA', 'Retención ICA', 1, 'VALOR_LIQUIDAR', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('8d9fe25a-3a4f-4c57-a08f-6c4b5131f002', 'IMPUESTO', 'AVISOS_TABLEROS', 'Avisos y Tableros', 15, 'RETENCION_ICA', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('8d9fe25a-3a4f-4c57-a08f-6c4b5131f003', 'IMPUESTO', 'SOBRETASA_BOMBERIL', 'Sobretasa Bomberil', 21, 'RETENCION_ICA', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('8d9fe25a-3a4f-4c57-a08f-6c4b5131f004', 'IMPUESTO', 'RETENCION_FUENTE', 'Retención en la Fuente', 3.5, 'TOTAL_VALOR_LIQUIDAR', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("concepto") DO NOTHING;
