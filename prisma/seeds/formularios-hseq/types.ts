/**
 * Tipos de las semillas HSEQ.
 *
 * Una semilla es un ARTEFACTO REVISABLE, no una carga a la base. Describe un
 * formulario completo en `DRAFT`, con su procedencia documental y los warnings de
 * transcripción, para que HSEQ lo apruebe antes de que exista en producción.
 *
 * Ninguna semilla trae assignments: publicar y asignar son decisiones humanas,
 * y una semilla que se cargara ya asignada le aparecería a los conductores sin
 * que nadie la haya revisado.
 */

import type {
	AssignmentFrequency,
	FormVersionDraft,
	LimitPolicy
} from '../../../src/modules/formularios-dinamicos/domain'

/** Procedencia del documento original. */
export interface SeedSourceMetadata {
	/** Nombre del archivo tal como venía en el ZIP. */
	sourceFile: string
	/** Código del encabezado interno de la hoja. */
	sourceCode: string
	/**
	 * Revisión del ENCABEZADO INTERNO, no la del nombre del archivo.
	 *
	 * Cuando discrepan (varios archivos dicen «V1» en el nombre y «Versión 2»
	 * dentro) se conserva la del encabezado, que es la que HSEQ controla, y la
	 * discrepancia se registra en `warnings`.
	 */
	sourceRevision: string
	/** Fecha del encabezado interno, `YYYY-MM-DD`. */
	sourceDate: string
	/** Hoja de la que se transcribió. */
	sourceSheet: string
	importedAt: string
	importStatus: 'DRAFT_REQUIRES_HSEQ_REVIEW'
}

export interface SeedDefinition {
	/** Código HSEQ. Es la identidad y debe ser único entre las semillas. */
	code: string
	slug: string
	name: string
	description: string | null
	ownerArea: string

	/**
	 * Frecuencia, límite y contexto SUGERIDOS.
	 *
	 * No crean nada: son la propuesta que el asignador precarga cuando HSEQ decida
	 * publicar. Editables sin tocar la semilla.
	 */
	suggested: {
		frequency: AssignmentFrequency
		limitPolicy: LimitPolicy
		context: Record<string, { required?: boolean }>
		/** Nota para HSEQ sobre por qué se propone esa configuración. */
		rationale: string
	}

	source: SeedSourceMetadata

	/**
	 * Advertencias de transcripción.
	 *
	 * Se conservan en el artefacto en vez de corregirse en silencio: erratas del
	 * original, discrepancias de versión, campos que el Excel dejaba ambiguos.
	 * El checklist previo a publicar las usa como lista de verificación.
	 */
	warnings: string[]

	/** El árbol, en la misma forma que consume `validateFormDefinition`. */
	version: FormVersionDraft
}

/** Registro de una semilla en el índice. */
export interface SeedEntry {
	code: string
	definition: SeedDefinition
}
