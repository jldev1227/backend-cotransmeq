/**
 * Patrones reutilizables de las semillas HSEQ.
 *
 * Son los nueve del inventario documental. Cada llamada MATERIALIZA campos
 * independientes: no queda ningún vínculo con la factory, igual que insertar una
 * plantilla desde el builder copia su snapshot. Editar una factory no altera las
 * semillas ya transcritas hasta que se vuelvan a generar, y eso es deliberado —
 * las semillas son artefactos revisables, no vistas de una definición viva.
 *
 * El orden (`sortOrder`) NO se fija aquí: lo asigna `seccion()` por posición en el
 * array. Numerar a mano en 13 formularios con cientos de campos garantiza
 * duplicados, que es exactamente lo que `uq_form_fields_order` rechaza.
 */

import type {
	FormFieldDraft,
	FormOptionDraft,
	FormSectionDraft,
	Rule
} from '../../../src/modules/formularios-dinamicos/domain'

// ─── Utilidades de construcción ──────────────────────────────────────────────

/** Campo sin `sortOrder`; lo pone `seccion()`. */
export type Campo = Omit<FormFieldDraft, 'sortOrder' | 'options' | 'children'> & {
	options?: Omit<FormOptionDraft, 'sortOrder'>[]
	children?: Campo[]
}

function conOrden(campos: Campo[]): FormFieldDraft[] {
	return campos.map((campo, index) => ({
		...campo,
		sortOrder: (index + 1) * 100,
		...(campo.options
			? { options: campo.options.map((o, i) => ({ ...o, sortOrder: (i + 1) * 100 })) }
			: {}),
		...(campo.children ? { children: conOrden(campo.children) } : {})
	})) as FormFieldDraft[]
}

/**
 * Sección con sus campos.
 *
 * Aplana los arrays anidados que devuelven las factories: `itemCNCNA` produce DOS
 * campos (estado + observación condicional) y escribirlos como `...spread` en cada
 * llamada haría el código de las semillas ilegible.
 */
export function seccion(
	key: string,
	title: string,
	campos: (Campo | Campo[])[],
	extra: { description?: string | null } = {}
): FormSectionDraft {
	return {
		key,
		title,
		description: extra.description ?? null,
		sortOrder: 0,
		settings: {},
		fields: conOrden(campos.flat())
	}
}

/** Asigna el `sortOrder` de las secciones por posición. */
export function ordenarSecciones(secciones: FormSectionDraft[]): FormSectionDraft[] {
	return secciones.map((s, i) => ({ ...s, sortOrder: (i + 1) * 100 }))
}

const base = (key: string, label: string): Campo => ({
	key,
	type: 'SHORT_TEXT',
	label,
	helpText: null,
	placeholder: null,
	required: false,
	config: {},
	validation: {},
	visibilityRule: null,
	defaultValue: null
})

// ─── Campos simples ──────────────────────────────────────────────────────────

export function texto(key: string, label: string, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'SHORT_TEXT', ...o }
}

export function textoLargo(key: string, label: string, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'LONG_TEXT', ...o }
}

export function entero(key: string, label: string, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'INTEGER', ...o }
}

export function decimal(key: string, label: string, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'DECIMAL', ...o }
}

export function fecha(key: string, label: string, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'DATE', ...o }
}

export function hora(key: string, label: string, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'TIME', ...o }
}

export function siNo(key: string, label: string, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'BOOLEAN', ...o }
}

export function info(key: string, label: string, cuerpo: string): Campo {
	return { ...base(key, label), type: 'INFO', helpText: cuerpo }
}

export function opciones(
	key: string,
	label: string,
	valores: { value: string; label: string; color?: string }[],
	o: Partial<Campo> = {}
): Campo {
	return {
		...base(key, label),
		type: 'SINGLE_CHOICE',
		options: valores.map((v) => ({
			value: v.value,
			label: v.label,
			color: v.color ?? null,
			score: null,
			metadata: {}
		})),
		...o
	}
}

export function multiple(
	key: string,
	label: string,
	valores: { value: string; label: string }[],
	o: Partial<Campo> = {}
): Campo {
	return {
		...base(key, label),
		type: 'MULTIPLE_CHOICE',
		options: valores.map((v) => ({ value: v.value, label: v.label, color: null, score: null, metadata: {} })),
		...o
	}
}

export function foto(key: string, label: string, maxFiles = 6, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'PHOTO', validation: { maxFiles }, ...o }
}

export function firma(key: string, label: string, o: Partial<Campo> = {}): Campo {
	return { ...base(key, label), type: 'SIGNATURE', validation: { maxFiles: 1 }, ...o }
}

// ─── 1–4. Escalas de estado ──────────────────────────────────────────────────

export const ESCALA_C_NC_NA = [
	{ value: 'C', label: 'Cumple', color: 'emerald' },
	{ value: 'NC', label: 'No cumple', color: 'red' },
	{ value: 'NA', label: 'No aplica', color: 'gray' }
] as const

export const ESCALA_SI_NO_NA = [
	{ value: 'SI', label: 'Sí', color: 'emerald' },
	{ value: 'NO', label: 'No', color: 'red' },
	{ value: 'NA', label: 'No aplica', color: 'gray' }
] as const

export const ESCALA_B_M_R = [
	{ value: 'B', label: 'Bueno', color: 'emerald' },
	{ value: 'M', label: 'Malo', color: 'red' },
	{ value: 'R', label: 'Regular', color: 'amber' }
] as const

export const ESCALA_B_M_CR = [
	{ value: 'B', label: 'Bueno', color: 'emerald' },
	{ value: 'M', label: 'Malo', color: 'red' },
	{ value: 'CR', label: 'Cambiar / Reemplazar', color: 'amber' }
] as const

/** Solo C/NC, sin «no aplica». Lo usa FR-21, cuyo original no ofrece NA. */
export const ESCALA_C_NC = [
	{ value: 'C', label: 'Cumple', color: 'emerald' },
	{ value: 'NC', label: 'No cumple', color: 'red' }
] as const

export const ESCALA_B_M_NA = [
	{ value: 'B', label: 'Bueno', color: 'emerald' },
	{ value: 'M', label: 'Malo', color: 'red' },
	{ value: 'NA', label: 'No aplica', color: 'gray' }
] as const

type Escala = readonly { value: string; label: string; color?: string }[]

/**
 * Ítem de inspección: estado + observación que se exige ante un estado negativo.
 *
 * Produce DOS campos y la regla que los une. Es el patrón central de casi todos
 * los formatos HSEQ, y la observación por ÍTEM (no por sección) es lo que permite
 * saber después *qué* falló y *por qué*: una observación por sección obligaría a
 * leer texto libre para averiguar a cuál de treinta ítems se refería.
 *
 * La regla se declara en el campo de estado con `targetFieldKey` a la observación,
 * que es la forma canónica: la condición mira el estado y el efecto recae sobre
 * otro campo.
 */
export function itemInspeccion(
	key: string,
	label: string,
	opcionesEstado: Escala,
	config: {
		/** Valores que obligan a observar. Por defecto los negativos de la escala. */
		exigeObservacionEn?: string[]
		required?: boolean
		helpText?: string | null
		/** Etiqueta de la observación. Por defecto «Observación». */
		observacionLabel?: string
	} = {}
): Campo[] {
	const negativos =
		config.exigeObservacionEn ??
		opcionesEstado.filter((o) => ['NC', 'NO', 'M', 'CR'].includes(o.value)).map((o) => o.value)

	const obsKey = `${key}_obs`

	const estado: Campo = {
		...base(key, label),
		type: 'SINGLE_CHOICE',
		required: config.required ?? true,
		helpText: config.helpText ?? null,
		options: opcionesEstado.map((o) => ({
			value: o.value,
			label: o.label,
			color: o.color ?? null,
			score: null,
			metadata: {}
		})),
		visibilityRule:
			negativos.length > 0
				? ({
						version: 1,
						/// `in` y no varias reglas `equals`: una sola regla con la lista de
						/// valores negativos es lo que el rule builder muestra como «está
						/// entre», y es una sola arista en el grafo de ciclos.
						all: [{ fieldKey: key, operator: 'in', value: negativos }],
						effect: { action: 'require', targetFieldKey: obsKey }
					} satisfies Rule)
				: null
	}

	const observacion: Campo = {
		...base(obsKey, config.observacionLabel ?? `Observación — ${label}`),
		type: 'LONG_TEXT',
		helpText: 'Describe el hallazgo concreto.',
		validation: { maxLength: 2000 },
		/// SEGUNDA regla, sobre el propio campo: además de exigirse, la observación
		/// se OCULTA cuando el estado es correcto. En un preoperacional de 120 ítems,
		/// mostrar 120 áreas de texto vacías hace la pantalla inusable; así solo
		/// aparecen las de los ítems que fallaron.
		///
		/// Son dos reglas y no una porque cada campo lleva UNA `visibilityRule`: el
		/// `require` vive en el estado y el `show` en la observación. Las dos generan
		/// la misma arista `estado → observación`, así que no introducen ciclos.
		visibilityRule: {
			version: 1,
			all: [{ fieldKey: key, operator: 'in', value: negativos }],
			effect: { action: 'show', targetFieldKey: obsKey }
		} satisfies Rule
	}

	return negativos.length > 0 ? [estado, observacion] : [estado]
}

/** Atajo: lista de ítems C/NC/NA con observación condicional. */
export function itemsCNCNA(
	items: { key: string; label: string; required?: boolean; helpText?: string }[]
): Campo[] {
	return items.flatMap((i) =>
		itemInspeccion(i.key, i.label, ESCALA_C_NC_NA, {
			required: i.required ?? true,
			helpText: i.helpText ?? null
		})
	)
}

/** Atajo: lista de ítems B/M/NA (los preoperacionales). */
export function itemsBMNA(
	items: { key: string; label: string; required?: boolean }[]
): Campo[] {
	return items.flatMap((i) =>
		itemInspeccion(i.key, i.label, ESCALA_B_M_NA, { required: i.required ?? true })
	)
}

/** Atajo: lista de ítems SÍ/NO/NA. */
export function itemsSiNoNa(
	items: { key: string; label: string; required?: boolean }[]
): Campo[] {
	return items.flatMap((i) =>
		itemInspeccion(i.key, i.label, ESCALA_SI_NO_NA, { required: i.required ?? true })
	)
}

// ─── 5. Hallazgo / plan de acción ────────────────────────────────────────────

/**
 * Grupo repetible de hallazgos con su medida de control.
 *
 * Repetible y no N campos fijos: el Excel imprime cuatro o cinco filas en blanco
 * porque el papel obliga, pero una inspección puede no tener ninguno o tener
 * doce. Con campos fijos, la inspección de doce hallazgos se anota apretada en el
 * margen —que es exactamente lo que pasa hoy—.
 */
export function hallazgoPlanAccion(
	key = 'plan_accion',
	label = 'Hallazgos y plan de acción',
	config: { conFecha?: boolean; conRecursos?: boolean; minRows?: number } = {}
): Campo {
	const hijos: Campo[] = [
		textoLargo('hallazgo_descripcion', 'Descripción del hallazgo', {
			required: true,
			validation: { maxLength: 2000 }
		}),
		textoLargo('hallazgo_medida', 'Medida de control / actividad propuesta', {
			required: true,
			validation: { maxLength: 2000 }
		}),
		texto('hallazgo_responsable', 'Responsable', { required: true, validation: { maxLength: 150 } }),
		texto('hallazgo_cargo', 'Cargo del responsable', { validation: { maxLength: 100 } })
	]
	if (config.conRecursos) {
		hijos.push(textoLargo('hallazgo_recursos', 'Recursos requeridos', { validation: { maxLength: 1000 } }))
	}
	if (config.conFecha !== false) {
		hijos.push(fecha('hallazgo_fecha_cumplimiento', 'Fecha de cumplimiento', { required: true }))
	}

	return {
		...base(key, label),
		type: 'REPEATABLE_GROUP',
		helpText: 'Agrega una fila por cada hallazgo. Si no hubo hallazgos, deja el grupo vacío.',
		validation: config.minRows ? { minRows: config.minRows, maxRows: 30 } : { maxRows: 30 },
		children: hijos
	}
}

// ─── 6. Identificación del inspector ─────────────────────────────────────────

/**
 * Quién inspecciona, dónde y cuándo.
 *
 * El nombre y el cargo se piden aunque el conductor esté autenticado: quien
 * diligencia no siempre es quien firma como autoridad ejecutante, y el original
 * distingue las dos figuras. La fecha también, porque una inspección puede
 * registrarse el día siguiente y `business_date` no sustituye a la fecha real del
 * hecho.
 */
export function identificacionInspector(
	config: { conLugar?: boolean; conQuienAtiende?: boolean; prefijo?: string } = {}
): Campo[] {
	const p = config.prefijo ?? ''
	const campos: Campo[] = [
		texto(`${p}inspector_nombre`, 'Nombre y apellido de quien inspecciona', {
			required: true,
			validation: { maxLength: 150 }
		}),
		texto(`${p}inspector_cargo`, 'Cargo / rol', { required: true, validation: { maxLength: 100 } }),
		fecha(`${p}fecha_inspeccion`, 'Fecha de la inspección', { required: true })
	]
	if (config.conLugar !== false) {
		campos.splice(
			2,
			0,
			texto(`${p}lugar_inspeccion`, 'Lugar / sede de la inspección', {
				required: true,
				validation: { maxLength: 150 }
			})
		)
	}
	if (config.conQuienAtiende) {
		campos.push(
			texto(`${p}atiende_nombre`, 'Nombre de quien atiende la inspección', {
				validation: { maxLength: 150 }
			}),
			texto(`${p}atiende_cargo`, 'Cargo de quien atiende', { validation: { maxLength: 100 } })
		)
	}
	return campos
}

// ─── 7. Contexto del vehículo ────────────────────────────────────────────────

/**
 * Referencia al vehículo con snapshot de sus datos legibles.
 *
 * `LOOKUP` y no texto libre: el snapshot (placa, marca, clase, modelo) queda
 * dentro del envío, así que el informe sigue diciendo qué vehículo era aunque el
 * vehículo se dé de baja o cambie de placa. Un texto libre además admite
 * «AAA123», «aaa-123» y «AAA 123» como tres vehículos distintos.
 */
export function contextoVehiculo(
	config: { required?: boolean; conKilometraje?: boolean } = {}
): Campo[] {
	const campos: Campo[] = [
		{
			...base('vehiculo', 'Vehículo'),
			type: 'LOOKUP',
			required: config.required ?? true,
			config: { source: 'VEHICLE', snapshot: ['placa', 'marca', 'clase_vehiculo', 'modelo'] },
			helpText: 'Selecciona la placa. Se guardan marca, clase y modelo junto al envío.'
		}
	]
	if (config.conKilometraje) {
		campos.push(
			entero('kilometraje', 'Kilometraje actual', {
				required: true,
				validation: { min: 0, max: 5_000_000 }
			})
		)
	}
	return campos
}

/** Alternativa cuando el original pide lugar O placa (equipos fijos y móviles). */
export function ubicacionOVehiculo(): Campo[] {
	return [
		opciones('ubicacion_tipo', 'El elemento inspeccionado está en…', [
			{ value: 'VEHICULO', label: 'Un vehículo' },
			{ value: 'SEDE', label: 'Una sede o instalación' }
		], { required: true }),
		{
			...base('vehiculo', 'Vehículo'),
			type: 'LOOKUP',
			config: { source: 'VEHICLE', snapshot: ['placa', 'marca', 'clase_vehiculo'] },
			/// Se muestra solo si es un vehículo: pedir placa para un extintor de
			/// oficina obliga al inspector a inventarse un valor.
			visibilityRule: {
				version: 1,
				all: [{ fieldKey: 'ubicacion_tipo', operator: 'equals', value: 'VEHICULO' }],
				effect: { action: 'show', targetFieldKey: 'vehiculo' }
			} satisfies Rule
		},
		texto('ubicacion_sede', 'Sede o lugar de ubicación', {
			validation: { maxLength: 150 },
			visibilityRule: {
				version: 1,
				all: [{ fieldKey: 'ubicacion_tipo', operator: 'equals', value: 'SEDE' }],
				effect: { action: 'show', targetFieldKey: 'ubicacion_sede' }
			} satisfies Rule
		})
	]
}

// ─── 8. Evidencia fotográfica ────────────────────────────────────────────────

export function evidenciaFotografica(
	key = 'registro_visual',
	label = 'Registro visual',
	config: { maxFiles?: number; conDescripcion?: boolean; helpText?: string } = {}
): Campo[] {
	const campos: Campo[] = [
		foto(key, label, config.maxFiles ?? 8, {
			helpText:
				config.helpText ??
				'Las fotos se comprimen en el teléfono antes de guardarse. Documenta lo que no se entiende solo con texto.'
		})
	]
	if (config.conDescripcion !== false) {
		campos.push(
			textoLargo(`${key}_descripcion`, 'Descripción del registro visual', {
				validation: { maxLength: 2000 }
			})
		)
	}
	return campos
}

// ─── 9. Declaración y firma ──────────────────────────────────────────────────

/**
 * Bloque de declaración + firma.
 *
 * El texto de la declaración va en un `INFO` y no en el `helpText` de la firma:
 * es una manifestación con valor documental, tiene que leerse como párrafo y
 * quedar visible en el recibo, no como letra pequeña bajo un control.
 */
export function declaracionFirma(
	config: {
		key?: string
		declaracion: string
		label?: string
		conNombre?: boolean
		conIdentificacion?: boolean
		required?: boolean
	}
): Campo[] {
	const key = config.key ?? 'firma'
	const campos: Campo[] = [
		info(`${key}_declaracion`, 'Declaración', config.declaracion),
		firma(key, config.label ?? 'Firma', { required: config.required ?? true })
	]
	if (config.conNombre !== false) {
		campos.push(
			texto(`${key}_nombre`, 'Nombre y apellido de quien firma', {
				required: true,
				validation: { maxLength: 150 }
			})
		)
	}
	if (config.conIdentificacion) {
		campos.push(
			texto(`${key}_identificacion`, 'Número de identificación', {
				required: true,
				validation: { maxLength: 20 }
			})
		)
	}
	return campos
}

/** Dos firmas independientes: entrega y recibe (FR-56). */
export function firmasEntregaRecibe(): Campo[] {
	return [
		info(
			'firmas_declaracion',
			'Declaración de entrega y recibo',
			'El vehículo fue ensayado y revisado por las partes a entera satisfacción. A partir de la fecha queda bajo la responsabilidad de quien lo recibe, que se compromete a velar por su conservación, buen funcionamiento mecánico y mantenimiento, óptimas condiciones de aseo y presentación, y a hacer uso prudente del mismo exclusivamente en actividades misionales de TRANSMERALDA S.A.S. ZOMAC. Debe ser devuelto en iguales condiciones.'
		),
		firma('firma_entrega', 'Firma de quien entrega', { required: true }),
		texto('entrega_nombre', 'Nombre de quien entrega', { required: true, validation: { maxLength: 150 } }),
		texto('entrega_identificacion', 'C.C. de quien entrega', { required: true, validation: { maxLength: 20 } }),
		firma('firma_recibe', 'Firma de quien recibe', { required: true }),
		texto('recibe_nombre', 'Nombre de quien recibe', { required: true, validation: { maxLength: 150 } }),
		texto('recibe_identificacion', 'C.C. de quien recibe', { required: true, validation: { maxLength: 20 } })
	]
}

// ─── Inventario con cantidad y estado (botiquín, kit de derrames) ────────────

/**
 * Inventario de elementos con cantidad esperada y estado.
 *
 * Cada elemento es un grupo de campos hermanos con prefijo, NO una fila de
 * repetible: la lista de elementos la fija el documento y el inspector no debe
 * poder añadir ni quitar renglones. Un repetible aquí permitiría entregar un
 * botiquín «completo» con tres elementos.
 */
export function itemInventario(
	key: string,
	label: string,
	unidadEsperada: string,
	escala: Escala = ESCALA_B_M_CR,
	config: { conVencimiento?: boolean; conCantidad?: boolean } = {}
): Campo[] {
	const campos: Campo[] = []

	if (config.conCantidad !== false) {
		campos.push(
			entero(`${key}_cantidad`, `${label} — cantidad encontrada`, {
				required: true,
				helpText: `Esperado: ${unidadEsperada}. Escribe 0 si no hay ninguno.`,
				validation: { min: 0, max: 9999 }
			})
		)
	}
	if (config.conVencimiento) {
		campos.push(fecha(`${key}_vencimiento`, `${label} — fecha de vencimiento`))
	}

	campos.push(
		...itemInspeccion(`${key}_estado`, `${label} — estado`, escala, {
			required: true,
			observacionLabel: `${label} — observación`
		})
	)
	return campos
}

/** Elemento de kit con completo/incompleto y cantidad faltante (FR-22). */
export function itemKit(key: string, label: string, cantidadEsperada: string): Campo[] {
	const estadoKey = `${key}_estado`
	const faltanteKey = `${key}_faltante`
	return [
		opciones(
			estadoKey,
			label,
			[
				{ value: 'COMPLETO', label: 'Completo', color: 'emerald' },
				{ value: 'INCOMPLETO', label: 'Incompleto', color: 'red' },
				{ value: 'NO_TIENE', label: 'No tiene', color: 'red' }
			],
			{
				required: true,
				helpText: `Cantidad esperada: ${cantidadEsperada}.`,
				/// La cantidad faltante solo tiene sentido si algo falta. Pedirla
				/// siempre obligaría a escribir «0» en once elementos completos.
				visibilityRule: {
					version: 1,
					all: [{ fieldKey: estadoKey, operator: 'in', value: ['INCOMPLETO', 'NO_TIENE'] }],
					effect: { action: 'require', targetFieldKey: faltanteKey }
				} satisfies Rule
			}
		),
		entero(faltanteKey, `${label} — cantidad faltante`, {
			validation: { min: 0, max: 9999 },
			/// Igual que en `itemInspeccion`: el `require` vive en el estado y el
			/// `show` aquí, para que once elementos completos no muestren once
			/// casillas de «faltante» pidiendo un cero.
			visibilityRule: {
				version: 1,
				all: [{ fieldKey: estadoKey, operator: 'in', value: ['INCOMPLETO', 'NO_TIENE'] }],
				effect: { action: 'show', targetFieldKey: faltanteKey }
			} satisfies Rule
		})
	]
}
