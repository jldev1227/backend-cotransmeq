import { z } from 'zod';

export const TipoPersonaEnum = z.enum(['PERSONA', 'EMPRESA']);
export const RegimenEnum = z.enum([
  'SIMPLIFICADO',
  'COMUN',
  'GRAN_CONTRIBUYENTE',
  'NO_RESPONSABLE',
  'AUTORRETENEDOR',
  'ORDINARIO',
]);

export const createTerceroSchema = z.object({
  nombre_completo: z.string().min(1, 'El nombre es requerido'),
  identificacion: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  correo: z.string().email('Formato de correo inválido').optional().nullable(),
  direccion: z.string().optional().nullable(),
  tipo_persona: TipoPersonaEnum.default('PERSONA'),
  regimen: RegimenEnum.optional().nullable(),
  notas: z.string().optional().nullable(),
});

export const updateTerceroSchema = createTerceroSchema.partial();

export const buscarTercerosSchema = z.object({
  search: z.string().optional(),
  tipo_persona: TipoPersonaEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateTerceroInput = z.infer<typeof createTerceroSchema>;
export type UpdateTerceroInput = z.infer<typeof updateTerceroSchema>;
export type BuscarTercerosInput = z.infer<typeof buscarTercerosSchema>;
