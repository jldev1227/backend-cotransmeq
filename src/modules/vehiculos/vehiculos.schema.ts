import { z } from 'zod'

// Enum para estado del vehículo - debe coincidir con enum_vehiculos_estado en Prisma
const EstadoVehiculoEnum = z.enum([
  'DISPONIBLE', 
  'NO_DISPONIBLE',
  'SERVICIO', 
  'MANTENIMIENTO', 
  'INACTIVO',
  'DESVINCULADO',
  'activo',
  'inactivo',
  'mantenimiento'
])

export const createVehiculoSchema = z.object({
  placa: z.string().min(6, "La placa debe tener al menos 6 caracteres"),
  marca: z.string().min(2, "La marca debe tener al menos 2 caracteres").optional(),
  linea: z.string().min(2, "La línea debe tener al menos 2 caracteres").optional(),
  modelo: z.string().min(1, "El modelo debe tener al menos 1 caracter").optional(),
  color: z.string().optional(),
  clase_vehiculo: z.string().min(2, "La clase de vehículo es requerida"),
  tipo_carroceria: z.string().optional(),
  combustible: z.string().optional(),
  numero_motor: z.string().optional(),
  vin: z.string().optional(),
  numero_serie: z.string().optional(),
  numero_chasis: z.string().optional(),
  propietario_nombre: z.string().optional(),
  propietario_identificacion: z.string().optional(),
  kilometraje: z.number().int().min(0).optional(),
  estado: EstadoVehiculoEnum.optional(),
  fecha_matricula: z.string().optional(),
  conductor_id: z.string().uuid().optional()
})

export const updateVehiculoSchema = createVehiculoSchema.partial()

export type CreateVehiculoInput = z.infer<typeof createVehiculoSchema>
export type UpdateVehiculoInput = z.infer<typeof updateVehiculoSchema>
