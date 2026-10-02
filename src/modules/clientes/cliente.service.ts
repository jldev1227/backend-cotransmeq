// @ts-nocheck
import { randomUUID } from 'crypto'
import { prisma } from '../../config/prisma'
import { CreateClienteInput, UpdateClienteInput, BuscarClientesInput } from './cliente.schema'

export const ClientesService = {
  async create(data: CreateClienteInput) {
    if (data.nit) {
      const existingByNit = await prisma.clientes.findUnique({
        where: { nit: data.nit }
      });
      if (existingByNit && !existingByNit.deletedAt) {
        throw new Error('Ya existe un cliente con este NIT');
      }
    }

    if (data.correo) {
      const existingByEmail = await prisma.clientes.findFirst({
        where: { correo: data.correo, deletedAt: null }
      });
      if (existingByEmail) {
        throw new Error('Ya existe un cliente con este correo');
      }
    }

    // @ts-ignore
    return prisma.clientes.create({
      data: {
        id: randomUUID(),
        tipo: (data.tipo as any) || 'EMPRESA',
        nit: data.nit,
        nombre: data.nombre,
        representante: data.representante,
        cedula: data.cedula,
        telefono: data.telefono,
        direccion: data.direccion,
        correo: data.correo,
        requiere_osi: data.requiere_osi || false,
        paga_recargos: data.paga_recargos || false,
      },
      include: {
        _count: {
          select: {
            recargos: { where: { deleted_at: null } },
            pernotes: { where: { deleted_at: null } },
            servicio: true,
          }
        }
      }
    });
  },

  async list(
    page: number = 1,
    limit: number = 10,
    tipo?: string,
    search?: string,
    /** Orden alfabético por nombre (A–Z por defecto). */
    orden: 'asc' | 'desc' = 'asc',
  ) {
    const skip = (page - 1) * limit;
    
    const where: any = { 
      deletedAt: null,
      oculto: false // Excluir clientes ocultos
    };

    if (tipo && tipo !== 'TODOS') {
      where.tipo = tipo;
    }

    // Búsqueda en múltiples campos
    if (search && search.trim() !== '') {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { nit: { contains: search, mode: 'insensitive' } },
        { representante: { contains: search, mode: 'insensitive' } },
        { cedula: { contains: search, mode: 'insensitive' } },
        { telefono: { contains: search, mode: 'insensitive' } },
        { correo: { contains: search, mode: 'insensitive' } },
        { direccion: { contains: search, mode: 'insensitive' } },
      ];
    }
    
    const [clientes, total] = await Promise.all([
      // @ts-ignore
      prisma.clientes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { nombre: orden },
        include: {
          _count: {
            select: {
              recargos: { where: { deleted_at: null } },
              pernotes: { where: { deleted_at: null } },
              servicio: true,
            }
          }
        }
      }),
      prisma.clientes.count({ where })
    ]);

    return {
      data: clientes,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  },

  async findById(id: string) {
    // @ts-ignore
    const cliente = await prisma.clientes.findFirst({
      where: { 
        id, 
        deletedAt: null 
      },
      include: {
        recargos: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
          take: 5,
        },
        pernotes: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
          take: 5,
        },
        servicio: {
          orderBy: { created_at: 'desc' },
          take: 5,
          include: {
            conductores: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                telefono: true,
              }
            },
            vehiculos: {
              select: {
                id: true,
                placa: true,
                marca: true,
                modelo: true,
              }
            },
            municipios_servicio_origen_idTomunicipios: {
              select: {
                id: true,
                nombre_municipio: true,
                nombre_departamento: true,
              }
            },
            municipios_servicio_destino_idTomunicipios: {
              select: {
                id: true,
                nombre_municipio: true,
                nombre_departamento: true,
              }
            },
          }
        },
        _count: {
          select: {
            recargos: { where: { deleted_at: null } },
            pernotes: { where: { deleted_at: null } },
            servicio: true,
          }
        }
      },
    });

    if (!cliente) {
      throw new Error('Cliente no encontrado');
    }

    return cliente;
  },

  async update(id: string, data: UpdateClienteInput) {
    const existingCliente = await prisma.clientes.findFirst({
      where: { id, deletedAt: null }
    });

    if (!existingCliente) {
      throw new Error('Cliente no encontrado');
    }

    if (data.nit && data.nit !== existingCliente.nit) {
      const existingByNit = await prisma.clientes.findUnique({
        where: { nit: data.nit }
      });
      if (existingByNit && existingByNit.id !== id && !existingByNit.deletedAt) {
        throw new Error('Ya existe un cliente con este NIT');
      }
    }

    if (data.correo && data.correo !== existingCliente.correo) {
      const existingByEmail = await prisma.clientes.findFirst({
        where: { correo: data.correo, deletedAt: null }
      });
      if (existingByEmail && existingByEmail.id !== id) {
        throw new Error('Ya existe un cliente con este correo');
      }
    }

    // @ts-ignore
    return prisma.clientes.update({
      where: { id },
      data: {
        ...(data as any),
        updatedAt: new Date(),
      },
      include: {
        _count: {
          select: {
            recargos: { where: { deleted_at: null } },
            pernotes: { where: { deleted_at: null } },
          }
        }
      }
    });
  },

  async delete(id: string) {
    const cliente = await prisma.clientes.findFirst({
      where: { id, deletedAt: null }
    });

    if (!cliente) {
      throw new Error('Cliente no encontrado');
    }

    return prisma.clientes.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });
  },

  async restore(id: string) {
    const cliente = await prisma.clientes.findUnique({
      where: { id }
    });

    if (!cliente) {
      throw new Error('Cliente no encontrado');
    }

    if (!cliente.deletedAt) {
      throw new Error('El cliente no está eliminado');
    }

    return prisma.clientes.update({
      where: { id },
      data: {
        deletedAt: null,
      },
    });
  },

  async search(params: BuscarClientesInput) {
    const { tipo, requiere_osi, paga_recargos, search, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;
    
    const where: any = {
      deletedAt: null,
    };

    if (tipo) where.tipo = tipo;
    if (requiere_osi !== undefined) where.requiere_osi = requiere_osi;
    if (paga_recargos !== undefined) where.paga_recargos = paga_recargos;

    if (search) {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { nit: { contains: search, mode: 'insensitive' } },
        { representante: { contains: search, mode: 'insensitive' } },
        { cedula: { contains: search, mode: 'insensitive' } },
        { correo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [clientes, total] = await Promise.all([
      // @ts-ignore
      prisma.clientes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              recargos: { where: { deleted_at: null } },
              pernotes: { where: { deleted_at: null } },
            }
          }
        }
      }),
      prisma.clientes.count({ where })
    ]);

    return {
      data: clientes,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  },

  async getStats(id: string) {
    const cliente = await prisma.clientes.findFirst({
      where: { id, deletedAt: null }
    });

    if (!cliente) {
      throw new Error('Cliente no encontrado');
    }

    // Stats simplificados - comentados los queries complejos
    return {
      cliente,
      stats: {
        recargos: { count: 0, total: 0 },
        pernotes: { count: 0, total: 0 }
      }
    };
  },

  async listBasicos() {
    return prisma.clientes.findMany({
      where: { 
        deletedAt: null,
        oculto: false // Excluir clientes ocultos
      },
      select: {
        id: true,
        nit: true,
        nombre: true,
        tipo: true,
        telefono: true,
        correo: true,
        requiere_osi: true
      },
      orderBy: { nombre: 'asc' }
    });
  },

  /**
   * Obtener clientes ocultos (admin only)
   */
  async obtenerOcultos(page: number = 1, limit: number = 10, tipo?: string, search?: string) {
    const skip = (page - 1) * limit;
    
    const where: any = { 
      deletedAt: null,
      oculto: true // Solo clientes ocultos
    };

    if (tipo && tipo !== 'TODOS') {
      where.tipo = tipo;
    }

    // Búsqueda en múltiples campos
    if (search && search.trim() !== '') {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { nit: { contains: search, mode: 'insensitive' } },
        { representante: { contains: search, mode: 'insensitive' } },
        { cedula: { contains: search, mode: 'insensitive' } },
        { telefono: { contains: search, mode: 'insensitive' } },
        { correo: { contains: search, mode: 'insensitive' } },
        { direccion: { contains: search, mode: 'insensitive' } },
      ];
    }
    
    const [clientes, total] = await Promise.all([
      // @ts-ignore
      prisma.clientes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: {
              recargos: { where: { deleted_at: null } },
              pernotes: { where: { deleted_at: null } },
              servicio: true,
            }
          }
        }
      }),
      prisma.clientes.count({ where })
    ]);

    return {
      data: clientes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  /**
   * Cambiar estado de ocultamiento de un cliente
   */
  async cambiarEstadoOculto(id: string, oculto: boolean) {
    return prisma.clientes.update({
      where: { id },
      data: {
        oculto,
        updatedAt: new Date()
      },
      include: {
        _count: {
          select: {
            recargos: { where: { deleted_at: null } },
            pernotes: { where: { deleted_at: null } },
            servicio: true,
          }
        }
      }
    });
  },

  // Operaciones masivas: Ocultar/Mostrar
  async cambiarOcultoMasivo(ids: string[], oculto: boolean) {
    return prisma.clientes.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        oculto,
        updatedAt: new Date(),
      },
    });
  },

  /**
   * Papelera: clientes con borrado lógico.
   *
   * Hasta ahora «eliminar» los sacaba del listado sin ningún sitio donde
   * verlos ni devolverlos (salvo de uno en uno, conociendo el id). Misma
   * forma que la papelera de conductores.
   */
  async obtenerPapelera(page: number = 1, limit: number = 10, tipo?: string, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = { deletedAt: { not: null } };
    if (tipo && tipo !== 'TODOS') where.tipo = tipo;
    if (search && search.trim() !== '') {
      where.OR = [
        { nombre: { contains: search, mode: 'insensitive' } },
        { nit: { contains: search, mode: 'insensitive' } },
        { representante: { contains: search, mode: 'insensitive' } },
        { cedula: { contains: search, mode: 'insensitive' } },
        { correo: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [clientes, total] = await Promise.all([
      prisma.clientes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { deletedAt: 'desc' },
        include: {
          _count: {
            select: {
              recargos: { where: { deleted_at: null } },
              pernotes: { where: { deleted_at: null } },
              servicio: true,
            },
          },
        },
      }),
      prisma.clientes.count({ where }),
    ]);
    return {
      data: clientes,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  },

  // Operaciones masivas: restaurar de la papelera
  async restaurarMasivo(ids: string[]) {
    return prisma.clientes.updateMany({
      where: { id: { in: ids }, deletedAt: { not: null } },
      data: { deletedAt: null, updatedAt: new Date() },
    });
  },

  /**
   * Borrado definitivo, solo desde la papelera y solo sin historial.
   *
   * Un cliente con servicios, liquidaciones o recargos es parte de la
   * contabilidad: borrarlo rompería esos registros (o fallaría por la clave
   * foránea con un error ilegible). En ese caso se responde 409 explicando
   * por qué, y el cliente se queda en la papelera.
   */
  async eliminarPermanente(id: string) {
    const cliente = await prisma.clientes.findUnique({ where: { id } });
    if (!cliente) throw new Error('Cliente no encontrado');
    if (!cliente.deletedAt) {
      throw Object.assign(new Error('Solo se eliminan definitivamente clientes que están en la papelera'), {
        statusCode: 400,
      });
    }
    const [servicios, liquidaciones, recargos, planillas, pernotes, tarifas, salidas] = await Promise.all([
      prisma.servicio.count({ where: { cliente_id: id } }),
      prisma.liquidacion_servicio.count({ where: { cliente_id: id } }),
      prisma.recargos.count({ where: { cliente_id: id } }),
      prisma.recargos_planillas.count({ where: { cliente_id: id } }),
      prisma.pernotes.count({ where: { cliente_id: id } }),
      prisma.tarifas_servicios.count({ where: { cliente_id: id } }),
      prisma.salidas_no_conformes.count({ where: { cliente_id: id } }),
    ]);
    const bloqueantes = { servicios, liquidaciones, recargos, planillas, pernotes, tarifas, salidas };
    if (Object.values(bloqueantes).some((n) => n > 0)) {
      throw Object.assign(
        new Error(
          'No se puede eliminar definitivamente: el cliente tiene historial (servicios, liquidaciones o recargos). Puede quedarse en la papelera.',
        ),
        { statusCode: 409, bloqueantes },
      );
    }
    return prisma.clientes.delete({ where: { id } });
  },

  // Operaciones masivas: Soft Delete
  async eliminarMasivo(ids: string[]) {
    return prisma.clientes.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        deletedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  },
};
