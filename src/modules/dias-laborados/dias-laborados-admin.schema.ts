import { z } from 'zod'
import { exigirPlacaSiMantenimiento, mantenimientoVehiculoFields } from './dias-laborados.schema'

// ═══════════════════════════════════════════════════════════════════
//  REGISTRO MASIVO (ADMINISTRATIVO)
//
//  Pensado para que un operador registre ~30 días de un conductor
//  en una sola llamada, sin tener que repetir el formulario día
//  por día.
//
//  El frontend arma "patrones" — uno por cada conjunto de días que
//  comparten tipo y (opcionalmente) segmento. Cada patrón puede ser:
//    • LABORADO      → con vehículo, cliente, horario, km, etc.
//    • DISPONIBLE    → solo horario de disponibilidad + pernocte
//    • DESCANSO      → solo observaciones
//    • MANTENIMIENTO → placa del vehículo + observaciones
//
//  El backend expande (patrón × fecha) → 1 `registro_dia_laboral`
//  (+ 1 `registro_dia_laboral_segmento` solo para LABORADO/DISPONIBLE).
//
//  Los días del mes que NO estén en ningún patrón simplemente NO se
//  tocan (no se crea ningún registro). Esto evita el problema del
//  feature anterior "diasNoAsignados" que auto-marcaba como descanso
//  los días que el operador no había tocado explícitamente.
// ═══════════════════════════════════════════════════════════════════

// Tramo de un patrón. Requerido solo para LABORADO y DISPONIBLE.
// Para DESCANSO/MANTENIMIENTO el patrón no lleva segmento.
const patronSegmentoSchema = z.object({
	cliente_id: z.string().uuid().optional().nullable(),
	cliente_nombre: z.string().max(255).optional().nullable(),
	vehiculo_id: z.string().uuid().optional().nullable(),
	vehiculo_placa: z.string().max(20).optional().nullable(),
	hora_inicio: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
	hora_fin: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
	horas_conducidas: z.number().min(0).max(24).optional().nullable(),
	km_inicial: z.number().int().nonnegative().optional().nullable(),
	km_final: z.number().int().nonnegative().optional().nullable(),
	pernocte: z.boolean().optional().default(false),
	observaciones: z.string().max(500).optional().nullable()
})
export type PatronSegmentoInput = z.infer<typeof patronSegmentoSchema>

// Un patrón de día + las fechas en que se aplica.
const patronSchema = z
	.object({
		// Tipo de día que representa este patrón. Default: LABORADO
		// (compatibilidad hacia atrás con payloads viejos).
		tipo: z
			.enum(['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO'])
			.optional()
			.default('LABORADO'),
		// Lista de fechas (YYYY-MM-DD) en las que este patrón aplica.
		// Se valida cantidad máxima para evitar payloads absurdos.
		fechas: z
			.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
			.min(1, 'Cada patrón debe tener al menos 1 fecha')
			.max(366),
		// Segmento con vehículo/cliente/horario. Requerido para
		// LABORADO y DISPONIBLE; ignorado para DESCANSO/MANTENIMIENTO.
		segmento: patronSegmentoSchema.optional(),
		// Placa del vehículo intervenido. Obligatoria si el patrón es
		// MANTENIMIENTO; ignorada en los demás tipos. No va dentro de
		// `segmento` porque un mantenimiento no genera tramo.
		...mantenimientoVehiculoFields,
		// Observaciones opcionales a nivel del día (mismas para todas
		// las fechas de este patrón). El backend las copia en el
		// registro_dia_laboral padre.
		observaciones: z.string().max(500).optional().nullable()
	})
	.refine(
		(p) => {
			// Si requiere segmento, validar coherencia km
			if (!p.segmento) return true
			if (p.segmento.km_final == null || p.segmento.km_inicial == null) return true
			return p.segmento.km_final >= p.segmento.km_inicial
		},
		{ message: 'km_final debe ser >= km_inicial', path: ['segmento', 'km_final'] }
	)
	.refine(
		(p) => {
			// Si requiere segmento con horario, validar hora_fin > hora_inicio
			if (!p.segmento?.hora_inicio || !p.segmento?.hora_fin) return true
			const [h1, m1] = p.segmento.hora_inicio.split(':').map(Number)
			const [h2, m2] = p.segmento.hora_fin.split(':').map(Number)
			return h2 * 60 + m2 > h1 * 60 + m1
		},
		{ message: 'hora_fin debe ser posterior a hora_inicio', path: ['segmento', 'hora_fin'] }
	)
	.superRefine((p, ctx) =>
		// Misma regla que el portal: un día de mantenimiento sin placa no se guarda.
		exigirPlacaSiMantenimiento(p.tipo, p.mantenimiento_vehiculo_placa, ctx)
	)
export type PatronInput = z.infer<typeof patronSchema>

// Schema principal del endpoint.
export const guardarRegistrosMasivosSchema = z
	.object({
		conductor_id: z.string().uuid(),
		// Mes / año al que pertenecen los registros. Útil para validar
		// que las fechas caigan en el mismo mes/año declarado.
		mes: z.coerce.number().int().min(1).max(12),
		anio: z.coerce.number().int().min(2000).max(2100),
		// Lista de patrones. Cada uno se expande a N registros
		// (uno por fecha). Cada patrón puede ser de cualquier tipo.
		patrones: z.array(patronSchema).max(60, 'Máximo 60 patrones por mes')
	})
	.refine(
		(v) => {
			// Verificar que todas las fechas de todos los patrones
			// pertenezcan al mes/año declarado.
			for (const p of v.patrones) {
				for (const f of p.fechas) {
					const [y, m] = f.split('-').map(Number)
					if (y !== v.anio || m !== v.mes) return false
				}
			}
			return true
		},
		{
			message: 'Todas las fechas de los patrones deben pertenecer al mes/año indicado',
			path: ['patrones']
		}
	)
	.refine(
		(v) => {
			// No debe haber solapamiento: una fecha no puede
			// estar en 2 patrones distintos.
			const seen = new Set<string>()
			for (const p of v.patrones) {
				for (const f of p.fechas) {
					if (seen.has(f)) return false
					seen.add(f)
				}
			}
			return true
		},
		{
			message: 'Una misma fecha no puede estar en 2 patrones distintos',
			path: ['patrones']
		}
	)
export type GuardarRegistrosMasivosInput = z.infer<typeof guardarRegistrosMasivosSchema>

// ─── Editar un segmento específico (admin) ──────────────
// Usado por el botón "editar" del canvas de Recorridos.
// Solo se pueden editar los campos de detalle del tramo.
// El `registro_dia_id`, `orden`, `created_at` no son modificables.
export const editarSegmentoSchema = z
	.object({
		cliente_id: z.string().uuid().optional().nullable(),
		cliente_nombre: z.string().max(255).optional().nullable(),
		vehiculo_id: z.string().uuid().optional().nullable(),
		vehiculo_placa: z.string().max(20).optional().nullable(),
		hora_inicio: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
		hora_fin: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
		inicio_dia_siguiente: z.boolean().optional(),
		fin_dia_siguiente: z.boolean().optional(),
		horas_conducidas: z.number().min(0).max(24).optional().nullable(),
		km_inicial: z.number().int().nonnegative().optional().nullable(),
		km_final: z.number().int().nonnegative().optional().nullable(),
		pernocte: z.boolean().optional(),
		observaciones: z.string().max(500).optional().nullable()
	})
	.refine(
		(v) => {
			// Validar coherencia km
			if (v.km_final == null || v.km_inicial == null) return true
			return v.km_final >= v.km_inicial
		},
		{ message: 'km_final debe ser >= km_inicial', path: ['km_final'] }
	)
	.refine(
		(v) => {
			// Validar orden de horarios considerando los flags
			// de día siguiente (turnos que cruzan medianoche).
			if (!v.hora_inicio || !v.hora_fin) return true
			const toMins = (h: string, next: boolean) =>
				h.split(':').reduce((a, v) => a * 60 + Number(v), 0) + (next ? 24 * 60 : 0)
			const inicio = toMins(v.hora_inicio, !!v.inicio_dia_siguiente)
			const fin = toMins(v.hora_fin, !!v.fin_dia_siguiente)
			return fin > inicio
		},
		{ message: 'hora_fin debe ser posterior a hora_inicio', path: ['hora_fin'] }
	)
export type EditarSegmentoInput = z.infer<typeof editarSegmentoSchema>

// ─── Editar un registro (día) a nivel de metadata ──────────────
// Puede actualizar tipo + observaciones, y opcionalmente
// enviar un `segmento` (single-tramo) que se crea o se
// actualiza sobre el primer segmento activo del día.
// Reglas:
//   - Si el `tipo` final es LABORADO o DISPONIBLE y se envía
//     `segmento`, se crea/actualiza un segmento.
//   - Si el `tipo` final es DESCANSO o MANTENIMIENTO, todos
//     los segmentos activos del día se soft-eliminan (el
//     frontend NO debe enviar `segmento` en este caso).
//   - Si el `tipo` final es MANTENIMIENTO se exige placa. Aquí
//     solo se puede validar cuando el `tipo` viene explícito en
//     el body; si llega implícito (se edita solo la observación
//     de un día ya marcado como mantenimiento) la regla la
//     aplica el servicio, que sí conoce el registro guardado.
export const editarRegistroSchema = z
	.object({
		tipo: z.enum(['LABORADO', 'DISPONIBLE', 'DESCANSO', 'MANTENIMIENTO']).optional(),
		observaciones: z.string().max(500).optional().nullable(),
		...mantenimientoVehiculoFields,
		// Tramo único opcional. Se ignora si tipo final es
		// DESCANSO o MANTENIMIENTO.
		segmento: z
			.object({
				cliente_id: z.string().uuid().optional().nullable(),
				cliente_nombre: z.string().max(255).optional().nullable(),
				vehiculo_id: z.string().uuid().optional().nullable(),
				vehiculo_placa: z.string().max(20).optional().nullable(),
				hora_inicio: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
				hora_fin: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
				inicio_dia_siguiente: z.boolean().optional(),
				fin_dia_siguiente: z.boolean().optional(),
				horas_conducidas: z.number().min(0).max(24).optional().nullable(),
				km_inicial: z.number().int().nonnegative().optional().nullable(),
				km_final: z.number().int().nonnegative().optional().nullable(),
				pernocte: z.boolean().optional(),
				observaciones: z.string().max(500).optional().nullable()
			})
			.optional()
			.nullable()
	})
	.refine(
		(v) => {
			// Si envían segmento, validar coherencia km
			if (!v.segmento) return true
			if (v.segmento.km_final == null || v.segmento.km_inicial == null) return true
			return v.segmento.km_final >= v.segmento.km_inicial
		},
		{ message: 'km_final debe ser >= km_inicial', path: ['segmento', 'km_final'] }
	)
	.refine(
		(v) => {
			// Si envían segmento con ambos horarios, validar orden
			// considerando los flags de día siguiente.
			if (!v.segmento?.hora_inicio || !v.segmento?.hora_fin) return true
			const toMins = (h: string, next: boolean) =>
				h.split(':').reduce((a, v) => a * 60 + Number(v), 0) + (next ? 24 * 60 : 0)
			const inicio = toMins(v.segmento.hora_inicio, !!v.segmento.inicio_dia_siguiente)
			const fin = toMins(v.segmento.hora_fin, !!v.segmento.fin_dia_siguiente)
			return fin > inicio
		},
		{ message: 'hora_fin debe ser posterior a hora_inicio', path: ['segmento', 'hora_fin'] }
	)
	.superRefine((v, ctx) =>
		exigirPlacaSiMantenimiento(v.tipo, v.mantenimiento_vehiculo_placa, ctx)
	)
export type EditarRegistroInput = z.infer<typeof editarRegistroSchema>
