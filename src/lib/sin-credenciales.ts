/**
 * Quita de un valor cualquier campo `password` (el hash de usuarios y
 * conductores), a cualquier profundidad. Modifica el objeto en el sitio y lo
 * devuelve.
 *
 * Es una red de seguridad, no el control principal: cada consulta debería
 * pedir solo lo que necesita. Existe porque en oct-2026 había diecisiete
 * `include: { conductores: true }` que devolvían la fila entera —con el hash de
 * la contraseña— en respuestas públicas, en respuestas del dashboard y en
 * eventos de socket, y uno nuevo pasaría inadvertido hasta que alguien mirara
 * la red. Va en el `preSerialization` global de `app.ts` y en los emisores de
 * socket que mandan entidades completas.
 *
 * Solo recorre objetos planos y arreglos: `Date`, `Decimal`, `Buffer` y demás
 * instancias se dejan como están.
 */
const CAMPOS_SECRETOS = new Set(['password'])

/// Tope de profundidad: ninguna respuesta legítima anida tanto, y evita
/// recorrer sin fin una estructura circular.
const PROFUNDIDAD_MAXIMA = 40

export function sinCredenciales<T>(valor: T): T {
  limpiar(valor, 0)
  return valor
}

function limpiar(valor: unknown, profundidad: number): void {
  if (valor === null || typeof valor !== 'object' || profundidad > PROFUNDIDAD_MAXIMA) return
  if (Array.isArray(valor)) {
    for (const elemento of valor) limpiar(elemento, profundidad + 1)
    return
  }
  const prototipo = Object.getPrototypeOf(valor)
  if (prototipo !== Object.prototype && prototipo !== null) return
  const objeto = valor as Record<string, unknown>
  for (const clave of Object.keys(objeto)) {
    if (CAMPOS_SECRETOS.has(clave)) delete objeto[clave]
    else limpiar(objeto[clave], profundidad + 1)
  }
}
