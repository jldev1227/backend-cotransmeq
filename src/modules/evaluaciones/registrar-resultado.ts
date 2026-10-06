import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { aiGradingService } from "../../services/ai-grading.service";
import { getIo } from "../../sockets";
import { calificarSopa, type ConfigSopa, type Trazo } from "./sopa-letras";

// Respuesta a una pregunta, tal como la envían la web pública y el portal del conductor
export const respuestaPreguntaSchema = z.object({
  preguntaId: z.string(),
  valor_texto: z.string().optional(),
  valor_numero: z.number().optional(),
  opcionesIds: z.array(z.string()).optional(),
  relacion: z
    .array(z.object({ izq: z.string(), der: z.string() }))
    .optional(),
  /** Sopa de letras: líneas marcadas entre dos celdas `[fila, columna]`. */
  trazos: z
    .array(
      z.object({
        palabra: z.string().optional(),
        desde: z.tuple([z.number().int(), z.number().int()]),
        hasta: z.tuple([z.number().int(), z.number().int()]),
      }),
    )
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
 * Una respuesta marca una opción que la pregunta ya no tiene. Pasa cuando la
 * evaluación se edita recreando sus opciones mientras alguien la tiene abierta:
 * la página manda los ids viejos. Antes se calificaba 0 en silencio.
 */
export class OpcionDesconocidaError extends Error {
  constructor(public readonly preguntaId: string) {
    super("La evaluación se modificó mientras la respondías. Recarga la página y vuelve a responder.");
    this.name = "OpcionDesconocidaError";
  }
}

export interface RespuestaCalificada {
  preguntaId: string;
  valor_texto?: string;
  valor_numero?: number;
  opcionesIds: string[];
  /** RELACION: pares `{izq, der}`. SOPA_LETRAS: trazos válidos. */
  relacion: Prisma.InputJsonValue;
  puntaje: number;
}

/**
 * Respuestas de texto ya calificadas, por id de pregunta. Al editar un
 * resultado, si el texto no cambió se conserva la nota en vez de volver a
 * pedirla a la IA (que además no es determinista).
 */
export type TextosCalificados = Map<string, { valor_texto: string; puntaje: number }>;

/**
 * Califica cada respuesta contra la clave actual de la evaluación. Es la única
 * lógica de puntuación: la usan el registro público y la edición por un
 * administrador, para que ambos caminos den la misma nota.
 */
export async function calificarRespuestas(
  evaluacion: EvaluacionConPreguntas,
  respuestas: RespuestaPregunta[],
  textosPrevios?: TextosCalificados,
): Promise<{ puntaje_total: number; respuestasDB: RespuestaCalificada[] }> {
  let puntaje_total = 0;
  const respuestasDB: RespuestaCalificada[] = [];
  for (let r of respuestas) {
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
      if (
        seleccionadas.some(
          (id: string) => !pregunta.opciones.some((o: any) => o.id === id),
        )
      ) {
        throw new OpcionDesconocidaError(pregunta.id);
      }
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
      const previa = textosPrevios?.get(pregunta.id);
      if (
        previa &&
        (r.valor_texto ?? "").trim() === previa.valor_texto.trim()
      ) {
        // Mismo texto que ya se calificó: se conserva la nota.
        puntaje = previa.puntaje;
      } else if (r.valor_texto && r.valor_texto.trim().length > 0) {
        // Calificar con IA usando Ministral-3B si hay respuesta de texto
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
    } else if (pregunta.tipo === "SOPA_LETRAS") {
      const config = pregunta.configuracion as unknown as ConfigSopa | null;
      if (config?.cuadricula?.length) {
        const trazos: Trazo[] = (r.trazos ?? []).map((t) => ({
          palabra: t.palabra,
          desde: [t.desde[0], t.desde[1]],
          hasta: [t.hasta[0], t.hasta[1]],
        }));
        const resultado = calificarSopa(config, trazos, pregunta.puntaje);
        puntaje = resultado.puntaje;
        // Lo que se guarda es lo que el backend validó, no lo que llegó.
        r = { ...r, opcionesIds: resultado.encontradas, trazos: resultado.trazosValidos };
      }
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
      relacion: (pregunta.tipo === "SOPA_LETRAS"
        ? (r.trazos ?? [])
        : r.relacion || []) as unknown as Prisma.InputJsonValue,
      puntaje,
    });
  }
  return { puntaje_total, respuestasDB };
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
  const { puntaje_total, respuestasDB } = await calificarRespuestas(
    evaluacion,
    respuestas,
  );

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
