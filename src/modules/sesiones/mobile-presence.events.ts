/** Contrato de presencia móvil: identidad verificada en el handshake. */
export const EVENTOS_PRESENCIA_MOVIL = {
  entrar: 'mobile-presence:join',
  salir: 'mobile-presence:leave',
  cambio: 'mobile-presence:changed'
} as const
