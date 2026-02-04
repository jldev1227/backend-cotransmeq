import { prisma } from '../../config/prisma'
import { getS3SignedUrl, uploadToS3, deleteFromS3 } from '../../config/aws'
import { randomUUID } from 'crypto'

export const ConductoresService = {
  // Obtener todos los conductores (sin soft deleted)
  async obtenerTodos(filters?: {
    estado?: string
    sede_trabajo?: string
    search?: string
    page?: number
    limit?: number
  }) {
    const page = filters?.page || 1
    const limit = filters?.limit || 1000  // ← Aumentado de 50 a 1000 para mostrar todos
    const skip = (page - 1) * limit

    const where: any = {
      oculto: false  // ← FILTRAR OCULTOS POR DEFECTO
    }

    // Filtro por estado
    if (filters?.estado) {
      where.estado = filters.estado
    }

    // Filtro por sede
    if (filters?.sede_trabajo) {
      where.sede_trabajo = filters.sede_trabajo
    }

    // Búsqueda por nombre, apellido o número de identificación
    if (filters?.search) {
      where.OR = [
        { nombre: { contains: filters.search, mode: 'insensitive' } },
        { apellido: { contains: filters.search, mode: 'insensitive' } },
        { numero_identificacion: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } }
      ]
    }

    const [conductores, total] = await Promise.all([
      prisma.conductores.findMany({
        where,
        select: {
          id: true,
          nombre: true,
          apellido: true,
          tipo_identificacion: true,
          numero_identificacion: true,
          email: true,
          telefono: true,
          foto_url: true,
          fecha_nacimiento: true,
          genero: true,
          direccion: true,
          cargo: true,
          fecha_ingreso: true,
          salario_base: true,
          estado: true,
          eps: true,
          fondo_pension: true,
          arl: true,
          tipo_contrato: true,
          categoria_licencia: true,
          vencimiento_licencia: true,
          sede_trabajo: true,
          tipo_sangre: true,
          created_at: true,
          updated_at: true
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit
      }),
      prisma.conductores.count({ where })
    ])

    // Generar URLs firmadas de S3 para las fotos desde la tabla documento
    const conductoresConFotos = await Promise.all(
      conductores.map(async (conductor) => {
        let foto_signed_url = null
        
        try {
          // Buscar documento de tipo FOTO_PERFIL para el conductor
          const fotoDocumento = await prisma.documento.findFirst({
            where: {
              conductor_id: conductor.id,
              categoria: 'FOTO_PERFIL',
              estado: 'vigente' // Cambiado de 'ACTIVO' a 'vigente'
            },
            orderBy: {
              created_at: 'desc'
            }
          })

          // Si existe el documento y tiene s3_key, generar URL firmada
          if (fotoDocumento?.s3_key) {
            foto_signed_url = await getS3SignedUrl(fotoDocumento.s3_key)
          } 
          // Fallback al foto_url antiguo si existe
          else if (conductor.foto_url) {
            foto_signed_url = await getS3SignedUrl(conductor.foto_url)
          }
        } catch (error) {
          console.error(`Error generando URL firmada para conductor ${conductor.id}:`, error)
        }

        return { ...conductor, foto_signed_url }
      })
    )

    return {
      conductores: conductoresConFotos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  },

  // Obtener conductor por ID
  async obtenerPorId(id: string) {
    const conductor = await prisma.conductores.findUnique({
      where: { id },
      include: {
        vehiculos: {
          select: {
            id: true,
            placa: true,
            marca: true,
            modelo: true,
            estado: true
          }
        },
        servicio: {
          select: {
            id: true,
            fecha_solicitud: true,
            estado: true,
            valor: true
          },
          orderBy: { fecha_solicitud: 'desc' },
          take: 10
        }
      }
    })

    if (!conductor) {
      throw new Error('Conductor no encontrado')
    }

    // Generar URL firmada para la foto desde la tabla documento
    let foto_signed_url = null
    try {
      // Buscar documento de tipo FOTO_PERFIL para el conductor
      const fotoDocumento = await prisma.documento.findFirst({
        where: {
          conductor_id: conductor.id,
          categoria: 'FOTO_PERFIL',
          estado: 'vigente' // Cambiado de 'ACTIVO' a 'vigente'
        },
        orderBy: {
          created_at: 'desc'
        }
      })

      // Si existe el documento y tiene s3_key, generar URL firmada
      if (fotoDocumento?.s3_key) {
        foto_signed_url = await getS3SignedUrl(fotoDocumento.s3_key)
      } 
      // Fallback al foto_url antiguo si existe
      else if (conductor.foto_url) {
        foto_signed_url = await getS3SignedUrl(conductor.foto_url)
      }
    } catch (error) {
      console.error('Error generando URL firmada:', error)
    }

    return { ...conductor, foto_signed_url }
  },

  // Crear conductor
  async crear(data: any, creado_por_id: string) {
    // Solo validar duplicados si numero_identificacion tiene valor
    if (data.numero_identificacion) {
      const conductorExistente = await prisma.conductores.findUnique({
        where: { numero_identificacion: data.numero_identificacion }
      })

      if (conductorExistente) {
        throw new Error('Ya existe un conductor con ese número de identificación')
      }
    }

    if (data.email) {
      const emailExistente = await prisma.conductores.findUnique({
        where: { email: data.email }
      })

      if (emailExistente) {
        throw new Error('Ya existe un conductor con ese email')
      }
    }

    // Convertir fechas de string a Date
    const fechaIngreso = data.fecha_ingreso ? new Date(data.fecha_ingreso) : new Date()
    const vencimientoLicencia = data.vencimiento_licencia ? new Date(data.vencimiento_licencia) : null
    const fechaNacimiento = data.fecha_nacimiento ? new Date(data.fecha_nacimiento) : null

    const conductor = await prisma.conductores.create({
      data: {
        id: randomUUID(),
        nombre: data.nombre,
        apellido: data.apellido,
        tipo_identificacion: data.tipo_identificacion || 'CC',
        numero_identificacion: data.numero_identificacion,
        email: data.email || null,
        telefono: data.telefono || null,
        direccion: data.direccion || null,
        fecha_nacimiento: fechaNacimiento,
        genero: data.genero || null,
        cargo: data.cargo || 'CONDUCTOR',
        fecha_ingreso: fechaIngreso,
        salario_base: data.salario_base || null,
        estado: data.estado || 'ACTIVO',
        eps: data.eps || null,
        fondo_pension: data.fondo_pension || null,
        arl: data.arl || null,
        tipo_contrato: data.tipo_contrato || null,
        categoria_licencia: data.categoria_licencia || null,
        vencimiento_licencia: vencimientoLicencia,
        sede_trabajo: data.sede_trabajo || null,
        tipo_sangre: data.tipo_sangre || null,
        creado_por_id,
        created_at: new Date(),
        updated_at: new Date()
      }
    })

    return conductor
  },

  // Actualizar conductor
  async actualizar(id: string, data: any, actualizado_por_id?: string) {
    const conductorExistente = await prisma.conductores.findUnique({
      where: { id }
    })

    if (!conductorExistente) {
      throw new Error('Conductor no encontrado')
    }

    // Verificar unicidad de número de identificación
    if (data.numero_identificacion && data.numero_identificacion !== conductorExistente.numero_identificacion) {
      const duplicado = await prisma.conductores.findUnique({
        where: { numero_identificacion: data.numero_identificacion }
      })

      if (duplicado) {
        throw new Error('Ya existe un conductor con ese número de identificación')
      }
    }

    // Verificar unicidad de email
    if (data.email && data.email !== conductorExistente.email) {
      const duplicado = await prisma.conductores.findUnique({
        where: { email: data.email }
      })

      if (duplicado) {
        throw new Error('Ya existe un conductor con ese email')
      }
    }

    const conductor = await prisma.conductores.update({
      where: { id },
      data: {
        ...data,
        actualizado_por_id,
        updated_at: new Date()
      }
    })

    return conductor
  },

  // Actualizar solo el estado
  async actualizarEstado(id: string, estado: any, actualizado_por_id?: string) {
    const conductorExistente = await prisma.conductores.findUnique({
      where: { id }
    })

    if (!conductorExistente) {
      throw new Error('Conductor no encontrado')
    }

    const conductor = await prisma.conductores.update({
      where: { id },
      data: {
        estado: estado as any,
        actualizado_por_id,
        updated_at: new Date()
      }
    })

    return conductor
  },

  // Soft delete (cambiar estado a DESVINCULADO o RETIRADO)
  async eliminar(id: string, actualizado_por_id?: string) {
    const conductorExistente = await prisma.conductores.findUnique({
      where: { id }
    })

    if (!conductorExistente) {
      throw new Error('Conductor no encontrado')
    }

    // Cambiar estado a RETIRADO en lugar de eliminar
    const conductor = await prisma.conductores.update({
      where: { id },
      data: {
        estado: 'RETIRADO',
        actualizado_por_id,
        updated_at: new Date()
      }
    })

    return conductor
  },

  // Subir foto del conductor
  async subirFoto(id: string, file: any) {
    const conductor = await prisma.conductores.findUnique({
      where: { id }
    })

    if (!conductor) {
      throw new Error('Conductor no encontrado')
    }

    // Eliminar foto anterior si existe
    if (conductor.foto_url) {
      try {
        await deleteFromS3(conductor.foto_url)
      } catch (error) {
        console.error('Error eliminando foto anterior:', error)
      }
    }

    // Generar clave única para S3
    const s3Key = `conductores/${id}/${Date.now()}-${file.originalname}`

    // Subir archivo a S3
    await uploadToS3(s3Key, file.buffer, file.mimetype)

    // Actualizar URL en base de datos
    const conductorActualizado = await prisma.conductores.update({
      where: { id },
      data: {
        foto_url: s3Key,
        updated_at: new Date()
      }
    })

    // Obtener URL firmada
    const fotoUrlFirmada = await getS3SignedUrl(s3Key)

    return {
      ...conductorActualizado,
      foto_url_firmada: fotoUrlFirmada
    }
  },

  // Eliminar foto del conductor
  async eliminarFoto(id: string) {
    const conductor = await prisma.conductores.findUnique({
      where: { id }
    })

    if (!conductor) {
      throw new Error('Conductor no encontrado')
    }

    if (conductor.foto_url) {
      // Eliminar de S3
      try {
        await deleteFromS3(conductor.foto_url)
      } catch (error) {
        console.error('Error eliminando foto de S3:', error)
      }

      // Actualizar base de datos
      await prisma.conductores.update({
        where: { id },
        data: {
          foto_url: null,
          updated_at: new Date()
        }
      })
    }

    return { message: 'Foto eliminada exitosamente' }
  },

  // Obtener conductores ocultos (solo admin)
  async obtenerOcultos(filters?: {
    search?: string
    page?: number
    limit?: number
  }) {
    const page = filters?.page || 1
    const limit = filters?.limit || 1000  // ← Aumentado de 50 a 1000
    const skip = (page - 1) * limit

    const where: any = {
      oculto: true  // Solo los ocultos
    }

    // Búsqueda
    if (filters?.search) {
      where.OR = [
        { nombre: { contains: filters.search, mode: 'insensitive' } },
        { apellido: { contains: filters.search, mode: 'insensitive' } },
        { numero_identificacion: { contains: filters.search, mode: 'insensitive' } }
      ]
    }

    const [conductores, total] = await Promise.all([
      prisma.conductores.findMany({
        where,
        select: {
          id: true,
          nombre: true,
          apellido: true,
          numero_identificacion: true,
          email: true,
          telefono: true,
          estado: true,
          sede_trabajo: true,
          cargo: true,
          oculto: true,
          created_at: true,
          updated_at: true
        },
        orderBy: { nombre: 'asc' },
        skip,
        take: limit
      }),
      prisma.conductores.count({ where })
    ])

    return {
      data: conductores,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  },

  // Cambiar estado oculto (solo admin)
  async cambiarEstadoOculto(id: string, oculto: boolean) {
    return prisma.conductores.update({
      where: { id },
      data: {
        oculto,
        updated_at: new Date()
      },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        oculto: true
      }
    })
  }
}
