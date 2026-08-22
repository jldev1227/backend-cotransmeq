/**
 * Coordenadas de diligenciamiento del formato GC-FOR-13 (COTRANSMEQ).
 *
 * Sistema de coordenadas: el de pdf-lib, con origen abajo-izquierda y unidades
 * en puntos sobre una página carta de 612 x 792.
 *
 * Los valores NO se comparten con Transmeralda aunque algunas filas coincidan:
 * son dos maquetas distintas (aquí el encabezado es una banda de tres líneas,
 * allá una tabla de control) y compartirlas haría que retocar una marca moviera
 * el texto de la otra.
 *
 * De dónde salen: se extrajeron del content stream del propio template — los
 * operadores `re` dan los rectángulos de las tablas y `pdftotext -bbox-layout`
 * da la caja de cada palabra. La `y` de una línea de texto es su línea base,
 * calculada como `yMax_bbox − descendente` (el cuerpo del formato es de 7 pt).
 */

/** Texto de una sola línea que se dibuja sobre una raya o dentro de una celda. */
export interface CampoTexto {
  x: number
  /** Línea base del texto. */
  y: number
  /** Ancho útil. Si el valor no cabe ni reduciendo, la generación falla. */
  maxWidth: number
  /** Tamaño nominal. Se reduce hasta `minSize` antes de dar error. */
  size: number
  minSize: number
  /**
   * `x` donde TERMINA la raya que ya viene impresa en el template.
   *
   * Solo lo llevan los campos que se escriben sobre una raya. Si el valor es
   * más largo que la raya, el generador dibuja la continuación hasta donde
   * termina el texto, de modo que el subrayado siempre acompañe al dato: una
   * razón social de 32 caracteres desborda por mucho la raya corta de la
   * sección 2, y sin esto el valor queda "flotando" sin línea debajo.
   */
  subrayadoHasta?: number
}

/** Distancia bajo la línea base a la que va el subrayado, y su grosor.
 *  Ajustados para empalmar exactamente con las rayas impresas del template. */
export const SUBRAYADO = { offset: 1.1, grosor: 0.5 }

/** Punto central de una casilla ☐ del template; la marca se centra ahí. */
export interface CampoCasilla {
  cx: number
  cy: number
  /** Tamaño de la marca que se dibuja dentro. Se mantiene por debajo del
   *  lado del cuadro del template para que la X no toque sus bordes. */
  size: number
}

/** Caja donde se incrusta la firma, preservando proporción. */
export interface CampoImagen {
  x: number
  y: number
  width: number
  height: number
}

export interface CoordenadasDeclaracionTransporte {
  razon_social: CampoTexto
  nit: CampoTexto
  representante_legal: CampoTexto
  cedula_representante: CampoTexto
  telefono_correo: CampoTexto
  /** Raya de "…declaro que la empresa ______" en la sección 2. */
  empresa_declaracion: CampoTexto
  confirmaciones: {
    vehiculos_revisados: CampoCasilla
    sin_alertas: CampoCasilla
    con_alertas_anexo: CampoCasilla
    soportes_vigentes: CampoCasilla
  }
  /** Las dos rayas de la sección 4. El texto se reparte entre ellas. */
  observaciones: CampoTexto[]
  firma_nombre: CampoTexto
  firma_documento: CampoTexto
  firma_imagen: CampoImagen
  fecha: CampoTexto
  resultado: {
    aprobado: CampoCasilla
    condicionado: CampoCasilla
    no_aprobado: CampoCasilla
  }
}

export const COORDENADAS: CoordenadasDeclaracionTransporte = {
  // Fila de encabezado: | RAZÓN SOCIAL PROVEEDOR | valor | NIT | valor |
  // Celdas x 182.83..358.68 y x 431.27..559.79, fila yTop 126.72..137.02.
  razon_social: { x: 185.8, y: 658.58, maxWidth: 170, size: 7.5, minSize: 5.5 },
  nit: { x: 434.3, y: 658.58, maxWidth: 123, size: 7.5, minSize: 5.5 },

  // Sección 1 — rayas de "Representante legal:", "C.C." y "Teléfono / correo:".
  // El `maxWidth` llega hasta el margen del cuerpo (x ~526.5) y no hasta el
  // final de la raya: la raya es una guía y a su derecha el formato está
  // vacío, así que un nombre o un correo largo continúa ahí en vez de fallar.
  representante_legal: { x: 149.5, y: 615.58, maxWidth: 377, size: 7.5, minSize: 5.5, subrayadoHasta: 314.33 },
  cedula_representante: { x: 100.5, y: 603.38, maxWidth: 426, size: 7.5, minSize: 5.5, subrayadoHasta: 265.19 },
  telefono_correo: { x: 142.3, y: 591.17, maxWidth: 384, size: 7.5, minSize: 5.5, subrayadoHasta: 306.8 },

  // Sección 2 — raya corta al final de la frase de declaración.
  empresa_declaracion: { x: 262.5, y: 550.67, maxWidth: 264, size: 7, minSize: 5.5, subrayadoHasta: 354.28 },

  // Sección 3 — las cuatro casillas ☐ de confirmación rápida.
  confirmaciones: {
    vehiculos_revisados: { cx: 88.14, cy: 388.49, size: 5.5 },
    sin_alertas: { cx: 88.14, cy: 375.29, size: 5.5 },
    con_alertas_anexo: { cx: 88.14, cy: 362.19, size: 5.5 },
    soportes_vigentes: { cx: 88.14, cy: 348.99, size: 5.5 }
  },

  // Sección 4 — dos rayas de observaciones. Igual que en la sección 1, el
  // ancho útil llega al margen del cuerpo y no al final de la raya dibujada.
  observaciones: [
    { x: 86.5, y: 305.42, maxWidth: 440, size: 7.5, minSize: 6, subrayadoHasta: 364.13 },
    { x: 86.5, y: 288.23, maxWidth: 440, size: 7.5, minSize: 6, subrayadoHasta: 357.13 }
  ],

  // Sección 5 — tabla de firma. Celdas de valor x 313.65..588.40.
  firma_nombre: { x: 317, y: 247.33, maxWidth: 268, size: 7.5, minSize: 5.5 },
  firma_documento: { x: 317, y: 237.33, maxWidth: 268, size: 7.5, minSize: 5.5 },
  // Celda de firma x 313.65..588.40, y 181.63..234.83; se deja 5 pt de margen.
  firma_imagen: { x: 318.65, y: 186.63, width: 264.75, height: 43.2 },

  // Fila final: | Fecha: … | Resultado: ☐ ☐ ☐ |
  fecha: { x: 113.5, y: 156.72, maxWidth: 216, size: 7.5, minSize: 6 },
  resultado: {
    aprobado: { cx: 375.9, cy: 158.87, size: 5.5 },
    condicionado: { cx: 414.09, cy: 158.87, size: 5.5 },
    no_aprobado: { cx: 463.1, cy: 158.87, size: 5.5 }
  }
}
