import { z } from 'zod';

export const tipoPreguntaEnum = z.enum([
  'OPCION_UNICA',
  'OPCION_MULTIPLE',
  'NUMERICA',
  'TEXTO',
  'RELACION',
]);

export const opcionSchema = z.object({
  texto: z.string().min(1),
  esCorrecta: z.boolean().default(false),
});

export const preguntaSchema = z.object({
  texto: z.string().min(1),
  tipo: tipoPreguntaEnum,
  puntaje: z.number().int().min(0), // Permitir 0 para preguntas de texto
  opciones: z.array(opcionSchema).optional(),
  relacionIzq: z.array(z.string()).optional(),
  relacionDer: z.array(z.string()).optional(),
  respuestaCorrecta: z.number().optional().nullable(), // Para preguntas numéricas
});

export const evaluacionSchema = z.object({
  titulo: z.string().min(1),
  descripcion: z.string().optional().nullable(),
  requiere_firma: z.boolean().default(false),
  preguntas: z.array(preguntaSchema),
});

export type TipoPregunta = z.infer<typeof tipoPreguntaEnum>;
export type Opcion = z.infer<typeof opcionSchema>;
export type Pregunta = z.infer<typeof preguntaSchema>;
export type Evaluacion = z.infer<typeof evaluacionSchema>;
