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
 *     DESPRENDIBLE_LAYOUT=clasico   ← por defecto: la de siempre
 *     DESPRENDIBLE_LAYOUT=nuevo     ← la aprobada
 *
 * El valor por defecto es `clasico` a propósito: un entorno al que nadie le
 * haya puesto la variable tiene que seguir imprimiendo lo que imprimía ayer.
 *
 * La elección no es solo de forma. `LiquidacionesService.datosDesprendible()`
 * también la consulta, porque la maquetación nueva trae sus propios
 * nombres de concepto y agrupa los recargos en OTROS / PAREX / GEOPARK; con
 * la clásica los recargos vuelven a ir con el nombre de cada cliente.
 * Por eso el layout se lee de aquí y no de `env` directamente: un solo sitio
 * decide, y los dos lados no pueden desincronizarse.
 *
 * PARA VOLVER A LA NUEVA: `DESPRENDIBLE_LAYOUT=nuevo` en el entorno del
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
  String(env.DESPRENDIBLE_LAYOUT ?? '').trim().toLowerCase() === 'nuevo' ? 'nuevo' : 'clasico';

/** Renderiza el desprendible con la maquetación vigente. */
export function renderDesprendibleHtml(
  d: DatosDesprendible,
  opciones: OpcionesRender = {},
): string {
  return LAYOUT_DESPRENDIBLE === 'nuevo' ? renderNuevo(d, opciones) : renderClasico(d, opciones);
}

export type { DatosDesprendible, LineaDesprendible, OpcionesRender } from './desprendible.template';
