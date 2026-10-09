/**
 * Clasificación automática de una solicitud recién recibida.
 *
 * Es una función pura a propósito: recibe los datos del formulario y lo que
 * ya se sabe de la base (antecedentes del mismo teléfono/correo/IP, si la
 * empresa es cliente) y devuelve prioridad, urgencia y un puntaje de riesgo
 * con las señales que lo explican. El panel muestra esas señales tal cual,
 * para que quien revisa entienda POR QUÉ la solicitud pide verificación y no
 * tenga que fiarse de un número.
 *
 * No decide nada por sí sola: una solicitud de riesgo alto sigue entrando a
 * la bandeja; solo entra marcada.
 */
import type { CrearSolicitudPublica, NivelRiesgo, Prioridad } from './solicitudes-web.schema'

export interface Senal {
  clave: string
  texto: string
  /** Positivo suma riesgo; negativo lo resta (señal tranquilizadora). */
  peso: number
}

export interface ContextoTriage {
  /** Fecha de hoy en Bogotá, `AAAA-MM-DD`. Se inyecta para poder probarlo. */
  hoy: string
  /** Solicitudes previas con el mismo teléfono o correo. */
  previas: { estado: string; created_at: Date }[]
  /** Solicitudes desde la misma IP en las últimas 24 h (sin contar esta). */
  mismaIp24h: number
  /** La empresa o el NIT coinciden con un cliente registrado. */
  clienteConocido: { id: string; nombre: string | null } | null
}

export interface ResultadoTriage {
  prioridad: Prioridad
  urgente: boolean
  riesgo_nivel: NivelRiesgo
  riesgo_puntaje: number
  senales: Senal[]
}

const DOMINIOS_GRATUITOS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'outlook.es', 'yahoo.com', 'yahoo.es', 'live.com', 'icloud.com', 'protonmail.com', 'proton.me'
])

/// Buzones temporales más comunes. No pretende ser exhaustiva: basta con
/// atrapar lo que un bot genérico usa por defecto.
const DOMINIOS_DESECHABLES = new Set([
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', '10minutemail.com', 'temp-mail.org', 'tempmail.com',
  'trashmail.com', 'getnada.com', 'dispostable.com', 'sharklasers.com', 'maildrop.cc', 'throwawaymail.com'
])

/** Días entre dos fechas `AAAA-MM-DD` (b − a). */
export function diasEntre(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Hoy en Bogotá (UTC−5 fija) como `AAAA-MM-DD`. */
export function hoyBogota(ahora = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10)
}

function dominioDe(correo: string): string {
  return correo.split('@')[1]?.toLowerCase() ?? ''
}

/** Celular colombiano (3xx xxx xxxx) o fijo con indicativo (60x xxx xxxx). */
export function telefonoColombianoValido(telefono: string): boolean {
  let d = telefono.replace(/\D/g, '')
  if (d.startsWith('57') && d.length > 10) d = d.slice(2)
  if (d.length === 10 && d.startsWith('3')) return true
  if (d.length === 10 && d.startsWith('60')) return true
  if (d.length === 7) return true
  return false
}

export function clasificarSolicitud(s: CrearSolicitudPublica, ctx: ContextoTriage): ResultadoTriage {
  const senales: Senal[] = []
  const pideServicio = s.tipo === 'cotizacion' || s.tipo === 'servicio'
  const dias = s.fecha_servicio ? diasEntre(ctx.hoy, s.fecha_servicio) : null

  // ── Urgencia ─────────────────────────────────────────────────────────────
  // «De ya para ya» es justamente el patrón que la empresa no quiere atender a
  // ciegas: se marca urgente Y se suma riesgo, para que se verifique primero.
  const urgente = pideServicio && dias !== null && dias <= 1
  if (urgente) {
    senales.push({ clave: 'servicio_inmediato', texto: dias! < 0 ? 'Pide el servicio para una fecha ya pasada' : dias === 0 ? 'Pide el servicio para hoy' : 'Pide el servicio para mañana', peso: 3 })
  } else if (pideServicio && dias !== null && dias <= 3) {
    senales.push({ clave: 'servicio_proximo', texto: `Pide el servicio en ${dias} días`, peso: 1 })
  }

  // ── Identidad ────────────────────────────────────────────────────────────
  if (pideServicio && !s.empresa && !s.documento) {
    senales.push({ clave: 'sin_empresa_ni_documento', texto: 'No indicó empresa ni documento', peso: 2 })
  } else if (pideServicio && !s.empresa) {
    senales.push({ clave: 'sin_empresa', texto: 'No indicó empresa', peso: 1 })
  }

  const dominio = dominioDe(s.correo)
  if (DOMINIOS_DESECHABLES.has(dominio)) {
    senales.push({ clave: 'correo_desechable', texto: `Correo temporal (${dominio})`, peso: 4 })
  } else if (pideServicio && s.empresa && DOMINIOS_GRATUITOS.has(dominio)) {
    senales.push({ clave: 'correo_gratuito', texto: `Dice ser de una empresa pero escribe desde ${dominio}`, peso: 1 })
  }

  if (!telefonoColombianoValido(s.telefono)) {
    senales.push({ clave: 'telefono_atipico', texto: 'El teléfono no parece un número colombiano', peso: 2 })
  }

  // ── Comportamiento del envío ─────────────────────────────────────────────
  if (s.tiempo_llenado_ms !== null && s.tiempo_llenado_ms !== undefined && s.tiempo_llenado_ms < 5_000) {
    senales.push({ clave: 'llenado_rapido', texto: `Formulario diligenciado en ${Math.round(s.tiempo_llenado_ms / 1000)} s`, peso: 3 })
  }
  const enlaces = (s.mensaje.match(/https?:\/\/|www\./gi) ?? []).length
  if (enlaces >= 2) {
    senales.push({ clave: 'mensaje_con_enlaces', texto: `El mensaje trae ${enlaces} enlaces`, peso: 2 })
  }
  if (ctx.mismaIp24h >= 3) {
    senales.push({ clave: 'ip_repetida', texto: `${ctx.mismaIp24h} solicitudes más desde la misma conexión en 24 h`, peso: 2 })
  }

  // ── Antecedentes ─────────────────────────────────────────────────────────
  const descartadas = ctx.previas.filter((p) => p.estado === 'descartada' || p.estado === 'spam').length
  const atendidas = ctx.previas.filter((p) => p.estado === 'atendida' || p.estado === 'verificada').length
  if (descartadas > 0) {
    senales.push({ clave: 'antecedente_descartado', texto: `Mismo contacto con ${descartadas} solicitud(es) descartada(s) antes`, peso: 3 })
  }
  if (atendidas > 0) {
    senales.push({ clave: 'antecedente_atendido', texto: `Mismo contacto ya fue atendido ${atendidas} vez/veces`, peso: -2 })
  }
  if (ctx.clienteConocido) {
    senales.push({ clave: 'cliente_conocido', texto: `Coincide con el cliente ${ctx.clienteConocido.nombre ?? 'registrado'}`, peso: -3 })
  }

  // ── Puntaje ──────────────────────────────────────────────────────────────
  const riesgo_puntaje = Math.max(0, senales.reduce((acc, x) => acc + x.peso, 0))
  const riesgo_nivel: NivelRiesgo = riesgo_puntaje >= 5 ? 'alto' : riesgo_puntaje >= 2 ? 'medio' : 'bajo'

  // ── Prioridad comercial (independiente del riesgo) ───────────────────────
  let prioridad: Prioridad = pideServicio ? 'media' : 'baja'
  if (pideServicio && (ctx.clienteConocido || (dias !== null && dias <= 7) || (s.pasajeros ?? 0) >= 15 || s.modalidad === 'contrato')) {
    prioridad = 'alta'
  }

  return { prioridad, urgente, riesgo_nivel, riesgo_puntaje, senales }
}
