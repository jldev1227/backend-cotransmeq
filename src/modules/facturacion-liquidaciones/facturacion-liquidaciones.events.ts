/** Eventos públicos del dominio de facturación de liquidaciones. */
export const EVENTOS_FACTURACION_LIQUIDACIONES = {
	facturaCreada: 'facturacion-created',
	facturaActualizada: 'facturacion-updated',
	facturaAnulada: 'facturacion-anulada',
	liquidacionFacturada: 'liquidacion-servicio-facturada'
} as const;

export type EventoFacturacionLiquidacion =
	(typeof EVENTOS_FACTURACION_LIQUIDACIONES)[keyof typeof EVENTOS_FACTURACION_LIQUIDACIONES];
