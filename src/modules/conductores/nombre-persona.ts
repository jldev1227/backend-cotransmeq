/**
 * Normalización del nombre y el apellido de un conductor.
 *
 * Los nombres se teclean en muchos sitios —el formulario del dashboard, la
 * carga masiva, el portal— y llegaban tal cual: «juan  perez», «JUAN Pérez  »,
 * «  Juan   Carlos  Perez ». Eso se ve en la ficha, en las pestañas del canvas
 * de recorridos, en los PDF y en los correos, y además rompe el ORDEN: al
 * ordenar por apellido, «perez» cae detrás de «Zapata» porque las minúsculas
 * van después en el orden de códigos.
 *
 * La regla es MAYÚSCULAS, que es como se escriben los nombres en los formatos
 * de la empresa (ver `OP-FR-03`), y sin espacios de más.
 *
 * Se conservan las tildes y la Ñ: quitarlas cambiaría el nombre de la persona,
 * no lo limpiaría. La comparación insensible a acentos, donde haga falta, es
 * cosa de quien busca, no de cómo se guarda el dato.
 */

/**
 * Caracteres que no pertenecen a un nombre.
 *
 * Se permiten letras (con diacríticos), espacios, apóstrofo y guion: hay
 * apellidos como «D'ANGELO» o «PEREZ-GOMEZ». Se quitan dígitos y puntuación,
 * que en este campo siempre han sido erratas.
 */
const NO_ES_NOMBRE = /[^\p{L}\s'’-]/gu

export function normalizarNombrePersona(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null

  const limpio = String(valor)
    .replace(NO_ES_NOMBRE, ' ')
    // Colapsa cualquier racha de espacios (incluido el no separable que llega
    // al pegar desde Word o desde Excel) en uno solo.
    .replace(/[\s ]+/g, ' ')
    .trim()
    .toLocaleUpperCase('es-CO')

  return limpio === '' ? null : limpio
}

/**
 * Aplica la normalización a los campos de nombre de un payload, si vienen.
 *
 * Se comprueba `in` y no la verdad del valor: en un `PATCH`, `nombre: ''` es
 * una intención de borrar, y convertirla en «no tocar» dejaría el valor viejo
 * sin que nadie lo note.
 */
export function normalizarNombresEnPayload<T extends Record<string, any>>(data: T): T {
  const salida: Record<string, any> = { ...data }
  for (const campo of ['nombre', 'apellido']) {
    if (campo in salida) salida[campo] = normalizarNombrePersona(salida[campo])
  }
  return salida as T
}
