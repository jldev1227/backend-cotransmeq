import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../config/prisma';
import { evaluacionSchema } from './evaluacion.schema';
import { z } from 'zod';
import { preguntaSchema } from './evaluacion.schema';
import { aiGradingService } from '../../services/ai-grading.service';
import { getIo } from '../../sockets';

// Esquema para registro de respuestas
const respuestaRegistroSchema = z.object({
  nombre_completo: z.string().min(1),
  numero_documento: z.string().min(1),
  cargo: z.string().min(1),
  correo: z.string().email(),
  telefono: z.string().min(1),
  firma: z.string().optional(),
  device_fingerprint: z.string().optional(),
  respuestas: z.array(z.object({
    preguntaId: z.string(),
    valor_texto: z.string().optional(),
    valor_numero: z.number().optional(),
    opcionesIds: z.array(z.string()).optional(),
    relacion: z.array(z.object({ izq: z.string(), der: z.string() })).optional()
  }))
});

export const EvaluacionesController = {
  async list(req: FastifyRequest, res: FastifyReply) {
    const evaluaciones = await prisma.evaluacion.findMany({
      orderBy: { created_at: 'desc' },
      include: { preguntas: { include: { opciones: true } } }
    });
    return res.send({ success: true, data: evaluaciones });
  },

  async findById(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
    const { id } = req.params;
    const evaluacion = await prisma.evaluacion.findUnique({
      where: { id },
      include: { preguntas: { include: { opciones: true } } }
    });
    if (!evaluacion) return res.status(404).send({ success: false, message: 'No encontrada' });
    return res.send({ success: true, data: evaluacion });
  },

  async create(req: FastifyRequest, res: FastifyReply) {
    const parsed = evaluacionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({ success: false, errors: parsed.error.errors });
    const { titulo, descripcion, requiere_firma, preguntas } = parsed.data;
    const evaluacion = await prisma.evaluacion.create({
      data: {
        titulo,
        descripcion,
        requiere_firma,
        preguntas: {
          create: preguntas.map((p: any) => ({
            texto: p.texto,
            tipo: p.tipo,
            puntaje: p.puntaje,
            opciones: p.opciones ? { create: p.opciones } : undefined,
            relacionIzq: p.relacionIzq || [],
            relacionDer: p.relacionDer || [],
            respuestaCorrecta: p.respuestaCorrecta,
          }))
        }
      },
      include: { preguntas: { include: { opciones: true } } }
    });
    return res.send({ success: true, data: evaluacion });
  },

  async update(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
    const { id } = req.params;
    const parsed = evaluacionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({ success: false, errors: parsed.error.errors });
    
    const { titulo, descripcion, requiere_firma, preguntas } = parsed.data;
    
    // Eliminar preguntas y opciones antiguas
    await prisma.pregunta.deleteMany({ where: { evaluacionId: id } });
    
    // Actualizar evaluación con nuevas preguntas
    const evaluacion = await prisma.evaluacion.update({
      where: { id },
      data: {
        titulo,
        descripcion,
        requiere_firma,
        preguntas: {
          create: preguntas.map((p: any) => ({
            texto: p.texto,
            tipo: p.tipo,
            puntaje: p.puntaje,
            opciones: p.opciones ? { create: p.opciones } : undefined,
            relacionIzq: p.relacionIzq || [],
            relacionDer: p.relacionDer || [],
            respuestaCorrecta: p.respuestaCorrecta,
          }))
        }
      },
      include: { preguntas: { include: { opciones: true } } }
    });
    
    return res.send({ success: true, data: evaluacion });
  },

  async delete(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
    const { id } = req.params;
    await prisma.evaluacion.delete({ where: { id } });
    return res.send({ success: true });
  },

  async responder(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
    const { id } = req.params;
    const parsed = respuestaRegistroSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).send({ success: false, errors: parsed.error.errors });
    const data = parsed.data;
    
    // VALIDACIÓN: Verificar si el dispositivo ya respondió esta evaluación
    if (data.device_fingerprint) {
      const respuestaExistente = await prisma.resultado.findFirst({
        where: {
          evaluacionId: id,
          device_fingerprint: data.device_fingerprint
        }
      });
      
      if (respuestaExistente) {
        return res.status(409).send({ 
          success: false, 
          message: 'Este dispositivo ya ha enviado una respuesta para esta evaluación' 
        });
      }
    }
    
    // Obtener evaluación y preguntas
    const evaluacion = await prisma.evaluacion.findUnique({
      where: { id },
      include: { preguntas: { include: { opciones: true } } }
    });
    if (!evaluacion) return res.status(404).send({ success: false, message: 'Evaluación no encontrada' });
    // Calcular puntaje
    let puntaje_total = 0;
    const respuestasDB = [];
    for (const r of data.respuestas) {
      const pregunta = evaluacion.preguntas.find((p: any) => p.id === r.preguntaId);
      if (!pregunta) continue;
      let puntaje = 0;
      if (pregunta.tipo === 'OPCION_UNICA' || pregunta.tipo === 'OPCION_MULTIPLE') {
        const correctas = pregunta.opciones.filter((o: any) => o.esCorrecta).map((o: any) => o.id);
        const seleccionadas = r.opcionesIds || [];
        if (pregunta.tipo === 'OPCION_UNICA') {
          if (correctas.length === 1 && seleccionadas.length === 1 && correctas[0] === seleccionadas[0]) {
            puntaje = pregunta.puntaje;
          }
        } else {
          // Opción múltiple: puntaje proporcional
          const aciertos = seleccionadas.filter((id: string) => correctas.includes(id)).length;
          puntaje = Math.round((aciertos / correctas.length) * pregunta.puntaje);
        }
      } else if (pregunta.tipo === 'NUMERICA') {
        // Comparar con respuestaCorrecta
        if (typeof r.valor_numero === 'number' && pregunta.respuestaCorrecta !== null && pregunta.respuestaCorrecta !== undefined) {
          if (pregunta.respuestaCorrecta === r.valor_numero) {
            puntaje = pregunta.puntaje;
          }
        }
      } else if (pregunta.tipo === 'TEXTO') {
        // Calificar con IA usando Ministral-3B si hay respuesta de texto
        if (r.valor_texto && r.valor_texto.trim().length > 0) {
          try {
            const resultado = await aiGradingService.gradeTextResponse(
              pregunta.texto, 
              r.valor_texto, 
              pregunta.puntaje
            );
            
            puntaje = resultado.score;
            
            // Log para auditoría
            console.log(`📝 Pregunta TEXTO calificada con IA (Ministral-3B):`, {
              pregunta: pregunta.texto.substring(0, 50) + '...',
              respuesta: r.valor_texto.substring(0, 50) + '...',
              puntaje: resultado.score,
              puntajeMaximo: pregunta.puntaje,
              razonamiento: resultado.reasoning
            });
          } catch (error) {
            console.error('❌ Error al calificar con IA:', error);
            puntaje = 0; // En caso de error, requiere calificación manual
          }
        } else {
          puntaje = 0; // Sin respuesta
        }
      } else if (pregunta.tipo === 'RELACION') {
        // Cada unión correcta suma 1 punto
        const relaciones = r.relacion || [];
        let aciertos = 0;
        for (const par of relaciones) {
          if (pregunta.relacionIzq.includes(par.izq) && pregunta.relacionDer.includes(par.der) && pregunta.relacionIzq.indexOf(par.izq) === pregunta.relacionDer.indexOf(par.der)) {
            aciertos++;
          }
        }
        puntaje = aciertos;
        if (puntaje > pregunta.puntaje) puntaje = pregunta.puntaje;
      }
      puntaje_total += puntaje;
      respuestasDB.push({
        preguntaId: pregunta.id,
        valor_texto: r.valor_texto,
        valor_numero: r.valor_numero,
        opcionesIds: r.opcionesIds || [],
        relacion: r.relacion || [],
        puntaje
      });
    }
    // Guardar resultado y respuestas
    // Capturar IP y User Agent del request
    const ip_address = req.headers['x-forwarded-for'] as string || req.ip || 'unknown';
    const user_agent = req.headers['user-agent'] || 'unknown';
    
    const resultado = await prisma.resultado.create({
      data: {
        evaluacionId: id,
        nombre_completo: data.nombre_completo,
        numero_documento: data.numero_documento,
        cargo: data.cargo,
        correo: data.correo,
        telefono: data.telefono,
        firma: data.firma,
        device_fingerprint: data.device_fingerprint,
        ip_address,
        user_agent,
        puntaje_total,
        respuestas: {
          create: respuestasDB
        }
      },
      include: { 
        respuestas: {
          include: {
            pregunta: {
              include: {
                opciones: true
              }
            }
          }
        },
        evaluacion: {
          include: {
            preguntas: {
              include: {
                opciones: true
              }
            }
          }
        }
      }
    });
    
    // Emitir evento socket para actualización en tiempo real
    try {
      const io = getIo();
      if (io) {
        io.to(`evaluacion-${id}`).emit('nueva-respuesta', resultado);
        console.log(`✅ Socket emitido: nueva-respuesta para evaluación ${id}`);
      }
    } catch (error) {
      console.error('❌ Error emitiendo evento socket:', error);
    }
    
    return res.send({ success: true, data: resultado });
  },

  async resultados(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
    const { id } = req.params;
    const resultados = await prisma.resultado.findMany({
      where: { evaluacionId: id },
      include: { 
        respuestas: {
          include: {
            pregunta: {
              include: {
                opciones: true
              }
            }
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });
    return res.send({ success: true, data: resultados });
  },

  async verificarDispositivo(req: FastifyRequest<{ Params: { id: string }; Querystring: { device_fingerprint: string } }>, res: FastifyReply) {
    const { id } = req.params;
    const { device_fingerprint } = req.query;
    
    if (!device_fingerprint) {
      return res.status(400).send({ success: false, message: 'device_fingerprint es requerido' });
    }
    
    // Buscar si este dispositivo ya respondió esta evaluación
    const resultado = await prisma.resultado.findFirst({
      where: {
        evaluacionId: id,
        device_fingerprint
      },
      include: { 
        respuestas: {
          include: {
            pregunta: {
              include: {
                opciones: true
              }
            }
          }
        },
        evaluacion: {
          include: {
            preguntas: {
              include: {
                opciones: true
              }
            }
          }
        }
      }
    });
    
    if (resultado) {
      return res.send({ success: true, data: resultado });
    }
    
    return res.send({ success: true, data: null });
  },
};
