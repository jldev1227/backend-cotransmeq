/**
 * Versión 2 de los dos preoperacionales: el MISMO contenido, partido en tres
 * etapas.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  NO se transcribe nada nuevo. Estas dos semillas se DERIVAN de `hseqFr08` y
 *  `hseqFr09`: mismas secciones, mismos campos, mismas reglas, mismas opciones.
 *  Lo único que cambia es el orden de tres secciones y una clave en
 *  `settings` de cada sección.
 *
 *  Derivarlas en vez de copiarlas es deliberado. Un preoperacional son 250-280
 *  campos; una copia manual habría divergido del original en el primer arreglo
 *  de una etiqueta, y entonces «la V2 replica el contenido del actual» dejaría
 *  de ser cierto sin que nadie lo notara.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Dónde vive la etapa ────────────────────────────────────────────────────
 *
 * En `form_sections.settings_json`, que ya es JSON libre y que el mapper ya
 * expone al portal dentro de `section.settings`. Cero migración: no hay columna
 * nueva, no hay tabla nueva, y un formulario sin `etapa` se comporta
 * exactamente como hoy (el portal lo trata como una sola etapa).
 *
 *   { "etapa": 1, "etapaTitulo": "Prealistamiento", "etapaFirma": true }
 *
 * Las tres claves son planas a propósito: `settings_json->>'etapa'` es una
 * consulta que cualquiera puede escribir, y anidarlas bajo un objeto solo
 * habría hecho más incómodo comprobar el reparto en producción.
 *
 * ── Por qué las etapas se definen POR TÍTULO ───────────────────────────────
 *
 * Los dos formularios tienen las mismas secciones en posiciones distintas: el
 * FR-09 intercala «Zona y puestos de pasajeros» e invierte tablero y luces.
 * Cualquier reparto por `sortOrder` habría funcionado en uno y roto el otro en
 * silencio. Por eso el reparto se declara con los títulos literales de las
 * secciones y el transformador ABORTA si encuentra un título que no sabe
 * clasificar: si mañana HSEQ añade una sección al final del FR-09, esto falla
 * al generar en vez de colarla en la etapa equivocada.
 */

import { hseqFr08 } from './hseq-fr-08'
import { hseqFr09 } from './hseq-fr-09'
import { decimal, foto, ordenarSecciones } from './factories'
import type { SeedDefinition } from './types'
import type { FormFieldDraft, FormSectionDraft } from '../../../src/modules/formularios-dinamicos/domain'

/** Las tres etapas, en orden de diligenciamiento. */
export interface EtapaPreoperacional {
	numero: number
	titulo: string
	descripcion: string
	/**
	 * La etapa se CIERRA con la firma del conductor.
	 *
	 * Solo la primera. Las otras dos se diligencian y ya: pedir tres firmas por
	 * un mismo recorrido no añade nada legalmente y multiplica por tres el
	 * trabajo del conductor.
	 */
	firma: boolean
}

export const ETAPAS_PREOPERACIONAL: EtapaPreoperacional[] = [
	{
		numero: 1,
		titulo: 'Prealistamiento',
		descripcion:
			'Antes de mover el vehículo: documentos, estado mecánico, dotación, salud y fatiga, combustible y kilometraje inicial. Se cierra con tu firma.',
		firma: true
	},
	{
		numero: 2,
		titulo: 'Durante el desplazamiento',
		descripcion:
			'En la primera parada segura: verificación en ruta y control de la propiedad del cliente. No se firma.',
		firma: false
	},
	{
		numero: 3,
		titulo: 'Cierre',
		descripcion: 'Al terminar el recorrido: estado final del vehículo y objetos olvidados. No se firma.',
		firma: false
	}
]

/**
 * Última sección de la etapa 1 en el orden original.
 *
 * Todo lo que en la semilla base va ANTES de esta sección (y ella misma) es
 * prealistamiento. Es la frontera que pidió HSEQ y la que fija el sentido de la
 * etapa: lo que se puede verificar con el vehículo parado.
 */
const CORTE_ETAPA_1 = 'Combustible, kilometraje y FUEC'

/**
 * Secciones que en la semilla base van al final y que aquí SUBEN a la etapa 1.
 *
 * «Novedades» trae las observaciones y la evidencia fotográfica, y «Firma del
 * conductor» la declaración. Las dos pertenecen al acto de certificar que el
 * vehículo es seguro, que ocurre antes de salir, no al terminar el recorrido.
 * El orden de este array es el orden en que quedan.
 */
const COLA_ETAPA_1 = ['Novedades', 'Firma del conductor']

const ETAPA_2 = [
	'Verificación durante el desplazamiento o en paradas seguras',
	'Propiedad del cliente / usuarios'
]

const ETAPA_3 = ['Verificación al finalizar el desplazamiento']

/**
 * Campos que cambian de sección al repartir en etapas.
 *
 * El kilometraje final se diligencia al cerrar el recorrido, pero el formato
 * original lo guarda junto al inicial, en la sección de combustible —que cae en
 * la etapa 1—. Dejarlo ahí obligaba al conductor a volver a la primera etapa
 * justo antes de enviar, que es exactamente lo que las etapas venían a evitar.
 *
 * Es el ÚNICO retoque de contenido sobre el formato original, y por eso se
 * declara aquí a la vista en lugar de esconderse dentro de la derivación.
 */
const TRASLADOS_DE_CAMPO: { campo: string; desde: string; hacia: string }[] = [
	{
		campo: 'Kilometraje final',
		desde: 'Combustible, kilometraje y FUEC',
		hacia: 'Verificación al finalizar el desplazamiento'
	}
]

/** Reasigna el `sortOrder` por posición, igual que hace la semilla base. */
function renumerar<T extends { sortOrder: number }>(campos: T[]): T[] {
	return campos.map((campo, i) => ({ ...campo, sortOrder: (i + 1) * 100 }))
}

/**
 * Mueve campos entre secciones ya repartidas.
 *
 * Estricto a propósito, con el mismo criterio que el reparto de secciones: si
 * el campo o alguna de las dos secciones no aparece, aborta. Un traslado que
 * fallara en silencio dejaría el campo en la etapa equivocada y nadie se
 * enteraría hasta que un conductor no pudiera cerrar su recorrido.
 */
function trasladarCampos(secciones: FormSectionDraft[], code: string): FormSectionDraft[] {
	let resultado = secciones
	for (const { campo, desde, hacia } of TRASLADOS_DE_CAMPO) {
		const origen = resultado.find((s) => s.title === desde)
		const destino = resultado.find((s) => s.title === hacia)
		if (!origen) {
			throw new Error(`${code}: no existe la sección «${desde}», origen del traslado de «${campo}».`)
		}
		if (!destino) {
			throw new Error(`${code}: no existe la sección «${hacia}», destino del traslado de «${campo}».`)
		}
		const movido = origen.fields.find((f) => f.label === campo)
		if (!movido) {
			throw new Error(`${code}: la sección «${desde}» no contiene el campo «${campo}».`)
		}
		resultado = resultado.map((s) => {
			if (s === origen) return { ...s, fields: renumerar(s.fields.filter((f) => f !== movido)) }
			if (s === destino) return { ...s, fields: renumerar([...s.fields, movido]) }
			return s
		})
	}
	return resultado
}

/**
 * Revisión de la versión por etapas.
 *
 *   1 → versión 2 del motor: la primera por etapas (`sourceRevision` `…-etapas`).
 *   2 → versión 3: añade «Evidencia de pausas activas» en la etapa 2.
 *   3 → versión 4: pide en la etapa 2 cada cuántas horas hizo pausa activa
 *       (obligatorio; las fotos siguen opcionales) y vuelve obligatorio el
 *       kilometraje final de la etapa 3.
 *
 * Subirla cambia TODOS los ids de la versión —se derivan de `sourceRevision`—,
 * así que el cargador escribe una versión NUEVA en vez de tocar la publicada,
 * que puede tener borradores colgando. Las asignaciones piloto NO cambian de id:
 * cuelgan de `REVISION_ASIGNACION`, y el cargador las mueve a la versión nueva.
 */
export const REVISION_ETAPAS = 3

const SUFIJO_ETAPAS = '-etapas'

function sufijoDeRevision(revision: number): string {
	return revision <= 1 ? SUFIJO_ETAPAS : `${SUFIJO_ETAPAS}-r${revision}`
}

/**
 * Campos que las revisiones posteriores AÑADEN a la versión por etapas.
 *
 * Mismo criterio estricto que los traslados: si la sección no existe o la clave
 * ya está, aborta en vez de colarlo en otro sitio o duplicarlo.
 */
const CAMPOS_NUEVOS: { desdeRevision: number; seccion: string; campo: FormFieldDraft }[] = [
	/// Se añaden en el orden del array: la pregunta de las horas va antes que las
	/// fotos aunque sea de una revisión posterior.
	{
		desdeRevision: 3,
		seccion: 'Verificación durante el desplazamiento o en paradas seguras',
		campo: {
			...decimal('pausas_activas_cada_horas', '¿Cada cuántas horas realizó pausa activa?', {
				required: true,
				helpText: 'En horas. Ejemplo: 2,5',
				validation: { min: 0.5, max: 24, precision: 1 }
			}),
			sortOrder: 0
		}
	},
	{
		desdeRevision: 2,
		seccion: 'Verificación durante el desplazamiento o en paradas seguras',
		campo: {
			...foto('pausas_activas_evidencia', 'Evidencia de pausas activas', 6, {
				helpText: 'Fotos de las pausas activas durante el recorrido (opcional).'
			}),
			sortOrder: 0
		}
	}
]

function anadirCampos(secciones: FormSectionDraft[], code: string, revision: number): FormSectionDraft[] {
	let resultado = secciones
	for (const { desdeRevision, seccion, campo } of CAMPOS_NUEVOS) {
		if (revision < desdeRevision) continue
		const destino = resultado.find((s) => s.title === seccion)
		if (!destino) throw new Error(`${code}: no existe la sección «${seccion}» para añadir «${campo.label}».`)
		if (resultado.some((s) => s.fields.some((f) => f.key === campo.key))) {
			throw new Error(`${code}: ya existe un campo con la clave «${campo.key}».`)
		}
		resultado = resultado.map((s) => (s === destino ? { ...s, fields: renumerar([...s.fields, campo]) } : s))
	}
	return resultado
}

/**
 * Cambios de las revisiones posteriores sobre campos que ya existen.
 *
 * Mismo criterio estricto: si la clave no aparece, aborta en vez de dejar el
 * campo como estaba sin avisar.
 */
const AJUSTES_DE_CAMPO: { desdeRevision: number; campo: string; cambios: Partial<FormFieldDraft> }[] = [
	{
		desdeRevision: 3,
		campo: 'km_final',
		cambios: { required: true, helpText: 'Al terminar el desplazamiento. Es obligatorio para cerrar el preoperacional.' }
	}
]

function ajustarCampos(secciones: FormSectionDraft[], code: string, revision: number): FormSectionDraft[] {
	let resultado = secciones
	for (const { desdeRevision, campo, cambios } of AJUSTES_DE_CAMPO) {
		if (revision < desdeRevision) continue
		if (!resultado.some((s) => s.fields.some((f) => f.key === campo))) {
			throw new Error(`${code}: no existe el campo «${campo}» que la revisión ${desdeRevision} ajusta.`)
		}
		resultado = resultado.map((s) => ({
			...s,
			fields: s.fields.map((f) => (f.key === campo ? { ...f, ...cambios } : f))
		}))
	}
	return resultado
}

function etapaDe(numero: number): EtapaPreoperacional {
	const etapa = ETAPAS_PREOPERACIONAL.find((e) => e.numero === numero)
	if (!etapa) throw new Error(`No existe la etapa ${numero}.`)
	return etapa
}

/** Marca una sección con su etapa, conservando lo que ya hubiera en `settings`. */
function conEtapa(section: FormSectionDraft, numero: number): FormSectionDraft {
	const etapa = etapaDe(numero)
	return {
		...section,
		settings: {
			...(section.settings ?? {}),
			etapa: etapa.numero,
			etapaTitulo: etapa.titulo,
			etapaFirma: etapa.firma
		}
	}
}

function buscar(secciones: FormSectionDraft[], titulo: string, code: string): FormSectionDraft {
	const encontrada = secciones.find((s) => s.title === titulo)
	if (!encontrada) {
		throw new Error(
			`${code}: no hay ninguna sección titulada «${titulo}». ` +
				'El reparto en etapas se declara por título; si HSEQ renombró la sección, ' +
				'actualiza `preoperacional-etapas.ts` en vez de dejar que se reparta sola.'
		)
	}
	return encontrada
}

/**
 * Reparte las secciones de una semilla base en las tres etapas.
 *
 * Devuelve la lista COMPLETA en el orden nuevo, cada sección con su etapa en
 * `settings`. Aborta si sobra o falta alguna: el reparto tiene que ser una
 * partición exacta, o el formulario perdería secciones sin avisar.
 */
export function repartirEnEtapas(base: SeedDefinition): FormSectionDraft[] {
	const origen = base.version.sections
	const corte = origen.findIndex((s) => s.title === CORTE_ETAPA_1)
	if (corte < 0) {
		throw new Error(
			`${base.code}: no se encontró la sección «${CORTE_ETAPA_1}», que marca el final de la etapa 1.`
		)
	}

	/// Todo lo anterior al corte, en su orden original. Se toma por POSICIÓN
	/// relativa al título del corte, no por `sortOrder`: el `sortOrder` de la
	/// semilla lo asigna `ordenarSecciones` y no significa nada por sí mismo.
	const cabeza = origen.slice(0, corte + 1)

	const clasificadasAparte = new Set([...COLA_ETAPA_1, ...ETAPA_2, ...ETAPA_3])

	/// Verificación dura: después del corte no puede quedar nada sin clasificar.
	const huerfanas = origen.slice(corte + 1).filter((s) => !clasificadasAparte.has(s.title))
	if (huerfanas.length) {
		throw new Error(
			`${base.code}: secciones sin etapa asignada después de «${CORTE_ETAPA_1}»: ` +
				huerfanas.map((s) => `«${s.title}»`).join(', ') +
				'. Clasifícalas en `preoperacional-etapas.ts`.'
		)
	}
	/// …y antes del corte tampoco puede haber ninguna de las que van aparte, o se
	/// duplicaría.
	const duplicadas = cabeza.filter((s) => clasificadasAparte.has(s.title))
	if (duplicadas.length) {
		throw new Error(
			`${base.code}: ${duplicadas.map((s) => `«${s.title}»`).join(', ')} aparece(n) antes de ` +
				`«${CORTE_ETAPA_1}» y también en el reparto explícito. Revisa el orden de la semilla base.`
		)
	}

	const secciones = [
		...cabeza.map((s) => conEtapa(s, 1)),
		...COLA_ETAPA_1.map((t) => conEtapa(buscar(origen, t, base.code), 1)),
		...ETAPA_2.map((t) => conEtapa(buscar(origen, t, base.code), 2)),
		...ETAPA_3.map((t) => conEtapa(buscar(origen, t, base.code), 3))
	]

	if (secciones.length !== origen.length) {
		throw new Error(
			`${base.code}: el reparto en etapas produjo ${secciones.length} secciones y la semilla base tiene ` +
				`${origen.length}. Tiene que ser una partición exacta.`
		)
	}

	const movidas = trasladarCampos(secciones, base.code)
	return ordenarSecciones(
		ajustarCampos(anadirCampos(movidas, base.code, REVISION_ETAPAS), base.code, REVISION_ETAPAS)
	)
}

/**
 * Deriva la semilla por etapas de una semilla base.
 *
 * `sourceRevision` gana el sufijo `-etapas`, y eso es lo que hace que todos los
 * ids (versión, secciones, campos, opciones) sean nuevos: `seedIds` los deriva
 * de `code + revisión`. El id del FORMULARIO no depende de la revisión, así que
 * la V2 cuelga del mismo `form_definitions` que la V1 — que es justo lo que
 * significa «versión 2 del mismo formulario».
 */
function derivarPorEtapas(base: SeedDefinition): SeedDefinition {
	return {
		...base,
		/// El código y el slug NO cambian: es el mismo formulario HSEQ.
		source: {
			...base.source,
			sourceRevision: `${base.source.sourceRevision}${sufijoDeRevision(REVISION_ETAPAS)}`
		},
		warnings: [
			...base.warnings,
			'VERSIÓN DERIVADA. El contenido no se transcribió de nuevo: se toma tal cual de la semilla de la versión 1 y solo se reordena y se etiqueta con la etapa. Cualquier corrección de contenido se hace en `hseq-fr-08.ts` / `hseq-fr-09.ts` y se propaga aquí al regenerar.',
			'«Novedades» y «Firma del conductor» se movieron al final de la ETAPA 1: la certificación de que el vehículo es seguro ocurre antes de salir, no al terminar el recorrido.',
			'La etapa vive en `form_sections.settings_json` (`etapa`, `etapaTitulo`, `etapaFirma`). No hay migración de esquema. Un formulario sin esas claves se comporta como hasta ahora.',
			'ES UN SOLO ENVÍO que avanza por etapas, no tres envíos. Firmar la etapa 1 guarda el borrador; no entrega nada. El envío sale cuando se cierra la etapa 3.',
			'El campo «Kilometraje final» sigue en la sección de combustible (ETAPA 1) aunque se diligencie al terminar: moverlo habría cambiado el contenido, y la V2 replica la V1. El conductor puede volver a la etapa 1 a completarlo antes de enviar.',
			...(REVISION_ETAPAS >= 2
				? ['Revisión 2 (versión 3 del motor): añade en la ETAPA 2 el campo opcional «Evidencia de pausas activas» (foto, hasta 6).']
				: []),
			...(REVISION_ETAPAS >= 3
				? [
						'Revisión 3 (versión 4 del motor): añade en la ETAPA 2 «¿Cada cuántas horas realizó pausa activa?» (obligatorio, en horas) y vuelve obligatorio el «Kilometraje final» de la ETAPA 3.'
					]
				: [])
		],
		version: {
			...base.version,
			title: `${base.version.title} (por etapas)`,
			settings: {
				...(base.version.settings ?? {}),
				/// Bandera, no copia del reparto: la fuente de verdad de qué sección
				/// va en qué etapa es `settings` de cada sección, y duplicar la tabla
				/// aquí solo abriría la puerta a que las dos divergieran.
				modo: 'ETAPAS'
			},
			sections: repartirEnEtapas(base)
		}
	}
}

/** HSEQ-FR-08 por etapas. Versión 2 del mismo formulario. */
export const hseqFr08Etapas: SeedDefinition = derivarPorEtapas(hseqFr08)

/** HSEQ-FR-09 por etapas. Versión 2 del mismo formulario. */
export const hseqFr09Etapas: SeedDefinition = derivarPorEtapas(hseqFr09)

/**
 * Las dos semillas por etapas.
 *
 * NO están en `SEMILLAS_HSEQ`. El cargador general escribe siempre
 * `version_number: 1` y dejaría estas dos chocando contra
 * `uq_form_versions_number` con la V1 ya cargada; y el inventario de HSEQ cuenta
 * trece formatos, no quince. Se cargan con `cargar-etapas.ts`.
 */
export const SEMILLAS_ETAPAS: SeedDefinition[] = [hseqFr08Etapas, hseqFr09Etapas]

/**
 * Revisión de la que derivan los ids de las asignaciones piloto, por código.
 *
 * Es la de la PRIMERA versión por etapas y no cambia al subir `REVISION_ETAPAS`:
 * así reejecutar el cargador mueve las mismas asignaciones a la versión nueva en
 * vez de crear otras —que el conductor vería como formularios duplicados—.
 */
export const REVISION_ASIGNACION: Record<string, string> = {
	[hseqFr08.code]: `${hseqFr08.source.sourceRevision}${SUFIJO_ETAPAS}`,
	[hseqFr09.code]: `${hseqFr09.source.sourceRevision}${SUFIJO_ETAPAS}`
}
