import { z } from 'zod';

export const tipoPreguntaEnum = z.enum([
  'OPCION_UNICA',
  'OPCION_MULTIPLE',
  'NUMERICA',
  'TEXTO',
  'RELACION',
  'VERDADERO_FALSO',
  'SOPA_LETRAS',
]);

export const opcionSchema = z.object({
  id: z.string().uuid().optional(), // ID existente para actualizaciones
  texto: z.string().min(1),
  esCorrecta: z.boolean().default(false),
});

export const preguntaSchema = z.object({
  id: z.string().uuid().optional(), // ID existente para actualizaciones
  texto: z.string().min(1),
  tipo: tipoPreguntaEnum,
  puntaje: z.number().int().min(0), // Permitir 0 para preguntas de texto
  opciones: z.array(opcionSchema).optional(),
  relacionIzq: z.array(z.string()).optional(),
  relacionDer: z.array(z.string()).optional(),
  respuestaCorrecta: z.number().optional().nullable(), // Para preguntas numéricas
  /**
   * Sopa de letras. El editor manda `palabras`, `tamano` y `diagonales`; si
   * reenvía una configuración ya generada (`cuadricula`), el backend la
   * conserva mientras la entrada no cambie.
   */
  configuracion: z
    .object({
      palabras: z.array(z.string()).min(1),
      tamano: z.number().int().min(6).max(20).optional(),
      diagonales: z.boolean().optional(),
    })
    .passthrough()
    .optional()
    .nullable(),
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
