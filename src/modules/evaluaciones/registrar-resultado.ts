import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { aiGradingService } from "../../services/ai-grading.service";
import { getIo } from "../../sockets";

// Respuesta a una pregunta, tal como la envían la web pública y el portal del conductor
export const respuestaPreguntaSchema = z.object({
  preguntaId: z.string(),
  valor_texto: z.string().optional(),
  valor_numero: z.number().optional(),
  opcionesIds: z.array(z.string()).optional(),
  relacion: z
    .array(z.object({ izq: z.string(), der: z.string() }))
    .optional(),
});

export type RespuestaPregunta = z.infer<typeof respuestaPreguntaSchema>;

export type EvaluacionConPreguntas = Prisma.EvaluacionGetPayload<{
  include: { preguntas: { include: { opciones: true } } };
}>;

export interface DatosRespondiente {
  nombre_completo: string;
  numero_documento: string;
  cargo: string;
  correo: string;
  telefono: string;
  firma?: string;
  device_fingerprint?: string;
  ip_address: string;
  user_agent: string;
}

/**
 * Califica las respuestas, guarda el resultado y avisa por socket a quien esté
 * viendo la evaluación. Lo usan la web pública y el portal del conductor.
 */
export async function registrarResultado(
  evaluacion: EvaluacionConPreguntas,
  respuestas: RespuestaPregunta[],
  datos: DatosRespondiente,
) {
  const id = evaluacion.id;
  // Calcular puntaje
  let puntaje_total = 0;
  const respuestasDB = [];
  for (const r of respuestas) {
    const pregunta = evaluacion.preguntas.find(
      (p: any) => p.id === r.preguntaId,
    );
    if (!pregunta) continue;
    let puntaje = 0;
    if (
      pregunta.tipo === "OPCION_UNICA" ||
      pregunta.tipo === "OPCION_MULTIPLE"
    ) {
      const correctas = pregunta.opciones
        .filter((o: any) => o.esCorrecta)
        .map((o: any) => o.id);
      const seleccionadas = r.opcionesIds || [];
      if (pregunta.tipo === "OPCION_UNICA") {
        if (
          correctas.length === 1 &&
          seleccionadas.length === 1 &&
          correctas[0] === seleccionadas[0]
        ) {
          puntaje = pregunta.puntaje;
        }
      } else {
        // Opción múltiple: puntaje proporcional
        const aciertos = seleccionadas.filter((id: string) =>
          correctas.includes(id),
        ).length;
        puntaje = Math.round(
          (aciertos / correctas.length) * pregunta.puntaje,
        );
      }
    } else if (pregunta.tipo === "NUMERICA") {
      // Comparar con respuestaCorrecta
      if (
        typeof r.valor_numero === "number" &&
        pregunta.respuestaCorrecta !== null &&
        pregunta.respuestaCorrecta !== undefined
      ) {
        if (pregunta.respuestaCorrecta === r.valor_numero) {
          puntaje = pregunta.puntaje;
        }
      }
    } else if (pregunta.tipo === "TEXTO") {
      // Calificar con IA usando Ministral-3B si hay respuesta de texto
      if (r.valor_texto && r.valor_texto.trim().length > 0) {
        try {
          const resultado = await aiGradingService.gradeTextResponse(
            pregunta.texto,
            r.valor_texto,
            pregunta.puntaje,
          );

          puntaje = resultado.score;

          // Log para auditoría
          console.log(`📝 Pregunta TEXTO calificada con IA (Ministral-3B):`, {
            pregunta: pregunta.texto.substring(0, 50) + "...",
            respuesta: r.valor_texto.substring(0, 50) + "...",
            puntaje: resultado.score,
            puntajeMaximo: pregunta.puntaje,
            razonamiento: resultado.reasoning,
          });
        } catch (error) {
          console.error("❌ Error al calificar con IA:", error);
          puntaje = 0; // En caso de error, requiere calificación manual
        }
      } else {
        puntaje = 0; // Sin respuesta
      }
    } else if (pregunta.tipo === "RELACION") {
      // Cada unión correcta suma 1 punto
      const relaciones = r.relacion || [];
      let aciertos = 0;
      for (const par of relaciones) {
        if (
          pregunta.relacionIzq.includes(par.izq) &&
          pregunta.relacionDer.includes(par.der) &&
          pregunta.relacionIzq.indexOf(par.izq) ===
            pregunta.relacionDer.indexOf(par.der)
        ) {
          aciertos++;
        }
      }
      puntaje = aciertos;
      if (puntaje > pregunta.puntaje) puntaje = pregunta.puntaje;
    } else if (pregunta.tipo === "VERDADERO_FALSO") {
      // Comparar valor_numero (1=Verdadero, 0=Falso) con respuestaCorrecta
      if (
        typeof r.valor_numero === "number" &&
        pregunta.respuestaCorrecta !== null &&
        pregunta.respuestaCorrecta !== undefined
      ) {
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
      puntaje,
    });
  }

  // Guardar resultado y respuestas
  const resultado = await prisma.resultado.create({
    data: {
      evaluacionId: id,
      nombre_completo: datos.nombre_completo,
      numero_documento: datos.numero_documento,
      cargo: datos.cargo,
      correo: datos.correo,
      telefono: datos.telefono,
      firma: datos.firma,
      device_fingerprint: datos.device_fingerprint,
      ip_address: datos.ip_address,
      user_agent: datos.user_agent,
      puntaje_total,
      respuestas: {
        create: respuestasDB,
      },
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

  // Emitir evento socket para actualización en tiempo real
  try {
    const io = getIo();
    if (io) {
      io.to(`evaluacion-${id}`).emit("nueva-respuesta", resultado);
      console.log(`✅ Socket emitido: nueva-respuesta para evaluación ${id}`);
    }
  } catch (error) {
    console.error("❌ Error emitiendo evento socket:", error);
  }

  return resultado;
}
