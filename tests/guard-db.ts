/**
 * Guarda de seguridad para la base de datos de tests.
 *
 * El 28-ago-2026 la suite corrió con DATABASE_URL apuntando a la base real y
 * `prisma.respuestas_asistencia.deleteMany()` borró 2042 respuestas. Los
 * `deleteMany()` sin filtro de los tests son legítimos contra una base
 * desechable y catastróficos contra cualquier otra, así que la decisión no
 * puede depender de qué haya en `.env` en ese momento.
 *
 * Regla: la suite solo limpia tablas si el nombre de la base delata que es
 * desechable (contiene "test" o "_local"), o si se declara explícitamente
 * ALLOW_DESTRUCTIVE_TESTS=true.
 */

const PATRON_BASE_DESECHABLE = /(test|_local)/i

export function describirBaseDeDatos(url: string | undefined) {
  if (!url) return { nombre: '(sin DATABASE_URL)', host: '(desconocido)' }
  try {
    const u = new URL(url)
    return { nombre: u.pathname.replace(/^\//, '') || '(sin nombre)', host: u.host }
  } catch {
    return { nombre: '(no parseable)', host: '(desconocido)' }
  }
}

export function esBaseDesechable(url = process.env.DATABASE_URL): boolean {
  if (process.env.ALLOW_DESTRUCTIVE_TESTS === 'true') return true
  const { nombre } = describirBaseDeDatos(url)
  return PATRON_BASE_DESECHABLE.test(nombre)
}

/**
 * Aborta la suite si la base no es desechable. Se llama antes de cualquier
 * borrado; preferimos fallar ruidosamente a borrar datos reales en silencio.
 */
export function exigirBaseDesechable(url = process.env.DATABASE_URL): void {
  if (esBaseDesechable(url)) return
  const { nombre, host } = describirBaseDeDatos(url)
  throw new Error(
    `\n\n  ABORTADO: los tests borran tablas completas y DATABASE_URL no apunta ` +
      `a una base desechable.\n` +
      `    base: ${nombre}\n` +
      `    host: ${host}\n\n` +
      `  Apunta DATABASE_URL a una base cuyo nombre contenga "test" o "_local",\n` +
      `  o exporta ALLOW_DESTRUCTIVE_TESTS=true si de verdad es desechable.\n`
  )
}
