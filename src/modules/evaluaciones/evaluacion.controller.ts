import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../config/prisma';
import { evaluacionSchema } from './evaluacion.schema';
import { z } from 'zod';
import { preguntaSchema } from './evaluacion.schema';
import { aiGradingService } from '../../services/ai-grading.service';
import { getIo } from '../../sockets';
import { EvaluacionPDFGeneratorService } from './pdf-generator.service';
import archiver from 'archiver';

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
    
    // Obtener preguntas actuales para comparar
    const preguntasActuales = await prisma.pregunta.findMany({
      where: { evaluacionId: id },
      include: { opciones: true }
    });
    
    const idsActuales = preguntasActuales.map(p => p.id);
    const idsEnviados = preguntas.filter(p => p.id).map(p => p.id!);
    
    // Preguntas que ya no están en la lista → eliminar (cascade borra respuestas asociadas)
    const idsAEliminar = idsActuales.filter(idActual => !idsEnviados.includes(idActual));
    
    // Ejecutar todo en una transacción
    const evaluacion = await prisma.$transaction(async (tx) => {
      // 1. Eliminar preguntas removidas
      if (idsAEliminar.length > 0) {
        await tx.pregunta.deleteMany({ where: { id: { in: idsAEliminar } } });
      }
      
      // 2. Actualizar preguntas existentes y crear nuevas
      for (const p of preguntas) {
        if (p.id && idsActuales.includes(p.id)) {
          // Pregunta existente → actualizar preservando el ID
          // Primero eliminar opciones viejas y recrear
          await tx.opcion.deleteMany({ where: { preguntaId: p.id } });
          await tx.pregunta.update({
            where: { id: p.id },
            data: {
              texto: p.texto,
              tipo: p.tipo,
              puntaje: p.puntaje,
              relacionIzq: p.relacionIzq || [],
              relacionDer: p.relacionDer || [],
              respuestaCorrecta: p.respuestaCorrecta,
              opciones: p.opciones ? { create: p.opciones.map(o => ({ texto: o.texto, esCorrecta: o.esCorrecta })) } : undefined,
            }
          });
        } else {
          // Pregunta nueva → crear
          await tx.pregunta.create({
            data: {
              evaluacionId: id,
              texto: p.texto,
              tipo: p.tipo,
              puntaje: p.puntaje,
              relacionIzq: p.relacionIzq || [],
              relacionDer: p.relacionDer || [],
              respuestaCorrecta: p.respuestaCorrecta,
              opciones: p.opciones ? { create: p.opciones.map(o => ({ texto: o.texto, esCorrecta: o.esCorrecta })) } : undefined,
            }
          });
        }
      }
      
      // 3. Actualizar datos de la evaluación
      return tx.evaluacion.update({
        where: { id },
        data: {
          titulo,
          descripcion,
          requiere_firma,
        },
        include: { preguntas: { include: { opciones: true } } }
      });
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
      } else if (pregunta.tipo === 'VERDADERO_FALSO') {
        // Comparar valor_numero (1=Verdadero, 0=Falso) con respuestaCorrecta
        if (typeof r.valor_numero === 'number' && pregunta.respuestaCorrecta !== null && pregunta.respuestaCorrecta !== undefined) {
          if (pregunta.respuestaCorrecta === r.valor_numero) {
            puntaje = pregunta.puntaje;
          }
        }
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

  async exportarPDF(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
    try {
      const { id } = req.params;

      const evaluacion = await prisma.evaluacion.findUnique({
        where: { id },
        include: {
          preguntas: {
            include: { opciones: true }
          }
        }
      });

      if (!evaluacion) {
        return res.status(404).send({ success: false, message: 'Evaluación no encontrada' });
      }

      const resultados = await prisma.resultado.findMany({
        where: { evaluacionId: id },
        include: {
          respuestas: {
            include: {
              pregunta: {
                include: { opciones: true }
              }
            }
          }
        },
        orderBy: { created_at: 'asc' }
      });

      const pdfBuffer = await EvaluacionPDFGeneratorService.generarPDFEvaluacion(
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
            respuestaCorrecta: p.respuestaCorrecta
          }))
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
            pregunta: resp.pregunta ? {
              id: resp.pregunta.id,
              texto: resp.pregunta.texto,
              tipo: resp.pregunta.tipo,
              puntaje: resp.pregunta.puntaje,
              opciones: resp.pregunta.opciones,
              relacionIzq: resp.pregunta.relacionIzq || [],
              relacionDer: resp.pregunta.relacionDer || [],
              respuestaCorrecta: resp.pregunta.respuestaCorrecta
            } : undefined
          }))
        }))
      );

      const fileName = `evaluacion_${evaluacion.titulo.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;

      res.header('Content-Type', 'application/pdf');
      res.header('Content-Disposition', `attachment; filename="${fileName}"`);

      return res.send(pdfBuffer);
    } catch (error: any) {
      console.error('Error generando PDF de evaluación:', error);
      return res.status(500).send({
        success: false,
        message: error.message || 'Error al generar el PDF'
      });
    }
  },

  async exportarPDFIndividual(req: FastifyRequest<{ Params: { id: string; resultadoId: string } }>, res: FastifyReply) {
    try {
      const { id, resultadoId } = req.params;

      const evaluacion = await prisma.evaluacion.findUnique({
        where: { id },
        include: {
          preguntas: {
            include: { opciones: true }
          }
        }
      });

      if (!evaluacion) {
        return res.status(404).send({ success: false, message: 'Evaluación no encontrada' });
      }

      const resultado = await prisma.resultado.findFirst({
        where: { id: resultadoId, evaluacionId: id },
        include: {
          respuestas: {
            include: {
              pregunta: {
                include: { opciones: true }
              }
            }
          }
        }
      });

      if (!resultado) {
        return res.status(404).send({ success: false, message: 'Resultado no encontrado' });
      }

      const pdfBuffer = await EvaluacionPDFGeneratorService.generarPDFIndividual(
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
            respuestaCorrecta: p.respuestaCorrecta
          }))
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
            pregunta: resp.pregunta ? {
              id: resp.pregunta.id,
              texto: resp.pregunta.texto,
              tipo: resp.pregunta.tipo,
              puntaje: resp.pregunta.puntaje,
              opciones: resp.pregunta.opciones,
              relacionIzq: resp.pregunta.relacionIzq || [],
              relacionDer: resp.pregunta.relacionDer || [],
              respuestaCorrecta: resp.pregunta.respuestaCorrecta
            } : undefined
          }))
        }
      );

      const fileName = `evaluacion_${evaluacion.titulo.replace(/[^a-zA-Z0-9]/g, '_')}_${resultado.nombre_completo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

      res.header('Content-Type', 'application/pdf');
      res.header('Content-Disposition', `attachment; filename="${fileName}"`);

      return res.send(pdfBuffer);
    } catch (error: any) {
      console.error('Error generando PDF individual:', error);
      return res.status(500).send({
        success: false,
        message: error.message || 'Error al generar el PDF'
      });
    }
  },

  async exportarZIP(req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) {
    try {
      const { id } = req.params;

      const evaluacion = await prisma.evaluacion.findUnique({
        where: { id },
        include: {
          preguntas: {
            include: { opciones: true }
          }
        }
      });

      if (!evaluacion) {
        return res.status(404).send({ success: false, message: 'Evaluación no encontrada' });
      }

      const resultados = await prisma.resultado.findMany({
        where: { evaluacionId: id },
        include: {
          respuestas: {
            include: {
              pregunta: {
                include: { opciones: true }
              }
            }
          }
        },
        orderBy: { created_at: 'asc' }
      });

      if (resultados.length === 0) {
        return res.status(404).send({ success: false, message: 'No hay resultados para exportar' });
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
          respuestaCorrecta: p.respuestaCorrecta
        }))
      };

      const zipFileName = `evaluacion_${evaluacion.titulo.replace(/[^a-zA-Z0-9]/g, '_')}_respuestas.zip`;

      res.header('Content-Type', 'application/zip');
      res.header('Content-Disposition', `attachment; filename="${zipFileName}"`);

      const archive = archiver('zip', { zlib: { level: 6 } });

      // Pipe archive to response
      const chunks: Buffer[] = [];
      archive.on('data', (chunk: Buffer) => chunks.push(chunk));

      const archiveFinished = new Promise<Buffer>((resolve, reject) => {
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        archive.on('error', reject);
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
            pregunta: resp.pregunta ? {
              id: resp.pregunta.id,
              texto: resp.pregunta.texto,
              tipo: resp.pregunta.tipo,
              puntaje: resp.pregunta.puntaje,
              opciones: resp.pregunta.opciones,
              relacionIzq: resp.pregunta.relacionIzq || [],
              relacionDer: resp.pregunta.relacionDer || [],
              respuestaCorrecta: resp.pregunta.respuestaCorrecta
            } : undefined
          }))
        };

        const pdfBuffer = await EvaluacionPDFGeneratorService.generarPDFIndividual(
          evaluacionData,
          resultadoData
        );

        const nombreLimpio = resultado.nombre_completo.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
        const documentoLimpio = resultado.numero_documento.replace(/[^a-zA-Z0-9]/g, '');
        const pdfFileName = `${nombreLimpio}_${documentoLimpio}.pdf`;

        archive.append(pdfBuffer, { name: pdfFileName });
      }

      archive.finalize();

      const zipBuffer = await archiveFinished;
      return res.send(zipBuffer);
    } catch (error: any) {
      console.error('Error generando ZIP de evaluación:', error);
      return res.status(500).send({
        success: false,
        message: error.message || 'Error al generar el ZIP'
      });
    }
  },
};
