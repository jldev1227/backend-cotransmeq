// @ts-nocheck
import { randomUUID } from 'crypto';
import { prisma } from '../../config/prisma';
import { CreateTerceroInput, UpdateTerceroInput } from './tercero.schema';

export const TercerosService = {
  async create(data: CreateTerceroInput) {
    if (data.identificacion) {
      const existing = await prisma.terceros.findFirst({
        where: { identificacion: data.identificacion, deleted_at: null },
      });
      if (existing) {
        throw new Error('Ya existe un tercero con esta identificación');
      }
    }

    return prisma.terceros.create({
      data: {
        id: randomUUID(),
        nombre_completo: data.nombre_completo.toUpperCase(),
        identificacion: data.identificacion || null,
        telefono: data.telefono || null,
        correo: data.correo || null,
        direccion: data.direccion || null,
        tipo_persona: (data.tipo_persona as any) || 'PERSONA',
        regimen: (data.regimen as any) || null,
        notas: data.notas || null,
      },
    });
  },

  async list(page: number = 1, limit: number = 20, tipo_persona?: string, search?: string, sortBy?: string, sortOrder?: string) {
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };

    if (tipo_persona && tipo_persona !== 'TODOS') {
      where.tipo_persona = tipo_persona;
    }

    if (search && search.trim() !== '') {
      where.OR = [
        { nombre_completo: { contains: search, mode: 'insensitive' } },
        { identificacion: { contains: search, mode: 'insensitive' } },
        { telefono: { contains: search, mode: 'insensitive' } },
        { correo: { contains: search, mode: 'insensitive' } },
        { direccion: { contains: search, mode: 'insensitive' } },
      ];
    }

    const allowedSortFields = ['nombre_completo', 'identificacion', 'tipo_persona', 'regimen', 'telefono', 'correo'];
    const orderField = (sortBy && allowedSortFields.includes(sortBy)) ? sortBy : 'nombre_completo';
    const orderDir = sortOrder === 'desc' ? 'desc' : 'asc';
    const orderBy: any = { [orderField]: orderDir };

    const baseWhere: any = { deleted_at: null };

    const [terceros, total, totalGeneral, totalPersonas, totalEmpresas] = await Promise.all([
      prisma.terceros.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      prisma.terceros.count({ where }),
      prisma.terceros.count({ where: baseWhere }),
      prisma.terceros.count({ where: { ...baseWhere, tipo_persona: 'PERSONA' } }),
      prisma.terceros.count({ where: { ...baseWhere, tipo_persona: 'EMPRESA' } }),
    ]);

    return {
      data: terceros,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      counts: {
        total: totalGeneral,
        personas: totalPersonas,
        empresas: totalEmpresas,
      },
    };
  },

  async findById(id: string) {
    const tercero = await prisma.terceros.findFirst({
      where: { id, deleted_at: null },
    });
    if (!tercero) throw new Error('Tercero no encontrado');
    return tercero;
  },

  async update(id: string, data: UpdateTerceroInput) {
    await this.findById(id);

    if (data.identificacion) {
      const existing = await prisma.terceros.findFirst({
        where: {
          identificacion: data.identificacion,
          deleted_at: null,
          NOT: { id },
        },
      });
      if (existing) {
        throw new Error('Ya existe un tercero con esta identificación');
      }
    }

    const updateData: any = { ...data };
    if (updateData.nombre_completo) {
      updateData.nombre_completo = updateData.nombre_completo.toUpperCase();
    }

    return prisma.terceros.update({
      where: { id },
      data: updateData,
    });
  },

  async delete(id: string) {
    await this.findById(id);
    return prisma.terceros.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  },

  async buscar(q: string) {
    const where: any = { deleted_at: null };
    if (q && q.trim().length > 0) {
      const term = q.trim();
      where.OR = [
        { nombre_completo: { contains: term, mode: 'insensitive' } },
        { identificacion: { contains: term, mode: 'insensitive' } },
      ];
    }
    return prisma.terceros.findMany({
      where,
      select: {
        id: true,
        nombre_completo: true,
        identificacion: true,
        tipo_persona: true,
      },
      orderBy: { nombre_completo: 'asc' },
      take: 20,
    });
  },

  async importarDesdeVehiculos() {
    const vehiculos = await prisma.vehiculos.findMany({
      where: {
        deleted_at: null,
        propietario_nombre: { not: null },
      },
      select: {
        propietario_nombre: true,
        propietario_identificacion: true,
      },
      distinct: ['propietario_identificacion'],
    });

    let importados = 0;
    let duplicados = 0;

    for (const v of vehiculos) {
      if (!v.propietario_nombre || v.propietario_nombre.trim() === '' || v.propietario_nombre.toUpperCase() === 'NULL') continue;

      const nombre = v.propietario_nombre.trim().toUpperCase();
      const identificacion = (v.propietario_identificacion && v.propietario_identificacion.toUpperCase() !== 'NULL')
        ? v.propietario_identificacion.trim()
        : null;

      const where: any = { deleted_at: null };
      if (identificacion) {
        where.identificacion = identificacion;
      } else {
        where.nombre_completo = nombre;
      }

      const existing = await prisma.terceros.findFirst({ where });
      if (existing) {
        duplicados++;
        continue;
      }

      await prisma.terceros.create({
        data: {
          id: randomUUID(),
          nombre_completo: nombre,
          identificacion,
          tipo_persona: 'PERSONA' as any,
        },
      });
      importados++;
    }

    return { importados, duplicados, total: importados + duplicados };
  },
};
