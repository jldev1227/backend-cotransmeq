/**
 * Eventos de tiempo real del módulo de Clientes.
 *
 * El módulo solo emitía `cliente:oculto` y `clientes:actualizacion-masiva`,
 * mientras que `/dashboard/clientes` escuchaba `cliente:created`,
 * `cliente:updated` y `cliente:deleted` (líneas 249-251). Ninguno existía:
 * crear un cliente no le aparecía a nadie más hasta recargar.
 *
 * Los nombres son los que la página ya escucha —en inglés, a diferencia de los
 * de servicios, que van en español—. Es otra inconsistencia real del proyecto;
 * se resuelve al unificar la convención, no renombrando aquí, porque eso
 * dejaría la página muda de nuevo.
 */

import { getIo } from '../../sockets'

export const EVENTOS_CLIENTE = {
	creado: 'cliente:created',
	actualizado: 'cliente:updated',
	eliminado: 'cliente:deleted'
} as const

/** Ver la nota de `servicios.events.ts`: el fallo se traga a propósito. */
function emitir(evento: string, datos: unknown): void {
	try {
		getIo().emit(evento, datos)
	} catch {
		/* Socket.IO no disponible: la operación de negocio ya está hecha. */
	}
}

export function emitClienteCreado(cliente: unknown): void {
	emitir(EVENTOS_CLIENTE.creado, cliente)
}

export function emitClienteActualizado(cliente: unknown): void {
	emitir(EVENTOS_CLIENTE.actualizado, cliente)
}

export function emitClienteEliminado(id: string): void {
	emitir(EVENTOS_CLIENTE.eliminado, { id })
}
