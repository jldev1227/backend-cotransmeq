/**
 * Lo único del Excel de la liquidación que cambia entre empresas: razón
 * social, NIT, logo y color. El generador (`excel-liquidacion.ts`) es
 * idéntico en los dos repos; este archivo no.
 */
import { resolverLogoCotransmeq } from '../../lib/branding'
import { FUEC } from '../extractos/fuec.config'
import type { MarcaExcel } from './excel-liquidacion'

export function marcaExcelLiquidacion(): MarcaExcel {
  const ruta = resolverLogoCotransmeq()
  return {
    /// La razón social que imprime la hoja 1 de la liquidación.
    razonSocial: 'SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.',
    nit: FUEC.nit,
    color: 'FFC2410C',
    colorSuave: 'FFFFF7ED',
    colorLinea: 'FFE2E8F0',
    /// 94×60: el logotipo es 177×113 y ExcelJS no respeta la proporción solo.
    logo: ruta ? { ruta, ancho: 94, alto: 60 } : null,
  }
}
