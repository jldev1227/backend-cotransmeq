import type { AccessLevel } from '../../../config/permissions'

/**
 * Guías interactivas: un tour paso a paso que el navegador pinta con un
 * foco (spotlight) y una tarjeta junto al elemento.
 *
 * Viven EN CÓDIGO, no en la base de datos: cambian en el mismo commit que la
 * pantalla que explican, se revisan en el diff y no hace falta editor ni
 * migración. Es la lección de segispro, donde las guías "versionadas" en
 * seeds acabaron siendo la fuente de verdad y la tabla un espejo.
 *
 * Cada paso señala un elemento con un `ancla`. Para no depender de sembrar
 * atributos por todo el código, el ancla admite tres formas:
 *  - `@nombre`            → `[data-tour="nombre"]`, para lo que no tiene id
 *                           ni texto estable (botones con icono, pestañas);
 *  - `texto:button:Facturar` / `texto:Nuevo Servicio`
 *                         → el primer elemento visible de esa etiqueta cuyo
 *                           texto contenga eso (sin tildes ni mayúsculas);
 *  - cualquier otra cosa  → selector CSS tal cual (`#numero-factura`,
 *                           `[role="dialog"]`).
 * Un paso sin ancla muestra solo la tarjeta, centrada.
 */
export interface PasoGuia {
  titulo: string
  /** Texto corto en segunda persona; sin markdown. */
  texto: string
  ancla?: string
  /** Ruta interna a la que ir antes de buscar el ancla (puede llevar query). */
  ruta?: string
  /**
   * `clic`: el visor hace clic en el ancla por el usuario (abre el modal, la
   * pestaña) y pasa solo al siguiente paso. Así «¿cómo facturo?» abre el
   * formulario y lo explica sin que la persona tenga que buscar el botón.
   */
  accion?: 'clic'
}

export interface Guia {
  /** Estable y en kebab-case: es lo que el modelo cita y lo que se registra. */
  id: string
  titulo: string
  /** Una frase: qué se logra siguiéndola. */
  descripcion: string
  /** Pantalla donde empieza. */
  ruta: string
  /**
   * Módulo de `ROUTE_PERMISSIONS` que hay que poder ver para que se ofrezca,
   * o `null` si es para todos. Igual que `requiere` en las herramientas.
   */
  modulo: string | null
  /** Nivel mínimo sobre `modulo` (p. ej. `full` si la guía enseña a crear). */
  nivel?: AccessLevel
  /** Cómo la pide la gente; alimenta la búsqueda junto con el título. */
  palabrasClave: string[]
  /** 0-10, desempata entre guías parecidas. */
  prioridad: number
  pasos: PasoGuia[]
}
