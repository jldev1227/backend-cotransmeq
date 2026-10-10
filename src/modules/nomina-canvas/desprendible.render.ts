/**
 * Elige con qué maquetación sale el desprendible de nómina.
 *
 * POR QUÉ EXISTE. Hay dos: la CLÁSICA
 * (`desprendible.clasico.template.ts`), que es la que la empresa viene
 * emitiendo, y la NUEVA (`desprendible.template.ts`), aprobada en septiembre
 * de 2026. La nueva entra cuando la empresa lo decida, no cuando se
 * despliegue el código, así que la decisión es una variable de entorno y no
 * un `git revert`.
 *
 *     DESPRENDIBLE_LAYOUT=nuevo     ← por defecto desde oct-2026: la aprobada
 *     DESPRENDIBLE_LAYOUT=clasico   ← la anterior, por si hay que volver
 *
 * Desde el 10-oct-2026 el diseño nuevo es el principal también en el
 * generador del navegador (`pdfDesprendible.ts` + `pdfDesprendibleDiseno.ts`),
 * que es el que reciben canvas, dashboard, portal, enlace firmado y app
 * móvil. Esta plantilla solo la usan la descarga individual por API, el ZIP
 * masivo y el PDF del enlace de firma pública.
 *
 * La elección no es solo de forma. `LiquidacionesService.datosDesprendible()`
 * también la consulta, porque la maquetación nueva trae sus propios
 * nombres de concepto y agrupa los recargos en OTROS / PAREX / GEOPARK; con
 * la clásica los recargos vuelven a ir con el nombre de cada cliente.
 * Por eso el layout se lee de aquí y no de `env` directamente: un solo sitio
 * decide, y los dos lados no pueden desincronizarse.
 *
 * PARA VOLVER A LA CLÁSICA: `DESPRENDIBLE_LAYOUT=clasico` en el entorno del
 * backend y reiniciar. No hay que tocar código.
 */

import { env } from '../../config/env';
import {
  renderDesprendibleHtml as renderNuevo,
  type DatosDesprendible,
  type OpcionesRender,
} from './desprendible.template';
import { renderDesprendibleClasicoHtml as renderClasico } from './desprendible.clasico.template';

export type LayoutDesprendible = 'clasico' | 'nuevo';

/** La maquetación vigente. Se resuelve una vez, al cargar el módulo. */
export const LAYOUT_DESPRENDIBLE: LayoutDesprendible =
  String(env.DESPRENDIBLE_LAYOUT ?? '').trim().toLowerCase() === 'clasico' ? 'clasico' : 'nuevo';

/** Renderiza el desprendible con la maquetación vigente. */
export function renderDesprendibleHtml(
  d: DatosDesprendible,
  opciones: OpcionesRender = {},
): string {
  return LAYOUT_DESPRENDIBLE === 'nuevo' ? renderNuevo(d, opciones) : renderClasico(d, opciones);
}

export type { DatosDesprendible, LineaDesprendible, OpcionesRender } from './desprendible.template';
