/**
 * El Excel de la liquidación: que traiga las hojas del documento y que sus
 * totales sean los guardados (los que se facturan), no una suma recalculada.
 * Puro: no toca la base ni el disco.
 */
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  generarExcelLiquidacion,
  nombreArchivoLiquidacion,
  type LiquidacionParaExcel,
  type MarcaExcel,
} from './excel-liquidacion'

const MARCA: MarcaExcel = {
  razonSocial: 'EMPRESA DE PRUEBA S.A.S.',
  nit: '900.000.000-1',
  color: 'FF087A57',
  colorSuave: 'FFEFFBF5',
  colorLinea: 'FFDEE7E3',
  logo: null,
}

function liquidacion(extra: Partial<LiquidacionParaExcel> = {}): LiquidacionParaExcel {
  return {
    consecutivo: 'CONF-015',
    mes: 4,
    anio: 2026,
    estado: 'APROBADA',
    fecha_liquidacion: new Date('2026-05-08T14:05:00Z'),
    fecha_aprobacion: new Date('2026-05-08T14:09:00Z'),
    fecha_facturacion: null,
    osi: 'OSI 26-1',
    operadora: 'PAREX',
    observaciones: 'Servicio del 1 al 30 de abril',
    valor_servicios: 1_000_000,
    valor_recargos: 200_000,
    valor_transporte_adicional: 0,
    valor_administracion_ta: 0,
    valor_pernoctes: 50_000,
    subtotal: 1_250_000,
    porcentaje_iva: 0,
    valor_iva: 0,
    total: 1_250_000,
    cliente: { nombre: 'CONFIPETROL S.A.S', nit: '900.179.369' },
    liquidado_por: { nombre: 'Ana' },
    aprobado_por: { nombre: 'Luis' },
    items: [
      {
        placa: 'QLR015',
        fecha_inicial: new Date('2026-04-01T00:00:00Z'),
        fecha_final: new Date('2026-04-07T00:00:00Z'),
        recorrido: 'VILLANUEVA - YOPAL',
        tipo_servicio: 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA',
        cantidad: 2,
        valor_unitario: 400_000,
        subtotal: 800_000,
        porcentaje_descuento: 0,
        valor_final: 800_000,
        numero_planilla: 'TM-1',
        cantidad_pernoctes: 0,
        valor_pernoctes_total: 0,
      },
      {
        placa: 'POP128',
        fecha_inicial: new Date('2026-04-08T00:00:00Z'),
        fecha_final: new Date('2026-04-30T00:00:00Z'),
        recorrido: 'TRANSPORTE ADICIONAL (HORA ADICIONAL)',
        tipo_servicio: 'TRANSPORTE_ADICIONAL_HORA_ADICIONAL',
        cantidad: 5,
        valor_unitario: 40_000,
        subtotal: 200_000,
        porcentaje_descuento: 0,
        valor_final: 200_000,
        numero_planilla: null,
        cantidad_pernoctes: 1,
        valor_pernoctes_total: 50_000,
      },
    ],
    recargos_data: {
      rows: [{ planilla: 'TM-1', placa: 'QLR015', conductor: 'JUAN', empresa: 'X', days: [10, 12], total: 22, promedio: 11, hed: 2, rn: 1 }],
    },
    historial: [
      { created_at: new Date('2026-05-07T19:46:00Z'), accion: 'creacion', estado_anterior: null, estado_nuevo: 'BORRADOR', motivo: null, usuario: { nombre: 'Jonathan' }, snapshot: { total: 1_100_000 } },
      { created_at: new Date('2026-05-08T14:09:00Z'), accion: 'cambio_estado', estado_anterior: 'LIQUIDADA', estado_nuevo: 'APROBADA', motivo: null, usuario: { nombre: 'Luis' }, snapshot: { total: 1_250_000 } },
    ],
    ...extra,
  }
}

async function leer(liq: LiquidacionParaExcel) {
  const { buffer, filename } = await generarExcelLiquidacion(liq, MARCA)
  const wb = new ExcelJS.Workbook()
  /// ExcelJS tipa `load` con su propio `Buffer` (un `ArrayBuffer`), no el de Node.
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  return { wb, filename }
}

/** Valor de la celda a la derecha de una etiqueta del bloque de totales. */
function totalDe(ws: ExcelJS.Worksheet, etiqueta: string): unknown {
  let valor: unknown
  ws.eachRow((fila) => {
    if (fila.getCell(8).value === etiqueta) valor = fila.getCell(11).value
  })
  return valor
}

describe('Excel de la liquidación', () => {
  it('trae las tres hojas del documento', async () => {
    const { wb } = await leer(liquidacion())
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Liquidación', 'Recargos (horas)', 'Trazabilidad'])
  })

  it('los totales son los guardados, en el orden de la hoja 1', async () => {
    const { wb } = await leer(liquidacion())
    const ws = wb.getWorksheet('Liquidación')!
    expect(totalDe(ws, 'Valor total del servicio sin recargos')).toBe(1_000_000)
    expect(totalDe(ws, 'Valor total recargos')).toBe(200_000)
    expect(totalDe(ws, 'Pernoctes')).toBe(50_000)
    expect(totalDe(ws, 'TOTAL SERVICIO')).toBe(1_250_000)
    // Transporte adicional en cero no se imprime: no es un renglón del documento.
    expect(totalDe(ws, 'Transporte adicional')).toBeUndefined()
  })

  it('la fila de totales de la tabla suma con fórmulas', async () => {
    const { wb } = await leer(liquidacion())
    const ws = wb.getWorksheet('Liquidación')!
    let fila: ExcelJS.Row | undefined
    ws.eachRow((f) => {
      if (f.getCell(1).value === 'TOTAL SERVICIOS') fila = f
    })
    const vrFinal = fila!.getCell(11).value as { formula: string; result: number }
    expect(vrFinal.formula).toMatch(/^SUM\(K\d+:K\d+\)$/)
    expect(vrFinal.result).toBe(1_000_000)
  })

  it('las columnas de pernoctes solo aparecen si algún ítem los tiene', async () => {
    const con = (await leer(liquidacion())).wb.getWorksheet('Liquidación')!
    const sin = (
      await leer(liquidacion({ items: liquidacion().items.map((i) => ({ ...i, cantidad_pernoctes: 0, valor_pernoctes_total: 0 })) }))
    ).wb.getWorksheet('Liquidación')!
    expect(con.columnCount).toBe(14)
    expect(sin.columnCount).toBe(12)
  })

  it('sin planillas no hay hoja de recargos; sin historial no hay trazabilidad', async () => {
    const { wb } = await leer(liquidacion({ recargos_data: { rows: [] }, historial: [] }))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Liquidación'])
  })

  it('una liquidación devuelta a borrador no muestra la aprobación vieja', async () => {
    const { wb } = await leer(liquidacion({ estado: 'BORRADOR' }))
    const ws = wb.getWorksheet('Liquidación')!
    let aprobada: unknown
    ws.eachRow((f) => {
      if (f.getCell(1).value === 'Aprobada') aprobada = f.getCell(3).value
    })
    expect(aprobada).toBe('—')
  })

  it('el nombre del archivo es ASCII y lleva consecutivo, cliente y periodo', () => {
    expect(nombreArchivoLiquidacion({ consecutivo: 'FEPCO-0394', mes: 9, anio: 2026, cliente: { nombre: 'FÉPCO SERVICIOS S.A.S', nit: null } })).toBe(
      'Liquidacion_FEPCO-0394_FEPCO_SERVICIOS_S_A_S_Septiembre-2026.xlsx',
    )
  })
})
