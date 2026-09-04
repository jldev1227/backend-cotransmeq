/**
 * Eventos de tiempo real del módulo de Servicios.
 *
 * Este módulo NO emitía nada. El frontend, en cambio, lleva desde siempre seis
 * listeners montados en `stores/servicios.ts` (`configurarSocket`, líneas
 * 498-570) con la lógica de parche por id ya escrita: insertar el nuevo al
 * principio, reemplazar por id, quitar el cancelado. Estaba todo hecho salvo
 * que los eventos nunca salían del backend, así que la lista solo se
 * actualizaba al recargar y dos personas trabajando a la vez veían cosas
 * distintas.
 *
 * Los nombres NO son elegidos aquí: son los que el store ya escucha. Cambiarlos
 * habría dejado el tiempo real igual de muerto, solo que en el otro extremo.
 *
 * La forma de cada payload también viene dada por el consumidor:
 *   - `creado` / `actualizado` / `cancelado` → la entidad completa
 *   - `estado-actualizado` → `{ servicio, estadoAnterior }`
 *   - `numero-planilla-actualizado` → `{ id, servicio }`
 *   - `eliminado` → solo `{ id }`, porque ya no hay entidad que mandar
 * Un consumidor que espere la entidad en todos se rompe en los dos últimos.
 */

import { getIo } from '../../sockets'

/** Estos son los literales que escucha `stores/servicios.ts`. */
export const EVENTOS_SERVICIO = {
	creado: 'servicio:creado',
	actualizado: 'servicio:actualizado',
	estadoActualizado: 'servicio:estado-actualizado',
	numeroPlanillaActualizado: 'servicio:numero-planilla-actualizado',
	cancelado: 'servicio:cancelado',
	eliminado: 'servicio:eliminado'
} as const

/**
 * Emite a todos los conectados.
 *
 * El `io` se resuelve en el momento de emitir y no al importar, y el fallo se
 * traga a propósito: `getIo()` LANZA si Socket.IO no está montado —pasa en los
 * tests que no levantan sockets, y durante el arranque— y no avisar por socket
 * nunca debe deshacer un servicio que ya se guardó. Es el mismo criterio que
 * sigue `recargos.service.ts`.
 */
function emitir(evento: string, datos: unknown): void {
	try {
		getIo().emit(evento, datos)
	} catch {
		/* Socket.IO no disponible: la operación de negocio ya está hecha. */
	}
}

export function emitServicioCreado(servicio: unknown): void {
	emitir(EVENTOS_SERVICIO.creado, servicio)
}

export function emitServicioActualizado(servicio: unknown): void {
	emitir(EVENTOS_SERVICIO.actualizado, servicio)
}

export function emitServicioEstadoActualizado(servicio: unknown, estadoAnterior: string): void {
	emitir(EVENTOS_SERVICIO.estadoActualizado, { servicio, estadoAnterior })
}

export function emitServicioNumeroPlanillaActualizado(id: string, servicio: unknown): void {
	emitir(EVENTOS_SERVICIO.numeroPlanillaActualizado, { id, servicio })
}

export function emitServicioCancelado(servicio: unknown): void {
	emitir(EVENTOS_SERVICIO.cancelado, servicio)
}

export function emitServicioEliminado(id: string): void {
	emitir(EVENTOS_SERVICIO.eliminado, { id })
}
