/**
 * Datos fijos de la empresa que imprime cada extracto de contrato (FUEC,
 * formato OP-FR-04). Son los que no cambian de un extracto a otro: la razón
 * social, el pie de página y el prefijo del número.
 *
 * El número del FUEC lo fija la Resolución 6652/2019 del Mintransporte
 * (art. 4): territorial (3) + resolución de habilitación (4) + año de la
 * habilitación (2) + año de expedición (4) + número de contrato (4) +
 * consecutivo (4). El prefijo son los nueve primeros dígitos.
 */
export const FUEC = {
  /// 550 Meta-Vaupés-Vichada · 3115 resolución de habilitación · 25 año (2025).
  prefijo: '550311525',
  razon_social: 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.',
  nit: '901.983.227',
  codigo_formato: 'OP-FR-01',
  version: '1',
  fecha_formato: '1-10-2025',
  direccion: 'KM 108 VIA KIOSKOS ASENTAMIENTO HUMANO CUERNAVACA Puerto Gaitan Meta',
  email: 'operaciones.cotransmeq@hotmail.com',
  telefono: '302 5711858',
  firmante_cargo: 'GERENTE',
  /// Empresas afiliadoras que son la propia: el convenio de colaboración se imprime «N/A».
  afiliacion_propia: ['COTRANSMEQ', 'COTRANSMEQ SAS', 'COTRANSMEQ S.A.S', 'COTRANSMEQ S.A.S.', 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.', 'SERVICIOS Y TRANSPORTES COTRANSMEQ SAS'],
  /// Objeto que se propone por defecto al crear uno nuevo.
  objeto_defecto: 'CONTRATO PARA TRANSPORTE DE PERSONAL Y HERRAMIENTAS',
} as const
