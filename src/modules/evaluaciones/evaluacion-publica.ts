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
