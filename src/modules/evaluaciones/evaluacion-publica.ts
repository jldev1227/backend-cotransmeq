import type { EvaluacionConPreguntas } from "./registrar-resultado";
import { sopaParaPublico, type ConfigSopa } from "./sopa-letras";

/** Fisher-Yates sobre una copia: no toca el arreglo original. */
export function barajar<T>(lista: T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * La evaluación tal como la puede ver quien la va a responder: sin
 * `esCorrecta` ni `respuestaCorrecta`. En RELACION la pareja correcta es
 * `relacionIzq[i] ↔ relacionDer[i]`, así que la derecha va barajada para que
 * el orden no delate la clave. Conserva el orden de las preguntas y los
 * nombres de campo de la ruta de administración, que es lo que ya lee la web.
 */
export function evaluacionSinClave(evaluacion: EvaluacionConPreguntas) {
  return {
    id: evaluacion.id,
    titulo: evaluacion.titulo,
    descripcion: evaluacion.descripcion,
    requiere_firma: evaluacion.requiere_firma,
    preguntas: evaluacion.preguntas.map((p) => ({
      id: p.id,
      texto: p.texto,
      tipo: p.tipo,
      puntaje: p.puntaje,
      opciones: p.opciones.map((o) => ({ id: o.id, texto: o.texto })),
      relacionIzq: p.relacionIzq,
      relacionDer: p.tipo === "RELACION" ? barajar(p.relacionDer) : p.relacionDer,
      // La sopa viaja sin la ubicación de las palabras: solo cuadrícula y lista.
      configuracion:
        p.tipo === "SOPA_LETRAS" && p.configuracion
          ? sopaParaPublico(p.configuracion as unknown as ConfigSopa)
          : null,
    })),
  };
}

/**
 * Umbral de aprobación, en porcentaje del puntaje máximo. Vive aquí y no en la
 * plantilla del PDF para que el documento y la página pública digan lo mismo:
 * la plantilla lo importa de este archivo.
 */
export const MINIMO_APROBACION = 70;

/** Porcentaje con un decimal, redondeado igual que en el PDF. */
export function porcentajeDe(obtenido: number, maximo: number): number {
  if (!maximo) return 0;
  return Math.round((obtenido / maximo) * 1000) / 10;
}

/**
 * Lo que la página pública muestra después de responder (o al volver a
 * abrir el enlace): el resultado y nada más.
 *
 * Hasta oct-2026 `responder` y `verificar` devolvían el `Resultado` entero con
 * la evaluación completa: `esCorrecta`, `respuestaCorrecta` y dónde estaba cada
 * palabra de la sopa, más el documento, el correo, el teléfono, la firma y la
 * IP de quien respondió. Bastaba responder una vez con datos de prueba para
 * sacar la clave y responder otra vez con todo bien; y `verificar`, sin sesión,
 * se los entregaba a cualquiera con el uuid y la huella del dispositivo.
 *
 * Por eso aquí no hay respuestas ni el detalle por pregunta: con «cuáles
 * acerté» y unos cuantos intentos se reconstruye la clave igual. `aciertos`
 * cuenta las preguntas con puntaje que obtuvieron el puntaje completo.
 */
export function resultadoPublico(
  preguntas: { id: string; puntaje: number }[],
  resultado: {
    nombre_completo: string;
    puntaje_total: number;
    created_at: Date;
    respuestas: { preguntaId: string; puntaje: number }[];
  },
) {
  const puntaje_maximo = preguntas.reduce((s, p) => s + p.puntaje, 0);
  const porcentaje = porcentajeDe(resultado.puntaje_total, puntaje_maximo);
  const calificables = preguntas.filter((p) => p.puntaje > 0);
  const aciertos = calificables.filter((p) => {
    const r = resultado.respuestas.find((x) => x.preguntaId === p.id);
    return !!r && r.puntaje >= p.puntaje;
  }).length;
  return {
    respondido: true as const,
    nombre: resultado.nombre_completo,
    fecha: resultado.created_at.toISOString(),
    puntaje_total: resultado.puntaje_total,
    puntaje_maximo,
    porcentaje,
    aprobado: puntaje_maximo > 0 && porcentaje >= MINIMO_APROBACION,
    aciertos,
    total_preguntas: calificables.length,
  };
}

export type ResultadoPublico = ReturnType<typeof resultadoPublico>;
