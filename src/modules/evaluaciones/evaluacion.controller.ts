import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../config/prisma";
import { evaluacionSchema } from "./evaluacion.schema";
import { z } from "zod";
import { preguntaSchema } from "./evaluacion.schema";
import {
  calificarRespuestas,
  OpcionDesconocidaError,
  registrarResultado,
  respuestaPreguntaSchema,
  type TextosCalificados,
} from "./registrar-resultado";
import { getIo } from "../../sockets";
import { generarSopa, mismaSopa, type ConfigSopa } from "./sopa-letras";
import { Prisma } from "@prisma/client";
import { evaluacionSinClave } from "./evaluacion-publica";
import { EvaluacionPDFGeneratorService } from "./pdf-generator.service";
import archiver from "archiver";

// Esquema para registro de respuestas
const respuestaRegistroSchema = z.object({
  nombre_completo: z.string().min(1),
  numero_documento: z.string().min(1),
  cargo: z.string().min(1),
  correo: z.string().email(),
  telefono: z.string().min(1),
  firma: z.string().optional(),
  device_fingerprint: z.string().optional(),
  respuestas: z.array(respuestaPreguntaSchema),
});

/**
 * La configuración que se guarda para una pregunta. Solo la sopa de letras
 * la usa: se genera la cuadrícula al crear y se conserva al editar mientras
 * las palabras, el tamaño y las direcciones no cambien (así los trazos ya
 * registrados siguen apuntando a las mismas celdas).
 */
function configuracionDePregunta(
  p: { tipo?: string; configuracion?: any },
  anterior?: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (p.tipo !== "SOPA_LETRAS" || !p.configuracion) return Prisma.JsonNull;
  const previa = anterior as ConfigSopa | null | undefined;
  if (previa?.cuadricula?.length && mismaSopa(previa, p.configuracion)) {
    return previa as unknown as Prisma.InputJsonValue;
  }
  return generarSopa(p.configuracion) as unknown as Prisma.InputJsonValue;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EvaluacionesController = {
  async list(req: FastifyRequest<{ Querystring: {
      page?: string;
      limit?: string;
      search?: string;
      sortBy?: 'titulo' | 'created_at';
      sortOrder?: 'asc' | 'desc';
    } }>, res: FastifyReply) {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '10')));
    const search = req.query.search || '';
    /**
     * El tipo de `sortBy` en la firma es SOLO de compilación.
     *
     * En ejecución llega lo que mande el cliente y entraba tal cual en el
     * `orderBy` de Prisma: se podía ordenar por cualquier columna de la
     * tabla, y un nombre inventado reventaba la consulta. La ruta tampoco
     * tiene esquema que lo filtre, así que la comprobación va aquí.
     */
    const CAMPOS_ORDENABLES = new Set(['titulo', 'created_at']);
    const sortBy =
      req.query.sortBy && CAMPOS_ORDENABLES.has(req.query.sortBy)
        ? req.query.sortBy
        : 'created_at';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    const where: any = { deleted_at: null };

    if (search) {
      where.OR = [
        { titulo: { contains: search, mode: 'insensitive' } },
        { descripcion: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [total, evaluaciones] = await Promise.all([
      prisma.evaluacion.count({ where }),
      prisma.evaluacion.findMany({
        where,
        include: { preguntas: { include: { opciones: true } } },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return res.send({
      success: true,
      data: evaluaciones,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  },

  async findById(
    req: FastifyRequest<{ Params: { id: string } }>,
    res: FastifyReply,
  ) {
    const { id } = req.params;
    const evaluacion = await prisma.evaluacion.findUnique({
      where: { id },
      include: { preguntas: { include: { opciones: true } } },
    });
    if (!evaluacion)
      return res.status(404).send({ success: false, message: "No encontrada" });
    return res.send({ success: true, data: evaluacion });
  },

  /**
   * Evaluación para la página pública de respuesta, sin la clave de
   * respuestas. La ruta de arriba la devuelve completa y es solo para el
   * dashboard; quien responde ve las correctas en el resultado de
   * `responder` / `verificar`, después de enviar.
   */
  async findPublic(
    req: FastifyRequest<{ Params: { id: string } }>,
    res: FastifyReply,
  ) {
    const { id } = req.params;
    // La columna es uuid: un id malformado haría fallar la consulta con 500
    const evaluacion = UUID_RE.test(id)
      ? await prisma.evaluacion.findFirst({
          where: { id, deleted_at: null },
          include: { preguntas: { include: { opciones: true } } },
        })
      : null;
    if (!evaluacion)
      return res.status(404).send({ success: false, message: "No encontrada" });
    return res.send({ success: true, data: evaluacionSinClave(evaluacion) });
  },

  async create(req: FastifyRequest, res: FastifyReply) {
    const parsed = evaluacionSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .send({ success: false, errors: parsed.error.errors });
    const { titulo, descripcion, requiere_firma, preguntas } = parsed.data;
    let configuraciones: (Prisma.InputJsonValue | typeof Prisma.JsonNull)[];
    try {
      configuraciones = preguntas.map((p) => configuracionDePregunta(p));
    } catch (error: any) {
      return res.status(400).send({ success: false, message: error.message });
    }
    const evaluacion = await prisma.evaluacion.create({
      data: {
        titulo,
        descripcion,
        requiere_firma,
        preguntas: {
          create: preguntas.map((p: any, i: number) => ({
            texto: p.texto,
            tipo: p.tipo,
            puntaje: p.puntaje,
            opciones: p.opciones ? { create: p.opciones } : undefined,
            relacionIzq: p.relacionIzq || [],
            relacionDer: p.relacionDer || [],
            respuestaCorrecta: p.respuestaCorrecta,
            configuracion: configuraciones[i],
          })),
        },
      },
      include: { preguntas: { include: { opciones: true } } },
    });
    return res.send({ success: true, data: evaluacion });
  },

  async update(
    req: FastifyRequest<{ Params: { id: string } }>,
    res: FastifyReply,
  ) {
    const { id } = req.params;
    const parsed = evaluacionSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .send({ success: false, errors: parsed.error.errors });

    const { titulo, descripcion, requiere_firma, preguntas } = parsed.data;

    // Obtener preguntas actuales para comparar
    const preguntasActuales = await prisma.pregunta.findMany({
      where: { evaluacionId: id },
      include: { opciones: true },
    });

    const idsActuales = preguntasActuales.map((p) => p.id);
    const idsEnviados = preguntas.filter((p) => p.id).map((p) => p.id!);

    // Preguntas que ya no están en la lista → eliminar (cascade borra respuestas asociadas)
    const idsAEliminar = idsActuales.filter(
      (idActual) => !idsEnviados.includes(idActual),
    );

    // Ejecutar todo en una transacción
    let evaluacion;
    try {
    evaluacion = await prisma.$transaction(
      async (tx) => {
        // 1. Eliminar preguntas removidas
        if (idsAEliminar.length > 0) {
          await tx.pregunta.deleteMany({ where: { id: { in: idsAEliminar } } });
        }

        // 2. Separar preguntas en dos grupos
        const preguntasExistentes = preguntas.filter(
          (p) => p.id && idsActuales.includes(p.id),
        );
        const preguntasNuevas = preguntas.filter(
          (p) => !p.id || !idsActuales.includes(p.id),
        );

        // Las opciones se conservan por id. Antes se borraban todas y se
        // recreaban: las respuestas ya registradas guardan el id de la opción
        // marcada, así que un «Editar → Guardar» las dejaba apuntando a nada
        // (0 puntos y «opciones que ya no existen» en el detalle). Ocurrió el
        // 5-oct-2026 con los cuatro primeros en responder Peligro Biomecánico.
        for (const p of preguntasExistentes) {
          const opciones = p.opciones ?? [];
          const idsConservados = opciones
            .map((o) => o.id)
            .filter((id): id is string => !!id);
          await tx.opcion.deleteMany({
            where: { preguntaId: p.id!, id: { notIn: idsConservados } },
          });
          const previa = preguntasActuales.find((q) => q.id === p.id);
          await tx.pregunta.update({
            where: { id: p.id },
            data: {
              texto: p.texto,
              tipo: p.tipo,
              puntaje: p.puntaje,
              relacionIzq: p.relacionIzq || [],
              relacionDer: p.relacionDer || [],
              respuestaCorrecta: p.respuestaCorrecta,
              configuracion: configuracionDePregunta(p, previa?.configuracion),
            },
          });
          for (const o of opciones) {
            const datos = { texto: o.texto, esCorrecta: o.esCorrecta };
            const actualizadas = o.id
              ? await tx.opcion.updateMany({
                  where: { id: o.id, preguntaId: p.id! },
                  data: datos,
                })
              : { count: 0 };
            if (actualizadas.count === 0) {
              await tx.opcion.create({
                data: { ...datos, preguntaId: p.id! },
              });
            }
          }
        }

        await Promise.all([
          ...preguntasNuevas.map((p) =>
            tx.pregunta.create({
              data: {
                evaluacionId: id,
                texto: p.texto,
                tipo: p.tipo,
                puntaje: p.puntaje,
                relacionIzq: p.relacionIzq || [],
                relacionDer: p.relacionDer || [],
                respuestaCorrecta: p.respuestaCorrecta,
                configuracion: configuracionDePregunta(p),
                opciones: p.opciones
                  ? {
                      create: p.opciones.map((o) => ({
                        texto: o.texto,
                        esCorrecta: o.esCorrecta,
                      })),
                    }
                  : undefined,
              },
            }),
          ),
        ]);

        // 3. Actualizar la evaluación
        return tx.evaluacion.update({
          where: { id },
          data: { titulo, descripcion, requiere_firma },
          include: { preguntas: { include: { opciones: true } } },
        });
      },
      { timeout: 15000 },
    ); // 👈 también aumenta el timeout como respaldo
    } catch (error: any) {
      if (/sopa de letras|cuadrícula/i.test(error?.message ?? "")) {
        return res.status(400).send({ success: false, message: error.message });
      }
      throw error;
    }

    return res.send({ success: true, data: evaluacion });
  },

  async delete(
    req: FastifyRequest<{ Params: { id: string } }>,
    res: FastifyReply,
  ) {
    const { id } = req.params;
    await prisma.evaluacion.update({
      where: { id },
      data: { deleted_at: new Date() }
    });
    return res.send({ success: true });
  },

  async responder(
    req: FastifyRequest<{ Params: { id: string } }>,
    res: FastifyReply,
  ) {
    const { id } = req.params;
    const parsed = respuestaRegistroSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .send({ success: false, errors: parsed.error.errors });
    const data = parsed.data;

    // VALIDACIÓN: Verificar si el dispositivo ya respondió esta evaluación
    if (data.device_fingerprint) {
      const respuestaExistente = await prisma.resultado.findFirst({
        where: {
          evaluacionId: id,
          device_fingerprint: data.device_fingerprint,
        },
      });

      if (respuestaExistente) {
        return res.status(409).send({
          success: false,
          message:
            "Este dispositivo ya ha enviado una respuesta para esta evaluación",
        });
      }
    }

    // Obtener evaluación y preguntas
    const evaluacion = await prisma.evaluacion.findUnique({
      where: { id },
      include: { preguntas: { include: { opciones: true } } },
    });
    if (!evaluacion)
      return res
        .status(404)
        .send({ success: false, message: "Evaluación no encontrada" });
    // Capturar IP y User Agent del request
    const ip_address =
      (req.headers["x-forwarded-for"] as string) || req.ip || "unknown";
    const user_agent = req.headers["user-agent"] || "unknown";

    let resultado;
    try {
      resultado = await registrarResultado(evaluacion, data.respuestas, {
        nombre_completo: data.nombre_completo,
        numero_documento: data.numero_documento,
        cargo: data.cargo,
        correo: data.correo,
        telefono: data.telefono,
        firma: data.firma,
        device_fingerprint: data.device_fingerprint,
        ip_address,
        user_agent,
      });
    } catch (error) {
      if (error instanceof OpcionDesconocidaError) {
        return res.status(409).send({
          success: false,
          code: "EVALUACION_MODIFICADA",
          message: error.message,
        });
      }
      throw error;
    }

    return res.send({ success: true, data: resultado });
  },

  /**
   * Lista de resultados, ligera: sin la firma (una imagen en base64 por
   * persona) y sin la pregunta anidada en cada respuesta (el panel ya tiene
   * las preguntas de la evaluación). Con 15 respuestas la versión completa
   * pesaba 525 KB y en producción no llegaba a cargar; esta pesa decenas.
   * El detalle completo se pide aparte con `resultado`.
   */
  async resultados(
    req: FastifyRequest<{ Params: { id: string } }>,
    res: FastifyReply,
  ) {
    const { id } = req.params;
    const resultados = await prisma.resultado.findMany({
      where: { evaluacionId: id },
      select: {
        id: true,
        evaluacionId: true,
        nombre_completo: true,
        numero_documento: true,
        cargo: true,
        correo: true,
        telefono: true,
        puntaje_total: true,
        firma: true,
        created_at: true,
        respuestas: {
          select: {
            id: true,
            preguntaId: true,
            valor_texto: true,
            valor_numero: true,
            opcionesIds: true,
            relacion: true,
            puntaje: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
    });
    return res.send({
      success: true,
      data: resultados.map(({ firma, ...r }) => ({ ...r, tiene_firma: !!firma })),
    });
  },

  /** Un resultado completo: con firma y con la pregunta de cada respuesta. */
  async resultado(
    req: FastifyRequest<{ Params: { id: string; resultadoId: string } }>,
    res: FastifyReply,
  ) {
    const { id, resultadoId } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(resultadoId)) {
      return res.status(404).send({ success: false, error: "No encontrado" });
    }
    const resultado = await prisma.resultado.findFirst({
      where: { id: resultadoId, evaluacionId: id },
      include: {
        respuestas: {
          include: { pregunta: { include: { opciones: true } } },
        },
      },
    });
    if (!resultado) {
      return res
        .status(404)
        .send({ success: false, error: "Resultado no encontrado" });
    }
    return res.send({ success: true, data: resultado });
  },

  /**
   * Un administrador corrige las respuestas de un resultado. Caso típico: la
   * evaluación se editó después de que alguien respondiera, las opciones se
   * recrearon con ids nuevos y esa persona quedó con 0 sin haber fallado.
   * Se reemplazan todas las respuestas y se recalifica con la clave actual.
   */
  async actualizarRespuestas(
    req: FastifyRequest<{ Params: { id: string; resultadoId: string } }>,
    res: FastifyReply,
  ) {
    const { id, resultadoId } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(resultadoId)) {
      return res.status(404).send({ success: false, error: "No encontrado" });
    }
    const parsed = z
      .object({ respuestas: z.array(respuestaPreguntaSchema) })
      .safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .send({ success: false, errors: parsed.error.errors });
    }

    const evaluacion = await prisma.evaluacion.findFirst({
      where: { id, deleted_at: null },
      include: { preguntas: { include: { opciones: true } } },
    });
    if (!evaluacion) {
      return res
        .status(404)
        .send({ success: false, error: "Evaluación no encontrada" });
    }
    const actual = await prisma.resultado.findFirst({
      where: { id: resultadoId, evaluacionId: id },
      include: { respuestas: true },
    });
    if (!actual) {
      return res
        .status(404)
        .send({ success: false, error: "Resultado no encontrado" });
    }

    const textosPrevios: TextosCalificados = new Map();
    for (const r of actual.respuestas) {
      if (r.valor_texto != null) {
        textosPrevios.set(r.preguntaId, {
          valor_texto: r.valor_texto,
          puntaje: r.puntaje,
        });
      }
    }
    let calificacion;
    try {
      calificacion = await calificarRespuestas(
        evaluacion,
        parsed.data.respuestas,
        textosPrevios,
      );
    } catch (error) {
      if (error instanceof OpcionDesconocidaError) {
        return res
          .status(400)
          .send({ success: false, message: error.message });
      }
      throw error;
    }
    const { puntaje_total, respuestasDB } = calificacion;

    const resultado = await prisma.$transaction(async (tx) => {
      await tx.respuesta.deleteMany({ where: { resultadoId } });
      return tx.resultado.update({
        where: { id: resultadoId },
        data: { puntaje_total, respuestas: { create: respuestasDB } },
        include: {
          respuestas: {
            include: { pregunta: { include: { opciones: true } } },
          },
        },
      });
    });

    const editor = (req as any).user;
    console.log(
      `✏️ Respuestas editadas: resultado ${resultadoId} de ${actual.nombre_completo} ` +
        `(${actual.puntaje_total} → ${puntaje_total}) por usuario ${editor?.id ?? "?"}`,
    );
    try {
      getIo()?.to(`evaluacion-${id}`).emit("respuesta-actualizada", resultado);
    } catch (error) {
      console.error("❌ Error emitiendo evento socket:", error);
    }

    return res.send({ success: true, data: resultado });
  },

  async verificarDispositivo(
    req: FastifyRequest<{
      Params: { id: string };
      Querystring: { device_fingerprint: string };
    }>,
    res: FastifyReply,
  ) {
    const { id } = req.params;
    const { device_fingerprint } = req.query;

    if (!device_fingerprint) {
      return res
        .status(400)
        .send({ success: false, message: "device_fingerprint es requerido" });
    }

    // Buscar si este dispositivo ya respondió esta evaluación
    const resultado = await prisma.resultado.findFirst({
      where: {
        evaluacionId: id,
        device_fingerprint,
      },
      include: {
        respuestas: {
          include: {
            pregunta: {
              include: {
                opciones: true,
              },
            },
          },
        },
        evaluacion: {
          include: {
            preguntas: {
              include: {
                opciones: true,
              },
            },
          },
        },
      },
    });

    if (resultado) {
      return res.send({ success: true, data: resultado });
    }

    return res.send({ success: true, data: null });
  },

  async exportarPDF(
    req: FastifyRequest<{ Params: { id: string } }>,
    res: FastifyReply,
  ) {
    try {
      const { id } = req.params;

      const evaluacion = await prisma.evaluacion.findUnique({
        where: { id },
        include: {
          preguntas: {
            include: { opciones: true },
          },
        },
      });

      if (!evaluacion) {
        return res
          .status(404)
          .send({ success: false, message: "Evaluación no encontrada" });
      }

      const resultados = await prisma.resultado.findMany({
        where: { evaluacionId: id },
        include: {
          respuestas: {
            include: {
              pregunta: {
                include: { opciones: true },
              },
            },
          },
        },
        orderBy: { created_at: "asc" },
      });

      const pdfBuffer =
        await EvaluacionPDFGeneratorService.generarPDFEvaluacion(
          {
            titulo: evaluacion.titulo,
            descripcion: evaluacion.descripcion,
            requiere_firma: evaluacion.requiere_firma,
            created_at: evaluacion.created_at.toISOString(),
            preguntas: evaluacion.preguntas.map((p: any) => ({
              id: p.id,
              texto: p.texto,
              tipo: p.tipo,
              puntaje: p.puntaje,
              opciones: p.opciones,
              relacionIzq: p.relacionIzq || [],
              relacionDer: p.relacionDer || [],
              respuestaCorrecta: p.respuestaCorrecta,
              configuracion: p.configuracion,
            })),
          },
          resultados.map((r: any) => ({
            id: r.id,
            nombre_completo: r.nombre_completo,
            numero_documento: r.numero_documento,
            cargo: r.cargo,
            correo: r.correo,
            telefono: r.telefono,
            puntaje_total: r.puntaje_total,
            firma: r.firma,
            created_at: r.created_at.toISOString(),
            respuestas: r.respuestas.map((resp: any) => ({
              id: resp.id,
              preguntaId: resp.preguntaId,
              valor_texto: resp.valor_texto,
              valor_numero: resp.valor_numero,
              opcionesIds: resp.opcionesIds || [],
              relacion: resp.relacion,
              puntaje: resp.puntaje,
              pregunta: resp.pregunta
                ? {
                    id: resp.pregunta.id,
                    texto: resp.pregunta.texto,
                    tipo: resp.pregunta.tipo,
                    puntaje: resp.pregunta.puntaje,
                    opciones: resp.pregunta.opciones,
                    relacionIzq: resp.pregunta.relacionIzq || [],
                    relacionDer: resp.pregunta.relacionDer || [],
                    respuestaCorrecta: resp.pregunta.respuestaCorrecta,
                    configuracion: resp.pregunta.configuracion,
                  }
                : undefined,
            })),
          })),
        );

      const fileName = `evaluacion_${evaluacion.titulo.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;

      res.header("Content-Type", "application/pdf");
      res.header("Content-Disposition", `attachment; filename="${fileName}"`);

      return res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generando PDF de evaluación:", error);
      return res.status(500).send({
        success: false,
        message: error.message || "Error al generar el PDF",
      });
    }
  },

  async exportarPDFIndividual(
    req: FastifyRequest<{ Params: { id: string; resultadoId: string } }>,
    res: FastifyReply,
  ) {
    try {
      const { id, resultadoId } = req.params;

      const evaluacion = await prisma.evaluacion.findUnique({
        where: { id },
        include: {
          preguntas: {
            include: { opciones: true },
          },
        },
      });

      if (!evaluacion) {
        return res
          .status(404)
          .send({ success: false, message: "Evaluación no encontrada" });
      }

      const resultado = await prisma.resultado.findFirst({
        where: { id: resultadoId, evaluacionId: id },
        include: {
          respuestas: {
            include: {
              pregunta: {
                include: { opciones: true },
              },
            },
          },
        },
      });

      if (!resultado) {
        return res
          .status(404)
          .send({ success: false, message: "Resultado no encontrado" });
      }

      const pdfBuffer =
        await EvaluacionPDFGeneratorService.generarPDFIndividual(
          {
            titulo: evaluacion.titulo,
            descripcion: evaluacion.descripcion,
            requiere_firma: evaluacion.requiere_firma,
            created_at: evaluacion.created_at.toISOString(),
            preguntas: evaluacion.preguntas.map((p: any) => ({
              id: p.id,
              texto: p.texto,
              tipo: p.tipo,
              puntaje: p.puntaje,
              opciones: p.opciones,
              relacionIzq: p.relacionIzq || [],
              relacionDer: p.relacionDer || [],
              respuestaCorrecta: p.respuestaCorrecta,
              configuracion: p.configuracion,
            })),
          },
          {
            id: resultado.id,
            nombre_completo: resultado.nombre_completo,
            numero_documento: resultado.numero_documento,
            cargo: resultado.cargo,
            correo: resultado.correo,
            telefono: resultado.telefono,
            puntaje_total: resultado.puntaje_total,
            firma: resultado.firma,
            created_at: resultado.created_at.toISOString(),
            respuestas: resultado.respuestas.map((resp: any) => ({
              id: resp.id,
              preguntaId: resp.preguntaId,
              valor_texto: resp.valor_texto,
              valor_numero: resp.valor_numero,
              opcionesIds: resp.opcionesIds || [],
              relacion: resp.relacion,
              puntaje: resp.puntaje,
              pregunta: resp.pregunta
                ? {
                    id: resp.pregunta.id,
                    texto: resp.pregunta.texto,
                    tipo: resp.pregunta.tipo,
                    puntaje: resp.pregunta.puntaje,
                    opciones: resp.pregunta.opciones,
                    relacionIzq: resp.pregunta.relacionIzq || [],
                    relacionDer: resp.pregunta.relacionDer || [],
                    respuestaCorrecta: resp.pregunta.respuestaCorrecta,
                    configuracion: resp.pregunta.configuracion,
                  }
                : undefined,
            })),
          },
        );

      const fileName = `evaluacion_${evaluacion.titulo.replace(/[^a-zA-Z0-9]/g, "_")}_${resultado.nombre_completo.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;

      res.header("Content-Type", "application/pdf");
      res.header("Content-Disposition", `attachment; filename="${fileName}"`);

      return res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generando PDF individual:", error);
      return res.status(500).send({
        success: false,
        message: error.message || "Error al generar el PDF",
      });
    }
  },

  async exportarZIP(
    req: FastifyRequest<{ Params: { id: string } }>,
    res: FastifyReply,
  ) {
    try {
      const { id } = req.params;

      const evaluacion = await prisma.evaluacion.findUnique({
        where: { id },
        include: {
          preguntas: {
            include: { opciones: true },
          },
        },
      });

      if (!evaluacion) {
        return res
          .status(404)
          .send({ success: false, message: "Evaluación no encontrada" });
      }

      const resultados = await prisma.resultado.findMany({
        where: { evaluacionId: id },
        include: {
          respuestas: {
            include: {
              pregunta: {
                include: { opciones: true },
              },
            },
          },
        },
        orderBy: { created_at: "asc" },
      });

      if (resultados.length === 0) {
        return res
          .status(404)
          .send({ success: false, message: "No hay resultados para exportar" });
      }

      const evaluacionData = {
        titulo: evaluacion.titulo,
        descripcion: evaluacion.descripcion,
        requiere_firma: evaluacion.requiere_firma,
        created_at: evaluacion.created_at.toISOString(),
        preguntas: evaluacion.preguntas.map((p: any) => ({
          id: p.id,
          texto: p.texto,
          tipo: p.tipo,
          puntaje: p.puntaje,
          opciones: p.opciones,
          relacionIzq: p.relacionIzq || [],
          relacionDer: p.relacionDer || [],
          respuestaCorrecta: p.respuestaCorrecta,
        })),
      };

      const zipFileName = `evaluacion_${evaluacion.titulo.replace(/[^a-zA-Z0-9]/g, "_")}_respuestas.zip`;

      res.header("Content-Type", "application/zip");
      res.header(
        "Content-Disposition",
        `attachment; filename="${zipFileName}"`,
      );

      const archive = archiver("zip", { zlib: { level: 6 } });

      // Pipe archive to response
      const chunks: Buffer[] = [];
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));

      const archiveFinished = new Promise<Buffer>((resolve, reject) => {
        archive.on("end", () => resolve(Buffer.concat(chunks)));
        archive.on("error", reject);
      });

      // Generate individual PDFs and add to archive
      for (const resultado of resultados) {
        const resultadoData = {
          id: resultado.id,
          nombre_completo: resultado.nombre_completo,
          numero_documento: resultado.numero_documento,
          cargo: resultado.cargo,
          correo: resultado.correo,
          telefono: resultado.telefono,
          puntaje_total: resultado.puntaje_total,
          firma: resultado.firma,
          created_at: resultado.created_at.toISOString(),
          respuestas: resultado.respuestas.map((resp: any) => ({
            id: resp.id,
            preguntaId: resp.preguntaId,
            valor_texto: resp.valor_texto,
            valor_numero: resp.valor_numero,
            opcionesIds: resp.opcionesIds || [],
            relacion: resp.relacion,
            puntaje: resp.puntaje,
            pregunta: resp.pregunta
              ? {
                  id: resp.pregunta.id,
                  texto: resp.pregunta.texto,
                  tipo: resp.pregunta.tipo,
                  puntaje: resp.pregunta.puntaje,
                  opciones: resp.pregunta.opciones,
                  relacionIzq: resp.pregunta.relacionIzq || [],
                  relacionDer: resp.pregunta.relacionDer || [],
                  respuestaCorrecta: resp.pregunta.respuestaCorrecta,
                }
              : undefined,
          })),
        };

        const pdfBuffer =
          await EvaluacionPDFGeneratorService.generarPDFIndividual(
            evaluacionData,
            resultadoData,
          );

        const nombreLimpio = resultado.nombre_completo
          .replace(/[^a-zA-Z0-9\s]/g, "")
          .replace(/\s+/g, "_");
        const documentoLimpio = resultado.numero_documento.replace(
          /[^a-zA-Z0-9]/g,
          "",
        );
        const pdfFileName = `${nombreLimpio}_${documentoLimpio}.pdf`;

        archive.append(pdfBuffer, { name: pdfFileName });
      }

      archive.finalize();

      const zipBuffer = await archiveFinished;
      return res.send(zipBuffer);
    } catch (error: any) {
      console.error("Error generando ZIP de evaluación:", error);
      return res.status(500).send({
        success: false,
        message: error.message || "Error al generar el ZIP",
      });
    }
  },
};
