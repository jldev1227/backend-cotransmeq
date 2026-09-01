import { z } from "zod";
import { CAMPOS_EDITABLES } from "./liquidaciones-terceros-adicionales.service";

/**
 * Validación de los endpoints de adicionales de cierres finales.
 *
 * Estos módulos no tenían validación declarativa: los controllers hacían
 * `Number(...)` y `Array.isArray(...)` a mano, y los services llevaban
 * `// @ts-nocheck`. Con la edición por celda desde el canvas eso deja de ser
 * aceptable — un `field` sin validar es un `UPDATE` de columna arbitraria.
 */

export const periodoQuerySchema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  anio: z.coerce.number().int().min(2000).max(2100),
});

export const anualQuerySchema = z.object({
  anio: z.coerce.number().int().min(2000).max(2100),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const crearAdicionalSchema = z.object({
  cierre_id: z.string().uuid(),
  cliente: z.string().max(255).optional(),
  placa: z.string().max(20).optional(),
  tercero_id: z.string().uuid().nullable().optional(),
  tercero_nombre: z.string().max(255).nullable().optional(),
  vehiculo_id: z.string().uuid().nullable().optional(),
  recorrido: z.string().max(500).nullable().optional(),
  fechas: z.string().max(100).nullable().optional(),
  valor_unitario: z.coerce.number().optional(),
  cantidad: z.coerce.number().optional(),
  porcentaje_admin: z.coerce.number().optional(),
  aplica_impuestos: z.boolean().optional(),
});

/**
 * PATCH por celda.
 *
 * `field` se valida contra la lista blanca del service (espejo de
 * `EDITABLE_FIELDS` del cell-permission del cliente). `base_version` es
 * obligatorio: sin él no hay compare-and-swap y volveríamos al
 * last-write-wins silencioso.
 */
export const patchCampoSchema = z.object({
  field: z.string().refine((f) => CAMPOS_EDITABLES.has(f), {
    message: "Campo no editable",
  }),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  base_version: z.coerce.number().int().min(1),
});

export const guardarLoteSchema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  anio: z.coerce.number().int().min(2000).max(2100),
  items: z.array(z.record(z.any())).default([]),
});

/** Formatea un ZodError como `{ error, detalles }` para la respuesta 400. */
export function formatZodError(err: z.ZodError) {
  return {
    error: "Payload inválido",
    detalles: err.errors.map((e) => ({
      campo: e.path.join("."),
      mensaje: e.message,
    })),
  };
}
