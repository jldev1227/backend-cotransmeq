// @ts-nocheck
import { randomUUID } from 'crypto'
import { prisma } from '../../config/prisma'
import { CreateVehiculoInput, UpdateVehiculoInput } from './vehiculos.schema'

export const VehiculosService = {
  async create(data: CreateVehiculoInput) {
    const now = new Date();
    return prisma.vehiculos.create({ 
      data: {
        ...data,
        id: randomUUID(),
        created_at: now,
        updated_at: now
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true
          }
        }
      }
    })
  },

  async list() {
    return prisma.vehiculos.findMany({
      where: {
        deleted_at: null, // Solo vehículos no eliminados
        oculto: false // Excluir vehículos ocultos
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true,
            estado: true
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    })
  },

  async findById(id: string) {
    console.log('🔍 [SERVICE] findById llamado con ID:', id)
    const result = await prisma.vehiculos.findUnique({
      where: { id },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true,
            estado: true
          }
        },
        servicio: {
          select: {
            id: true,
            estado: true,
            fecha_solicitud: true,
            origen_especifico: true,
            destino_especifico: true
          },
          take: 10,
          orderBy: {
            created_at: 'desc'
          }
        }
      }
    })
    console.log('📦 [SERVICE] Resultado de Prisma:', result)
    return result
  },

  async update(id: string, data: UpdateVehiculoInput) {
    return prisma.vehiculos.update({
      where: { id },
      data,
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true
          }
        }
      }
    })
  },

  async delete(id: string) {
    // Soft delete: solo actualiza deleted_at
    return prisma.vehiculos.update({
      where: { id },
      data: {
        deleted_at: new Date()
      }
    })
  },

  async restore(id: string) {
    // Restaurar vehículo eliminado
    return prisma.vehiculos.update({
      where: { id },
      data: {
        deleted_at: null
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true
          }
        }
      }
    })
  },

  async listDeleted() {
    // Listar solo vehículos eliminados
    return prisma.vehiculos.findMany({
      where: {
        deleted_at: {
          not: null
        }
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true,
            estado: true
          }
        }
      },
      orderBy: {
        deleted_at: 'desc'
      }
    })
  },

  async findByPlaca(placa: string) {
    return prisma.vehiculos.findUnique({
      where: { placa },
      include: {
        conductores: true
      }
    })
  },

  async listBasicos() {
    return prisma.vehiculos.findMany({
      where: {
        deleted_at: null,
        oculto: false // Excluir vehículos ocultos
      },
      select: {
        id: true,
        placa: true,
        marca: true,
        modelo: true,
        clase_vehiculo: true,
        estado: true,
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true
          }
        }
      },
      orderBy: {
        placa: 'asc'
      }
    })
  },

  /**
   * Obtener vehículos ocultos (admin only)
   */
  async obtenerOcultos() {
    return prisma.vehiculos.findMany({
      where: {
        deleted_at: null,
        oculto: true // Solo vehículos ocultos
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true,
            estado: true
          }
        }
      },
      orderBy: {
        updated_at: 'desc'
      }
    })
  },

  /**
   * Cambiar estado de ocultamiento de un vehículo
   */
  async cambiarEstadoOculto(id: string, oculto: boolean) {
    const now = new Date()
    return prisma.vehiculos.update({
      where: { id },
      data: {
        oculto,
        updated_at: now
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            email: true,
            telefono: true
          }
        }
      }
    })
  }
}
