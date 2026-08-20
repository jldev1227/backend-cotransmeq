/**
 * Índice de las semillas HSEQ de formularios dinámicos.
 *
 * Trece artefactos, todos en `DRAFT` y sin assignments. Este archivo NO carga
 * nada: solo los reúne y expone la validación. La carga real la ejecuta el usuario
 * cuando HSEQ haya aprobado el contenido y el SQL de la migración esté aplicado.
 *
 * Importar este módulo no abre ninguna conexión ni importa Prisma. Es deliberado:
 * el validador tiene que poder correr en un test sin base.
 */

import { hseqFr04 } from './hseq-fr-04'
import { hseqFr05 } from './hseq-fr-05'
import { hseqFr07 } from './hseq-fr-07'
import { hseqFr08 } from './hseq-fr-08'
import { hseqFr09 } from './hseq-fr-09'
import { hseqFr17 } from './hseq-fr-17'
import { hseqFr21 } from './hseq-fr-21'
import { hseqFr22 } from './hseq-fr-22'
import { hseqFr33 } from './hseq-fr-33'
import { hseqFr40 } from './hseq-fr-40'
import { hseqFr42 } from './hseq-fr-42'
import { hseqFr43 } from './hseq-fr-43'
import { hseqFr56 } from './hseq-fr-56'
import type { SeedDefinition } from './types'

/**
 * Las trece semillas, en el orden de entrega que recomienda la especificación.
 *
 * El orden importa para la revisión, no para la carga: FR-22 primero porque es la
 * más pequeña que ejercita todos los patrones, luego los dos preoperacionales por
 * volumen y reglas, y el resto después.
 */
export const SEMILLAS_HSEQ: SeedDefinition[] = [
	hseqFr22,
	hseqFr08,
	hseqFr09,
	hseqFr04,
	hseqFr05,
	hseqFr07,
	hseqFr17,
	hseqFr21,
	hseqFr33,
	hseqFr40,
	hseqFr42,
	hseqFr43,
	hseqFr56
]

/** Búsqueda por código HSEQ. */
export function semillaPorCodigo(code: string): SeedDefinition | undefined {
	return SEMILLAS_HSEQ.find((s) => s.code === code.toUpperCase())
}

export {
	hseqFr04,
	hseqFr05,
	hseqFr07,
	hseqFr08,
	hseqFr09,
	hseqFr17,
	hseqFr21,
	hseqFr22,
	hseqFr33,
	hseqFr40,
	hseqFr42,
	hseqFr43,
	hseqFr56
}
export * from './types'
export * from './ids'
export * from './validate'
