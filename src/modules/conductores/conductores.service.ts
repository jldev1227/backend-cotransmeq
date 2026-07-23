import { prisma } from "../../config/prisma";
import { getS3SignedUrl, uploadToS3, deleteFromS3 } from "../../config/aws";
import { randomUUID } from "crypto";

/**
 * Helper batch para obtener fotos firmadas de S3 de N conductores en UNA
 * sola query. Evita el N+1 de la implementación anterior que hacía 1 query
 * por conductor + 1 llamada a S3 por conductor (con connection_limit=1 en
 * Prisma, los `Promise.all` se serializaban y se superaban los 15s de
 * timeout del frontend).
 *
 * Estrategia:
 *  1) 1 sola query a `documento` con `conductor_id IN (...)` para traer las
 *     FOTO_PERFIL vigentes más recientes por conductor.
 *  2) 1 sola query a `conductores` para obtener el fallback `foto_url` de
 *     los que no tengan documento FOTO_PERFIL.
 *  3) URLs firmadas generadas en `Promise.all` (sin más queries a DB).
 *
 * Retorna un Map<conductor_id, foto_signed_url | null>.
 */
async function obtenerFotosConductoresBatch(
  conductorIds: string[],
): Promise<Map<string, string | null>> {
  const fotoMap = new Map<string, string | null>();
  if (conductorIds.length === 0) return fotoMap;

  // 1. Fallback: foto_url directo de la tabla conductores
  try {
    const conductores = await prisma.conductores.findMany({
      where: { id: { in: conductorIds } },
      select: { id: true, foto_url: true },
    });
    for (const c of conductores) {
      if (c.id) fotoMap.set(c.id, c.foto_url ?? null);
    }
  } catch (error) {
    console.error("[conductores] Error leyendo foto_url fallback:", error);
  }

  // 2. Documentos FOTO_PERFIL vigentes (más recientes primero)
  let fotos: Array<{ conductor_id: string | null; s3_key: string | null; ruta_archivo: string; created_at: Date }> = [];
  try {
    fotos = await prisma.documento.findMany({
      where: {
        conductor_id: { in: conductorIds },
        categoria: "FOTO_PERFIL",
        estado: "vigente",
      },
      select: {
        conductor_id: true,
        s3_key: true,
        ruta_archivo: true,
        created_at: true,
      },
      orderBy: { created_at: "desc" },
    });
  } catch (error) {
    console.error("[conductores] Error leyendo documento FOTO_PERFIL batch:", error);
    return fotoMap;
  }

  // 3. Sobrescribir con la FOTO_PERFIL más reciente (la primera por created_at desc)
  // Solo si aún no tiene una URL (preserva el orden de "más reciente primero")
  for (const foto of fotos) {
    if (!foto.conductor_id) continue;
    if (fotoMap.get(foto.conductor_id) === null || fotoMap.get(foto.conductor_id) === undefined) {
      const key = foto.s3_key || foto.ruta_archivo || null;
      fotoMap.set(foto.conductor_id, key);
    }
  }

  // 4. Generar URLs firmadas en paralelo. Si una falla, dejar null (no rompe la lista).
  const entries = Array.from(fotoMap.entries()).filter(([, key]) => !!key) as Array<[string, string]>;
  if (entries.length > 0) {
    const signed = await Promise.all(
      entries.map(([, key]) =>
        getS3SignedUrl(key).catch((err) => {
          console.error(`[conductores] Error firmando s3_key=${key}:`, err?.message || err);
          return null;
        }),
      ),
    );
    entries.forEach(([conductorId], i) => {
      fotoMap.set(conductorId, signed[i] ?? null);
    });
  }

  return fotoMap;
}

/**
 * Atacha `foto_signed_url` a un conductor usando el mapa pre-calculado.
 * Si el mapa no tiene el id, intenta generar la URL desde `foto_url` (fallback).
 */
async function attachFotoConductor(
  conductor: { id: string; foto_url?: string | null },
  fotoMap: Map<string, string | null>,
): Promise<string | null> {
  if (fotoMap.has(conductor.id)) {
    return fotoMap.get(conductor.id) ?? null;
  }
  // Fallback: si el mapa no tiene la entrada (caso borde), firmar foto_url directo
  if (conductor.foto_url) {
    try {
      return await getS3SignedUrl(conductor.foto_url);
    } catch {
      return null;
    }
  }
  return null;
}

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
          cargo: true,
          estado: true,
          sede_trabajo: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { nombre: "asc" },
        skip,
        take: limit,
      }),
      prisma.conductores.count({ where }),
    ]);

    // Batch: 1 sola query a `documento` + 1 a `conductores` (fallback) en vez
    // de N queries por conductor. Las URLs firmadas se generan en paralelo
    // después. Esto baja el request de ~6s+ a <1s incluso con 100+ conductores.
    const ids = conductores.map((c) => c.id).filter((id): id is string => !!id);
    const fotoMap = await obtenerFotosConductoresBatch(ids);

    const conductoresConFotos = await Promise.all(
      conductores.map(async (conductor) => ({
        ...conductor,
        foto_signed_url: await attachFotoConductor(conductor, fotoMap),
      })),
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

    // Reutiliza el mismo batch helper (con 1 solo id) para mantener
    // consistencia con `obtenerTodos` y compartir la lógica de fallback.
    const fotoMap = await obtenerFotosConductoresBatch([conductor.id]);
    const foto_signed_url = await attachFotoConductor(conductor, fotoMap);

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
