import { prisma } from "../../config/prisma";
import {
  type CreateRecargoDTO,
  type UpdateRecargoDTO,
} from "./recargos.schema";
import { randomUUID } from "crypto";
import PDFDocument from "pdfkit";


// Constantes de cálculo
const HORAS_LIMITE = {
  JORNADA_NORMAL: 10.33, // 10 horas 20 minutos - extras empiezan después de esto (día normal)
  JORNADA_FESTIVA: 7.33, // 7 horas 20 minutos - RD fijo en domingos/festivos, extras después de esto
  INICIO_NOCTURNO: 19, // 7pm
  FIN_NOCTURNO: 6,
};

// Empresas que NO reconocen RNDF (Recargo Nocturno Dominical/Festivo)
const EMPRESAS_SIN_RNDF = [
  "cfb258a6-448c-4469-aa71-8eeafa4530ef", // PAREX RESOURCES (COLOMBIA) AG SUCURSAL
];

interface RecargosCalculados {
  hed: number;
  hen: number;
  hefd: number;
  hefn: number;
  rndf: number;
  rn: number;
  rd: number;
}

// Función para calcular recargos de un día
// Lógica unificada: cada hora se clasifica como ordinaria vs extra, y nocturna vs diurna
// - Jornada ordinaria domingo/festivo: nocturnas → RNDF, diurnas → RD
// - Horas extras domingo/festivo: nocturnas → HEFN, diurnas → HEFD
// - Jornada ordinaria día normal: nocturnas → RN, diurnas → sin recargo
// - Horas extras día normal: nocturnas → HEN, diurnas → HED
function calcularRecargosDia(
  hora_inicio: number,
  hora_fin: number,
  total_horas: number,
  es_domingo_o_festivo: boolean,
  excluirRNDF: boolean = false,
): RecargosCalculados {
  let hed = 0,
    hen = 0,
    hefd = 0,
    hefn = 0,
    rndf = 0,
    rn = 0,
    rd = 0;

  if (total_horas <= 0) {
    return { hed, hen, hefd, hefn, rndf, rn, rd };
  }

  // Determinar jornada ordinaria - extras SIEMPRE empiezan después de 10.33h
  const jornadaOrdinaria = HORAS_LIMITE.JORNADA_NORMAL;

  // Función helper para verificar si una hora es nocturna (19:00-06:00)
  function esNocturna(hora: number): boolean {
    const h = hora % 24;
    return h >= HORAS_LIMITE.INICIO_NOCTURNO || h < HORAS_LIMITE.FIN_NOCTURNO;
  }

  // Recorrer cada fracción de hora y clasificarla
  let horaActual = hora_inicio;
  let horasAcumuladas = 0;

  while (horaActual < hora_fin) {
    const siguienteHora = Math.min(horaActual + 0.5, hora_fin);
    const fraccion = siguienteHora - horaActual;
    const nocturna = esNocturna(horaActual);
    const esExtra = horasAcumuladas >= jornadaOrdinaria;

    if (es_domingo_o_festivo) {
      if (esExtra) {
        // Horas extras en domingo/festivo
        if (nocturna) {
          hefn += fraccion;
        } else {
          hefd += fraccion;
        }
      } else {
        // Jornada ordinaria en domingo/festivo
        const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas;
        if (fraccion <= horasRestantesJornada) {
          if (nocturna) {
            rndf += fraccion;
          } else {
            rd += fraccion;
          }
        } else {
          // Parte es jornada ordinaria, parte es extra
          const parteOrdinaria = horasRestantesJornada;
          const parteExtra = fraccion - parteOrdinaria;
          if (nocturna) {
            rndf += parteOrdinaria;
            hefn += parteExtra;
          } else {
            rd += parteOrdinaria;
            hefd += parteExtra;
          }
        }
      }
    } else {
      // Día normal
      if (esExtra) {
        if (nocturna) {
          hen += fraccion;
        } else {
          hed += fraccion;
        }
      } else {
        const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas;
        if (fraccion <= horasRestantesJornada) {
          if (nocturna) {
            rn += fraccion;
          }
          // Diurna ordinaria en día normal = no genera recargo
        } else {
          const parteOrdinaria = horasRestantesJornada;
          const parteExtra = fraccion - parteOrdinaria;
          if (nocturna) {
            rn += parteOrdinaria;
            hen += parteExtra;
          } else {
            hed += parteExtra;
          }
        }
      }
    }

    horasAcumuladas += fraccion;
    horaActual = siguienteHora;
  }

  // En domingo/festivo:
  // RNDF = TODAS las horas nocturnas del turno (ordinarias + extras)
  // RD = 7.33 - RNDF (las nocturnas se restan del dominical)
  // PAREX no reconoce RNDF, así que no se resta
  // ✅ POR ESTO:
  if (es_domingo_o_festivo) {
    const INICIO_RNDF = 19;

    let rdRecalc = 0;
    let rndfRecalc = 0;
    let horasAcum = 0;

    let h = hora_inicio;
    while (h < hora_fin) {
      const sig = Math.min(h + 0.5, hora_fin);
      const fraccion = sig - h;
      const hora = h % 24;

      if (horasAcum < jornadaOrdinaria) {
        const aAgregar = Math.min(fraccion, jornadaOrdinaria - horasAcum);
        const esRNDF = hora >= INICIO_RNDF || hora < HORAS_LIMITE.FIN_NOCTURNO;

        if (esRNDF) rndfRecalc += aAgregar;
        else rdRecalc += aAgregar;
      }

      horasAcum += fraccion;
      h = sig;
    }

    if (!excluirRNDF) {
      rndf = redondear(rndfRecalc);
      rd = redondear(
        Math.min(rdRecalc, HORAS_LIMITE.JORNADA_FESTIVA - rndfRecalc),
      );
    } else {
      // PAREX: no reconoce RNDF, todo va a RD
      rndf = 0;
      rd = redondear(
        Math.min(rdRecalc + rndfRecalc, HORAS_LIMITE.JORNADA_FESTIVA),
      );
    }
  }

  return {
    hed: Math.round(hed * 100) / 100,
    hen: Math.round(hen * 100) / 100,
    hefd: Math.round(hefd * 100) / 100,
    hefn: Math.round(hefn * 100) / 100,
    rndf: Math.round(rndf * 100) / 100,
    rn: Math.round(rn * 100) / 100,
    rd: Math.round(rd * 100) / 100,
  };
}

/**
 * Pre-procesa el array de días laborales para manejar `continua_siguiente_dia`.
 * Si un día tiene continua_siguiente_dia=true, se combinan sus horas con el día siguiente
 * y el día siguiente se marca para no generar recargos propios (como si fuera disponibilidad).
 * Retorna un Map: diaIndex → recargos calculados (ya con la lógica de merge).
 */
function calcularRecargosConContinuacion(
  diasLaborales: any[],
): Map<number, RecargosCalculados> {
  const resultados = new Map<number, RecargosCalculados>();
  const diasMerged = new Set<number>(); // Indices de días que ya fueron absorbidos

  for (let i = 0; i < diasLaborales.length; i++) {
    const dia = diasLaborales[i];

    // Si este día ya fue absorbido por el anterior, retornar ceros
    if (diasMerged.has(i)) {
      resultados.set(i, {
        hed: 0,
        hen: 0,
        hefd: 0,
        hefn: 0,
        rndf: 0,
        rn: 0,
        rd: 0,
      });
      continue;
    }

    // Si está disponible, ceros
    if (dia.disponibilidad) {
      resultados.set(i, {
        hed: 0,
        hen: 0,
        hefd: 0,
        hefn: 0,
        rndf: 0,
        rn: 0,
        rd: 0,
      });
      continue;
    }

    const hora_inicio = dia.hora_inicio || 0;
    let hora_fin = dia.hora_fin || 0;
    const es_domingo_o_festivo = dia.es_domingo || dia.es_festivo;

    // Si continua al siguiente día, combinar horas
    if (dia.continua_siguiente_dia && i < diasLaborales.length - 1) {
      const siguiente = diasLaborales[i + 1];
      if (siguiente && !siguiente.disponibilidad) {
        const horasNextDia =
          (siguiente.hora_fin || 0) - (siguiente.hora_inicio || 0);
        if (horasNextDia > 0) {
          hora_fin = hora_fin + horasNextDia;
          diasMerged.add(i + 1); // Marcar el siguiente como absorbido
          console.log(
            `📊 [MERGE] Día ${dia.dia} continúa al día ${siguiente.dia}: hora_fin extendida a ${hora_fin}`,
          );
        }
      }
    }

    const total_horas = hora_fin - hora_inicio;
    const recargos = calcularRecargosDia(
      hora_inicio,
      hora_fin,
      total_horas,
      es_domingo_o_festivo,
    );
    resultados.set(i, recargos);
  }

  return resultados;
}

function buildBulkDias(
  diasLaborales: any[],
  recargoPlanillaId: string,
  tiposMap: Map<string, string>,
  userId: string | undefined,
  now: Date,
) {
  const recargosMap = calcularRecargosConContinuacion(diasLaborales);
 
  const diasRows: any[] = [];
  const detallesRows: any[] = [];
 
  for (let idx = 0; idx < diasLaborales.length; idx++) {
    const dia = diasLaborales[idx];
    const hora_inicio = dia.hora_inicio || 0;
    const hora_fin = dia.hora_fin || 0;
    const total_horas = dia.total_horas || 0;
 
    const recargos = recargosMap.get(idx) ?? {
      hed: 0, hen: 0, hefd: 0, hefn: 0, rndf: 0, rn: 0, rd: 0,
    };
 
    const diaId = randomUUID();
 
    diasRows.push({
      id: diaId,
      recargo_planilla_id: recargoPlanillaId,
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
      continua_siguiente_dia: dia.continua_siguiente_dia || false,
      observaciones: dia.observaciones,
      creado_por_id: userId,
      created_at: now,
      updated_at: now,
    });
 
    // Detalles de recargo para este día
    const tiposConValor: Array<[string, number]> = [
      ["HED", recargos.hed],
      ["HEN", recargos.hen],
      ["HEFD", recargos.hefd],
      ["HEFN", recargos.hefn],
      ["RN", recargos.rn],
      ["RD", recargos.rd],
      ["RNDF", recargos.rndf],
    ];
 
    for (const [codigo, horas] of tiposConValor) {
      if (horas > 0 && tiposMap.has(codigo)) {
        detallesRows.push({
          id: randomUUID(),
          dia_laboral_id: diaId,
          tipo_recargo_id: tiposMap.get(codigo)!,
          horas,
          creado_por_id: userId,
          created_at: now,
          updated_at: now,
        });
      }
    }
  }
 
  return { diasRows, detallesRows };
}

export function redondear(numero: number, decimales = 2): number {
  const factor = Math.pow(10, decimales);
  return Math.round(numero * factor) / factor;
}

export const RecargosService = {
  // Listar recargos con filtros (para canvas)
  async list(page: number, limit: number, filters: any) {
    const skip = (page - 1) * limit;

    const where: any = {
      deleted_at: filters.eliminados ? { not: null } : null,
    };

    if (filters.mes) where.mes = parseInt(filters.mes);
    if (filters.año) where.a_o = parseInt(filters.año);
    if (filters.conductor_id) where.conductor_id = filters.conductor_id;
    if (filters.vehiculo_id) where.vehiculo_id = filters.vehiculo_id;
    if (filters.empresa_id) where.empresa_id = filters.empresa_id;
    if (filters.estado) where.estado = filters.estado;
    if (filters.numero_planilla) {
      where.numero_planilla = {
        contains: filters.numero_planilla,
        mode: "insensitive",
      };
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
              foto_url: true,
            },
          },
          vehiculos: {
            select: {
              id: true,
              placa: true,
              marca: true,
              modelo: true,
            },
          },
          clientes: {
            select: {
              id: true,
              nombre: true,
            },
          },
          dias_laborales_planillas: {
            where: { deleted_at: filters.eliminados ? { not: null } : null },
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
                where: {
                  deleted_at: filters.eliminados ? { not: null } : null,
                  activo: true,
                },
                include: {
                  tipos_recargos: {
                    select: {
                      id: true,
                      codigo: true,
                      nombre: true,
                      porcentaje: true,
                    },
                  },
                },
              },
            },
            orderBy: { dia: "asc" },
          },
          servicio: {
            select: {
              id: true,
              fecha_realizacion: true,
              fecha_solicitud: true,
            },
          },
        },
        orderBy: [{ created_at: "desc" }],
      }),
      prisma.recargos_planillas.count({ where }),
    ]);

    // Calcular totales por cada recargo
    const recargosConTotales = recargos.map((recargo) => {
      const totales = {
        total_hed: 0,
        total_hen: 0,
        total_hefd: 0,
        total_hefn: 0,
        total_rndf: 0,
        total_rn: 0,
        total_rd: 0,
        total_horas: 0,
        total_dias: 0,
      };

      recargo.dias_laborales_planillas.forEach((dia) => {
        totales.total_horas += Number(dia.total_horas) || 0;
        totales.total_dias += 1;

        dia.detalles_recargos_dias.forEach((detalle) => {
          const codigo = detalle.tipos_recargos.codigo.toLowerCase();
          const horas = Number(detalle.horas) || 0;

          switch (codigo) {
            case "hed":
              totales.total_hed += horas;
              break;
            case "hen":
              totales.total_hen += horas;
              break;
            case "hefd":
              totales.total_hefd += horas;
              break;
            case "hefn":
              totales.total_hefn += horas;
              break;
            case "rndf":
              totales.total_rndf += horas;
              break;
            case "rn":
              totales.total_rn += horas;
              break;
            case "rd":
              totales.total_rd += horas;
              break;
          }
        });
      });

      // Mapear nombres de relaciones para que coincidan con el frontend
      return {
        ...recargo,
        ...totales,
        conductor: recargo.conductores,
        vehiculo: recargo.vehiculos,
        empresa: recargo.clientes,
        dias_laborales: recargo.dias_laborales_planillas,
        tiene_documento: !!recargo.planilla_s3key,
      };
    });

    return {
      recargos: recargosConTotales,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  // Obtener un recargo por ID
  async findById(id: string) {
    const recargo = await prisma.recargos_planillas.findUnique({
      where: { id },
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
        servicio: {
          include: {
            municipios_servicio_origen_idTomunicipios: true,
            municipios_servicio_destino_idTomunicipios: true,
            clientes: {
              select: { id: true, nombre: true, nit: true },
            },
          },
        },
        dias_laborales_planillas: {
          where: { deleted_at: null },
          include: {
            detalles_recargos_dias: {
              where: { deleted_at: null, activo: true },
              include: {
                tipos_recargos: true,
              },
            },
          },
          orderBy: { dia: "asc" },
        },
        users_recargos_planillas_creado_por_idTousers: {
          select: {
            id: true,
            nombre: true,
          },
        },
        users_recargos_planillas_actualizado_por_idTousers: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
    });

    if (!recargo) {
      throw new Error("Recargo no encontrado");
    }

    return {
      ...recargo,
      conductor: recargo.conductores,
      conductores: undefined, // opcional quitarlom
      vehiculo: recargo.vehiculos,
      vehiculos: undefined,
    };
  },

  // Helper: Determinar estado del servicio basado en días laborales
  _determinarEstadoServicio(
    diasLaborales: { dia: number }[],
    mes: number,
    año: number,
  ): string {
    if (!diasLaborales || diasLaborales.length === 0) {
      return "solicitado";
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const hoyTime = hoy.getTime();

    const dias = diasLaborales.map((d) => {
      const fecha = new Date(año, mes - 1, d.dia);
      fecha.setHours(0, 0, 0, 0);
      return fecha.getTime();
    });

    const maxDia = Math.max(...dias);
    const minDia = Math.min(...dias);
    const incluyeHoy = dias.some((d) => d === hoyTime);

    if (maxDia < hoyTime) {
      // Todos los días son anteriores a hoy → realizado
      return "realizado";
    } else if (incluyeHoy || (minDia <= hoyTime && maxDia >= hoyTime)) {
      // Incluye el día actual o mezcla pasados y futuros → en_curso
      return "en_curso";
    } else {
      // Solo días futuros → planificado
      return "planificado";
    }
  },

  // Helper: normalizar propósito del servicio
  _normalizarProposito(proposito: string | null | undefined): any {
    if (!proposito) return "personal";
    if (proposito === "personal y herramienta") return "personal_y_herramienta";
    return proposito;
  },

   
  // ─────────────────────────────────────────────
  // CREATE — optimizado
  // ─────────────────────────────────────────────
  async create(data: CreateRecargoDTO, userId?: string) {
    const now = new Date();
   
    // 1. Cargar tipos_recargo UNA sola vez (fuera de la tx porque es solo lectura)
    const tiposRecargo = await prisma.tipos_recargos.findMany({ where: { activo: true } });
    const tiposMap = new Map(tiposRecargo.map((t) => [t.codigo, t.id]));
   
    // 2. Todo en una sola transacción interactiva
    const recargo = await prisma.$transaction(async (tx) => {
   
      // 2a. Crear servicio si hace falta (una sola escritura condicional)
      let servicioId = data.servicio_id ?? null;
      if (!servicioId && data.servicio_origen_id && data.servicio_destino_id) {
        const estadoServicio = this._determinarEstadoServicio(
          data.dias_laborales || [],
          data.mes,
          data.año,
        );
        const nuevoServicio = await tx.servicio.create({
          data: {
            id: randomUUID(),
            cliente_id: data.empresa_id,
            conductor_id: data.conductor_id,
            vehiculo_id: data.vehiculo_id,
            origen_id: data.servicio_origen_id,
            destino_id: data.servicio_destino_id,
            origen_especifico: data.servicio_origen_especifico || "",
            destino_especifico: data.servicio_destino_especifico || "",
            origen_latitud: data.servicio_origen_latitud,
            origen_longitud: data.servicio_origen_longitud,
            destino_latitud: data.servicio_destino_latitud,
            destino_longitud: data.servicio_destino_longitud,
            observaciones: data.servicio_observaciones,
            proposito_servicio: this._normalizarProposito(data.servicio_proposito) as any,
            estado: estadoServicio as any,
            fecha_solicitud: now,
            fecha_realizacion: data.servicio_fecha_realizacion
              ? new Date(data.servicio_fecha_realizacion)
              : undefined,
            valor: 0,
            created_at: now,
            updated_at: now,
          },
        });
        servicioId = nuevoServicio.id;
      }
   
      // 2b. Crear el recargo principal
      const recargoId = randomUUID();
      await tx.recargos_planillas.create({
        data: {
          id: recargoId,
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id,
          empresa_id: data.empresa_id,
          numero_planilla: data.numero_planilla,
          mes: data.mes,
          a_o: data.año,
          observaciones: data.observaciones,
          estado: "pendiente",
          version: 1,
          creado_por_id: userId,
          created_at: now,
          updated_at: now,
          servicio_id: servicioId,
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
        } as any,
      });
   
      // 2c. Construir filas en memoria (sin I/O)
      const { diasRows, detallesRows } = buildBulkDias(
        data.dias_laborales || [],
        recargoId,
        tiposMap,
        userId,
        now,
      );
   
      // 2d. Insertar días y detalles en solo 2 queries (createMany)
      if (diasRows.length > 0) {
        await tx.dias_laborales_planillas.createMany({ data: diasRows });
      }
      if (detallesRows.length > 0) {
        await tx.detalles_recargos_dias.createMany({ data: detallesRows });
      }
   
      return recargoId;
    });
   
    // 3. Actualizar totales (fuera de la tx para no bloquearla más)
    await this.actualizarTotales(recargo);
   
    return this.findById(recargo);
  },

  // ─────────────────────────────────────────────
// UPDATE — optimizado
// ─────────────────────────────────────────────
async  update(id: string, data: UpdateRecargoDTO, userId?: string) {
  const now = new Date();
 
  // 1. Leer recargo existente + tipos_recargo en paralelo (2 queries simultáneos)
  const [recargoExistente, tiposRecargo] = await Promise.all([
    prisma.recargos_planillas.findUnique({ where: { id } }),
    prisma.tipos_recargos.findMany({ where: { activo: true } }),
  ]);
 
  if (!recargoExistente) throw new Error("Recargo no encontrado");
 
  const tiposMap = new Map(tiposRecargo.map((t) => [t.codigo, t.id]));
 
  // 2. Construir updateData en memoria
  const updateData: any = {
    actualizado_por_id: userId,
    version: { increment: 1 },
    updated_at: now,
  };
 
  const camposEscalares: (keyof UpdateRecargoDTO)[] = [
    "numero_planilla", "observaciones", "estado", "mes",
    "conductor_id", "vehiculo_id", "empresa_id", "servicio_id",
    "estado_conductor", "via_trocha", "via_afirmado", "via_mixto",
    "via_pavimentada", "riesgo_desniveles", "riesgo_deslizamientos",
    "riesgo_sin_senalizacion", "riesgo_animales", "riesgo_peatones",
    "riesgo_trafico_alto", "fuente_consulta", "calificacion_servicio",
    "tiempo_disponibilidad_horas", "duracion_trayecto_horas", "numero_dias_servicio",
  ];
 
  for (const campo of camposEscalares) {
    if (data[campo] !== undefined) {
      // año → a_o mapping especial
      updateData[campo === "año" ? "a_o" : campo] = data[campo];
    }
  }
  if (data.año !== undefined) updateData.a_o = data.año;
 
  // 3. Transacción única para todo
  await prisma.$transaction(async (tx) => {
 
    // 3a. Servicio (crear o actualizar) — condicional
    const tieneServicioData = data.servicio_origen_id && data.servicio_destino_id;
    if (tieneServicioData) {
      const mesRecargo = data.mes ?? recargoExistente.mes;
      const añoRecargo = data.año ?? recargoExistente.a_o;
      const estadoServicio = this._determinarEstadoServicio(
        data.dias_laborales || [],
        mesRecargo,
        añoRecargo,
      );
      const servicioData: any = {
        origen_id: data.servicio_origen_id,
        destino_id: data.servicio_destino_id,
        origen_especifico: data.servicio_origen_especifico || "",
        destino_especifico: data.servicio_destino_especifico || "",
        origen_latitud: data.servicio_origen_latitud,
        origen_longitud: data.servicio_origen_longitud,
        destino_latitud: data.servicio_destino_latitud,
        destino_longitud: data.servicio_destino_longitud,
        observaciones: data.servicio_observaciones,
        proposito_servicio: this._normalizarProposito(data.servicio_proposito) as any,
        estado: estadoServicio as any,
        conductor_id: data.conductor_id || recargoExistente.conductor_id,
        vehiculo_id: data.vehiculo_id || recargoExistente.vehiculo_id,
        fecha_realizacion: data.servicio_fecha_realizacion
          ? new Date(data.servicio_fecha_realizacion)
          : undefined,
        updated_at: now,
      };
 
      if (recargoExistente.servicio_id) {
        await tx.servicio.update({ where: { id: recargoExistente.servicio_id }, data: servicioData });
      } else {
        const nuevoServicio = await tx.servicio.create({
          data: {
            id: randomUUID(),
            cliente_id: data.empresa_id || recargoExistente.empresa_id,
            fecha_solicitud: now,
            valor: 0,
            created_at: now,
            ...servicioData,
          },
        });
        updateData.servicio_id = nuevoServicio.id;
      }
    }
 
    // 3b. Actualizar recargo principal
    await tx.recargos_planillas.update({ where: { id }, data: updateData });
 
    // 3c. Días laborales — reemplazar en bulk
    if (data.dias_laborales && data.dias_laborales.length > 0) {
      // DELETE existentes (cascade elimina detalles)
      await tx.dias_laborales_planillas.deleteMany({ where: { recargo_planilla_id: id } });
 
      // Construir filas en memoria
      const { diasRows, detallesRows } = buildBulkDias(
        data.dias_laborales,
        id,
        tiposMap,
        userId,
        now,
      );
 
      // 2 queries para insertar todo
      if (diasRows.length > 0) {
        await tx.dias_laborales_planillas.createMany({ data: diasRows });
      }
      if (detallesRows.length > 0) {
        await tx.detalles_recargos_dias.createMany({ data: detallesRows });
      }
    }
  });
 
  // 4. Totales fuera de la tx
  await this.actualizarTotales(id);
 
  return this.findById(id);
},
 

  // Liquidar recargo
  async liquidar(id: string, userId?: string) {
    const recargo = await prisma.recargos_planillas.update({
      where: { id },
      data: {
        estado: "liquidada",
        actualizado_por_id: userId,
        version: { increment: 1 },
      },
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
      },
    });

    return recargo;
  },

  // Duplicar recargo
  async duplicar(id: string, userId?: string) {
    const original = await this.findById(id);

    const nuevoRecargo = await this.create(
      {
        conductor_id: original.conductor_id,
        vehiculo_id: original.vehiculo_id,
        empresa_id: original.empresa_id,
        numero_planilla: original.numero_planilla
          ? `${original.numero_planilla}-COPIA`
          : null,
        mes: original.mes,
        año: original.a_o,
        observaciones: original.observaciones,
        dias_laborales: original.dias_laborales_planillas.map((dia) => ({
          dia: dia.dia,
          hora_inicio: Number(dia.hora_inicio),
          hora_fin: Number(dia.hora_fin),
          total_horas: Number(dia.total_horas),
          es_festivo: dia.es_festivo,
          es_domingo: dia.es_domingo,
          kilometraje_inicial: dia.kilometraje_inicial
            ? Number(dia.kilometraje_inicial)
            : null,
          kilometraje_final: dia.kilometraje_final
            ? Number(dia.kilometraje_final)
            : null,
          pernocte: dia.pernocte,
          disponibilidad: dia.disponibilidad,
          continua_siguiente_dia: dia.continua_siguiente_dia || false,
          observaciones: dia.observaciones,
        })),
      },
      userId,
    );

    return nuevoRecargo;
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
          },
        },
      },
    });

    if (!recargo) return;

    const total_dias_laborados = recargo.dias_laborales_planillas.length;
    const total_horas_trabajadas = recargo.dias_laborales_planillas.reduce(
      (sum, dia) => sum + Number(dia.total_horas),
      0,
    );
    const total_horas_ordinarias = recargo.dias_laborales_planillas.reduce(
      (sum, dia) => sum + Number(dia.horas_ordinarias),
      0,
    );

    await prisma.recargos_planillas.update({
      where: { id: recargoId },
      data: {
        total_dias_laborados,
        total_horas_trabajadas,
        total_horas_ordinarias,
      },
    });
  },

  // Obtener tipos de recargo activos
  async getTiposRecargo() {
    return prisma.tipos_recargos.findMany({
      where: { activo: true },
      orderBy: { codigo: "asc" },
    });
  },

  // Obtener estadísticas
  async getEstadisticas(filters: any) {
    const where: any = { deleted_at: null };

    if (filters.mes) where.mes = parseInt(filters.mes);
    if (filters.año) where.a_o = parseInt(filters.año);
    if (filters.empresa_id) where.empresa_id = filters.empresa_id;

    const [total, porEstado] = await Promise.all([
      prisma.recargos_planillas.count({ where }),
      prisma.recargos_planillas.groupBy({
        by: ["estado"],
        where,
        _count: true,
      }),
    ]);

    return {
      total,
      por_estado: porEstado.map((e) => ({
        estado: e.estado,
        cantidad: e._count,
      })),
    };
  },

  // Soft delete de recargo
  async softDelete(id: string, userId?: string) {
    const now = new Date();

    // Verificar que el recargo existe y no está eliminado
    const recargo = await prisma.recargos_planillas.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!recargo) {
      throw new Error("Recargo no encontrado o ya está eliminado");
    }

    // Soft delete del recargo (cascade soft delete en días laborales y detalles)
    await prisma.$transaction([
      // Marcar detalles de recargos como eliminados
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: {
            in: (
              await prisma.dias_laborales_planillas.findMany({
                where: { recargo_planilla_id: id },
                select: { id: true },
              })
            ).map((d) => d.id),
          },
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Marcar días laborales como eliminados
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: id,
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Marcar recargo como eliminado
      prisma.recargos_planillas.update({
        where: { id },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),
    ]);

    return { success: true, message: "Recargo eliminado correctamente" };
  },

  // Soft delete múltiple de recargos
  async softDeleteMany(ids: string[], userId?: string) {
    const now = new Date();

    // Verificar que todos los recargos existen y no están eliminados
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        id: { in: ids },
        deleted_at: null,
      },
      select: { id: true },
    });

    if (recargos.length === 0) {
      throw new Error("No se encontraron recargos válidos para eliminar");
    }

    const validIds = recargos.map((r) => r.id);

    // Obtener todos los IDs de días laborales
    const diasLaboralesIds = (
      await prisma.dias_laborales_planillas.findMany({
        where: { recargo_planilla_id: { in: validIds } },
        select: { id: true },
      })
    ).map((d) => d.id);

    // Soft delete en cascada
    await prisma.$transaction([
      // Marcar detalles de recargos como eliminados
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: { in: diasLaboralesIds },
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Marcar días laborales como eliminados
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: { in: validIds },
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Marcar recargos como eliminados
      prisma.recargos_planillas.updateMany({
        where: {
          id: { in: validIds },
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),
    ]);

    return {
      success: true,
      message: `${validIds.length} recargo(s) eliminado(s) correctamente`,
      eliminados: validIds.length,
    };
  },

  // Restaurar recargo (quitar soft delete)
  async restored(id: string, userId?: string) {
    const now = new Date();

    // Verificar que el recargo existe y está eliminado
    const recargo = await prisma.recargos_planillas.findFirst({
      where: {
        id,
        deleted_at: {
          not: null,
        },
      },
    });

    if (!recargo) {
      throw new Error("Recargo no encontrado o ya está restaurado");
    }

    // Obtener IDs de días laborales eliminados del recargo
    const diasLaboralesIds = (
      await prisma.dias_laborales_planillas.findMany({
        where: { recargo_planilla_id: id },
        select: { id: true },
      })
    ).map((d) => d.id);

    // Restaurar en cascada
    await prisma.$transaction([
      // Restaurar detalles de recargos
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: { in: diasLaboralesIds },
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Restaurar días laborales
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: id,
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Restaurar recargo
      prisma.recargos_planillas.update({
        where: { id },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),
    ]);

    return { success: true, message: "Recargo restaurado correctamente" };
  },

  // Restaurar múltiples recargos (quitar soft delete)
  async restoredMany(ids: string[], userId?: string) {
    const now = new Date();

    // Verificar que todos los recargos existen y están eliminados
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        id: { in: ids },
        deleted_at: { not: null },
      },
      select: { id: true },
    });

    if (recargos.length === 0) {
      throw new Error("No se encontraron recargos válidos para restaurar");
    }

    const validIds = recargos.map((r) => r.id);

    // Obtener todos los IDs de días laborales
    const diasLaboralesIds = (
      await prisma.dias_laborales_planillas.findMany({
        where: { recargo_planilla_id: { in: validIds } },
        select: { id: true },
      })
    ).map((d) => d.id);

    // Restaurar en cascada
    await prisma.$transaction([
      // Restaurar detalles de recargos
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: { in: diasLaboralesIds },
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Restaurar días laborales
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: { in: validIds },
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Restaurar recargos
      prisma.recargos_planillas.updateMany({
        where: {
          id: { in: validIds },
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),
    ]);

    return {
      success: true,
      message: `${validIds.length} recargo(s) restaurado(s) correctamente`,
      restaurados: validIds.length,
    };
  },

  async cambiarEstadoMultiple(ids: string[], estado: string, userId?: string) {
    const now = new Date();

    // Verificar que todos los recargos existen y no están eliminados
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        id: { in: ids },
        deleted_at: null,
      },
      select: { id: true, estado: true },
    });

    if (recargos.length === 0) {
      throw new Error("No se encontraron recargos válidos para actualizar");
    }

    const validIds = recargos.map((r) => r.id);

    // Actualizar estado de todos los recargos válidos
    await prisma.recargos_planillas.updateMany({
      where: {
        id: { in: validIds },
        deleted_at: null,
      },
      data: {
        estado: estado as any,
        actualizado_por_id: userId,
        updated_at: now,
      },
    });

    return {
      success: true,
      message: `${validIds.length} recargo(s) actualizado(s) al estado "${estado}"`,
      actualizados: validIds.length,
      estado,
    };
  },

  async reporteServiciosporPlaca(mes: string, año: string) {
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        deleted_at: null,
        mes: parseInt(mes),
        a_o: parseInt(año),
        conductores: {
          nomina: true, // 👈 filtro aquí
        },
      },
      select: {
        conductores: {
          select: {
            nombre: true,
            apellido: true,
            numero_identificacion: true,
          },
        },
        vehiculos: {
          select: { placa: true },
        },
        clientes: {
          select: { nombre: true },
        },
        dias_laborales_planillas: {
          where: { deleted_at: null },
          orderBy: { dia: "asc" },
          select: { dia: true },
        },
      },
    });

    return recargos;
  },
};
interface RecargoRow {
  conductores: {
    nombre: string;
    apellido: string;
    numero_identificacion: string;
  };
  vehiculos: { placa: string };
  clientes: { nombre: string };
  dias_laborales_planillas: { dia: Date | string }[];
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════

const MESES: Record<number, string> = {
  1: "Enero",
  2: "Febrero",
  3: "Marzo",
  4: "Abril",
  5: "Mayo",
  6: "Junio",
  7: "Julio",
  8: "Agosto",
  9: "Septiembre",
  10: "Octubre",
  11: "Noviembre",
  12: "Diciembre",
};

const C = {
  HEADER_BG: "#1E3A5F",
  HEADER_TEXT: "#FFFFFF",
  ROW_EVEN: "#EAF0FB",
  ROW_ODD: "#FFFFFF",
  BORDER: "#B0BEC5",
  TOTAL_BG: "#D0E4F7",
  TOTAL_TEXT: "#1E3A5F",
  FOOTER: "#90A4AE",
};

// A4 en puntos
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2; // 523.28

// Columnas: Conductor | Placa | Servicios
const COL_CONDUCTOR = 210;
const COL_PLACA = 100;
const COL_SERVICIOS = 63; // ~63
const TABLE_W = COL_CONDUCTOR + COL_PLACA + COL_SERVICIOS; // 373 — ancho real de la tabla

const ROW_H = 20;
const TH_H = 22;
const HEADER_H = 36; // banda compacta 2 líneas
const TABLE_TOP = MARGIN + HEADER_H + 8;
const FOOTER_Y = PAGE_H - MARGIN - 18;
const USABLE_BOT = FOOTER_Y - 4;

// ═══════════════════════════════════════════════════════════════
// GENERADOR PDF
// ═══════════════════════════════════════════════════════════════

export function generarPDFReporteServicios(
  recargos: RecargoRow[],
  mes: string,
  anio: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // ── 1. Agrupación por conductor → placas ──────────────────
    const mapaGrupos = new Map<
      string,
      { conductor: string; placas: { placa: string; servicios: number }[] }
    >();

    for (const r of recargos) {
      const cedula = r.conductores.numero_identificacion;
      const nombre = `${r.conductores.nombre} ${r.conductores.apellido}`;
      const placa = r.vehiculos.placa;
      const dias = r.dias_laborales_planillas.length;

      if (!mapaGrupos.has(cedula)) {
        mapaGrupos.set(cedula, { conductor: nombre, placas: [] });
      }
      const grupo = mapaGrupos.get(cedula)!;
      const entry = grupo.placas.find((p) => p.placa === placa);
      if (entry) {
        entry.servicios += dias;
      } else {
        grupo.placas.push({ placa, servicios: dias });
      }
    }

    const grupos = Array.from(mapaGrupos.values()).sort((a, b) =>
      a.conductor.localeCompare(b.conductor, "es"),
    );
    grupos.forEach((g) =>
      g.placas.sort((a, b) => a.placa.localeCompare(b.placa)),
    );

    const totalServicios = grupos.reduce(
      (s, g) => s + g.placas.reduce((ps, p) => ps + p.servicios, 0),
      0,
    );

    const mesNombre = MESES[parseInt(mes)] ?? mes;
    const hoy = new Date().toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    // ── 2. Documento ───────────────────────────────────────────
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      info: {
        Title: `Reporte Servicios ${mesNombre} ${anio}`,
        Author: "Sistema de Gestión",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    // ── 3. Helpers ─────────────────────────────────────────────

    const drawHeader = () => {
      doc.rect(0, 0, PAGE_W, HEADER_H).fill(C.HEADER_BG);

      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor(C.HEADER_TEXT)
        .text(
          `REPORTE DE SERVICIOS POR PLACA Y CONDUCTOR  —  ${mesNombre.toUpperCase()} ${anio}`,
          MARGIN,
          9,
          { width: CONTENT_W, align: "left", lineBreak: false },
        );

      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor("#90CAF9")
        .text(`Generado el ${hoy}`, MARGIN, 22, {
          width: CONTENT_W,
          align: "left",
          lineBreak: false,
        });
    };

    const drawTableHeader = (y: number): number => {
      doc.rect(MARGIN, y, TABLE_W, TH_H).fill(C.HEADER_BG);

      const cols = [
        {
          label: "CONDUCTOR",
          x: MARGIN,
          w: COL_CONDUCTOR,
          align: "left" as const,
        },
        {
          label: "PLACA",
          x: MARGIN + COL_CONDUCTOR,
          w: COL_PLACA,
          align: "center" as const,
        },
        {
          label: "SERVICIOS",
          x: MARGIN + COL_CONDUCTOR + COL_PLACA,
          w: COL_SERVICIOS,
          align: "center" as const,
        },
      ];

      doc.font("Helvetica-Bold").fontSize(8).fillColor(C.HEADER_TEXT);
      for (const col of cols) {
        doc.text(col.label, col.x + 4, y + 7, {
          width: col.w - 8,
          align: col.align,
          lineBreak: false,
        });
      }
      return y + TH_H;
    };

    const SUB_H = 18; // alto del subheader de conductor

    /** Subheader con nombre del conductor — ocupa toda la fila */
    const drawConductorSubheader = (nombre: string, y: number) => {
      doc.rect(MARGIN, y, TABLE_W, SUB_H).fill("#E8EEF7");
      // Línea superior remarcada
      doc
        .moveTo(MARGIN, y)
        .lineTo(MARGIN + TABLE_W, y)
        .strokeColor("#1E3A5F")
        .lineWidth(1)
        .stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#1E3A5F")
        .text(nombre.toUpperCase(), MARGIN + 6, y + 5, {
          width: TABLE_W - 12,
          align: "left",
          lineBreak: false,
        });
    };

    /** Fila de placa/servicios (sin columna conductor) */
    const drawPlacaRow = (
      placa: string,
      servicios: number,
      y: number,
      idx: number,
    ) => {
      doc
        .rect(MARGIN, y, TABLE_W, ROW_H)
        .fill(idx % 2 === 0 ? C.ROW_ODD : C.ROW_EVEN);
      doc.font("Helvetica").fontSize(8).fillColor("#263238");
      // Celda conductor vacía (identación visual)
      doc.text("", MARGIN + 4, y + 5, {
        width: COL_CONDUCTOR - 8,
        lineBreak: false,
      });
      doc.text(placa, MARGIN + COL_CONDUCTOR + 4, y + 5, {
        width: COL_PLACA - 8,
        align: "center",
        lineBreak: false,
      });
      doc.text(
        String(servicios),
        MARGIN + COL_CONDUCTOR + COL_PLACA + 4,
        y + 5,
        { width: COL_SERVICIOS - 8, align: "center", lineBreak: false },
      );
      doc
        .moveTo(MARGIN, y + ROW_H)
        .lineTo(MARGIN + TABLE_W, y + ROW_H)
        .strokeColor(C.BORDER)
        .lineWidth(0.25)
        .stroke();
    };

    const drawTotalRow = (y: number) => {
      doc.rect(MARGIN, y, TABLE_W, ROW_H).fill(C.TOTAL_BG);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C.TOTAL_TEXT);
      doc.text("TOTAL", MARGIN + 4, y + 5, {
        width: COL_CONDUCTOR + COL_PLACA - 8,
        align: "right",
        lineBreak: false,
      });
      doc.text(
        String(totalServicios),
        MARGIN + COL_CONDUCTOR + COL_PLACA + 4,
        y + 5,
        { width: COL_SERVICIOS - 8, align: "center", lineBreak: false },
      );
    };

    const drawTableBorder = (yTop: number, yBot: number) => {
      doc
        .rect(MARGIN, yTop, TABLE_W, yBot - yTop)
        .strokeColor(C.BORDER)
        .lineWidth(0.5)
        .stroke();

      for (const offset of [COL_CONDUCTOR, COL_CONDUCTOR + COL_PLACA]) {
        doc
          .moveTo(MARGIN + offset, yTop)
          .lineTo(MARGIN + offset, yBot)
          .strokeColor(C.BORDER)
          .lineWidth(0.3)
          .stroke();
      }
    };

    const drawFooter = (pageNum: number, totalPages: number) => {
      doc
        .moveTo(MARGIN, FOOTER_Y)
        .lineTo(MARGIN + CONTENT_W, FOOTER_Y)
        .strokeColor(C.BORDER)
        .lineWidth(0.4)
        .stroke();

      doc.font("Helvetica").fontSize(7).fillColor(C.FOOTER);
      doc.text(
        "Sistema de Gestión  •  Documento generado automáticamente",
        MARGIN,
        FOOTER_Y + 4,
        { width: CONTENT_W * 0.7, align: "left", lineBreak: false },
      );
      doc.text(`Página ${pageNum} de ${totalPages}`, MARGIN, FOOTER_Y + 4, {
        width: CONTENT_W,
        align: "right",
        lineBreak: false,
      });
    };

    // ── 4. Renderizado ─────────────────────────────────────────
    drawHeader();

    let curY = TABLE_TOP;
    let tableTop = curY;
    curY = drawTableHeader(curY);
    let pageNum = 1;
    let rowIdx = 0; // para alternar color de filas globalmente

    const checkPage = (needed: number) => {
      if (curY + needed > USABLE_BOT) {
        drawTableBorder(tableTop, curY);
        doc.addPage();
        pageNum++;
        drawHeader();
        tableTop = TABLE_TOP;
        curY = drawTableHeader(tableTop);
      }
    };

    for (let gi = 0; gi < grupos.length; gi++) {
      const grupo = grupos[gi];
      const isLast = gi === grupos.length - 1;

      // Espacio mínimo: subheader + al menos 1 fila de placa (evitar huérfanos)
      checkPage(SUB_H + ROW_H);

      drawConductorSubheader(grupo.conductor, curY);
      curY += SUB_H;

      for (let pi = 0; pi < grupo.placas.length; pi++) {
        const p = grupo.placas[pi];
        const isLastPlaca = pi === grupo.placas.length - 1;
        const spaceNeeded = ROW_H + (isLast && isLastPlaca ? ROW_H : 0);

        checkPage(spaceNeeded);
        drawPlacaRow(p.placa, p.servicios, curY, rowIdx++);
        curY += ROW_H;
      }
    }

    // Fila total global
    checkPage(ROW_H);
    drawTotalRow(curY);
    curY += ROW_H;
    drawTableBorder(tableTop, curY);

    // Footers con página real
    const totalPages = doc.bufferedPageRange().count;
    for (let p = 0; p < totalPages; p++) {
      doc.switchToPage(p);
      drawFooter(p + 1, totalPages);
    }

    doc.end();
  });
}
