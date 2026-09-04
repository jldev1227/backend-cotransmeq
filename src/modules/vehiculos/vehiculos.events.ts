/**
 * Eventos de tiempo real del módulo de Vehículos (flota).
 *
 * El módulo solo emitía `vehiculo:oculto` y `vehiculos:actualizacion-masiva`,
 * mientras que `/dashboard/flota` escuchaba `vehiculo-creado`,
 * `vehiculo-actualizado` y `vehiculo-eliminado` (líneas 246-248). Ninguno de
 * los tres existía, así que dar de alta un vehículo no le llegaba a nadie:
 * la página solo se refrescaba para quien había hecho el cambio, por el
 * `on:success` de su propia modal.
 *
 * Los nombres son los que la página ya escucha. Usan guion y no dos puntos,
 * a diferencia de los de servicios: es una inconsistencia real del proyecto
 * que se corrige al unificar la convención, no aquí — renombrarlos ahora
 * dejaría la página muda otra vez.
 *
 * La página recarga la lista entera con cada evento (`loadVehiculos`), así que
 * el payload es informativo. Se manda la entidad igualmente para que el día
 * que se pase a parche por id no haya que tocar el backend.
 */

import { getIo } from '../../sockets'

export const EVENTOS_VEHICULO = {
	creado: 'vehiculo-creado',
	actualizado: 'vehiculo-actualizado',
	eliminado: 'vehiculo-eliminado'
} as const

/** Ver la nota de `servicios.events.ts`: el fallo se traga a propósito. */
function emitir(evento: string, datos: unknown): void {
	try {
		getIo().emit(evento, datos)
	} catch {
		/* Socket.IO no disponible: la operación de negocio ya está hecha. */
	}
}

export function emitVehiculoCreado(vehiculo: unknown): void {
	emitir(EVENTOS_VEHICULO.creado, vehiculo)
}

export function emitVehiculoActualizado(vehiculo: unknown): void {
	emitir(EVENTOS_VEHICULO.actualizado, vehiculo)
}

export function emitVehiculoEliminado(id: string): void {
	emitir(EVENTOS_VEHICULO.eliminado, { id })
}
