import { prisma } from '../../config/prisma'

export interface SeguimientoRegistroInput {
  fecha_seguimiento: Date | string
  descripcion_observaciones?: string
  estado_accion: string
  adjunto_url?: string
  replanteo?: any
  responsable_seguimiento?: string
  cargo_responsable_seguimiento?: string
}

export interface CausaAccionInput {
  orden: number
  analisis_causa: string
  es_causa_raiz?: boolean
  descripcion_plan_accion?: string
  fecha_limite_implementacion?: Date | string
  responsable_ejecucion?: string
  fecha_seguimiento?: Date | string
  estado_seguimiento?: 'En Proceso' | 'Cumplida' | 'Vencida' | 'Replanteada' | 'Cerrada'
  descripcion_observaciones?: string
  seguimientos?: SeguimientoRegistroInput[]
  // Campos de evaluación de eficacia y cierre individual
  fecha_evaluacion_eficacia?: Date | string
  criterio_evaluacion_eficacia?: string
  analisis_evidencias_cierre?: string
  evaluacion_cierre_eficaz?: 'EFICAZ' | 'NO EFICAZ'
  soporte_cierre_eficaz?: string
  fecha_cierre?: Date | string
  responsable_cierre?: string
}

export interface CreateSeguimientoCausaInput {
  fecha_seguimiento: Date | string
  estado_accion: 'Cumplidas' | 'En Proceso' | 'Vencidas' | 'Replanteada'
  descripcion_observaciones?: string
  evaluacion_eficaz?: 'EFICAZ' | 'NO EFICAZ'
  responsable_seguimiento?: string
  cargo_responsable_seguimiento?: string
  replanteo?: any
}

export interface CicloEficaciaInput {
  numero_ciclo: number
  fecha_seguimiento: Date | string
  descripcion?: string
  resultado_ciclo?: 'AVANCE_SATISFACTORIO' | 'SIN_AVANCES' | 'IMPEDIMENTO_IDENTIFICADO'
  impedimento?: string
  nueva_fecha?: Date | string
  responsable?: string
  cargo?: string
  criterios_cumplidos?: string[]
  adjunto_url?: string
}

export interface EvidenciaEficaciaInput {
  orden: number
  tipo_evidencia?: string
  descripcion?: string
  fecha?: Date | string
  estado_ubicacion?: 'DISPONIBLE' | 'PENDIENTE'
  adjunto_url?: string
}

export interface CreateAccionCorrectivaInput {
  accion_numero: string
  lugar_sede?: string
  proceso_origen_hallazgo?: string
  componente_elemento_referencia?: string
  fuente_genero_hallazgo?: string
  fuente_genero_hallazgo_otros?: string
  marco_legal_normativo?: string
  fecha_identificacion_hallazgo?: Date | string
  descripcion_hallazgo?: string
  tipo_hallazgo_detectado?: string
  tipo_hallazgo_otros?: string
  variable_categoria_analisis?: string
  aplica_correccion_inmediata?: boolean
  justificacion_no_correccion?: string
  responsable_correccion?: string
  correccion_solucion_inmediata?: string
  fecha_implementacion?: Date | string
  valoracion_riesgo?: 'ALTO' | 'MEDIO' | 'BAJO'
  requiere_actualizar_matriz?: boolean
  matriz_a_actualizar?: string
  tipo_accion_ejecutar?: 'CORRECTIVA' | 'PREVENTIVA' | 'MEJORA'
  causas?: CausaAccionInput[]
  seguimientos_correccion?: SeguimientoRegistroInput[]
  fecha_limite_evaluacion_eficacia?: Date | string
  ciclos_eficacia?: CicloEficaciaInput[]
  evaluaciones_eficacia?: any[]
  evidencias_eficacia?: EvidenciaEficaciaInput[]
  fecha_evaluacion_eficacia?: Date | string
  criterio_evaluacion_eficacia?: string
  analisis_evidencias_cierre?: string
  evaluacion_cierre_eficaz?: 'EFICAZ' | 'NO EFICAZ' | 'PARCIAL'
  soporte_cierre_eficaz?: string
  fecha_cierre_definitivo?: Date | string
  responsable_cierre?: string
  cargo_responsable_cierre?: string
  observaciones_cierre?: string
  aplica_reapertura?: boolean
  fecha_reapertura?: Date | string
  razon_reapertura?: string
  accion_origen_reapertura?: string
  creado_por_id?: string
  created_at?: Date | string
}

const includeAccionCompleta = {
  causas: {
    orderBy: { orden: 'asc' as const },
    include: {
      seguimientos: {
        orderBy: [{ fecha_seguimiento: 'desc' as const }, { created_at: 'desc' as const }]
      }
    }
  },
  seguimientos_correccion: {
    orderBy: { fecha_seguimiento: 'asc' as const }
  },
  ciclos_eficacia: {
    orderBy: { numero_ciclo: 'asc' as const }
  },
  evidencias_eficacia: {
    orderBy: { orden: 'asc' as const }
  },
  aprobaciones: {
    orderBy: { orden: 'asc' as const },
    include: {
      aprobador: {
        select: { id: true, nombre: true, correo: true, cargo: true }
      }
    }
  },
  usuarios: {
    select: { id: true, nombre: true, correo: true }
  },
  registrado_por: {
    select: { id: true, nombre: true, correo: true, cargo: true }
  }
}

export interface UpdateAccionCorrectivaInput extends Partial<CreateAccionCorrectivaInput> {}

export interface FiltrosAccionesCorrectivas {
  tipo_accion_ejecutar?: string
  estado_seguimiento?: string
  estado_global?: string
  valoracion_riesgo?: string
  fecha_desde?: Date | string
  fecha_hasta?: Date | string
  busqueda?: string
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  ultimos_90_dias?: boolean
  incluir_eliminados?: boolean
}

const approvalFlow: Record<string, string[]> = {
  NC_MAYOR: ['Gerencia'],
  NC_MENOR: ['CoordinadorHSEQ'],
  OBSERVACION: ['CoordinadorHSEQ'],
  MEJORA: ['CoordinadorHSEQ'],
}

// Normaliza el label legible al enum HallazgoTipo.
// Acepta: 'NC Mayor', 'No conformidad mayor', 'NC. MAYOR', 'NC_MAYOR', 'Observación', etc.
const LABEL_TO_ENUM: Record<string, 'NC_MAYOR' | 'NC_MENOR' | 'OBSERVACION' | 'MEJORA'> = {
  'NC Mayor': 'NC_MAYOR',
  'No conformidad mayor': 'NC_MAYOR',
  'NC. MAYOR': 'NC_MAYOR',
  'NC.MAYOR': 'NC_MAYOR',
  'NC MAYOR': 'NC_MAYOR',
  'NC_MAYOR': 'NC_MAYOR',
  'NC Menor': 'NC_MENOR',
  'No conformidad menor': 'NC_MENOR',
  'NC. MENOR': 'NC_MENOR',
  'NC.MENOR': 'NC_MENOR',
  'NC MENOR': 'NC_MENOR',
  'NC_MENOR': 'NC_MENOR',
  'Observación': 'OBSERVACION',
  'Observacion': 'OBSERVACION',
  'OBSERVACIÓN': 'OBSERVACION',
  'OBSERVACION': 'OBSERVACION',
  'Oportunidad de Mejora': 'MEJORA',
  'Oportunidad de mejora': 'MEJORA',
  'Posibilidad de Mejora': 'MEJORA',
  'POSIBILIDAD DE MEJORA': 'MEJORA',
  'MEJORA': 'MEJORA'
}

function normalizarHallazgo(valor: string | null | undefined): 'NC_MAYOR' | 'NC_MENOR' | 'OBSERVACION' | 'MEJORA' | null {
  if (!valor) return null
  const key = valor.trim()
  if (LABEL_TO_ENUM[key]) return LABEL_TO_ENUM[key]
  // Búsqueda normalizada (case-insensitive, sin acentos, sin puntos/espacios extras)
  const norm = key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  for (const [k, v] of Object.entries(LABEL_TO_ENUM)) {
    const kn = k
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    if (kn === norm) return v
  }
  return null
}

export class AccionesCorrectivasService {
  // Crear nueva acción correctiva/preventiva
  async crear(data: CreateAccionCorrectivaInput) {
    console.log("Creando accion con data:", JSON.stringify(data, null, 2));
    // Validar que no exista el número de acción
    const existente = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { accion_numero: data.accion_numero }
    })

    if (existente) {
      throw new Error(`Ya existe una acción con el número ${data.accion_numero}`)
    }

    const {
      causas,
      seguimientos_correccion,
      ciclos_eficacia,
      evidencias_eficacia,
      ...datosAccion
    } = data

    const fechasConvertidas = this.convertirFechas(datosAccion)

    return await prisma.acciones_correctivas_preventivas.create({
      data: {
        ...fechasConvertidas,
        created_at: datosAccion.created_at ? new Date(datosAccion.created_at) : new Date(),
        causas: causas?.length
          ? { create: causas.map((c) => this.buildCausaCreate(c)) }
          : undefined,
        seguimientos_correccion: seguimientos_correccion?.length
          ? { create: seguimientos_correccion.filter(s => s.fecha_seguimiento).map((s) => this.buildSeguimientoCreate(s)) }
          : undefined,
        ciclos_eficacia: ciclos_eficacia?.length
          ? { create: ciclos_eficacia.filter(c => c.fecha_seguimiento).map((c) => this.buildCicloCreate(c)) }
          : undefined,
        evidencias_eficacia: evidencias_eficacia?.length
          ? { create: evidencias_eficacia.map((e) => this.buildEvidenciaCreate(e)) }
          : undefined,
        updated_at: new Date()
      },
      include: includeAccionCompleta
    })
  }

  // Listar acciones con filtros y paginación
  async listar(filtros: FiltrosAccionesCorrectivas = {}) {
    const {
      ultimos_90_dias,
      tipo_accion_ejecutar,
      estado_seguimiento,
      estado_global,
      valoracion_riesgo,
      fecha_desde,
      fecha_hasta,
      busqueda,
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'desc',
      incluir_eliminados
    } = filtros

    const where: any = {}

    // Filtro por defecto: excluir eliminados
    if (incluir_eliminados) {
      where.deleted_at = { not: null }
    } else {
      where.deleted_at = null
    }

    // Filtros específicos
    if (ultimos_90_dias) {
      const fecha90 = new Date()
      fecha90.setDate(fecha90.getDate() - 90)
      where.created_at = { gte: fecha90 }
    }

    if (tipo_accion_ejecutar) {
      where.tipo_accion_ejecutar = tipo_accion_ejecutar
    }

    if (estado_global) {
      where.estado_global = estado_global
    }

    if (estado_seguimiento) {
      where.causas = {
        some: {
          estado_seguimiento
        }
      }
    }

    if (valoracion_riesgo) {
      where.valoracion_riesgo = valoracion_riesgo
    }

    // Filtro de rango de fechas
    if (fecha_desde || fecha_hasta) {
      where.fecha_identificacion_hallazgo = {}
      if (fecha_desde) {
        where.fecha_identificacion_hallazgo.gte = new Date(fecha_desde)
      }
      if (fecha_hasta) {
        where.fecha_identificacion_hallazgo.lte = new Date(fecha_hasta)
      }
    }

    // Búsqueda general
    if (busqueda) {
      where.OR = [
        { accion_numero: { contains: busqueda, mode: 'insensitive' } },
        { descripcion_hallazgo: { contains: busqueda, mode: 'insensitive' } },
        { lugar_sede: { contains: busqueda, mode: 'insensitive' } },
        { responsable_ejecucion: { contains: busqueda, mode: 'insensitive' } },
        {
          causas: {
            some: {
              responsable_ejecucion: { contains: busqueda, mode: 'insensitive' }
            }
          }
        }
      ]
    }

    // Paginación
    const skip = (page - 1) * limit

    // Construir orderBy dinámico
    const allowedSortFields = [
      'accion_numero',
      'descripcion_hallazgo',
      'tipo_accion_ejecutar',
      'estado_accion',
      'estado_global',
      'valoracion_riesgo',
      'responsable_ejecucion',
      'fecha_limite_cierre_accion',
      'fecha_identificacion_hallazgo',
      'created_at'
    ]
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at'
    const safeSortOrder = sortOrder === 'asc' ? 'asc' : 'desc'

    const [acciones, total] = await Promise.all([
      prisma.acciones_correctivas_preventivas.findMany({
        where,
        include: {
          causas: {
            orderBy: { orden: 'asc' },
            select: {
              id: true,
              orden: true,
              analisis_causa: true,
              estado_seguimiento: true,
              fecha_limite_implementacion: true,
              responsable_ejecucion: true,
              evaluacion_cierre_eficaz: true,
              fecha_cierre: true
            }
          },
          seguimientos_correccion: {
            orderBy: { fecha_seguimiento: 'desc' },
            take: 3,
            select: {
              fecha_seguimiento: true,
              estado_accion: true,
              descripcion_observaciones: true
            }
          },
          usuarios: {
            select: {
              id: true,
              nombre: true,
              correo: true
            }
          },
          registrado_por: {
            select: { id: true, nombre: true, correo: true, cargo: true }
          }
        },
        orderBy: {
          [safeSortBy]: safeSortOrder
        },
        skip,
        take: limit
      }),
      prisma.acciones_correctivas_preventivas.count({ where })
    ])

    return {
      acciones,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  }

  // Duplicar una acción existente
  async duplicar(id: string, creado_por_id: string) {
    const original = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id },
      include: includeAccionCompleta
    })

    if (!original) {
      throw new Error('Acción no encontrada')
    }
    
    // Generar nuevo número concatenando la original con la fecha de hoy (yyyy-mm-dd)
    // No se relaciona con la original, es una copia independiente
    const hoy = new Date();
    const fechaFormato = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const sufijo = original.deleted_at ? '_Eliminado' : '';
    const nuevoNumero = `${original.accion_numero}-${fechaFormato}${sufijo}`;

    const {
      id: _,
      accion_numero: __,
      created_at: ___,
      updated_at: ____,
      creado_por_id: _____,
      causas,
      seguimientos_correccion,
      ciclos_eficacia,
      evidencias_eficacia,
      usuarios,
      aprobaciones,
      registrado_por,
      ...datosBase
    } = original as any

    return await prisma.acciones_correctivas_preventivas.create({
      data: {
        ...datosBase,
        accion_numero: nuevoNumero,
        creado_por_id,
        created_at: new Date(),
        updated_at: new Date(),
        causas: {
          create: causas.map((c: any) => ({
            orden: c.orden,
            analisis_causa: c.analisis_causa,
            es_causa_raiz: c.es_causa_raiz,
            descripcion_plan_accion: c.descripcion_plan_accion,
            fecha_limite_implementacion: c.fecha_limite_implementacion,
            responsable_ejecucion: c.responsable_ejecucion,
            estado_seguimiento: c.estado_seguimiento,
            seguimientos: {
              create: c.seguimientos.map((s: any) => ({
                fecha_seguimiento: s.fecha_seguimiento,
                estado_accion: s.estado_accion,
                descripcion_observaciones: s.descripcion_observaciones,
                adjunto_url: s.adjunto_url
              }))
            }
          }))
        },
        seguimientos_correccion: {
          create: seguimientos_correccion.map((s: any) => ({
            fecha_seguimiento: s.fecha_seguimiento,
            descripcion_observaciones: s.descripcion_observaciones,
            estado_accion: s.estado_accion,
            adjunto_url: s.adjunto_url
          }))
        },
        ciclos_eficacia: {
          create: ciclos_eficacia.map((c: any) => ({
            numero_ciclo: c.numero_ciclo,
            fecha_seguimiento: c.fecha_seguimiento,
            descripcion: c.descripcion,
            resultado_ciclo: c.resultado_ciclo,
            responsable: c.responsable,
            cargo: c.cargo,
            criterios_cumplidos: c.criterios_cumplidos,
            adjunto_url: c.adjunto_url
          }))
        },
        evidencias_eficacia: {
          create: evidencias_eficacia.map((e: any) => ({
            orden: e.orden,
            tipo_evidencia: e.tipo_evidencia,
            descripcion: e.descripcion,
            fecha: e.fecha,
            estado_ubicacion: e.estado_ubicacion,
            adjunto_url: e.adjunto_url
          }))
        }
      },
      include: includeAccionCompleta
    })
  }

  // Obtener acción por ID
  async obtenerPorId(id: string) {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id },
      include: includeAccionCompleta
    })

    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    if (accion.deleted_at) {
      throw new Error('Acción eliminada. Restaúrela desde la papelera.')
    }

    return accion
  }

  // Obtener acción por número
  async obtenerPorNumero(accion_numero: string) {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { accion_numero },
      include: includeAccionCompleta
    })

    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    return accion
  }

  // Actualizar acción
  async actualizar(id: string, data: UpdateAccionCorrectivaInput) {
    // Verificar que existe
    await this.obtenerPorId(id)

    // Si se intenta cambiar el número, validar que no exista
    if (data.accion_numero) {
      const existente = await prisma.acciones_correctivas_preventivas.findFirst({
        where: {
          accion_numero: data.accion_numero,
          id: { not: id }
        }
      })

      if (existente) {
        throw new Error(`Ya existe una acción con el número ${data.accion_numero}`)
      }
    }

    const {
      causas,
      seguimientos_correccion,
      ciclos_eficacia,
      evidencias_eficacia,
      ...datosAccion
    } = data

    const fechasConvertidas = this.convertirFechas(datosAccion)

    const nestedUpdate: Record<string, unknown> = {}

    if (causas !== undefined) {
      nestedUpdate.causas = {
        deleteMany: {},
        create: causas.map((c) => this.buildCausaCreate(c))
      }
    }
    if (seguimientos_correccion !== undefined) {
      nestedUpdate.seguimientos_correccion = {
        deleteMany: {},
        create: seguimientos_correccion.filter(s => s.fecha_seguimiento).map((s) => this.buildSeguimientoCreate(s))
      }
    }
    if (ciclos_eficacia !== undefined) {
      nestedUpdate.ciclos_eficacia = {
        deleteMany: {},
        create: ciclos_eficacia.filter(c => c.fecha_seguimiento).map((c) => this.buildCicloCreate(c))
      }
    }
    if (evidencias_eficacia !== undefined) {
      nestedUpdate.evidencias_eficacia = {
        deleteMany: {},
        create: evidencias_eficacia.map((e) => this.buildEvidenciaCreate(e))
      }
    }

    return await prisma.acciones_correctivas_preventivas.update({
      where: { id },
      data: {
        ...fechasConvertidas,
        created_at: datosAccion.created_at ? new Date(datosAccion.created_at) : undefined,
        ...nestedUpdate,
        updated_at: new Date()
      },
      include: includeAccionCompleta
    })
  }

  // Eliminar acción
  async eliminar(id: string) {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id },
      include: includeAccionCompleta
    })

    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    if (accion.deleted_at) {
      throw new Error('La acción ya está eliminada')
    }

    return await prisma.acciones_correctivas_preventivas.update({
      where: { id },
      data: { deleted_at: new Date() },
      include: includeAccionCompleta
    })
  }

  async restaurar(id: string) {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id },
      include: includeAccionCompleta
    })

    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    if (!accion.deleted_at) {
      throw new Error('La acción no está eliminada')
    }

    // Restaurar consecutivo original (quitar _Eliminado si existe)
    const accionNumero = accion.accion_numero.replace(/_Eliminado$/, '')

    return await prisma.acciones_correctivas_preventivas.update({
      where: { id },
      data: { deleted_at: null, accion_numero: accionNumero },
      include: includeAccionCompleta
    })
  }

  async eliminarPermanente(id: string) {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id }
    })

    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    if (!accion.deleted_at) {
      throw new Error('Solo se pueden eliminar permanentemente acciones ya eliminadas')
    }

    return await prisma.acciones_correctivas_preventivas.delete({
      where: { id }
    })
  }

  // ============================================
  // STEP 4 - APROBACIÓN DEL PLAN DE ACCIÓN
  // ============================================
  //
  // Modelo: una sola aprobación por acción.
  //   - NO existe "inicialización": no se crea registro previo.
  //   - El registro se inserta/actualiza SOLO cuando un usuario
  //     con el cargo correcto ejecuta APROBAR o RECHAZAR.
  //   - El rol esperado se determina por el tipo de hallazgo.
  //

  // Normaliza un cargo para comparación robusta
  private normalizarCargo(cargo: string | null | undefined): string {
    if (!cargo) return ''
    return cargo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Determina si un cargo (texto libre) corresponde al rol esperado
  private cargoCorrespondeARol(cargoUsuario: string, rol: string): boolean {
    const u = this.normalizarCargo(cargoUsuario)
    if (!u) return false

    const equivalencias: Record<string, string[]> = {
      Gerencia: [
        'gerencia', 'gerente', 'gerente general', 'representante de la direccion',
        'representante legal', 'direccion general', 'direccion', 'alta direccion'
      ],
      CoordinadorHSEQ: [
        'coordinador hseq', 'coordinadora hseq', 'coord hseq', 'hseq',
        'coordinacion hseq', 'jefe hseq', 'lider hseq', 'responsable hseq'
      ],
    }

    const lista = equivalencias[rol] || [rol.toLowerCase()]
    return lista.some(eq => u === eq || u.includes(eq))
  }

  // Resolver el rol esperado a partir del tipo de hallazgo.
  // Acepta el enum ('NC_MENOR') o el label legible ('NC Menor', 'No conformidad menor', etc.)
  private getRolEsperadoPorHallazgo(hallazgoTipo: string | null | undefined): string | null {
    const enumVal = normalizarHallazgo(hallazgoTipo)
    if (!enumVal) return null
    const roles = approvalFlow[enumVal]
    if (!roles || roles.length === 0) return null
    if (enumVal === 'NC_MAYOR') return 'Gerencia'
    return 'CoordinadorHSEQ'
  }

  // Aprobar (inserta o actualiza; valida que el cargo del usuario
  // coincida con el rol esperado para esta acción)
  async aprobar(accionId: string, usuarioId: string, comentario?: string) {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id: accionId },
      select: { hallazgo_tipo: true, tipo_hallazgo_detectado: true, estado_aprobacion: true }
    })
    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    // hallazgo_tipo (enum) es la fuente de verdad; si está vacío,
    // cae al VARCHAR legacy tipo_hallazgo_detectado (que guarda el label legible)
    const hallazgoValor = (accion.hallazgo_tipo as string) || accion.tipo_hallazgo_detectado

    const rolEsperado = this.getRolEsperadoPorHallazgo(hallazgoValor)
    if (!rolEsperado) {
      throw new Error(`No hay un aprobador definido para el tipo de hallazgo: ${accion.tipo_hallazgo_detectado}`)
    }

    const usuario = await prisma.usuarios.findUnique({
      where: { id: usuarioId },
      select: { id: true, nombre: true, cargo: true, activo: true }
    })
    if (!usuario || !usuario.activo) {
      throw new Error('Usuario no autorizado')
    }

    if (!this.cargoCorrespondeARol(usuario.cargo, rolEsperado)) {
      throw new Error(
        `Su cargo "${usuario.cargo || 'sin cargo'}" no corresponde al rol requerido "${rolEsperado}".`
      )
    }

    // Si ya existe un registro APROBADO, no se puede re-aprobar
    const existente = await prisma.aprobaciones_accion.findUnique({
      where: { accion_id: accionId }
    })
    if (existente && existente.estado === 'APROBADO') {
      throw new Error('Esta acción ya fue aprobada')
    }

    const data = {
      accion_id: accionId,
      rol: rolEsperado,
      estado: 'APROBADO' as const,
      aprobador_id: usuarioId,
      fecha: new Date(),
      comentario: comentario || null,
    }

    const aprobacion = existente
      ? await prisma.aprobaciones_accion.update({
          where: { id: existente.id },
          data,
          include: {
            aprobador: { select: { id: true, nombre: true, correo: true, cargo: true } }
          }
        })
      : await prisma.aprobaciones_accion.create({
          data,
          include: {
            aprobador: { select: { id: true, nombre: true, correo: true, cargo: true } }
          }
        })

    await prisma.acciones_correctivas_preventivas.update({
      where: { id: accionId },
      data: { estado_aprobacion: 'APROBADO' }
    })

    return aprobacion
  }

  // Rechazar (mismas validaciones que aprobar; inserta o actualiza)
  async rechazar(accionId: string, usuarioId: string, comentario: string) {
    if (!comentario || !comentario.trim()) {
      throw new Error('Debe ingresar un comentario para rechazar')
    }

    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id: accionId },
      select: { hallazgo_tipo: true, tipo_hallazgo_detectado: true, estado_aprobacion: true }
    })
    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    const hallazgoValor = (accion.hallazgo_tipo as string) || accion.tipo_hallazgo_detectado
    const rolEsperado = this.getRolEsperadoPorHallazgo(hallazgoValor)
    if (!rolEsperado) {
      throw new Error(`No hay un aprobador definido para el tipo de hallazgo: ${hallazgoValor || '(sin tipo)'}`)
    }

    const usuario = await prisma.usuarios.findUnique({
      where: { id: usuarioId },
      select: { id: true, nombre: true, cargo: true, activo: true }
    })
    if (!usuario || !usuario.activo) {
      throw new Error('Usuario no autorizado')
    }

    if (!this.cargoCorrespondeARol(usuario.cargo, rolEsperado)) {
      throw new Error(
        `Su cargo "${usuario.cargo || 'sin cargo'}" no corresponde al rol requerido "${rolEsperado}".`
      )
    }

    if (accion.estado_aprobacion === 'APROBADO') {
      throw new Error('Esta acción ya fue aprobada y no puede ser rechazada')
    }

    const existente = await prisma.aprobaciones_accion.findUnique({
      where: { accion_id: accionId }
    })

    const data = {
      accion_id: accionId,
      rol: rolEsperado,
      estado: 'RECHAZADO' as const,
      aprobador_id: usuarioId,
      fecha: new Date(),
      comentario: comentario.trim(),
    }

    const rechazo = existente
      ? await prisma.aprobaciones_accion.update({
          where: { id: existente.id },
          data,
          include: {
            aprobador: { select: { id: true, nombre: true, correo: true, cargo: true } }
          }
        })
      : await prisma.aprobaciones_accion.create({
          data,
          include: {
            aprobador: { select: { id: true, nombre: true, correo: true, cargo: true } }
          }
        })

    await prisma.acciones_correctivas_preventivas.update({
      where: { id: accionId },
      data: { estado_aprobacion: 'RECHAZADO' }
    })

    return rechazo
  }

  // Obtener la única aprobación existente (o null)
  async obtenerAprobaciones(accionId: string) {
    const [accion, aprobacion] = await Promise.all([
      prisma.acciones_correctivas_preventivas.findUnique({
        where: { id: accionId },
        select: { hallazgo_tipo: true, tipo_hallazgo_detectado: true, estado_aprobacion: true }
      }),
      prisma.aprobaciones_accion.findUnique({
        where: { accion_id: accionId },
        include: {
          aprobador: {
            select: { id: true, nombre: true, correo: true, cargo: true }
          }
        }
      })
    ])

    const hallazgoValor = (accion?.hallazgo_tipo as string) || accion?.tipo_hallazgo_detectado
    const rolEsperado = this.getRolEsperadoPorHallazgo(hallazgoValor)

    return {
      hallazgoTipo: accion,
      rolEsperado,
      approval: aprobacion,
    }
  }

  // Resetea la aprobación (útil cuando se cambia el tipo de hallazgo)
  async resetAprobacion(accionId: string) {
    await prisma.aprobaciones_accion.deleteMany({ where: { accion_id: accionId } })
    await prisma.acciones_correctivas_preventivas.update({
      where: { id: accionId },
      data: { estado_aprobacion: 'PENDIENTE' }
    })
  }

  // ============================================
  // STEP 5 - ESTADO DE LA ACCIÓN
  // ============================================

  // Calcular y actualizar el estado global según reglas de negocio
  async calcularEstadoGlobal(accionId: string): Promise<{ estado_anterior: string; estado_nuevo: string }> {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id: accionId },
      include: {
        causas: {
          select: { estado_seguimiento: true, evaluacion_cierre_eficaz: true, fecha_cierre: true }
        }
      }
    })

    if (!accion) throw new Error('Acción no encontrada')

    const hoy = new Date()
    const fechaLimite = accion.fecha_limite_cierre_accion ? new Date(accion.fecha_limite_cierre_accion) : null

    // Conteos por estado de las causas
    const detalleCausas = accion.causas.map(c => ({
      estado_seguimiento: c.estado_seguimiento,
      fecha_cierre: c.fecha_cierre,
      evaluacion_cierre_eficaz: c.evaluacion_cierre_eficaz
    }))
    const causasReplanteadas = accion.causas.filter(c => c.estado_seguimiento === 'Replanteada').length
    const causasVencidas = accion.causas.filter(c => c.estado_seguimiento === 'Vencida').length
    const causasEnProceso = accion.causas.filter(c => c.estado_seguimiento === 'En Proceso' || !c.estado_seguimiento).length
    const causasCerradasEficaz = accion.causas.filter(
      c => c.fecha_cierre && c.evaluacion_cierre_eficaz === 'EFICAZ'
    ).length
    const causasTotal = accion.causas.length
    const todasCausasCerradasEficaz = causasTotal > 0 && causasCerradasEficaz === causasTotal

    const estadoAnterior = accion.estado_global as string

    let estadoNuevo: string
    let razonCambio = ''

    // Prioridad de reglas:
    // 1) Si alguna causa está REPLANTEADA → REPLANTEADA
    // 2) Si alguna causa está VENCIDA (estado_seguimiento) → VENCIDA
    // 3) Si TODAS las causas están cerradas con evaluación EFICAZ → CUMPLIDA
    // 4) Si la fecha límite ya pasó y aún no termina → VENCIDA (fallback)
    // 5) Else → EN_PROCESO
    if (causasReplanteadas > 0) {
      estadoNuevo = 'REPLANTEADA'
      razonCambio = `${causasReplanteadas} causa(s) en estado 'Replanteada'`
    } else if (causasVencidas > 0) {
      estadoNuevo = 'VENCIDA'
      razonCambio = `${causasVencidas} causa(s) en estado 'Vencida'`
    } else if (todasCausasCerradasEficaz) {
      estadoNuevo = 'CUMPLIDA'
      razonCambio = `Todas las ${causasTotal} causa(s) cerradas con evaluación EFICAZ`
    } else if (fechaLimite && fechaLimite < hoy) {
      estadoNuevo = 'VENCIDA'
      razonCambio = `Fecha límite ${fechaLimite.toISOString()} ya vencida y la acción no está terminada`
    } else {
      estadoNuevo = 'EN_PROCESO'
      razonCambio = `${causasEnProceso} causa(s) en proceso`
    }

    console.log('[calcularEstadoGlobal]', {
      accionId,
      fecha_limite_cierre_accion: fechaLimite?.toISOString() ?? null,
      hoy: hoy.toISOString(),
      causasTotal,
      causasReplanteadas,
      causasVencidas,
      causasCerradasEficaz,
      causasEnProceso,
      detalleCausas,
      estadoAnterior,
      estadoNuevo,
      razonCambio,
      vaACambiar: estadoNuevo !== estadoAnterior
    })

    if (estadoNuevo !== estadoAnterior) {
      await prisma.acciones_correctivas_preventivas.update({
        where: { id: accionId },
        data: {
          estado_global: estadoNuevo as any,
          fecha_actualizacion_estado: new Date(),
        }
      })
      console.log('[calcularEstadoGlobal] BD actualizada:', {
        accionId,
        estado_global: estadoNuevo
      })
    } else {
      console.log('[calcularEstadoGlobal] Sin cambios (estadoNuevo == estadoAnterior):', estadoNuevo)
    }

    return { estado_anterior: estadoAnterior, estado_nuevo: estadoNuevo }
  }

  // Actualizar manualmente el estado global (usado desde Step 5)
  async actualizarEstadoGlobal(accionId: string, data: {
    estado_global: string
    registrado_por_id?: string
    observaciones?: string
  }) {
    const accion = await this.obtenerPorId(accionId)

    const actualizada = await prisma.acciones_correctivas_preventivas.update({
      where: { id: accionId },
      data: {
        estado_global: data.estado_global as any,
        fecha_actualizacion_estado: new Date(),
        registrado_por_id: data.registrado_por_id || undefined,
        observaciones: data.observaciones !== undefined ? data.observaciones : undefined,
      },
      include: includeAccionCompleta
    })

    return actualizada
  }

  // Crear nueva causa para una acción existente
  async crearCausa(
    accionId: string,
    data: {
      orden: number
      analisis_causa: string
      descripcion_plan_accion?: string
      responsable_ejecucion?: string
      fecha_limite_implementacion?: string
      estado_seguimiento?: 'En Proceso' | 'Cumplida' | 'Vencida'
    }
  ) {
    // 1. Verificar que la acción existe
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id: accionId }
    })

    if (!accion) {
      throw new Error('Acción correctiva no encontrada')
    }

    // 2. Validar que analisis_causa no esté vacío
    if (!data.analisis_causa || data.analisis_causa.trim() === '') {
      throw new Error('El campo analisis_causa es obligatorio')
    }

    // 3. Convertir fecha si existe
    const fechaLimite = data.fecha_limite_implementacion
      ? new Date(data.fecha_limite_implementacion)
      : null

    // 4. Crear la causa
    const causa = await prisma.causas_accion_correctiva.create({
      data: {
        accion_correctiva_id: accionId,
        orden: data.orden,
        analisis_causa: data.analisis_causa,
        descripcion_plan_accion: data.descripcion_plan_accion || null,
        responsable_ejecucion: data.responsable_ejecucion || null,
        fecha_limite_implementacion: fechaLimite,
        estado_seguimiento: data.estado_seguimiento || 'En Proceso'
      }
    })

    return causa
  }

  // Actualizar causa individual
  async actualizarCausa(
    accionId: string,
    causaId: string,
    data: {
      analisis_causa?: string
      descripcion_plan_accion?: string
      responsable_ejecucion?: string
      fecha_limite_implementacion?: string
      estado_seguimiento?: 'En Proceso' | 'Cumplida' | 'Vencida'
      descripcion_observaciones?: string
      fecha_seguimiento?: string
      fecha_evaluacion_eficacia?: string
      criterio_evaluacion_eficacia?: string
      analisis_evidencias_cierre?: string
      evaluacion_cierre_eficaz?: 'EFICAZ' | 'NO EFICAZ'
      soporte_cierre_eficaz?: string
      fecha_cierre?: string
      responsable_cierre?: string
      sugerencia_ia?: any
    }
  ) {
    // 1. Verificar que la causa existe y pertenece a la acción
    const causa = await prisma.causas_accion_correctiva.findFirst({
      where: {
        id: causaId,
        accion_correctiva_id: accionId
      }
    })

    if (!causa) {
      throw new Error('Causa no encontrada')
    }

    // 2. Preparar datos de actualización
    const updateData: any = {}

    if (data.analisis_causa !== undefined) {
      updateData.analisis_causa = data.analisis_causa
    }

    if (data.descripcion_plan_accion !== undefined) {
      updateData.descripcion_plan_accion = data.descripcion_plan_accion
    }

    if (data.responsable_ejecucion !== undefined) {
      updateData.responsable_ejecucion = data.responsable_ejecucion
    }

    if (data.fecha_limite_implementacion !== undefined) {
      updateData.fecha_limite_implementacion = data.fecha_limite_implementacion
        ? new Date(data.fecha_limite_implementacion)
        : null
    }

    if (data.estado_seguimiento !== undefined) {
      updateData.estado_seguimiento = data.estado_seguimiento
    }

    if (data.descripcion_observaciones !== undefined) {
      updateData.descripcion_observaciones = data.descripcion_observaciones
    }

    if (data.fecha_seguimiento !== undefined) {
      updateData.fecha_seguimiento = data.fecha_seguimiento
        ? new Date(data.fecha_seguimiento)
        : null
    }

    if (data.fecha_evaluacion_eficacia !== undefined) {
      updateData.fecha_evaluacion_eficacia = data.fecha_evaluacion_eficacia
        ? new Date(data.fecha_evaluacion_eficacia)
        : null
    }

    if (data.criterio_evaluacion_eficacia !== undefined) {
      updateData.criterio_evaluacion_eficacia = data.criterio_evaluacion_eficacia
    }

    if (data.analisis_evidencias_cierre !== undefined) {
      updateData.analisis_evidencias_cierre = data.analisis_evidencias_cierre
    }

    if (data.evaluacion_cierre_eficaz !== undefined) {
      updateData.evaluacion_cierre_eficaz = data.evaluacion_cierre_eficaz
    }

    if (data.soporte_cierre_eficaz !== undefined) {
      updateData.soporte_cierre_eficaz = data.soporte_cierre_eficaz
    }

    if (data.fecha_cierre !== undefined) {
      updateData.fecha_cierre = data.fecha_cierre
        ? new Date(data.fecha_cierre)
        : null
    }

    if (data.responsable_cierre !== undefined) {
      updateData.responsable_cierre = data.responsable_cierre
    }

    if (data.sugerencia_ia !== undefined) {
      updateData.sugerencia_ia = data.sugerencia_ia
    }

    // 3. Actualizar la causa
    const causaActualizada = await prisma.causas_accion_correctiva.update({
      where: { id: causaId },
      data: updateData
    })

    return causaActualizada
  }

  // Listar seguimientos de una causa (trazabilidad)
  async listarSeguimientosCausa(accionId: string, causaId: string) {
    const causa = await prisma.causas_accion_correctiva.findFirst({
      where: {
        id: causaId,
        accion_correctiva_id: accionId
      }
    })

    if (!causa) {
      throw new Error('Causa no encontrada')
    }

    return await prisma.seguimientos_causa.findMany({
      where: { causa_id: causaId },
      orderBy: [{ fecha_seguimiento: 'desc' }, { created_at: 'desc' }],
      include: {
        registrado_por: {
          select: { id: true, nombre: true, correo: true }
        }
      }
    })
  }

  // Crear un seguimiento para una causa (trazabilidad)
  async crearSeguimientoCausa(
    accionId: string,
    causaId: string,
    data: CreateSeguimientoCausaInput,
    registrado_por_id?: string
  ) {
    const causa = await prisma.causas_accion_correctiva.findFirst({
      where: {
        id: causaId,
        accion_correctiva_id: accionId
      }
    })

    if (!causa) {
      throw new Error('Causa no encontrada')
    }

    const fechaSeguimiento = typeof data.fecha_seguimiento === 'string'
      ? new Date(data.fecha_seguimiento)
      : data.fecha_seguimiento

    const estadoSeguimientoNormalizado: 'En Proceso' | 'Cumplida' | 'Vencida' =
      data.estado_accion === 'Cumplidas'
        ? 'Cumplida'
        : data.estado_accion === 'Vencidas'
          ? 'Vencida'
          : 'En Proceso'

    const seguimiento = await prisma.$transaction(async (tx) => {
      const creado = await tx.seguimientos_causa.create({
        data: {
          causa_id: causaId,
          fecha_seguimiento: fechaSeguimiento,
          estado_accion: data.estado_accion,
          descripcion_observaciones: data.descripcion_observaciones || null,
          evaluacion_eficaz: data.evaluacion_eficaz || null,
          registrado_por_id: registrado_por_id || null,
          responsable_seguimiento: data.responsable_seguimiento || null,
          cargo_responsable_seguimiento: data.cargo_responsable_seguimiento || null,
          replanteo: data.replanteo || null
        },
        include: {
          registrado_por: {
            select: { id: true, nombre: true, correo: true }
          }
        }
      })

      await tx.causas_accion_correctiva.update({
        where: { id: causaId },
        data: {
          fecha_seguimiento: fechaSeguimiento,
          estado_seguimiento: estadoSeguimientoNormalizado,
          descripcion_observaciones: data.descripcion_observaciones || null,
          updated_at: new Date()
        }
      })

      return creado
    })

    return seguimiento
  }

  // Estadísticas generales
  async obtenerEstadisticas() {
    const [total, porTipo, porRiesgo, porEstadoGlobal, causasPorEstado, proximasVencer, causasCerradas, causasPendientes] =
      await Promise.all([
        // Total de acciones
        prisma.acciones_correctivas_preventivas.count(),

        // Por tipo de acción
        prisma.acciones_correctivas_preventivas.groupBy({
          by: ['tipo_accion_ejecutar'],
          _count: true
        }),

        // Por valoración de riesgo
        prisma.acciones_correctivas_preventivas.groupBy({
          by: ['valoracion_riesgo'],
          _count: true
        }),

        // Por estado global de la acción (EN_PROCESO, VENCIDA, CUMPLIDA, REPLANTEADA)
        prisma.acciones_correctivas_preventivas.groupBy({
          by: ['estado_global'],
          _count: true
        }),

        // Causas por estado de seguimiento
        prisma.causas_accion_correctiva.groupBy({
          by: ['estado_seguimiento'],
          _count: true
        }),

        // Próximas a vencer (30 días) - causas con fecha límite próxima
        prisma.causas_accion_correctiva.count({
          where: {
            fecha_limite_implementacion: {
              gte: new Date(),
              lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            },
            estado_seguimiento: { not: 'Cumplida' }
          }
        }),

        // Causas cerradas eficazmente
        prisma.causas_accion_correctiva.count({
          where: {
            evaluacion_cierre_eficaz: 'EFICAZ',
            fecha_cierre: { not: null }
          }
        }),

        // Causas pendientes de cierre
        prisma.causas_accion_correctiva.count({
          where: {
            OR: [{ fecha_cierre: null }, { evaluacion_cierre_eficaz: null }],
            estado_seguimiento: 'Cumplida'
          }
        })
      ])

    // Transformar arrays de groupBy a objetos para fácil acceso
    const porTipoMap: Record<string, number> = {}
    porTipo.forEach((item) => {
      porTipoMap[item.tipo_accion_ejecutar || 'Sin tipo'] = item._count
    })

    const porRiesgoMap: Record<string, number> = {}
    porRiesgo.forEach((item) => {
      porRiesgoMap[item.valoracion_riesgo || 'Sin valoración'] = item._count
    })

    // por_estado usa estado_global de las acciones (no de causas)
    // Mapear: EN_PROCESO -> "En Proceso", VENCIDA -> "Vencidas", CUMPLIDA -> "Cumplidas", REPLANTEADA -> "Replanteadas"
    const estadoGlobalToLabel: Record<string, string> = {
      EN_PROCESO: 'En Proceso',
      VENCIDA: 'Vencidas',
      CUMPLIDA: 'Cumplidas',
      REPLANTEADA: 'Replanteadas'
    }
    const porEstadoMap: Record<string, number> = {}
    porEstadoGlobal.forEach((item) => {
      const label = estadoGlobalToLabel[item.estado_global as string] || item.estado_global || 'Sin estado'
      porEstadoMap[label] = (porEstadoMap[label] || 0) + item._count
    })

    const causasPorEstadoMap: Record<string, number> = {}
    causasPorEstado.forEach((item) => {
      causasPorEstadoMap[item.estado_seguimiento || 'Sin estado'] = item._count
    })

    return {
      total,
      por_tipo: porTipoMap,
      por_riesgo: porRiesgoMap,
      por_estado: porEstadoMap,
      por_estado_causas: causasPorEstadoMap,
      proximas_vencer: proximasVencer,
      causas_cerradas_eficazmente: causasCerradas,
      causas_pendientes_cierre: causasPendientes
    }
  }

  // Validar que todas las causas estén cerradas
  async validarCierreCompleto(accion_id: string): Promise<{
    todas_cerradas: boolean
    causas_pendientes: number
    detalle_pendientes: Array<{ orden: number; analisis_causa: string; estado: string }>
  }> {
    const causas = await prisma.causas_accion_correctiva.findMany({
      where: { accion_correctiva_id: accion_id },
      select: {
        orden: true,
        analisis_causa: true,
        estado_seguimiento: true,
        evaluacion_cierre_eficaz: true,
        fecha_cierre: true
      },
      orderBy: { orden: 'asc' }
    })

    const pendientes = causas.filter(
      (c) => !c.fecha_cierre || !c.evaluacion_cierre_eficaz || c.evaluacion_cierre_eficaz === 'NO EFICAZ'
    )

    return {
      todas_cerradas: pendientes.length === 0,
      causas_pendientes: pendientes.length,
      detalle_pendientes: pendientes.map((p) => ({
        orden: p.orden || 0,
        analisis_causa: p.analisis_causa,
        estado: p.evaluacion_cierre_eficaz || 'Sin evaluar'
      }))
    }
  }

  // Cerrar una causa específica
  async cerrarCausa(
    causa_id: string,
    datos_cierre: {
      fecha_evaluacion_eficacia: Date | string
      criterio_evaluacion_eficacia: string
      analisis_evidencias_cierre: string
      evaluacion_cierre_eficaz: 'EFICAZ' | 'NO EFICAZ'
      soporte_cierre_eficaz?: string
      responsable_cierre: string
    }
  ) {
    const causa = await prisma.causas_accion_correctiva.findUnique({
      where: { id: causa_id }
    })

    if (!causa) {
      throw new Error('Causa no encontrada')
    }

    // Validar que la causa esté cumplida antes de cerrar
    if (causa.estado_seguimiento !== 'Cumplida') {
      throw new Error('La causa debe estar en estado "Cumplida" antes de cerrar')
    }

    const fechasConvertidas = this.convertirFechasCausa(datos_cierre as any)

    return await prisma.causas_accion_correctiva.update({
      where: { id: causa_id },
      data: {
        ...fechasConvertidas,
        fecha_cierre: new Date(),
        updated_at: new Date()
      }
    })
  }

  // Helper: Convertir fechas string a Date
  private convertirFechas(data: any) {
    const resultado = { ...data }
    const camposFecha = [
      'fecha_identificacion_hallazgo',
      'fecha_implementacion',
      'fecha_limite_evaluacion_eficacia',
      'fecha_evaluacion_eficacia',
      'fecha_cierre_definitivo',
      'fecha_reapertura',
      'created_at'
    ]

    camposFecha.forEach((campo) => {
      if (resultado[campo]) {
        const d = new Date(resultado[campo]);
        if (!isNaN(d.getTime())) {
          resultado[campo] = d;
        } else {
          delete resultado[campo];
        }
      } else {
        delete resultado[campo];
      }
    })

    // Convertir booleanos
    const camposBool = ['requiere_actualizar_matriz', 'aplica_correccion_inmediata', 'aplica_reapertura'];
    camposBool.forEach(campo => {
      if (typeof resultado[campo] === 'string') {
        resultado[campo] = resultado[campo] === 'true';
      }
    });

    return resultado;
  }

  // Helper: Convertir fechas de causas (sin seguimientos anidados)
  private convertirFechasCausa(causa: CausaAccionInput) {
    const { seguimientos, ...resto } = causa
    const resultado: any = { ...resto }
    const camposFecha = ['fecha_limite_implementacion', 'fecha_seguimiento', 'fecha_evaluacion_eficacia', 'fecha_cierre']

    camposFecha.forEach((campo) => {
      if (resultado[campo]) {
        const d = new Date(resultado[campo]);
        if (!isNaN(d.getTime())) {
          resultado[campo] = d;
        } else {
          delete resultado[campo];
        }
      } else {
        delete resultado[campo];
      }
    })

    if (resultado.estado_seguimiento === 'Cerrada') {
      resultado.estado_seguimiento = 'Cumplida'
    }

    return resultado
  }

  private toDate(value: Date | string): Date | null {
    if (!value) return null;
    const d = typeof value === 'string' ? new Date(value) : value;
    return isNaN(d.getTime()) ? null : d;
  }

  private buildSeguimientoCreate(s: SeguimientoRegistroInput) {
    return {
      fecha_seguimiento: this.toDate(s.fecha_seguimiento),
      descripcion_observaciones: s.descripcion_observaciones?.trim() || null,
      estado_accion: s.estado_accion,
      adjunto_url: s.adjunto_url || null,
      replanteo: s.replanteo || null,
      responsable_seguimiento: s.responsable_seguimiento?.trim() || null,
      cargo_responsable_seguimiento: s.cargo_responsable_seguimiento?.trim() || null
    }
  }

  private buildCausaCreate(causa: CausaAccionInput) {
    const base = this.convertirFechasCausa(causa)
    const ultimoSeguimiento = causa.seguimientos?.filter((s) => s.fecha_seguimiento).at(-1)

    if (ultimoSeguimiento) {
      base.fecha_seguimiento = this.toDate(ultimoSeguimiento.fecha_seguimiento)
      base.descripcion_observaciones =
        ultimoSeguimiento.descripcion_observaciones?.trim() || null
      base.estado_seguimiento = this.normalizarEstadoCausa(ultimoSeguimiento.estado_accion)
    }

    const seguimientosCreate = causa.seguimientos?.filter((s) => s.fecha_seguimiento)?.length
      ? {
          create: causa.seguimientos
            .filter((s) => s.fecha_seguimiento)
            .map((s) => this.buildSeguimientoCreate(s))
        }
      : undefined

    return {
      orden: base.orden,
      analisis_causa: base.analisis_causa,
      es_causa_raiz: base.es_causa_raiz ?? false,
      descripcion_plan_accion: base.descripcion_plan_accion,
      fecha_limite_implementacion: base.fecha_limite_implementacion,
      responsable_ejecucion: base.responsable_ejecucion,
      fecha_seguimiento: base.fecha_seguimiento,
      estado_seguimiento: base.estado_seguimiento || 'En Proceso',
      descripcion_observaciones: base.descripcion_observaciones,
      ...(seguimientosCreate && { seguimientos: seguimientosCreate })
    }
  }

  private normalizarEstadoCausa(estado: string): string {
    if (estado === 'Cerrada' || estado === 'Cumplidas') return 'Cumplida'
    if (estado === 'Vencidas') return 'Vencida'
    if (estado === 'En Proceso') return 'En Proceso'
    return estado
  }

  private buildCicloCreate(ciclo: CicloEficaciaInput) {
    const criterios =
      ciclo.criterios_cumplidos?.filter((c) => c?.trim()).map((c) => c.trim()) ?? []
    return {
      numero_ciclo: ciclo.numero_ciclo,
      fecha_seguimiento: this.toDate(ciclo.fecha_seguimiento),
      descripcion: ciclo.descripcion?.trim() || null,
      resultado_ciclo: ciclo.resultado_ciclo || null,
      responsable: ciclo.responsable?.trim() || null,
      cargo: ciclo.cargo?.trim() || null,
      adjunto_url: ciclo.adjunto_url || null,
      impedimento: ciclo.impedimento || null,
      nueva_fecha: ciclo.nueva_fecha ? this.toDate(ciclo.nueva_fecha) : null,
      criterios_cumplidos: criterios.length ? criterios : undefined
    }
  }

  private buildEvidenciaCreate(ev: EvidenciaEficaciaInput) {
    return {
      orden: ev.orden,
      tipo_evidencia: ev.tipo_evidencia?.trim() || null,
      descripcion: ev.descripcion?.trim() || null,
      fecha: ev.fecha ? this.toDate(ev.fecha) : null,
      estado_ubicacion: ev.estado_ubicacion || null,
      adjunto_url: ev.adjunto_url || null
    }
  }
}
