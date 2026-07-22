/**
 * Servicio de Conciliación de Facturas con Terceros
 * 
 * Recibe 2 CSVs:
 *   1) Movimiento auxiliar por cuenta contable (software contable)
 *   2) Historial de liquidaciones de servicios para terceros
 * 
 * Matchea por número de factura y reporta:
 *   - Facturas conciliadas (presentes en ambos)
 *   - Facturas solo en contable (faltan en historial)
 *   - Facturas solo en historial (faltan en contable)
 *   - Liquidaciones anuladas
 *   - Diferencias de montos
 */

import * as XLSX from 'xlsx'

// ─── Interfaces ────────────────────────────────────────────

export interface RegistroContable {
  codigoContable: string
  cuentaContable: string
  comprobante: string
  fechaElaboracion: string
  identificacion: string
  nombreTercero: string
  saldoInicial: number
  debito: number
  credito: number
}

export interface RegistroLiquidacion {
  cliente: string
  numLiquidacion: string
  placa: string
  nombreTercero: string
  descripcion: string
  fechas: string
  valorUnidad: number
  cantidad: number
  admon: number
  total: number
  valorLiquidar: number
  numPlanilla: string
  ingresosExtraGlobal: number
  ingresosExtraAval: number
  ingresoTransmeralda: number
  numFactura: string
  liquidado: string
  ordenCompra: string
}

export interface FacturaConciliada {
  numFactura: string
  cliente: string
  // Del contable
  comprobante: string
  fechaElaboracion: string
  identificacion: string
  terceroContable: string
  creditoContable: number
  debitoContable: number
  // Del historial
  liquidaciones: {
    numLiquidacion: string
    placa: string
    nombreTercero: string
    descripcion: string
    fechas: string
    total: number
    valorLiquidar: number
    ingresoTransmeralda: number
  }[]
  valorLiquidarTotal: number
  ingresoTransmeraldaTotal: number
  diferencia: number
  estado: 'ok' | 'diferencia'
}

export interface FacturaSoloContable {
  numFactura: string // del comprobante
  comprobante: string
  fechaElaboracion: string
  identificacion: string
  terceroContable: string
  creditoContable: number
  debitoContable: number
  observacion: string
}

export interface FacturaSoloHistorial {
  numFactura: string
  cliente: string
  liquidaciones: {
    numLiquidacion: string
    placa: string
    nombreTercero: string
    descripcion: string
    total: number
    ingresoTransmeralda: number
  }[]
  totalHistorial: number
  observacion: string
}

export interface LiquidacionAnulada {
  numLiquidacion: string
  cliente: string
  placa: string
  nombreTercero: string
  descripcion: string
  total: number
  numFactura: string
  observacion: string
}

export interface ResultadoConciliacion {
  resumen: {
    totalRegistrosContables: number
    totalLiquidaciones: number
    facturasUnicas_contable: number
    facturasUnicas_historial: number
    conciliadas: number
    soloEnContable: number
    soloEnHistorial: number
    anuladas: number
    totalCredito: number
    totalHistorial: number
    diferenciasDetectadas: number
  }
  conciliadas: FacturaConciliada[]
  soloContable: FacturaSoloContable[]
  soloHistorial: FacturaSoloHistorial[]
  anuladas: LiquidacionAnulada[]
}

// ─── Helpers de parsing ────────────────────────────────────

function limpiarNumero(val: string | number | undefined | null): number {
  if (val === undefined || val === null || val === '') return 0
  if (typeof val === 'number') return val
  // Remover $, espacios, puntos de miles y reemplazar coma decimal
  const cleaned = String(val)
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')    // puntos como separador de miles
    .replace(/,/g, '.')    // coma como decimal
    .trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function limpiarTexto(val: any): string {
  if (val === undefined || val === null) return ''
  return String(val).trim()
}

/**
 * Extraer número de factura del comprobante contable
 * Formato: "FV-2-4059" → extrae "4059"
 * O si ya viene como número puro
 */
function extraerNumFacturaDeComprobante(comprobante: string): string {
  const match = comprobante.match(/(\d+)$/)
  return match ? match[1] : comprobante.trim()
}

// ─── Servicio principal ────────────────────────────────────

export class ConciliacionTercerosService {

  /**
   * Parsea el CSV del movimiento auxiliar contable
   */
  static parsearContable(buffer: Buffer, filename: string): RegistroContable[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    
    // Convertir a JSON - las primeras filas pueden ser encabezados del reporte
    const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    
    // Buscar la fila de encabezados (contiene "Código contable" o "Comprobante")
    let headerIndex = -1
    for (let i = 0; i < Math.min(rawData.length, 15); i++) {
      const row = rawData[i].map((c: any) => limpiarTexto(c).toLowerCase())
      if (row.some((c: string) => c.includes('código contable') || c.includes('codigo contable')) ||
          row.some((c: string) => c.includes('comprobante'))) {
        headerIndex = i
        break
      }
    }

    if (headerIndex === -1) {
      throw new Error('No se encontró la fila de encabezados en el archivo contable. Busque que contenga "Código contable" o "Comprobante".')
    }

    const headers = rawData[headerIndex].map((h: any) => limpiarTexto(h).toLowerCase())
    const registros: RegistroContable[] = []

    // Mapear columnas
    const colMap = {
      codigoContable: headers.findIndex((h: string) => h.includes('código contable') || h.includes('codigo contable')),
      cuentaContable: headers.findIndex((h: string) => h.includes('cuenta contable')),
      comprobante: headers.findIndex((h: string) => h.includes('comprobante')),
      fechaElaboracion: headers.findIndex((h: string) => h.includes('fecha')),
      identificacion: headers.findIndex((h: string) => h.includes('identificación') || h.includes('identificacion')),
      nombreTercero: headers.findIndex((h: string) => h.includes('nombre del tercero') || h.includes('tercero')),
      saldoInicial: headers.findIndex((h: string) => h.includes('saldo inicial')),
      debito: headers.findIndex((h: string) => h.includes('débito') || h.includes('debito')),
      credito: headers.findIndex((h: string) => h.includes('crédito') || h.includes('credito')),
    }

    for (let i = headerIndex + 1; i < rawData.length; i++) {
      const row = rawData[i]
      if (!row || row.length === 0) continue
      
      const comprobante = limpiarTexto(row[colMap.comprobante])
      if (!comprobante) continue // Saltar filas sin comprobante (totales, etc.)
      
      // Saltar filas de totales
      const firstCol = limpiarTexto(row[0]).toLowerCase()
      if (firstCol.includes('total') || firstCol.includes('subtotal')) continue

      registros.push({
        codigoContable: limpiarTexto(row[colMap.codigoContable]),
        cuentaContable: limpiarTexto(row[colMap.cuentaContable]),
        comprobante,
        fechaElaboracion: limpiarTexto(row[colMap.fechaElaboracion]),
        identificacion: limpiarTexto(row[colMap.identificacion]),
        nombreTercero: limpiarTexto(row[colMap.nombreTercero]),
        saldoInicial: limpiarNumero(row[colMap.saldoInicial]),
        debito: limpiarNumero(row[colMap.debito]),
        credito: limpiarNumero(row[colMap.credito]),
      })
    }

    return registros
  }

  /**
   * Parsea el CSV/Excel del historial de liquidaciones
   */
  static parsearLiquidaciones(buffer: Buffer, filename: string): RegistroLiquidacion[] {
    const workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 })
    const sheetName = workbook.SheetNames[0]
    const sheet = workbook.Sheets[sheetName]
    
    const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

    // Buscar fila de encabezados (contiene "CLIENTE" o "# LIQUIDACION" o "PLACA")
    let headerIndex = -1
    for (let i = 0; i < Math.min(rawData.length, 15); i++) {
      const row = rawData[i].map((c: any) => limpiarTexto(c).toUpperCase())
      if (row.some((c: string) => c.includes('CLIENTE')) &&
          row.some((c: string) => c.includes('LIQUIDACION') || c.includes('PLACA'))) {
        headerIndex = i
        break
      }
    }

    if (headerIndex === -1) {
      throw new Error('No se encontró la fila de encabezados en el archivo de liquidaciones. Busque que contenga "CLIENTE" y "LIQUIDACION" o "PLACA".')
    }

    const headers = rawData[headerIndex].map((h: any) => limpiarTexto(h).toUpperCase())
    const registros: RegistroLiquidacion[] = []

    // Mapear columnas (flexible)
    const findCol = (keywords: string[]) => {
      return headers.findIndex((h: string) => keywords.some(k => h.includes(k)))
    }

    const colMap = {
      cliente: findCol(['CLIENTE']),
      numLiquidacion: findCol(['LIQUIDACION', '# LIQUIDACION']),
      placa: findCol(['PLACA']),
      nombreTercero: findCol(['NOMBRE 3', 'NOMBRE TERCERO', 'NOMBRE 3°']),
      descripcion: findCol(['DESCRIPCION']),
      fechas: findCol(['FECHAS', 'FECHA']),
      valorUnidad: findCol(['V/UNIDAD', 'VALOR UNIDAD']),
      cantidad: findCol(['CANT']),
      admon: findCol(['ADMON']),
      total: findCol(['TOTAL']),
      valorLiquidar: findCol(['V/LIQUIDAR', 'VALOR LIQUIDAR']),
      numPlanilla: findCol(['PLANILLA', '# PLANILLA']),
      ingresosExtraGlobal: findCol(['INGRES EXTRA GLOBAL', 'INGRESOS EXTRA GLOBAL']),
      ingresosExtraAval: findCol(['INGRESOS EXTRA AVAL', 'EXTRA AVAL']),
      ingresoTransmeralda: findCol(['INGRESO TRANSMERALDA']),
      numFactura: findCol(['FACTURA', '# FACTURA']),
      liquidado: findCol(['LIQUIDADO']),
      ordenCompra: findCol(['ORDEN DE COMPRA', 'ORDEN COMPRA']),
    }

    for (let i = headerIndex + 1; i < rawData.length; i++) {
      const row = rawData[i]
      if (!row || row.length === 0) continue

      const cliente = limpiarTexto(row[colMap.cliente])
      if (!cliente) continue // Saltar filas vacías

      registros.push({
        cliente,
        numLiquidacion: limpiarTexto(row[colMap.numLiquidacion]),
        placa: limpiarTexto(row[colMap.placa]),
        nombreTercero: limpiarTexto(row[colMap.nombreTercero]),
        descripcion: limpiarTexto(row[colMap.descripcion]),
        fechas: limpiarTexto(row[colMap.fechas]),
        valorUnidad: limpiarNumero(row[colMap.valorUnidad]),
        cantidad: limpiarNumero(row[colMap.cantidad]),
        admon: limpiarNumero(row[colMap.admon]),
        total: limpiarNumero(row[colMap.total]),
        valorLiquidar: limpiarNumero(row[colMap.valorLiquidar]),
        numPlanilla: limpiarTexto(row[colMap.numPlanilla]),
        ingresosExtraGlobal: limpiarNumero(row[colMap.ingresosExtraGlobal]),
        ingresosExtraAval: limpiarNumero(row[colMap.ingresosExtraAval]),
        ingresoTransmeralda: limpiarNumero(row[colMap.ingresoTransmeralda]),
        numFactura: limpiarTexto(row[colMap.numFactura]),
        liquidado: limpiarTexto(row[colMap.liquidado]),
        ordenCompra: limpiarTexto(row[colMap.ordenCompra]),
      })
    }

    return registros
  }

  /**
   * Ejecuta la conciliación entre ambos archivos
   */
  static conciliar(
    registrosContables: RegistroContable[],
    registrosLiquidaciones: RegistroLiquidacion[]
  ): ResultadoConciliacion {

    // 1) Separar anuladas del historial
    const anuladas: LiquidacionAnulada[] = []
    const liquidacionesActivas: RegistroLiquidacion[] = []

    for (const liq of registrosLiquidaciones) {
      const facturaUpper = liq.numFactura.toUpperCase()
      const liquidadoUpper = liq.liquidado.toUpperCase()
      if (facturaUpper.includes('ANULAD') || liquidadoUpper.includes('ANULAD')) {
        anuladas.push({
          numLiquidacion: liq.numLiquidacion,
          cliente: liq.cliente,
          placa: liq.placa,
          nombreTercero: liq.nombreTercero,
          descripcion: liq.descripcion,
          total: liq.total,
          numFactura: liq.numFactura,
          observacion: 'Liquidación anulada'
        })
      } else {
        liquidacionesActivas.push(liq)
      }
    }

    // 2) Agrupar registros contables por número de factura extraído del comprobante
    //    Un comprobante como "FV-2-4059" → factura "4059"
    //    Pueden existir múltiples líneas para el mismo comprobante
    const contablePorFactura = new Map<string, RegistroContable[]>()
    for (const rc of registrosContables) {
      const numFact = extraerNumFacturaDeComprobante(rc.comprobante)
      if (!contablePorFactura.has(numFact)) {
        contablePorFactura.set(numFact, [])
      }
      contablePorFactura.get(numFact)!.push(rc)
    }

    // 3) Agrupar liquidaciones activas por número de factura
    const historialPorFactura = new Map<string, RegistroLiquidacion[]>()
    for (const liq of liquidacionesActivas) {
      const numFact = liq.numFactura.trim()
      if (!numFact) continue
      if (!historialPorFactura.has(numFact)) {
        historialPorFactura.set(numFact, [])
      }
      historialPorFactura.get(numFact)!.push(liq)
    }

    // 4) Conciliar
    const conciliadas: FacturaConciliada[] = []
    const soloContable: FacturaSoloContable[] = []
    const soloHistorial: FacturaSoloHistorial[] = []
    const facturasProcessed = new Set<string>()

    // Recorrer facturas del contable
    for (const [numFactura, regsContable] of contablePorFactura.entries()) {
      facturasProcessed.add(numFactura)
      const regsHistorial = historialPorFactura.get(numFactura)

      if (regsHistorial && regsHistorial.length > 0) {
        // Factura presente en ambos → conciliada
        // Solo sumar créditos de cuentas "ING. RECIBIDO PARA TERCEROS"
        const regsTerceros = regsContable.filter(r =>
          r.cuentaContable.toUpperCase().includes('ING') &&
          r.cuentaContable.toUpperCase().includes('RECIBIDO') &&
          r.cuentaContable.toUpperCase().includes('TERCERO')
        )
        const totalCredito = regsTerceros.reduce((sum, r) => sum + r.credito, 0)
        const totalDebito = regsContable.reduce((sum, r) => sum + r.debito, 0)
        const totalValorLiquidar = regsHistorial.reduce((sum, r) => sum + r.valorLiquidar, 0)
        const totalIngresoTransmeralda = regsHistorial.reduce((sum, r) => sum + r.ingresoTransmeralda, 0)
        const diferencia = Math.abs(totalCredito - totalValorLiquidar)

        conciliadas.push({
          numFactura,
          cliente: regsHistorial[0].cliente,
          comprobante: regsContable[0].comprobante,
          fechaElaboracion: regsContable[0].fechaElaboracion,
          identificacion: regsContable[0].identificacion,
          terceroContable: regsContable[0].nombreTercero,
          creditoContable: totalCredito,
          debitoContable: totalDebito,
          liquidaciones: regsHistorial.map(l => ({
            numLiquidacion: l.numLiquidacion,
            placa: l.placa,
            nombreTercero: l.nombreTercero,
            descripcion: l.descripcion,
            fechas: l.fechas,
            total: l.total,
            valorLiquidar: l.valorLiquidar,
            ingresoTransmeralda: l.ingresoTransmeralda,
          })),
          valorLiquidarTotal: totalValorLiquidar,
          ingresoTransmeraldaTotal: totalIngresoTransmeralda,
          diferencia,
          estado: diferencia < 1 ? 'ok' : 'diferencia'
        })
      } else {
        // Solo en contable — filtrar solo registros de ING. RECIBIDO PARA TERCEROS
        const regsTerceros = regsContable.filter(r =>
          r.cuentaContable.toUpperCase().includes('ING') &&
          r.cuentaContable.toUpperCase().includes('RECIBIDO') &&
          r.cuentaContable.toUpperCase().includes('TERCERO')
        )
        // Si no hay registros de terceros, esta factura no aplica para conciliación
        if (regsTerceros.length === 0) continue

        for (const rc of regsTerceros) {
          soloContable.push({
            numFactura,
            comprobante: rc.comprobante,
            fechaElaboracion: rc.fechaElaboracion,
            identificacion: rc.identificacion,
            terceroContable: rc.nombreTercero,
            creditoContable: rc.credito,
            debitoContable: rc.debito,
            observacion: 'Factura en software contable pero NO en historial de liquidaciones'
          })
        }
      }
    }

    // Recorrer facturas del historial no procesadas
    for (const [numFactura, regsHistorial] of historialPorFactura.entries()) {
      if (facturasProcessed.has(numFactura)) continue
      
      soloHistorial.push({
        numFactura,
        cliente: regsHistorial[0].cliente,
        liquidaciones: regsHistorial.map(l => ({
          numLiquidacion: l.numLiquidacion,
          placa: l.placa,
          nombreTercero: l.nombreTercero,
          descripcion: l.descripcion,
          total: l.total,
          ingresoTransmeralda: l.ingresoTransmeralda,
        })),
        totalHistorial: regsHistorial.reduce((s, l) => s + l.valorLiquidar, 0),
        observacion: 'Factura en historial de liquidaciones pero NO en software contable'
      })
    }

    // 5) Resumen — solo sumar créditos de cuentas de terceros
    const totalCredito = registrosContables
      .filter(r =>
        r.cuentaContable.toUpperCase().includes('ING') &&
        r.cuentaContable.toUpperCase().includes('RECIBIDO') &&
        r.cuentaContable.toUpperCase().includes('TERCERO')
      )
      .reduce((s, r) => s + r.credito, 0)
    const totalValorLiquidar = liquidacionesActivas.reduce((s, l) => s + l.valorLiquidar, 0)

    return {
      resumen: {
        totalRegistrosContables: registrosContables.length,
        totalLiquidaciones: registrosLiquidaciones.length,
        facturasUnicas_contable: contablePorFactura.size,
        facturasUnicas_historial: historialPorFactura.size,
        conciliadas: conciliadas.length,
        soloEnContable: soloContable.length,
        soloEnHistorial: soloHistorial.length,
        anuladas: anuladas.length,
        totalCredito,
        totalHistorial: totalValorLiquidar,
        diferenciasDetectadas: conciliadas.filter(c => c.estado === 'diferencia').length,
      },
      conciliadas,
      soloContable,
      soloHistorial,
      anuladas,
    }
  }

  /**
   * Genera un Excel de la conciliación
   */
  static generarExcel(resultado: ResultadoConciliacion): Buffer {
    const wb = XLSX.utils.book_new()

    // Hoja 1: Resumen
    const resumenData = [
      ['CONCILIACIÓN DE FACTURAS CON TERCEROS'],
      ['TRANSPORTES Y SERVICIOS ESMERALDA S.A.S'],
      [''],
      ['Concepto', 'Valor'],
      ['Registros contables procesados', resultado.resumen.totalRegistrosContables],
      ['Liquidaciones procesadas', resultado.resumen.totalLiquidaciones],
      ['Facturas únicas en contable', resultado.resumen.facturasUnicas_contable],
      ['Facturas únicas en historial', resultado.resumen.facturasUnicas_historial],
      ['Facturas conciliadas', resultado.resumen.conciliadas],
      ['Facturas solo en contable', resultado.resumen.soloEnContable],
      ['Facturas solo en historial', resultado.resumen.soloEnHistorial],
      ['Liquidaciones anuladas', resultado.resumen.anuladas],
      ['Diferencias detectadas', resultado.resumen.diferenciasDetectadas],
      [''],
      ['Total crédito contable', resultado.resumen.totalCredito],
      ['Total V/Liquidar historial', resultado.resumen.totalHistorial],
      ['Diferencia global', resultado.resumen.totalCredito - resultado.resumen.totalHistorial],
    ]
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenData)
    // Ajustar anchos
    wsResumen['!cols'] = [{ wch: 40 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen')

    // Hoja 2: Conciliadas
    const conciliadasData = [
      ['# Factura', 'Cliente', 'Comprobante', 'Fecha', 'NIT Tercero', 'Tercero Contable',
       'Crédito Contable', 'Débito Contable', 'V/Liquidar', 'Ingreso Cotransmeq', 'Diferencia', 'Estado',
       '# Liquidaciones', 'Placas', 'Terceros', 'Descripciones'],
      ...resultado.conciliadas.map(c => [
        c.numFactura,
        c.cliente,
        c.comprobante,
        c.fechaElaboracion,
        c.identificacion,
        c.terceroContable,
        c.creditoContable,
        c.debitoContable,
        c.valorLiquidarTotal,
        c.ingresoTransmeraldaTotal,
        c.diferencia,
        c.estado === 'ok' ? '✓ OK' : '⚠ Diferencia',
        c.liquidaciones.map(l => l.numLiquidacion).join(', '),
        c.liquidaciones.map(l => l.placa).join(', '),
        c.liquidaciones.map(l => l.nombreTercero).join(', '),
        c.liquidaciones.map(l => l.descripcion).join(', '),
      ])
    ]
    const wsConciliadas = XLSX.utils.aoa_to_sheet(conciliadasData)
    wsConciliadas['!cols'] = Array(16).fill({ wch: 18 })
    XLSX.utils.book_append_sheet(wb, wsConciliadas, 'Conciliadas')

    // Hoja 3: Solo en Contable
    const soloContData = [
      ['# Factura', 'Comprobante', 'Fecha', 'NIT', 'Tercero', 'Crédito', 'Débito', 'Observación'],
      ...resultado.soloContable.map(s => [
        s.numFactura, s.comprobante, s.fechaElaboracion, s.identificacion,
        s.terceroContable, s.creditoContable, s.debitoContable, s.observacion
      ])
    ]
    const wsSoloCont = XLSX.utils.aoa_to_sheet(soloContData)
    wsSoloCont['!cols'] = Array(8).fill({ wch: 22 })
    XLSX.utils.book_append_sheet(wb, wsSoloCont, 'Solo en Contable')

    // Hoja 4: Solo en Historial
    const soloHistData = [
      ['# Factura', 'Cliente', '# Liquidaciones', 'Placas', 'Terceros', 'Total Historial', 'Observación'],
      ...resultado.soloHistorial.map(s => [
        s.numFactura, s.cliente,
        s.liquidaciones.map(l => l.numLiquidacion).join(', '),
        s.liquidaciones.map(l => l.placa).join(', '),
        s.liquidaciones.map(l => l.nombreTercero).join(', '),
        s.totalHistorial,
        s.observacion
      ])
    ]
    const wsSoloHist = XLSX.utils.aoa_to_sheet(soloHistData)
    wsSoloHist['!cols'] = Array(7).fill({ wch: 22 })
    XLSX.utils.book_append_sheet(wb, wsSoloHist, 'Solo en Historial')

    // Hoja 5: Anuladas
    const anuladasData = [
      ['# Liquidación', 'Cliente', 'Placa', 'Tercero', 'Descripción', 'Total', '# Factura', 'Observación'],
      ...resultado.anuladas.map(a => [
        a.numLiquidacion, a.cliente, a.placa, a.nombreTercero,
        a.descripcion, a.total, a.numFactura, a.observacion
      ])
    ]
    const wsAnuladas = XLSX.utils.aoa_to_sheet(anuladasData)
    wsAnuladas['!cols'] = Array(8).fill({ wch: 22 })
    XLSX.utils.book_append_sheet(wb, wsAnuladas, 'Anuladas')

    // Generar buffer
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return excelBuffer
  }
}
