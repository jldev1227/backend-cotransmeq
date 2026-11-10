import { z } from "zod";

const fechaISO = z.string().refine((valor) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return (
    Number.isFinite(fecha.getTime()) &&
    fecha.toISOString().slice(0, 10) === valor
  );
}, "Usa una fecha válida con formato AAAA-MM-DD.");

export const previsualizarImportacionFormulariosSchema = z
  .object({
    fechaDesde: fechaISO,
    fechaHasta: fechaISO,
    estado: z.enum(["SUBMITTED", "VOIDED"]).default("SUBMITTED"),
    codigoFormulario: z.string().trim().max(50).optional(),
    busqueda: z.string().trim().max(120).optional(),
    crearConductoresFaltantes: z.boolean().default(false),
    crearVehiculosFaltantes: z.boolean().default(false),
    pagina: z.number().int().min(1).max(1000).default(1),
    porPagina: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(({ fechaDesde, fechaHasta }) => fechaDesde <= fechaHasta, {
    message: "La fecha inicial debe ser anterior o igual a la fecha final.",
    path: ["fechaHasta"],
  })
  .refine(
    ({ fechaDesde, fechaHasta }) =>
      Date.parse(`${fechaHasta}T00:00:00.000Z`) -
        Date.parse(`${fechaDesde}T00:00:00.000Z`) <=
      365 * 24 * 60 * 60 * 1000,
    {
      message: "El rango máximo de consulta es de 366 días.",
      path: ["fechaHasta"],
    },
  );

export const importarEnviosFormulariosSchema = z
  .object({
    seleccion: z
      .array(
        z
          .object({
            submissionId: z.string().uuid(),
            huella: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    crearConductoresFaltantes: z.boolean().default(false),
    crearVehiculosFaltantes: z.boolean().default(false),
  })
  .strict()
  .refine(
    ({ seleccion }) =>
      new Set(seleccion.map((item) => item.submissionId)).size ===
      seleccion.length,
    {
      message: "No repitas el mismo envío en la selección.",
      path: ["seleccion"],
    },
  );

export type PrevisualizarImportacionFormulariosInput = z.infer<
  typeof previsualizarImportacionFormulariosSchema
>;
export type ImportarEnviosFormulariosInput = z.infer<
  typeof importarEnviosFormulariosSchema
>;
