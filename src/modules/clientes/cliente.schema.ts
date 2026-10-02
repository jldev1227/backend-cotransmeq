import { z } from 'zod';

// Enum TipoCliente para validación.
//
// La base guarda `EMPRESA | PERSONA_NATURAL` (enum de Prisma), pero aquí solo
// se aceptaba `PERSONA`: crear una persona natural desde la web fallaba
// siempre con 400, y editar una existente también, porque el formulario manda
// su `tipo`. `PERSONA` se sigue aceptando por compatibilidad y se traduce.
const TipoClienteEnum = z.preprocess(
  (v) => (v === 'PERSONA' ? 'PERSONA_NATURAL' : v),
  z.enum(['EMPRESA', 'PERSONA_NATURAL']),
);

// Schema base para Cliente (sin validaciones condicionales)
const clienteBaseSchema = z.object({
  tipo: TipoClienteEnum.default('EMPRESA'),
  nit: z.string().optional().nullable(),
  nombre: z.string().min(1, 'El nombre es requerido'),
  representante: z.string().optional().nullable(),
  cedula: z.string().optional().nullable(),
  telefono: z.string().optional().nullable(),
  direccion: z.string().optional().nullable(),
  /// Vacío equivale a «sin correo»: borrar el campo al editar no es un correo
  /// mal escrito.
  correo: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().email('Formato de correo inválido').optional().nullable(),
  ),
  requiere_osi: z.boolean().default(false),
  paga_recargos: z.boolean().default(false),
});

// Schema para crear un cliente con validaciones condicionales
export const createClienteSchema = clienteBaseSchema.refine((data) => {
  // Si es empresa, requiere NIT
  if (data.tipo === 'EMPRESA' && !data.nit) {
    return false;
  }
  // Si es persona, requiere cédula
  if (data.tipo === 'PERSONA_NATURAL' && !data.cedula) {
    return false;
  }
  return true;
}, {
  message: "Las empresas requieren NIT y las personas requieren cédula",
  path: ["tipo"]
});

// Schema para actualizar un cliente (todos los campos opcionales)
export const updateClienteSchema = clienteBaseSchema.partial();

// Schema para buscar clientes
export const buscarClientesSchema = z.object({
  tipo: TipoClienteEnum.optional(),
  requiere_osi: z.boolean().optional(),
  paga_recargos: z.boolean().optional(),
  search: z.string().optional(), // Búsqueda general en nombre, nit, representante, etc.
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional()
});

// Tipos derivados
export type CreateClienteInput = z.infer<typeof createClienteSchema>;
export type UpdateClienteInput = z.infer<typeof updateClienteSchema>;
export type BuscarClientesInput = z.infer<typeof buscarClientesSchema>;