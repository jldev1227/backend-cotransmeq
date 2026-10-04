/**
 * Achica una respuesta antes de dársela al modelo: corta las listas largas,
 * redondea decimales y quita claves ruidosas. Así una herramienta no se come el
 * contexto con un listado de 300 vehículos.
 */
export function recortar(valor: unknown, maxLista = 10, profundidad = 0): unknown {
  if (profundidad > 6) return '…'
  if (Array.isArray(valor)) {
    const cortada = valor.slice(0, maxLista).map((v) => recortar(v, maxLista, profundidad + 1))
    return valor.length > maxLista ? [...cortada, `… y ${valor.length - maxLista} más`] : cortada
  }
  if (valor instanceof Date) return valor.toISOString()
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor)) {
      if (v === null || v === undefined) continue
      salida[k] = recortar(v, maxLista, profundidad + 1)
    }
    return salida
  }
  if (typeof valor === 'number' && !Number.isInteger(valor)) {
    return Math.round(valor * 100) / 100
  }
  return valor
}

/** Serializa el resultado de una herramienta con un tope de caracteres. */
export function aTextoParaModelo(valor: unknown, maxCaracteres = 14000): string {
  const texto = JSON.stringify(valor)
  return texto.length > maxCaracteres ? `${texto.slice(0, maxCaracteres)}… [recortado]` : texto
}

/** Entero entre `min` y `max`, o `porDefecto` si el modelo mandó cualquier otra cosa. */
export function enteroEntre(valor: unknown, min: number, max: number, porDefecto: number): number {
  const n = Number(valor)
  if (!Number.isInteger(n)) return porDefecto
  return Math.min(max, Math.max(min, n))
}

/** Texto limpio o `undefined`: los argumentos vienen de un LLM y pueden traer basura. */
export function textoOpcional(valor: unknown, max = 200): string | undefined {
  if (typeof valor !== 'string') return undefined
  const t = valor.trim()
  return t ? t.slice(0, max) : undefined
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function fechaOpcional(valor: unknown): string | undefined {
  return typeof valor === 'string' && FECHA.test(valor) ? valor : undefined
}

/** Fecha corta legible para el modelo (y para el usuario), en hora de Colombia. */
export function fechaCorta(valor: Date | string | null | undefined): string | undefined {
  if (!valor) return undefined
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', year: 'numeric', month: 'short', day: 'numeric' })
}
