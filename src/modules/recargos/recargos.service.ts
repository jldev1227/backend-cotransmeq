import { prisma } from '../../config/prisma'
import type { CreateRecargoDTO, UpdateRecargoDTO } from './recargos.schema'
import { randomUUID } from 'crypto'

// Constantes de cálculo
const HORAS_LIMITE = {
  JORNADA_NORMAL: 10,
  INICIO_NOCTURNO: 19,
  FIN_NOCTURNO: 6
}

const PORCENTAJES_RECARGO = {
  HE_DIURNA: 25,
  HE_NOCTURNA: 75,
  HE_FESTIVA_DIURNA: 100,
  HE_FESTIVA_NOCTURNA: 150,
  RECARGO_NOCTURNO: 35,
  RECARGO_DOMINICAL: 75
}

interface RecargosCalculados {
  hed: number
  hen: number
  hefd: number
  hefn: number
  rn: number
  rd: number
}

// Función para calcular recargos de un día
function calcularRecargosDia(
  hora_inicio: number,
  hora_fin: number,
  total_horas: number,
  es_domingo_o_festivo: boolean
): RecargosCalculados {
  console.log(`📊 [CALC] Entrada: inicio=${hora_inicio}, fin=${hora_fin}, total=${total_horas}, domingo/festivo=${es_domingo_o_festivo}`)
  
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rn = 0, rd = 0

  // Calcular recargo nocturno (19:00-06:00) - SOLO EN LAS PRIMERAS 10 HORAS
  // El recargo nocturno NO se cuenta en horas extras (HEN/HEFN ya incluyen el recargo nocturno)
  let horaActual = hora_inicio
  while (horaActual < Math.min(hora_inicio + total_horas, hora_inicio + HORAS_LIMITE.JORNADA_NORMAL)) {
    const horaDelDia = horaActual % 24
    const siguienteHora = Math.min(horaActual + 0.5, hora_inicio + total_horas, hora_inicio + HORAS_LIMITE.JORNADA_NORMAL)
    
    // Verificar si está en período nocturno (19:00-23:59 o 00:00-06:00)
    if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
      rn += siguienteHora - horaActual
    }
    
    horaActual = siguienteHora
  }

  if (es_domingo_o_festivo) {
    // Recargo dominical/festivo: máximo 10 horas
    rd = Math.min(total_horas, HORAS_LIMITE.JORNADA_NORMAL)

    // Horas extras festivas (solo si trabaja más de 10 horas)
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL
      
      // Calcular cuántas horas extras son nocturnas
      const horaInicioExtras = hora_inicio + HORAS_LIMITE.JORNADA_NORMAL
      let horasExtrasNocturnas = 0
      
      let horaActualExtra = horaInicioExtras
      while (horaActualExtra < hora_inicio + total_horas) {
        const horaDelDia = horaActualExtra % 24
        const siguienteHora = Math.min(horaActualExtra + 0.5, hora_inicio + total_horas)
        
        if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra
        }
        
        horaActualExtra = siguienteHora
      }
      
      hefn = Math.min(horasExtrasNocturnas, horas_extras)
      hefd = horas_extras - hefn
    }
  } else {
    // Día normal (no domingo ni festivo)
    // Horas extras solo si trabaja más de 10 horas
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL
      
      // Calcular cuántas horas extras son nocturnas
      const horaInicioExtras = hora_inicio + HORAS_LIMITE.JORNADA_NORMAL
      let horasExtrasNocturnas = 0
      
      let horaActualExtra = horaInicioExtras
      while (horaActualExtra < hora_inicio + total_horas) {
        const horaDelDia = horaActualExtra % 24
        const siguienteHora = Math.min(horaActualExtra + 0.5, hora_inicio + total_horas)
        
        if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra
        }
        
        horaActualExtra = siguienteHora
      }
      
      hen = Math.min(horasExtrasNocturnas, horas_extras)
      hed = horas_extras - hen
    }
  }

  const resultado = { 
    hed: Math.round(hed * 10) / 10, 
    hen: Math.round(hen * 10) / 10, 
    hefd: Math.round(hefd * 10) / 10, 
    hefn: Math.round(hefn * 10) / 10, 
    rn: Math.round(rn * 10) / 10, 
    rd: Math.round(rd * 10) / 10 
  }
  
  console.log(`📊 [CALC] Resultado:`, resultado)
  
  return resultado
}

export const RecargosService = {
  // Listar recargos con filtros (para canvas)
  async list(page: number, limit: number, filters: any) {
    const skip = (page - 1) * limit
    
    const where: any = {
      deleted_at: null
    }

    if (filters.mes) where.mes = parseInt(filters.mes)
    if (filters.año) where.a_o = parseInt(filters.año)
    if (filters.conductor_id) where.conductor_id = filters.conductor_id
    if (filters.vehiculo_id) where.vehiculo_id = filters.vehiculo_id
    if (filters.empresa_id) where.empresa_id = filters.empresa_id
    if (filters.estado) where.estado = filters.estado
    if (filters.numero_planilla) {
      where.numero_planilla = { contains: filters.numero_planilla, mode: 'insensitive' }
    }

    const [recargos, total] = await Promise.all([
      prisma.recargos_planillas.findMany({
        where,
        skip,
        take: limit,
        include: {
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true,
              foto_url: true
            }
          },
          vehiculos: {
            select: {
              id: true,
              placa: true,
              marca: true,
              modelo: true
            }
          },
          clientes: {
            select: {
              id: true,
              nombre: true
            }
          },
          dias_laborales_planillas: {
            where: { deleted_at: null },
            select: {
              id: true,
              dia: true,
              hora_inicio: true,
              hora_fin: true,
              total_horas: true,
              es_festivo: true,
              es_domingo: true,
              pernocte: true,
              disponibilidad: true,
              kilometraje_inicial: true,
              kilometraje_final: true,
              detalles_recargos_dias: {
                where: { deleted_at: null, activo: true },
                include: {
                  tipos_recargos: {
                    select: {
                      id: true,
                      codigo: true,
                      nombre: true,
                      porcentaje: true
                    }
                  }
                }
              }
            },
            orderBy: { dia: 'asc' }
          }
        },
        orderBy: [
          { created_at: 'desc' }
        ]
      }),
      prisma.recargos_planillas.count({ where })
    ])

    // Calcular totales por cada recargo
    const recargosConTotales = recargos.map(recargo => {
      const totales = {
        total_hed: 0,
        total_hen: 0,
        total_hefd: 0,
        total_hefn: 0,
        total_rn: 0,
        total_rd: 0,
        total_horas: 0,
        total_dias: 0
      }

      console.log(`📊 [DEBUG] Calculando totales para recargo ID: ${recargo.id}`)
      console.log(`📊 [DEBUG] Días laborales: ${recargo.dias_laborales_planillas.length}`)
      
      if (recargo.dias_laborales_planillas.length === 0) {
        console.log(`⚠️ [DEBUG] Este recargo NO tiene días laborales!`)
      }

      recargo.dias_laborales_planillas.forEach(dia => {
        // Excluir días marcados como disponible de los totales
        if (dia.disponibilidad) return

        const horasDia = Number(dia.total_horas) || 0
        totales.total_horas += horasDia
        totales.total_dias += 1

        console.log(`📊 [DEBUG] Día ${dia.dia}: total_horas=${dia.total_horas}, parsed=${horasDia}`)
        console.log(`📊 [DEBUG] Detalles recargos: ${dia.detalles_recargos_dias.length}`)

        dia.detalles_recargos_dias.forEach(detalle => {
          const codigo = detalle.tipos_recargos.codigo.toLowerCase()
          const horas = Number(detalle.horas) || 0

          console.log(`📊 [DEBUG] Detalle: tipo=${codigo}, horas=${detalle.horas}, parsed=${horas}`)

          switch(codigo) {
            case 'hed': totales.total_hed += horas; break
            case 'hen': totales.total_hen += horas; break
            case 'hefd': totales.total_hefd += horas; break
            case 'hefn': totales.total_hefn += horas; break
            case 'rn': totales.total_rn += horas; break
            case 'rd': totales.total_rd += horas; break
          }
        })
      })

      console.log(`📊 [DEBUG] Totales calculados:`, totales)

      // Mapear nombres de relaciones para que coincidan con el frontend
      return {
        ...recargo,
        ...totales,
        conductor: recargo.conductores,
        vehiculo: recargo.vehiculos,
        empresa: recargo.clientes,
        dias_laborales: recargo.dias_laborales_planillas
      }
    })

    return {
      recargos: recargosConTotales,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  },

  // Obtener un recargo por ID
  async findById(id: string) {
    const recargo = await prisma.recargos_planillas.findUnique({
      where: { id },
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
        dias_laborales_planillas: {
          where: { deleted_at: null },
          include: {
            detalles_recargos_dias: {
              where: { deleted_at: null, activo: true },
              include: {
                tipos_recargos: true
              }
            }
          },
          orderBy: { dia: 'asc' }
        },
        users_recargos_planillas_creado_por_idTousers: {
          select: {
            id: true,
            nombre: true
          }
        },
        users_recargos_planillas_actualizado_por_idTousers: {
          select: {
            id: true,
            nombre: true
          }
        }
      }
    })

    if (!recargo) {
      throw new Error('Recargo no encontrado')
    }

    return recargo
  },

  // Crear recargo con días laborales
  async create(data: CreateRecargoDTO, userId?: string) {
    console.log('📊 [CREATE] Datos recibidos:', JSON.stringify(data, null, 2))
    console.log('📊 [CREATE] Días laborales recibidos:', data.dias_laborales?.length)
    
    // Obtener tipos de recargo activos
    const tiposRecargo = await prisma.tipos_recargos.findMany({
      where: { activo: true }
    })

    const tiposMap = new Map(tiposRecargo.map(t => [t.codigo, t.id]))
    console.log('📊 [CREATE] Tipos de recargo disponibles:', Array.from(tiposMap.keys()))

    const now = new Date()

    const recargo = await prisma.recargos_planillas.create({
      data: {
        id: randomUUID(), // Generar UUID para el ID
        conductor_id: data.conductor_id,
        vehiculo_id: data.vehiculo_id,
        empresa_id: data.empresa_id,
        numero_planilla: data.numero_planilla,
        mes: data.mes,
        a_o: data.año,
        observaciones: data.observaciones,
        estado: 'pendiente',
        version: 1,
        creado_por_id: userId,
        created_at: now,
        updated_at: now,
        
        // Nuevos campos de relación y condiciones
        servicio_id: data.servicio_id,
        estado_conductor: data.estado_conductor as any,
        via_trocha: data.via_trocha,
        via_afirmado: data.via_afirmado,
        via_mixto: data.via_mixto,
        via_pavimentada: data.via_pavimentada,
        riesgo_desniveles: data.riesgo_desniveles,
        riesgo_deslizamientos: data.riesgo_deslizamientos,
        riesgo_sin_senalizacion: data.riesgo_sin_senalizacion,
        riesgo_animales: data.riesgo_animales,
        riesgo_peatones: data.riesgo_peatones,
        riesgo_trafico_alto: data.riesgo_trafico_alto,
        fuente_consulta: data.fuente_consulta as any,
        calificacion_servicio: data.calificacion_servicio as any,
        tiempo_disponibilidad_horas: data.tiempo_disponibilidad_horas,
        duracion_trayecto_horas: data.duracion_trayecto_horas,
        numero_dias_servicio: data.numero_dias_servicio,
        
        dias_laborales_planillas: {
          // Cast to any because Prisma generated types for nested creates are strict
          // and may require created_at/updated_at depending on schema defaults.
          // The runtime shape is valid for creation; use `as any` to satisfy TS.
          create: ((data.dias_laborales || []).map(dia => {
            const hora_inicio = dia.hora_inicio || 0
            const hora_fin = dia.hora_fin || 0
            const total_horas = dia.total_horas || 0
            const es_domingo_o_festivo = dia.es_domingo || dia.es_festivo

            // Si el día está marcado como disponible, no calcular recargos
            const recargos = dia.disponibilidad
              ? { hed: 0, hen: 0, hefd: 0, hefn: 0, rn: 0, rd: 0 }
              : calcularRecargosDia(hora_inicio, hora_fin, total_horas, es_domingo_o_festivo)

            console.log(`📊 [CREATE DEBUG] Día ${dia.dia}: hora_inicio=${hora_inicio}, hora_fin=${hora_fin}, total_horas=${total_horas}`)
            console.log(`📊 [CREATE DEBUG] Recargos calculados:`, recargos)

            return {
              id: randomUUID(), // Generar UUID para el día laboral
              dia: dia.dia,
              hora_inicio,
              hora_fin,
              total_horas,
              horas_ordinarias: Math.min(total_horas, HORAS_LIMITE.JORNADA_NORMAL),
              es_festivo: dia.es_festivo,
              es_domingo: dia.es_domingo,
              kilometraje_inicial: dia.kilometraje_inicial,
              kilometraje_final: dia.kilometraje_final,
              pernocte: dia.pernocte || false,
              disponibilidad: dia.disponibilidad,
              observaciones: dia.observaciones,
              creado_por_id: userId,
              created_at: now,
              updated_at: now,
              detalles_recargos_dias: {
                create: [
                  recargos.hed > 0 && tiposMap.has('HED') ? { 
                    id: randomUUID(), // Generar UUID para el detalle
                    tipo_recargo_id: tiposMap.get('HED')!, 
                    horas: recargos.hed,
                    creado_por_id: userId,
                    created_at: now,
                    updated_at: now
                  } : null,
                  recargos.hen > 0 && tiposMap.has('HEN') ? { 
                    id: randomUUID(),
                    tipo_recargo_id: tiposMap.get('HEN')!, 
                    horas: recargos.hen,
                    creado_por_id: userId,
                    created_at: now,
                    updated_at: now
                  } : null,
                  recargos.hefd > 0 && tiposMap.has('HEFD') ? { 
                    id: randomUUID(),
                    tipo_recargo_id: tiposMap.get('HEFD')!, 
                    horas: recargos.hefd,
                    creado_por_id: userId,
                    created_at: now,
                    updated_at: now
                  } : null,
                  recargos.hefn > 0 && tiposMap.has('HEFN') ? { 
                    id: randomUUID(),
                    tipo_recargo_id: tiposMap.get('HEFN')!, 
                    horas: recargos.hefn,
                    creado_por_id: userId,
                    created_at: now,
                    updated_at: now
                  } : null,
                  recargos.rn > 0 && tiposMap.has('RN') ? { 
                    id: randomUUID(),
                    tipo_recargo_id: tiposMap.get('RN')!, 
                    horas: recargos.rn,
                    creado_por_id: userId,
                    created_at: now,
                    updated_at: now
                  } : null,
                  recargos.rd > 0 && tiposMap.has('RD') ? { 
                    id: randomUUID(),
                    tipo_recargo_id: tiposMap.get('RD')!, 
                    horas: recargos.rd,
                    creado_por_id: userId,
                    created_at: now,
                    updated_at: now
                  } : null
                ].filter(Boolean)
              }
            }
          })) as any
        }
  } as any,
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
        dias_laborales_planillas: {
          include: {
            detalles_recargos_dias: {
              include: {
                tipos_recargos: true
              }
            }
          }
        }
      }
    })

    // Actualizar totales del recargo
    await this.actualizarTotales(recargo.id)

    return this.findById(recargo.id)
  },

  // Actualizar recargo
  async update(id: string, data: UpdateRecargoDTO, userId?: string) {
    // Obtener el recargo existente
    const recargoExistente = await prisma.recargos_planillas.findUnique({
      where: { id },
      include: {
        dias_laborales_planillas: {
          include: {
            detalles_recargos_dias: true
          }
        }
      }
    })

    if (!recargoExistente) {
      throw new Error('Recargo no encontrado')
    }

    // Construir objeto de actualización (sin relaciones ni dias_laborales)
    const updateData: any = {
      actualizado_por_id: userId,
      version: { increment: 1 },
      updated_at: new Date()
    }

    // Actualizar campos básicos
    if (data.numero_planilla !== undefined) updateData.numero_planilla = data.numero_planilla
    if (data.observaciones !== undefined) updateData.observaciones = data.observaciones
    if (data.estado !== undefined) updateData.estado = data.estado
    if (data.mes !== undefined) updateData.mes = data.mes
    if (data.año !== undefined) updateData.a_o = data.año
    
    // Actualizar relaciones (conductor, vehículo, empresa)
    if (data.conductor_id !== undefined) updateData.conductor_id = data.conductor_id
    if (data.vehiculo_id !== undefined) updateData.vehiculo_id = data.vehiculo_id
    if (data.empresa_id !== undefined) updateData.empresa_id = data.empresa_id
    
    // Actualizar nuevos campos de condiciones y evaluación
    if (data.servicio_id !== undefined) updateData.servicio_id = data.servicio_id
    if (data.estado_conductor !== undefined) updateData.estado_conductor = data.estado_conductor
    if (data.via_trocha !== undefined) updateData.via_trocha = data.via_trocha
    if (data.via_afirmado !== undefined) updateData.via_afirmado = data.via_afirmado
    if (data.via_mixto !== undefined) updateData.via_mixto = data.via_mixto
    if (data.via_pavimentada !== undefined) updateData.via_pavimentada = data.via_pavimentada
    if (data.riesgo_desniveles !== undefined) updateData.riesgo_desniveles = data.riesgo_desniveles
    if (data.riesgo_deslizamientos !== undefined) updateData.riesgo_deslizamientos = data.riesgo_deslizamientos
    if (data.riesgo_sin_senalizacion !== undefined) updateData.riesgo_sin_senalizacion = data.riesgo_sin_senalizacion
    if (data.riesgo_animales !== undefined) updateData.riesgo_animales = data.riesgo_animales
    if (data.riesgo_peatones !== undefined) updateData.riesgo_peatones = data.riesgo_peatones
    if (data.riesgo_trafico_alto !== undefined) updateData.riesgo_trafico_alto = data.riesgo_trafico_alto
    if (data.fuente_consulta !== undefined) updateData.fuente_consulta = data.fuente_consulta
    if (data.calificacion_servicio !== undefined) updateData.calificacion_servicio = data.calificacion_servicio
    if (data.tiempo_disponibilidad_horas !== undefined) updateData.tiempo_disponibilidad_horas = data.tiempo_disponibilidad_horas
    if (data.duracion_trayecto_horas !== undefined) updateData.duracion_trayecto_horas = data.duracion_trayecto_horas
    if (data.numero_dias_servicio !== undefined) updateData.numero_dias_servicio = data.numero_dias_servicio

    // Actualizar el recargo principal
    await prisma.recargos_planillas.update({
      where: { id },
      data: updateData
    })

    // Si hay días laborales para actualizar
    if (data.dias_laborales && data.dias_laborales.length > 0) {
      // Obtener tipos de recargo activos
      const tiposRecargo = await prisma.tipos_recargos.findMany({
        where: { activo: true }
      })
      const tiposMap = new Map(tiposRecargo.map(t => [t.codigo, t.id]))
      const now = new Date()

      // Eliminar días laborales existentes (cascade eliminará detalles_recargos_dias)
      await prisma.dias_laborales_planillas.deleteMany({
        where: { recargo_planilla_id: id }
      })

      // Crear nuevos días laborales con sus recargos
      for (const dia of data.dias_laborales) {
        const hora_inicio = dia.hora_inicio || 0
        const hora_fin = dia.hora_fin || 0
        const total_horas = dia.total_horas || 0
        const es_domingo_o_festivo = dia.es_domingo || dia.es_festivo

        // Si el día está marcado como disponible, no calcular recargos
        const recargos = dia.disponibilidad
          ? { hed: 0, hen: 0, hefd: 0, hefn: 0, rn: 0, rd: 0 }
          : calcularRecargosDia(hora_inicio, hora_fin, total_horas, es_domingo_o_festivo)

        // Crear día laboral con sus detalles de recargos
        await prisma.dias_laborales_planillas.create({
          data: {
            id: randomUUID(),
            recargo_planilla_id: id,
            dia: dia.dia,
            hora_inicio,
            hora_fin,
            total_horas,
            horas_ordinarias: Math.min(total_horas, HORAS_LIMITE.JORNADA_NORMAL),
            es_festivo: dia.es_festivo,
            es_domingo: dia.es_domingo,
            kilometraje_inicial: dia.kilometraje_inicial,
            kilometraje_final: dia.kilometraje_final,
            pernocte: dia.pernocte || false,
            disponibilidad: dia.disponibilidad || false,
            observaciones: dia.observaciones,
            creado_por_id: userId,
            created_at: now,
            updated_at: now,
            detalles_recargos_dias: {
              create: [
                recargos.hed > 0 && tiposMap.has('HED') ? { 
                  id: randomUUID(),
                  tipo_recargo_id: tiposMap.get('HED')!, 
                  horas: recargos.hed,
                  creado_por_id: userId,
                  created_at: now,
                  updated_at: now
                } : null,
                recargos.hen > 0 && tiposMap.has('HEN') ? { 
                  id: randomUUID(),
                  tipo_recargo_id: tiposMap.get('HEN')!, 
                  horas: recargos.hen,
                  creado_por_id: userId,
                  created_at: now,
                  updated_at: now
                } : null,
                recargos.hefd > 0 && tiposMap.has('HEFD') ? { 
                  id: randomUUID(),
                  tipo_recargo_id: tiposMap.get('HEFD')!, 
                  horas: recargos.hefd,
                  creado_por_id: userId,
                  created_at: now,
                  updated_at: now
                } : null,
                recargos.hefn > 0 && tiposMap.has('HEFN') ? { 
                  id: randomUUID(),
                  tipo_recargo_id: tiposMap.get('HEFN')!, 
                  horas: recargos.hefn,
                  creado_por_id: userId,
                  created_at: now,
                  updated_at: now
                } : null,
                recargos.rn > 0 && tiposMap.has('RN') ? { 
                  id: randomUUID(),
                  tipo_recargo_id: tiposMap.get('RN')!, 
                  horas: recargos.rn,
                  creado_por_id: userId,
                  created_at: now,
                  updated_at: now
                } : null,
                recargos.rd > 0 && tiposMap.has('RD') ? { 
                  id: randomUUID(),
                  tipo_recargo_id: tiposMap.get('RD')!, 
                  horas: recargos.rd,
                  creado_por_id: userId,
                  created_at: now,
                  updated_at: now
                } : null
              ].filter(Boolean)
            }
          }
        })
      }

      // Actualizar totales del recargo
      await this.actualizarTotales(id)
    }

    // Retornar el recargo actualizado con todas sus relaciones
    return this.findById(id)
  },

  // Liquidar recargo
  async liquidar(id: string, userId?: string) {
    const recargo = await prisma.recargos_planillas.update({
      where: { id },
      data: {
        estado: 'liquidada',
        actualizado_por_id: userId,
        version: { increment: 1 }
      },
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true
      }
    })

    return recargo
  },

  // Duplicar recargo
  async duplicar(id: string, userId?: string) {
    const original = await this.findById(id)

    const nuevoRecargo = await this.create({
      conductor_id: original.conductor_id,
      vehiculo_id: original.vehiculo_id,
      empresa_id: original.empresa_id,
      numero_planilla: original.numero_planilla ? `${original.numero_planilla}-COPIA` : null,
      mes: original.mes,
      año: original.a_o,
      observaciones: original.observaciones,
      dias_laborales: original.dias_laborales_planillas.map(dia => ({
        dia: dia.dia,
        hora_inicio: Number(dia.hora_inicio),
        hora_fin: Number(dia.hora_fin),
        total_horas: Number(dia.total_horas),
        es_festivo: dia.es_festivo,
        es_domingo: dia.es_domingo,
        kilometraje_inicial: dia.kilometraje_inicial ? Number(dia.kilometraje_inicial) : null,
        kilometraje_final: dia.kilometraje_final ? Number(dia.kilometraje_final) : null,
        pernocte: dia.pernocte,
        disponibilidad: dia.disponibilidad,
        observaciones: dia.observaciones
      }))
    }, userId)

    return nuevoRecargo
  },

  // Actualizar totales calculados
  async actualizarTotales(recargoId: string) {
    const recargo = await prisma.recargos_planillas.findUnique({
      where: { id: recargoId },
      include: {
        dias_laborales_planillas: {
          where: { deleted_at: null },
          select: {
            total_horas: true,
            horas_ordinarias: true,
            disponibilidad: true
          }
        }
      }
    })

    if (!recargo) return

    // Excluir días marcados como disponible de los totales
    const diasNoDisponibles = recargo.dias_laborales_planillas.filter(dia => !dia.disponibilidad)
    const total_dias_laborados = diasNoDisponibles.length
    const total_horas_trabajadas = diasNoDisponibles.reduce(
      (sum, dia) => sum + Number(dia.total_horas), 
      0
    )
    const total_horas_ordinarias = diasNoDisponibles.reduce(
      (sum, dia) => sum + Number(dia.horas_ordinarias), 
      0
    )

    await prisma.recargos_planillas.update({
      where: { id: recargoId },
      data: {
        total_dias_laborados,
        total_horas_trabajadas,
        total_horas_ordinarias
      }
    })
  },

  // Obtener tipos de recargo activos
  async getTiposRecargo() {
    return prisma.tipos_recargos.findMany({
      where: { activo: true },
      orderBy: { codigo: 'asc' }
    })
  },

  // Obtener estadísticas
  async getEstadisticas(filters: any) {
    const where: any = { deleted_at: null }
    
    if (filters.mes) where.mes = parseInt(filters.mes)
    if (filters.año) where.a_o = parseInt(filters.año)
    if (filters.empresa_id) where.empresa_id = filters.empresa_id

    const [total, porEstado] = await Promise.all([
      prisma.recargos_planillas.count({ where }),
      prisma.recargos_planillas.groupBy({
        by: ['estado'],
        where,
        _count: true
      })
    ])

    return {
      total,
      por_estado: porEstado.map(e => ({
        estado: e.estado,
        cantidad: e._count
      }))
    }
  },

  // Soft delete de recargo
  async softDelete(id: string, userId?: string) {
    const now = new Date()

    // Verificar que el recargo existe y no está eliminado
    const recargo = await prisma.recargos_planillas.findFirst({
      where: {
        id,
        deleted_at: null
      }
    })

    if (!recargo) {
      throw new Error('Recargo no encontrado o ya está eliminado')
    }

    // Soft delete del recargo (cascade soft delete en días laborales y detalles)
    await prisma.$transaction([
      // Marcar detalles de recargos como eliminados
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: {
            in: (await prisma.dias_laborales_planillas.findMany({
              where: { recargo_planilla_id: id },
              select: { id: true }
            })).map(d => d.id)
          },
          deleted_at: null
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now
        }
      }),

      // Marcar días laborales como eliminados
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: id,
          deleted_at: null
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now
        }
      }),

      // Marcar recargo como eliminado
      prisma.recargos_planillas.update({
        where: { id },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now
        }
      })
    ])

    return { success: true, message: 'Recargo eliminado correctamente' }
  },

  // Soft delete múltiple de recargos
  async softDeleteMany(ids: string[], userId?: string) {
    const now = new Date()

    // Verificar que todos los recargos existen y no están eliminados
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        id: { in: ids },
        deleted_at: null
      },
      select: { id: true }
    })

    if (recargos.length === 0) {
      throw new Error('No se encontraron recargos válidos para eliminar')
    }

    const validIds = recargos.map(r => r.id)

    // Obtener todos los IDs de días laborales
    const diasLaboralesIds = (await prisma.dias_laborales_planillas.findMany({
      where: { recargo_planilla_id: { in: validIds } },
      select: { id: true }
    })).map(d => d.id)

    // Soft delete en cascada
    await prisma.$transaction([
      // Marcar detalles de recargos como eliminados
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: { in: diasLaboralesIds },
          deleted_at: null
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now
        }
      }),

      // Marcar días laborales como eliminados
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: { in: validIds },
          deleted_at: null
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now
        }
      }),

      // Marcar recargos como eliminados
      prisma.recargos_planillas.updateMany({
        where: {
          id: { in: validIds },
          deleted_at: null
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now
        }
      })
    ])

    return {
      success: true,
      message: `${validIds.length} recargo(s) eliminado(s) correctamente`,
      eliminados: validIds.length
    }
  },

  async cambiarEstadoMultiple(ids: string[], estado: string, userId?: string) {
    const now = new Date()

    // Verificar que todos los recargos existen y no están eliminados
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        id: { in: ids },
        deleted_at: null
      },
      select: { id: true, estado: true }
    })

    if (recargos.length === 0) {
      throw new Error('No se encontraron recargos válidos para actualizar')
    }

    const validIds = recargos.map(r => r.id)

    // Actualizar estado de todos los recargos válidos
    await prisma.recargos_planillas.updateMany({
      where: {
        id: { in: validIds },
        deleted_at: null
      },
      data: {
        estado: estado as any,
        actualizado_por_id: userId,
        updated_at: now
      }
    })

    return {
      success: true,
      message: `${validIds.length} recargo(s) actualizado(s) al estado "${estado}"`,
      actualizados: validIds.length,
      estado
    }
  }
}
