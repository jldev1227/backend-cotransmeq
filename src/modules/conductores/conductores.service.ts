import { prisma } from "../../config/prisma";
import { getS3SignedUrl, uploadToS3, deleteFromS3 } from "../../config/aws";
import { randomUUID } from "crypto";

export const ConductoresService = {
  // Obtener todos los conductores (sin soft deleted)
  async obtenerTodos(filters?: {
    estado?: string;
    sede_trabajo?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      oculto: false, // ← FILTRAR OCULTOS POR DEFECTO
      deleted_at: null, // ← FILTRAR ELIMINADOS
    };

    // Filtro por estado
    if (filters?.estado) {
      where.estado = filters.estado;
    }

    // Filtro por sede
    if (filters?.sede_trabajo) {
      where.sede_trabajo = filters.sede_trabajo;
    }

    // Búsqueda por nombre, apellido o número de identificación
    if (filters?.search) {
      where.OR = [
        { nombre: { contains: filters.search, mode: "insensitive" } },
        { apellido: { contains: filters.search, mode: "insensitive" } },
        {
          numero_identificacion: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
        { email: { contains: filters.search, mode: "insensitive" } },
      ];
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
          updated_at: true,
        },
        orderBy: { nombre: "asc" },
        skip,
        take: limit,
      }),
      prisma.conductores.count({ where }),
    ]);

    // Generar URLs firmadas de S3 para las fotos desde la tabla documento
    const conductoresConFotos = await Promise.all(
      conductores.map(async (conductor) => {
        let foto_signed_url = null;

        try {
          // Buscar documento de tipo FOTO_PERFIL para el conductor
          const fotoDocumento = await prisma.documento.findFirst({
            where: {
              conductor_id: conductor.id,
              categoria: "FOTO_PERFIL",
              estado: "vigente", // Cambiado de 'ACTIVO' a 'vigente'
            },
            orderBy: {
              created_at: "desc",
            },
          });

          // Si existe el documento y tiene s3_key, generar URL firmada
          if (fotoDocumento?.s3_key) {
            foto_signed_url = await getS3SignedUrl(fotoDocumento.s3_key);
          }
          // Fallback al foto_url antiguo si existe
          else if (conductor.foto_url) {
            foto_signed_url = await getS3SignedUrl(conductor.foto_url);
          }
        } catch (error) {
          console.error(
            `Error generando URL firmada para conductor ${conductor.id}:`,
            error,
          );
        }

        return { ...conductor, foto_signed_url };
      }),
    );

    return {
      conductores: conductoresConFotos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
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
            estado: true,
          },
        },
        servicio: {
          select: {
            id: true,
            fecha_solicitud: true,
            estado: true,
            valor: true,
          },
          orderBy: { fecha_solicitud: "desc" },
          take: 10,
        },
      },
    });

    if (!conductor) {
      throw new Error("Conductor no encontrado");
    }

    // Generar URL firmada para la foto desde la tabla documento
    let foto_signed_url = null;
    try {
      // Buscar documento de tipo FOTO_PERFIL para el conductor
      const fotoDocumento = await prisma.documento.findFirst({
        where: {
          conductor_id: conductor.id,
          categoria: "FOTO_PERFIL",
          estado: "vigente", // Cambiado de 'ACTIVO' a 'vigente'
        },
        orderBy: {
          created_at: "desc",
        },
      });

      // Si existe el documento y tiene s3_key, generar URL firmada
      if (fotoDocumento?.s3_key) {
        foto_signed_url = await getS3SignedUrl(fotoDocumento.s3_key);
      }
      // Fallback al foto_url antiguo si existe
      else if (conductor.foto_url) {
        foto_signed_url = await getS3SignedUrl(conductor.foto_url);
      }
    } catch (error) {
      console.error("Error generando URL firmada:", error);
    }

    return { ...conductor, foto_signed_url };
  },

  // Crear conductor
  async crear(data: any, creado_por_id: string) {
    // Solo validar duplicados si numero_identificacion tiene valor
    if (data.numero_identificacion) {
      const conductorExistente = await prisma.conductores.findUnique({
        where: { numero_identificacion: data.numero_identificacion },
      });

      if (conductorExistente) {
        throw new Error(
          "Ya existe un conductor con ese número de identificación",
        );
      }
    }

    if (data.email) {
      const emailExistente = await prisma.conductores.findUnique({
        where: { email: data.email },
      });

      if (emailExistente) {
        throw new Error("Ya existe un conductor con ese email");
      }
    }

    // Convertir fechas de string a Date de forma robusta
    const parseDate = (val: any) => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    const fechaIngreso = parseDate(data.fecha_ingreso) || new Date();
    const vencimientoLicencia = parseDate(data.vencimiento_licencia);
    const fechaNacimiento = parseDate(data.fecha_nacimiento);

    const conductor = await prisma.conductores.create({
      data: {
        id: randomUUID(),
        nombre: data.nombre,
        apellido: data.apellido,
        tipo_identificacion: data.tipo_identificacion || "CC",
        numero_identificacion: data.numero_identificacion,
        email: data.email || null,
        telefono: data.telefono || null,
        direccion: data.direccion || null,
        fecha_nacimiento: fechaNacimiento,
        genero: data.genero || null,
        cargo: data.cargo || "CONDUCTOR",
        fecha_ingreso: fechaIngreso,
        salario_base: data.salario_base || null,
        estado: data.estado || "activo",
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
        updated_at: new Date(),
      },
    });

    return conductor;
  },

  // Actualizar conductor
  async actualizar(id: string, data: any, actualizado_por_id?: string) {
    const conductorExistente = await prisma.conductores.findUnique({
      where: { id },
    });

    if (!conductorExistente) {
      throw new Error("Conductor no encontrado");
    }

    // Verificar unicidad de número de identificación
    if (
      data.numero_identificacion &&
      data.numero_identificacion !== conductorExistente.numero_identificacion
    ) {
      const duplicado = await prisma.conductores.findUnique({
        where: { numero_identificacion: data.numero_identificacion },
      });

      if (duplicado) {
        throw new Error(
          "Ya existe un conductor con ese número de identificación",
        );
      }
    }

    // Verificar unicidad de email
    if (data.email && data.email !== conductorExistente.email) {
      const duplicado = await prisma.conductores.findUnique({
        where: { email: data.email },
      });

      if (duplicado) {
        throw new Error("Ya existe un conductor con ese email");
      }
    }

    const allowedFields = [
      "nombre",
      "apellido",
      "tipo_identificacion",
      "numero_identificacion",
      "email",
      "telefono",
      "fecha_nacimiento",
      "genero",
      "direccion",
      "fecha_ingreso",
      "salario_base",
      "eps",
      "fondo_pension",
      "arl",
      "termino_contrato",
      "fecha_terminacion",
      "licencia_conduccion",
      "ultimo_acceso",
      "permisos",
      "cargo",
      "categoria_licencia",
      "foto_url",
      "password",
      "tipo_contrato",
      "vencimiento_licencia",
      "estado",
      "sede_trabajo",
      "tipo_sangre",
      "oculto",
    ];

    const cleanData: any = {};

    for (const field of allowedFields) {
      if (!(field in data) || data[field] === undefined) {
        continue;
      }

      // Evitar enviar null en JSON
      if (
        (field === "licencia_conduccion" || field === "permisos") &&
        data[field] === null
      ) {
        continue;
      }

      // Convertir fechas correctamente para Prisma
      if (
        [
          "fecha_ingreso",
          "fecha_nacimiento",
          "fecha_terminacion",
          "vencimiento_licencia",
          "ultimo_acceso",
        ].includes(field)
      ) {
        if (!data[field]) {
          cleanData[field] = null;
        } else {
          const dateValue = new Date(data[field]);
          // Si la fecha es inválida, no la incluimos o la seteamos a null
          if (isNaN(dateValue.getTime())) {
            cleanData[field] = null;
          } else {
            // Asegurar formato correcto si es solo fecha (YYYY-MM-DD)
            if (typeof data[field] === 'string' && data[field].length === 10) {
               cleanData[field] = new Date(`${data[field]}T12:00:00`);
            } else {
               cleanData[field] = dateValue;
            }
          }
        }
        continue;
      }

      cleanData[field] = data[field];
    }

    const conductor = await prisma.conductores.update({
      where: { id },
      data: {
        ...cleanData,
        actualizado_por_id,
        updated_at: new Date(),
      },
    });

    return conductor;
  },

  // Actualizar solo el estado
  async actualizarEstado(id: string, estado: any, actualizado_por_id?: string) {
    const conductorExistente = await prisma.conductores.findUnique({
      where: { id },
    });

    if (!conductorExistente) {
      throw new Error("Conductor no encontrado");
    }

    const conductor = await prisma.conductores.update({
      where: { id },
      data: {
        estado: estado as any,
        actualizado_por_id,
        updated_at: new Date(),
      },
    });

    return conductor;
  },

  // Soft delete (marcar con deleted_at)
  async eliminar(id: string, actualizado_por_id?: string) {
    const conductorExistente = await prisma.conductores.findUnique({
      where: { id },
    });

    if (!conductorExistente) {
      throw new Error("Conductor no encontrado");
    }

    // Soft delete: marcar deleted_at y estado retirado
    const conductor = await prisma.conductores.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        estado: "retirado",
        actualizado_por_id,
        updated_at: new Date(),
      },
    });

    return conductor;
  },

  // Obtener conductores en la papelera (soft deleted)
  async obtenerPapelera(filters?: {
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      deleted_at: { not: null }, // Solo los eliminados (soft delete)
    };

    // Búsqueda
    if (filters?.search) {
      where.OR = [
        { nombre: { contains: filters.search, mode: "insensitive" } },
        { apellido: { contains: filters.search, mode: "insensitive" } },
        {
          numero_identificacion: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
      ];
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
          deleted_at: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { nombre: "asc" },
        skip,
        take: limit,
      }),
      prisma.conductores.count({ where }),
    ]);

    return {
      data: conductores,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Restaurar conductor de la papelera
  async restaurar(id: string, actualizado_por_id?: string) {
    const conductor = await prisma.conductores.findUnique({
      where: { id },
    });

    if (!conductor) {
      throw new Error("Conductor no encontrado");
    }

    return prisma.conductores.update({
      where: { id },
      data: {
        deleted_at: null,
        estado: "activo",
        actualizado_por_id,
        updated_at: new Date(),
      },
    });
  },

  // Obtener relaciones del conductor (preview de borrado permanente)
  async obtenerRelaciones(id: string) {
    const conductor = await prisma.conductores.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        numero_identificacion: true,
        deleted_at: true,
      },
    });

    if (!conductor) {
      throw { statusCode: 404, message: "Conductor no encontrado" };
    }

    // Consultas en paralelo para no bloquear la UI
    // Solo se filtran por deleted_at las tablas que tienen soft-delete:
    // - recargos_planillas (deleted_at)
    // - vehiculos (deleted_at)
    // El resto (liquidaciones, firmas, preoperacionales, etc.) usan campos
    // como `estado` o `used` que NO son soft-delete, así que se cuentan
    // tal cual para reflejar la realidad contable/legal.
    const [
      recargos,
      liquidaciones,
      firmas,
      preoperacionales,
      excesos,
      documentos,
      servicios,
      vehiculos,
      salidasNoConformes,
      registrosDia,
      tokens,
    ] = await Promise.all([
      prisma.recargos_planillas.count({
        where: { conductor_id: id, deleted_at: null },
      }),
      prisma.liquidaciones.count({ where: { conductor_id: id } }),
      prisma.firmas_desprendibles.count({ where: { conductor_id: id } }),
      prisma.preoperacionales.count({ where: { conductor_id: id } }),
      prisma.excesos_velocidad.count({ where: { conductor_id: id } }),
      prisma.documentos_compartidos.count({ where: { conductor_id: id } }),
      prisma.servicio.count({ where: { conductor_id: id } }),
      prisma.vehiculos.count({
        where: { conductor_id: id, deleted_at: null },
      }),
      prisma.salidas_no_conformes.count({ where: { conductor_id: id } }),
      prisma.registro_dia_laboral.count({ where: { conductor_id: id } }),
      prisma.conductor_token.count({ where: { conductor_id: id } }),
    ]);

    const relaciones = [
      {
        tabla: "recargos_planillas",
        etiqueta: "Recargos en planilla de nómina",
        icono: "💰",
        cantidad: recargos,
        bloquea: recargos > 0,
        descripcion: "Recargos y horas extras registradas en la planilla",
      },
      {
        tabla: "liquidaciones",
        etiqueta: "Liquidaciones laborales",
        icono: "📋",
        cantidad: liquidaciones,
        bloquea: liquidaciones > 0,
        descripcion: "Liquidaciones de prestaciones sociales",
      },
      {
        tabla: "firmas_desprendibles",
        etiqueta: "Firmas de desprendibles de nómina",
        icono: "✍️",
        cantidad: firmas,
        bloquea: firmas > 0,
        descripcion: "Firmas digitales de recibos de pago",
      },
      {
        tabla: "preoperacionales",
        etiqueta: "Inspecciones preoperacionales",
        icono: "🔍",
        cantidad: preoperacionales,
        bloquea: preoperacionales > 0,
        descripcion: "Checklist diarios de inspección vehicular",
      },
      {
        tabla: "excesos_velocidad",
        etiqueta: "Excesos de velocidad",
        icono: "⚠️",
        cantidad: excesos,
        bloquea: excesos > 0,
        descripcion: "Reportes de exceso de velocidad registrados",
      },
      {
        tabla: "servicio",
        etiqueta: "Servicios / viajes realizados",
        icono: "🚛",
        cantidad: servicios,
        bloquea: servicios > 0,
        descripcion: "Historial de servicios y viajes asignados",
      },
      {
        tabla: "vehiculos",
        etiqueta: "Vehículos asignados",
        icono: "🚚",
        cantidad: vehiculos,
        bloquea: vehiculos > 0,
        descripcion: "Vehículos que tiene asignados como conductor titular",
      },
      {
        tabla: "salidas_no_conformes",
        etiqueta: "Salidas no conformes",
        icono: "🚫",
        cantidad: salidasNoConformes,
        bloquea: salidasNoConformes > 0,
        descripcion: "Reportes de salidas no conformes",
      },
      {
        tabla: "registro_dia_laboral",
        etiqueta: "Días laborados",
        icono: "📅",
        cantidad: registrosDia,
        bloquea: registrosDia > 0,
        descripcion: "Registro de actividad diaria del conductor",
      },
      {
        tabla: "documentos_compartidos",
        etiqueta: "Documentos compartidos",
        icono: "📄",
        cantidad: documentos,
        bloquea: false,
        descripcion: "Enlaces de documentos compartidos (se eliminarán)",
      },
      {
        tabla: "conductor_token",
        etiqueta: "Tokens de acceso activos",
        icono: "🔑",
        cantidad: tokens,
        bloquea: false,
        descripcion: "Tokens del portal de conductor (se eliminarán)",
      },
    ];

    const totalRelaciones = relaciones.reduce((s, r) => s + r.cantidad, 0);
    const hayBloqueos = relaciones.some((r) => r.bloquea);

    return {
      conductor: {
        id: conductor.id,
        nombre: `${conductor.nombre} ${conductor.apellido}`,
        identificacion: conductor.numero_identificacion,
        en_papelera: !!conductor.deleted_at,
      },
      relaciones,
      total_relaciones: totalRelaciones,
      hay_bloqueos: hayBloqueos,
      mensaje_bloqueo:
        "Este conductor tiene datos históricos (nómina, servicios, inspecciones) que no pueden eliminarse por integridad contable y legal. Recomendamos mantenerlo en la papelera o anonimizar sus datos personales.",
    };
  },

  // Eliminar permanentemente
  async eliminarPermanente(id: string, forzar = false) {
    const conductor = await prisma.conductores.findUnique({
      where: { id },
    });

    if (!conductor) {
      throw new Error("Conductor no encontrado");
    }

    // Si no se fuerza, verificar que no haya datos bloqueantes
    // (mismo criterio que el preview: recargos y vehículos con deleted_at
    // NO cuentan como bloqueantes, ya que fueron soft-deleted previamente)
    if (!forzar) {
      const [recargos, liquidaciones, firmas, preoperacionales, servicios] = await Promise.all([
        prisma.recargos_planillas.count({
          where: { conductor_id: id, deleted_at: null },
        }),
        prisma.liquidaciones.count({ where: { conductor_id: id } }),
        prisma.firmas_desprendibles.count({ where: { conductor_id: id } }),
        prisma.preoperacionales.count({ where: { conductor_id: id } }),
        prisma.servicio.count({ where: { conductor_id: id } }),
      ]);

      const bloqueantes = recargos + liquidaciones + firmas + preoperacionales + servicios;
      if (bloqueantes > 0) {
        throw {
          statusCode: 409,
          message:
            "No se puede eliminar permanentemente: el conductor tiene datos históricos (nómina, servicios, inspecciones). Considere mantener el soft-delete.",
          bloqueantes: { recargos, liquidaciones, firmas, preoperacionales, servicios },
        };
      }
    }

    // Primero eliminar de S3 si tiene foto
    if (conductor.foto_url) {
      try {
        await deleteFromS3(conductor.foto_url);
      } catch (error) {
        console.error("Error eliminando foto de S3 en borrado permanente:", error);
      }
    }

    // Eliminar en transacción para que sea atómico
    return prisma.$transaction(async (tx) => {
      // Tablas con FK sin cascade: limpiar manualmente
      await tx.recargos_planillas.deleteMany({ where: { conductor_id: id } });
      await tx.liquidaciones.deleteMany({ where: { conductor_id: id } });
      await tx.firmas_desprendibles.deleteMany({ where: { conductor_id: id } });
      await tx.preoperacionales.deleteMany({ where: { conductor_id: id } });
      await tx.excesos_velocidad.deleteMany({ where: { conductor_id: id } });
      await tx.salidas_no_conformes.deleteMany({ where: { conductor_id: id } });
      await tx.registro_dia_laboral.deleteMany({ where: { conductor_id: id } });
      await tx.servicio.deleteMany({ where: { conductor_id: id } });
      await tx.documentos_compartidos.deleteMany({ where: { conductor_id: id } });
      await tx.conductor_token.deleteMany({ where: { conductor_id: id } });

      // Vehículos: desvincular (no eliminar) — preservar histórico de placas
      await tx.vehiculos.updateMany({
        where: { conductor_id: id },
        data: { conductor_id: null },
      });

      return tx.conductores.delete({ where: { id } });
    });
  },

  // Operaciones masivas: Ocultar/Mostrar
  async cambiarOcultoMasivo(ids: string[], oculto: boolean, actualizado_por_id?: string) {
    return prisma.conductores.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        oculto,
        actualizado_por_id,
        updated_at: new Date(),
      },
    });
  },

  // Operaciones masivas: Soft Delete
  async eliminarMasivo(ids: string[], actualizado_por_id?: string) {
    return prisma.conductores.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        deleted_at: new Date(),
        estado: "retirado",
        actualizado_por_id,
        updated_at: new Date(),
      },
    });
  },

  // Operaciones masivas: Restaurar
  async restaurarMasivo(ids: string[], actualizado_por_id?: string) {
    return prisma.conductores.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        deleted_at: null,
        estado: "activo",
        actualizado_por_id,
        updated_at: new Date(),
      },
    });
  },

  // Subir foto del conductor
  async subirFoto(id: string, file: any) {
    const conductor = await prisma.conductores.findUnique({
      where: { id },
    });

    if (!conductor) {
      throw new Error("Conductor no encontrado");
    }

    // Eliminar foto anterior si existe
    if (conductor.foto_url) {
      try {
        await deleteFromS3(conductor.foto_url);
      } catch (error) {
        console.error("Error eliminando foto anterior:", error);
      }
    }

    // Generar clave única para S3
    const s3Key = `conductores/${id}/${Date.now()}-${file.originalname}`;

    // Subir archivo a S3
    await uploadToS3(s3Key, file.buffer, file.mimetype);

    // Actualizar URL en base de datos
    const conductorActualizado = await prisma.conductores.update({
      where: { id },
      data: {
        foto_url: s3Key,
        updated_at: new Date(),
      },
    });

    // Obtener URL firmada
    const fotoUrlFirmada = await getS3SignedUrl(s3Key);

    return {
      ...conductorActualizado,
      foto_url_firmada: fotoUrlFirmada,
    };
  },

  // Eliminar foto del conductor
  async eliminarFoto(id: string) {
    const conductor = await prisma.conductores.findUnique({
      where: { id },
    });

    if (!conductor) {
      throw new Error("Conductor no encontrado");
    }

    if (conductor.foto_url) {
      // Eliminar de S3
      try {
        await deleteFromS3(conductor.foto_url);
      } catch (error) {
        console.error("Error eliminando foto de S3:", error);
      }

      // Actualizar base de datos
      await prisma.conductores.update({
        where: { id },
        data: {
          foto_url: null,
          updated_at: new Date(),
        },
      });
    }

    return { message: "Foto eliminada exitosamente" };
  },

  // Obtener conductores ocultos (solo admin)
  async obtenerOcultos(filters?: {
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const where: any = {
      oculto: true, // Solo los ocultos
    };

    // Búsqueda
    if (filters?.search) {
      where.OR = [
        { nombre: { contains: filters.search, mode: "insensitive" } },
        { apellido: { contains: filters.search, mode: "insensitive" } },
        {
          numero_identificacion: {
            contains: filters.search,
            mode: "insensitive",
          },
        },
      ];
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
          updated_at: true,
        },
        orderBy: { nombre: "asc" },
        skip,
        take: limit,
      }),
      prisma.conductores.count({ where }),
    ]);

    return {
      data: conductores,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Cambiar estado oculto (solo admin)
  async cambiarEstadoOculto(id: string, oculto: boolean) {
    return prisma.conductores.update({
      where: { id },
      data: {
        oculto,
        updated_at: new Date(),
      },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        oculto: true,
      },
    });
  },
};
