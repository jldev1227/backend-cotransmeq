import type { Guia } from './tipos'

/**
 * Elige la guía que mejor responde a una pregunta, por palabras clave.
 *
 * Puntúa por raíces (toleran plurales y conjugaciones: «factur» cubre
 * facturar, facturas, facturación) sobre título (+5), palabras clave (+3) y
 * descripción (+1), cada una pesada por lo rara que es entre las guías:
 * «servicio» está en muchas y vale poco; «ticket» en una y vale todo.
 *
 * Si la segunda tiene al menos el 80 % de la primera, no se decide aquí: se
 * devuelven candidatas y el modelo pregunta o elige con el contexto.
 */
// Palabras de relleno. OJO: «ver», «dónde», «crear», «abrir» NO van aquí: son
// la intención, y distinguen «ver las facturas» de «facturar».
const VACIAS = new Set([
  'como', 'puedo', 'para', 'que', 'una', 'uno', 'unos', 'unas', 'los', 'las', 'del', 'con', 'por', 'hago', 'hacer',
  'quiero', 'necesito', 'mas', 'esta', 'este', 'esto', 'hay', 'ayuda', 'ayudame', 'guia', 'guiame', 'muestrame',
  'explicame', 'desde', 'aqui', 'app', 'pantalla', 'puede', 'puedes', 'estan', 'esta',
])

export function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
}

/** Palabras completas, sin relleno: para premiar la coincidencia exacta. */
export function palabras(texto: string): Set<string> {
  const salida = new Set<string>()
  for (const p of normalizarTexto(texto).split(/\s+/)) if (p.length >= 3 && !VACIAS.has(p)) salida.add(p)
  return salida
}

const SUFIJOS = ['amos', 'emos', 'imos', 'ando', 'iendo', 'ar', 'er', 'ir', 'es', 'as', 'os', 'o', 'a', 'e', 's']

/**
 * Raíz tolerante: quita una terminación verbal o de plural y se queda con las
 * primeras cinco letras. Así «creo», «crear» y «creamos» coinciden, igual que
 * «facturar», «facturas» y «facturación».
 */
export function raices(texto: string): Set<string> {
  const salida = new Set<string>()
  for (const p of palabras(texto)) {
    let tallo = p
    for (const suf of SUFIJOS) {
      if (p.length - suf.length >= 3 && p.endsWith(suf)) {
        tallo = p.slice(0, -suf.length)
        break
      }
    }
    salida.add(tallo.slice(0, 5))
  }
  return salida
}

export interface GuiaPuntuada {
  guia: Guia
  puntos: number
}

export function elegirGuias(pregunta: string, guias: readonly Guia[]): GuiaPuntuada[] {
  const consulta = raices(pregunta)
  if (consulta.size === 0 || guias.length === 0) return []

  // Peso de cada raíz según en cuántas guías aparece (título y palabras
  // clave): una raíz que está en todas no distingue nada y pesa cero; una que
  // solo está en una pesa el máximo. Es un IDF de bolsillo.
  const frecuencia = new Map<string, number>()
  for (const g of guias) {
    for (const x of raices(`${g.titulo} ${g.palabrasClave.join(' ')}`)) frecuencia.set(x, (frecuencia.get(x) ?? 0) + 1)
  }
  const peso = (r: string) => Math.log((guias.length + 1) / ((frecuencia.get(r) ?? 0) + 1))

  const exactas = palabras(pregunta)
  const puntuadas: GuiaPuntuada[] = guias.map((g) => {
    const titulo = raices(g.titulo)
    const claves = raices(g.palabrasClave.join(' '))
    const descripcion = raices(g.descripcion)
    const literales = palabras(`${g.titulo} ${g.palabrasClave.join(' ')}`)
    let puntos = 0
    for (const r of consulta) {
      const w = peso(r)
      if (titulo.has(r)) puntos += 5 * w
      if (claves.has(r)) puntos += 3 * w
      if (descripcion.has(r)) puntos += 1 * w
    }
    // La palabra exacta desempata entre raíces iguales: «facturar» (acción)
    // frente a «facturas» (la lista).
    for (const x of exactas) {
      if (!literales.has(x)) continue
      const r = raices(x).values().next().value
      if (r) puntos += 4 * peso(r)
    }
    if (puntos > 0) puntos += g.prioridad / 10
    return { guia: g, puntos }
  })

  return puntuadas.filter((p) => p.puntos >= 2.5).sort((a, b) => b.puntos - a.puntos)
}

/** `true` si hay empate técnico entre las dos primeras. */
export function hayEmpate(puntuadas: GuiaPuntuada[]): boolean {
  return puntuadas.length >= 2 && puntuadas[1].puntos >= puntuadas[0].puntos * 0.8
}
