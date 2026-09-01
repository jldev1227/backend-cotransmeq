import { z } from "zod";

/**
 * Validación de los endpoints de **ingresos de Transmeralda**.
 *
 * La TABLA de la hoja se lee en vivo de `liquidacion_tercero` y no se puede
 * editar. Lo que sí se escribe —y por tanto necesita validación de verdad— es
 * lo que el equipo decide encima: qué filas bajan a la hoja de ADICIONALES,
 * con qué porcentajes, y los conceptos del pie de cada hoja.
 *
 * `z.coerce` en las query porque llegan como string.
 */

export const anualQuerySchema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
});

export const periodoQuerySchema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  anio: z.coerce.number().int().min(2000).max(2100),
});

/// Porcentaje de la hoja. Se permite negativo: un ingreso puede serlo, y
/// bloquearlo aquí obligaría a arreglarlo fuera del canvas.
const porcentaje = z.coerce.number().min(-1000).max(1000);

export const filaIngresoSchema = z.object({
  /// Item de `liquidacion_tercero` al que se refiere la fila. Es la identidad:
  /// el `id` de la fila de override lo pone el servidor.
  liquidacion_tercero_id: z.string().uuid(),
  incluir_adicional: z.boolean().optional(),
  cantidad: z.coerce.number().min(-1e6).max(1e6).optional(),
  pct_admon_ingresos: porcentaje.nullable().optional(),
  pct_ganancia: porcentaje.nullable().optional(),
  pct_admon_adicional: porcentaje.nullable().optional(),
  valor_unitario_adicional: z.coerce.number().nullable().optional(),
  orden: z.coerce.number().int().optional(),
});

export const conceptoIngresoSchema = z.object({
  id: z.string().uuid().optional(),
  hoja: z.enum(["INGRESOS", "ADICIONALES"]),
  // Sin `PRESTAMO`: este documento no liquida préstamos ni horas extras, y
  // un cliente que todavía los mandara escribiría filas que ninguna hoja
  // pinta ni suma. Se rechazan en la puerta.
  tipo: z.enum(["COSTO_LABORAL", "GASTO_OPERATIVO", "ANTICIPO", "IMPUESTO"]),
  concepto: z.string().min(1).max(100),
  persona: z.string().max(150).nullable().optional(),
  dias: z.coerce.number().nullable().optional(),
  valor_unitario: z.coerce.number().optional(),
  porcentaje: porcentaje.nullable().optional(),
  valor_total: z.coerce.number().optional(),
  base_calculo: z.coerce.number().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  orden: z.coerce.number().int().optional(),
});

export const guardarIngresoSchema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  anio: z.coerce.number().int().min(2000).max(2100),
  observaciones: z.string().nullable().optional(),
  pct_admon_ingresos: porcentaje.optional(),
  pct_ganancia_adicionales: porcentaje.optional(),
  pct_admon_adicionales: porcentaje.optional(),
  filas: z.array(filaIngresoSchema).default([]),
  conceptos: z.array(conceptoIngresoSchema).default([]),
});

export function formatZodError(err: z.ZodError) {
  return {
    error: "Payload inválido",
    detalles: err.errors.map((e) => ({
      campo: e.path.join("."),
      mensaje: e.message,
    })),
  };
}
