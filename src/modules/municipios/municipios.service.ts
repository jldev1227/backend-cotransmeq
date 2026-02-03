// @ts-nocheck
import { prisma } from '../../config/prisma'
import { CreateMunicipioInput, UpdateMunicipioInput, BuscarMunicipiosInput } from './municipios.schema'

export const MunicipiosService = {
  async create(data: CreateMunicipioInput) {
    return prisma.municipios.create({ 
      data
    })
  },

  async list() {
    return prisma.municipios.findMany({
      orderBy: [
        { nombre_departamento: 'asc' },
        { nombre_municipio: 'asc' }
      ]
    })
  },

  async findById(id: string) {
    return prisma.municipios.findUnique({
      where: { id },
      include: {
        serviciosOrigen: {
          select: {
            id: true,
            estado: true,
            fecha_solicitud: true
          },
          take: 10,
          orderBy: {
            created_at: 'desc'
          }
        },
        serviciosDestino: {
          select: {
            id: true,
            estado: true,
            fecha_solicitud: true
          },
          take: 10,
          orderBy: {
            created_at: 'desc'
          }
        }
      }
    })
  },

  async update(id: string, data: UpdateMunicipioInput) {
    return prisma.municipios.update({
      where: { id },
      data
    })
  },

  async delete(id: string) {
    return prisma.municipios.delete({
      where: { id }
    })
  },

  async buscar(params: BuscarMunicipiosInput) {
    const {
      nombre,
      departamento,
      tipo,
      codigo_departamento,
      page = 1,
      limit = 20
    } = params

    const where: any = {}

    if (nombre) {
      where.nombre_municipio = {
        contains: nombre,
        mode: 'insensitive'
      }
    }

    if (departamento) {
      where.nombre_departamento = {
        contains: departamento,
        mode: 'insensitive'
      }
    }

    if (tipo) {
      where.tipo = tipo
    }

    if (codigo_departamento) {
      where.codigo_departamento = codigo_departamento
    }

    const [municipios, total] = await Promise.all([
      prisma.municipios.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [
          { nombre_departamento: 'asc' },
          { nombre_municipio: 'asc' }
        ]
      }),
      prisma.municipios.count({ where })
    ])

    return {
      municipios,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  },

  async findByCodigo(codigo_municipio: number) {
    return prisma.municipios.findUnique({
      where: { codigo_municipio }
    })
  },

  async findByDepartamento(codigo_departamento: number) {
    return prisma.municipios.findMany({
      where: { codigo_departamento },
      orderBy: { nombre_municipio: 'asc' }
    })
  }
}