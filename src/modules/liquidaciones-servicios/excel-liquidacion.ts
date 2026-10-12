/**
 * Excel de una liquidación de servicio: lo que se descarga desde la vista
 * previa del documento.
 *
 * Antes era una sola hoja con los ítems y la suma de sus valores: le faltaban
 * los recargos, los pernoctes, el IVA y el total de la liquidación, que son
 * justo lo que se cruza con la factura, y el botón decía «CSV» aunque bajaba
 * un .xlsx. Ahora trae tres hojas que siguen al documento impreso:
 *
 *   1. Liquidación: encabezado, ítems y los totales de la hoja 1.
 *   2. Recargos (horas): la hoja 2, si la liquidación tiene planillas.
 *   3. Trazabilidad: los cambios de estado y las ediciones, con su total.
 *
 * Es idéntico en los dos repos. Lo que cambia por empresa (razón social,
 * NIT, logo y color) llega en `MarcaExcel` desde `excel-marca.ts`.
 */
import ExcelJS from 'exceljs'

export interface MarcaExcel {
  razonSocial: string
  nit: string
  /** ARGB del color de la marca: encabezados de tabla y título. */
  color: string
  /** ARGB del tono claro: filas alternas y bloque de totales. */
  colorSuave: string
  /** ARGB de las líneas de la tabla. */
  colorLinea: string
  logo: { ruta: string; ancho: number; alto: number } | null
}

interface Persona {
  nombre: string | null
}

export interface ItemParaExcel {
  placa: string
  fecha_inicial: Date
  fecha_final: Date
  recorrido: string
  tipo_servicio: string
  cantidad: number
  valor_unitario: number
  subtotal: number
  porcentaje_descuento: number
  valor_final: number
  numero_planilla: string | null
  cantidad_pernoctes: number
  valor_pernoctes_total: number
}

export interface EventoParaExcel {
  created_at: Date
  accion: string | null
  estado_anterior: string | null
  estado_nuevo: string
  motivo: string | null
  usuario: Persona | null
  snapshot: unknown
}

export interface LiquidacionParaExcel {
  consecutivo: string
  mes: number
  anio: number
  estado: string
  fecha_liquidacion: Date | null
  fecha_aprobacion: Date | null
  fecha_facturacion: Date | null
  osi: string | null
  operadora: string | null
  observaciones: string | null
  valor_servicios: number
  valor_recargos: number
  valor_transporte_adicional: number
  valor_administracion_ta: number
  valor_pernoctes: number
  subtotal: number
  porcentaje_iva: number
  valor_iva: number
  total: number
  cliente: { nombre: string | null; nit: string | null }
  liquidado_por: Persona | null
  aprobado_por: Persona | null
  items: ItemParaExcel[]
  recargos_data: unknown
  historial: EventoParaExcel[]
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const ESTADOS: Record<string, string> = {
  BORRADOR: 'Borrador',
  LIQUIDADA: 'Liquidada',
  APROBADA: 'Aprobada',
  FACTURADA: 'Facturada',
  ANULADA: 'Anulada',
}

/// Prisma devuelve la clave del enum; el documento imprime la etiqueta.
const TIPOS_SERVICIO: Record<string, string> = {
  TRANSPORTE_DE_PERSONAL_EN_CAMIONETA: 'TRANSPORTE DE PERSONAL EN CAMIONETA',
  TRANSPORTE_DE_PERSONAL_EN_BUSETA: 'TRANSPORTE DE PERSONAL EN BUSETA',
  TRANSPORTE_DE_PERSONAL_EN_MICROBUS: 'TRANSPORTE DE PERSONAL EN MICROBUS',
  TRANSPORTE_DE_PERSONAL_EN_BUS: 'TRANSPORTE DE PERSONAL EN BUS',
  TRANSPORTE_DE_HERRAMIENTA_EN_CAMIONETA_DOBLE_CABINA: 'TRANSPORTE DE HERRAMIENTA EN CAMIONETA DOBLE CABINA',
  TRANSPORTE_ADICIONAL_HORA_ADICIONAL: 'TRANSPORTE ADICIONAL (HORA ADICIONAL)',
  TRANSPORTE_ADICIONAL_KM_ADICIONAL: 'TRANSPORTE ADICIONAL (KM ADICIONAL)',
  TRANSPORTE_ADICIONAL_DISPONIBILIDAD: 'TRANSPORTE ADICIONAL (DISPONIBILIDAD)',
}

const EVENTOS: Record<string, string> = {
  creacion: 'Creación',
  edicion: 'Edición',
  cambio_estado: 'Cambio de estado',
}

/// Excel muestra los separadores según el idioma de quien lo abre: en español
/// «$ 1.234.567». Los negativos en rojo, como en la contabilidad.
const FMT_COP = '"$" #,##0;[Red]-"$" #,##0'
const FMT_FECHA = 'dd/mm/yyyy'
const FMT_FECHA_HORA = 'dd/mm/yyyy hh:mm'
const FMT_HORAS = '0.##'
const GRIS = 'FF66756F'
const TINTA = 'FF17201D'

/// Colombia no tiene horario de verano: la hora local es UTC−5 todo el año.
/// ExcelJS escribe las fechas en UTC, así que una marca de tiempo se corre a
/// la hora de Bogotá para que la celda diga lo que vio el usuario.
const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000
const enBogota = (d: Date | null) => (d ? new Date(d.getTime() - OFFSET_BOGOTA_MS) : null)

const fechaLarga = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat('es-CO', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'America/Bogota',
      }).format(d)
    : '—'

const periodo = (mes: number, anio: number) => `${MESES[mes - 1] ?? mes} ${anio}`

function borde(color: string): Partial<ExcelJS.Borders> {
  const linea = { style: 'thin' as const, color: { argb: color } }
  return { top: linea, left: linea, bottom: linea, right: linea }
}

function relleno(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function encabezadoTabla(fila: ExcelJS.Row, titulos: string[], marca: MarcaExcel) {
  titulos.forEach((t, i) => {
    const c = fila.getCell(i + 1)
    c.value = t
    c.fill = relleno(marca.color)
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = borde(marca.color)
  })
  fila.height = 30
}

function etiquetaValor(
  ws: ExcelJS.Worksheet,
  fila: number,
  col: number,
  etiqueta: string,
  valor: ExcelJS.CellValue,
  hasta: number,
  /** Columnas que ocupa la etiqueta: la primera columna de la hoja es la de
   *  «N.°» y no cabe «Observaciones». */
  anchoEtiqueta = 1,
) {
  if (anchoEtiqueta > 1) ws.mergeCells(fila, col, fila, col + anchoEtiqueta - 1)
  const e = ws.getCell(fila, col)
  e.value = etiqueta
  e.font = { bold: true, size: 9, color: { argb: GRIS } }
  e.alignment = { vertical: 'top' }
  ws.mergeCells(fila, col + anchoEtiqueta, fila, hasta)
  const v = ws.getCell(fila, col + anchoEtiqueta)
  v.value = valor
  v.font = { size: 10, color: { argb: TINTA } }
  v.alignment = { vertical: 'top', wrapText: true }
}

/** Un nombre de archivo que viaja bien en `Content-Disposition` (ASCII). */
export function nombreArchivoLiquidacion(liq: Pick<LiquidacionParaExcel, 'consecutivo' | 'mes' | 'anio' | 'cliente'>): string {
  const limpio = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)
  const partes = ['Liquidacion', liq.consecutivo, liq.cliente.nombre ?? '', `${MESES[liq.mes - 1] ?? liq.mes}-${liq.anio}`]
  return partes.map((p) => limpio(String(p))).filter(Boolean).join('_') + '.xlsx'
}

// ── Hoja 1 ──────────────────────────────────────────────────────────────
function hojaLiquidacion(wb: ExcelJS.Workbook, liq: LiquidacionParaExcel, marca: MarcaExcel) {
  const ws = wb.addWorksheet('Liquidación', {
    properties: { defaultRowHeight: 18 },
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  })
  ws.headerFooter.oddFooter = `&L${liq.consecutivo} · ${marca.razonSocial}&RPágina &P de &N`

  const conPernoctes = liq.items.some((i) => i.cantidad_pernoctes > 0 || i.valor_pernoctes_total > 0)
  const columnas: Array<{ titulo: string; ancho: number }> = [
    { titulo: 'N.°', ancho: 5 },
    { titulo: 'Placa', ancho: 11 },
    { titulo: 'Fecha inicial', ancho: 12 },
    { titulo: 'Fecha final', ancho: 12 },
    { titulo: 'Recorrido', ancho: 44 },
    { titulo: 'Tipo de servicio', ancho: 32 },
    { titulo: 'Cant.', ancho: 7 },
    { titulo: 'Vr. unitario', ancho: 15 },
    { titulo: 'Subtotal', ancho: 15 },
    { titulo: 'Dcto.', ancho: 8 },
    { titulo: 'Vr. final', ancho: 15 },
    { titulo: 'Planilla', ancho: 13 },
    ...(conPernoctes
      ? [
          { titulo: 'Pernoctes', ancho: 10 },
          { titulo: 'Vr. pernoctes', ancho: 15 },
        ]
      : []),
  ]
  const ultimaCol = columnas.length
  columnas.forEach((c, i) => (ws.getColumn(i + 1).width = c.ancho))

  // Encabezado del documento
  if (marca.logo) {
    const id = wb.addImage({ filename: marca.logo.ruta, extension: 'png' })
    ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: marca.logo.ancho, height: marca.logo.alto } })
  }
  ws.mergeCells(1, 3, 1, 9)
  const titulo = ws.getCell(1, 3)
  titulo.value = 'LIQUIDACIÓN DE SERVICIOS'
  titulo.font = { bold: true, size: 16, color: { argb: marca.color } }
  ws.mergeCells(2, 3, 2, 9)
  const sub = ws.getCell(2, 3)
  sub.value = `OP-FR-07 · ${marca.razonSocial} · NIT ${marca.nit}`
  sub.font = { size: 10, color: { argb: GRIS } }
  ws.mergeCells(1, 10, 1, ultimaCol)
  const num = ws.getCell(1, 10)
  num.value = `N.° ${liq.consecutivo}`
  num.font = { bold: true, size: 14, color: { argb: TINTA } }
  num.alignment = { horizontal: 'right' }
  ws.mergeCells(2, 10, 2, ultimaCol)
  const est = ws.getCell(2, 10)
  est.value = ESTADOS[liq.estado] ?? liq.estado
  est.font = { bold: true, size: 10, color: { argb: marca.color } }
  est.alignment = { horizontal: 'right' }
  ws.mergeCells(3, 10, 3, ultimaCol)
  const gen = ws.getCell(3, 10)
  gen.value = `Generado el ${fechaLarga(new Date())}`
  gen.font = { size: 8, italic: true, color: { argb: GRIS } }
  gen.alignment = { horizontal: 'right' }
  ws.getRow(1).height = 24

  // Datos generales, en tres columnas de etiqueta + valor
  const fila = 5
  etiquetaValor(ws, fila, 1, 'Cliente', liq.cliente.nombre ?? '—', 5, 2)
  etiquetaValor(ws, fila, 6, 'NIT', liq.cliente.nit ?? '—', 8)
  etiquetaValor(ws, fila, 9, 'Periodo', periodo(liq.mes, liq.anio), ultimaCol)
  etiquetaValor(ws, fila + 1, 1, 'OSI', liq.osi || '—', 5, 2)
  etiquetaValor(ws, fila + 1, 6, 'Operadora', liq.operadora || '—', 8)
  etiquetaValor(
    ws,
    fila + 1,
    9,
    'Liquidada',
    liq.fecha_liquidacion && ['LIQUIDADA', 'APROBADA', 'FACTURADA'].includes(liq.estado)
      ? `${fechaLarga(liq.fecha_liquidacion)}${liq.liquidado_por?.nombre ? ` · ${liq.liquidado_por.nombre}` : ''}`
      : '—',
    ultimaCol,
  )
  etiquetaValor(
    ws,
    fila + 2,
    1,
    'Aprobada',
    liq.fecha_aprobacion && ['APROBADA', 'FACTURADA'].includes(liq.estado)
      ? `${fechaLarga(liq.fecha_aprobacion)}${liq.aprobado_por?.nombre ? ` · ${liq.aprobado_por.nombre}` : ''}`
      : '—',
    5,
    2,
  )
  /// Mismas condiciones que el editor: una liquidación devuelta a borrador
  /// conserva sus fechas viejas en la base, pero ya no está aprobada.
  etiquetaValor(
    ws,
    fila + 2,
    6,
    'Facturada',
    liq.fecha_facturacion && liq.estado === 'FACTURADA' ? fechaLarga(liq.fecha_facturacion) : '—',
    8,
  )
  etiquetaValor(ws, fila + 2, 9, 'Servicios', liq.items.length, ultimaCol)
  let filaTabla = fila + 4
  if (liq.observaciones?.trim()) {
    etiquetaValor(ws, fila + 3, 1, 'Observaciones', liq.observaciones.trim(), ultimaCol, 2)
    ws.getRow(fila + 3).height = Math.min(60, 18 * Math.ceil(liq.observaciones.length / 140))
    filaTabla = fila + 5
  }

  // Tabla de ítems
  encabezadoTabla(ws.getRow(filaTabla), columnas.map((c) => c.titulo), marca)
  const primera = filaTabla + 1
  liq.items.forEach((it, i) => {
    const r = ws.getRow(primera + i)
    r.values = [
      i + 1,
      it.placa,
      it.fecha_inicial,
      it.fecha_final,
      it.recorrido,
      TIPOS_SERVICIO[it.tipo_servicio] ?? it.tipo_servicio.replace(/_/g, ' '),
      it.cantidad,
      it.valor_unitario,
      it.subtotal,
      it.porcentaje_descuento / 100,
      it.valor_final,
      it.numero_planilla ?? '',
      ...(conPernoctes ? [it.cantidad_pernoctes, it.valor_pernoctes_total] : []),
    ]
    r.getCell(3).numFmt = FMT_FECHA
    r.getCell(4).numFmt = FMT_FECHA
    ;[8, 9, 11].forEach((c) => (r.getCell(c).numFmt = FMT_COP))
    r.getCell(10).numFmt = '0%'
    if (conPernoctes) r.getCell(14).numFmt = FMT_COP
    r.getCell(5).alignment = { wrapText: true, vertical: 'top' }
    r.getCell(6).alignment = { wrapText: true, vertical: 'top' }
    for (let c = 1; c <= ultimaCol; c++) {
      const cell = r.getCell(c)
      cell.border = borde(marca.colorLinea)
      cell.font = { size: 10 }
      if (i % 2 === 1) cell.fill = relleno(marca.colorSuave)
      if (![5, 6].includes(c)) cell.alignment = { ...(cell.alignment ?? {}), vertical: 'top' }
    }
  })
  const ultimaItem = primera + Math.max(liq.items.length, 1) - 1

  // Fila de totales de la tabla, con fórmulas: si alguien corrige un valor en
  // el Excel, la suma lo sigue.
  const filaTot = ultimaItem + 1
  const tot = ws.getRow(filaTot)
  ws.mergeCells(filaTot, 1, filaTot, 6)
  tot.getCell(1).value = 'TOTAL SERVICIOS'
  tot.getCell(1).alignment = { horizontal: 'right' }
  const suma = (col: number, resultado: number) => ({
    formula: `SUM(${ws.getColumn(col).letter}${primera}:${ws.getColumn(col).letter}${ultimaItem})`,
    result: resultado,
  })
  tot.getCell(7).value = suma(7, liq.items.reduce((s, i) => s + i.cantidad, 0))
  tot.getCell(9).value = suma(9, liq.items.reduce((s, i) => s + i.subtotal, 0))
  tot.getCell(11).value = suma(11, liq.items.reduce((s, i) => s + i.valor_final, 0))
  if (conPernoctes) {
    tot.getCell(13).value = suma(13, liq.items.reduce((s, i) => s + i.cantidad_pernoctes, 0))
    tot.getCell(14).value = suma(14, liq.items.reduce((s, i) => s + i.valor_pernoctes_total, 0))
    tot.getCell(14).numFmt = FMT_COP
  }
  ;[9, 11].forEach((c) => (tot.getCell(c).numFmt = FMT_COP))
  for (let c = 1; c <= ultimaCol; c++) {
    const cell = tot.getCell(c)
    cell.font = { bold: true, size: 10 }
    cell.fill = relleno(marca.colorSuave)
    cell.border = borde(marca.colorLinea)
  }

  if (liq.items.length > 0) {
    ws.autoFilter = { from: { row: filaTabla, column: 1 }, to: { row: ultimaItem, column: ultimaCol } }
  }
  ws.pageSetup.printTitlesRow = `${filaTabla}:${filaTabla}`

  // Resumen: los mismos renglones y el mismo orden que la hoja 1 impresa.
  // Son los valores guardados de la liquidación, no sumas recalculadas: son
  // los que se facturan.
  const renglones: Array<[string, number, boolean?]> = [
    ['Valor total del servicio sin recargos', liq.valor_servicios],
    ['Valor total recargos', liq.valor_recargos],
    ...(liq.valor_transporte_adicional ? ([['Transporte adicional', liq.valor_transporte_adicional]] as Array<[string, number]>) : []),
    ...(liq.valor_administracion_ta ? ([['Administración transporte adicional', liq.valor_administracion_ta]] as Array<[string, number]>) : []),
    ['Pernoctes', liq.valor_pernoctes],
    ['Subtotal', liq.subtotal],
    [`IVA ${liq.porcentaje_iva}%`, liq.valor_iva],
    ['TOTAL SERVICIO', liq.total, true],
  ]
  let r0 = filaTot + 2
  for (const [etiqueta, valor, fuerte] of renglones) {
    ws.mergeCells(r0, 8, r0, 10)
    const e = ws.getCell(r0, 8)
    e.value = etiqueta
    e.alignment = { horizontal: 'right' }
    const v = ws.getCell(r0, 11)
    v.value = valor
    v.numFmt = FMT_COP
    for (const c of [e, v]) {
      c.border = borde(marca.colorLinea)
      c.font = fuerte ? { bold: true, size: 11, color: { argb: 'FFFFFFFF' } } : { size: 10 }
      if (fuerte) c.fill = relleno(marca.color)
    }
    r0++
  }
}

// ── Hoja 2: recargos (horas) ────────────────────────────────────────────
interface FilaRecargos {
  planilla?: string
  placa?: string
  conductor?: string
  empresa?: string
  days?: number[]
  total?: number
  promedio?: number
  hed?: number
  hen?: number
  hefd?: number
  hefn?: number
  rn?: number
  rndf?: number
  rd?: number
}

function filasRecargos(data: unknown): FilaRecargos[] {
  const rows = (data as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as FilaRecargos[]).filter((r) => r && typeof r === 'object') : []
}

function hojaRecargos(wb: ExcelJS.Workbook, liq: LiquidacionParaExcel, marca: MarcaExcel) {
  const filas = filasRecargos(liq.recargos_data)
  if (filas.length === 0) return
  const ws = wb.addWorksheet('Recargos (horas)', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const diasMes = new Date(Date.UTC(liq.anio, liq.mes, 0)).getUTCDate()
  const fijos = ['Planilla', 'Placa', 'Conductor', 'Empresa']
  const tipos: Array<[keyof FilaRecargos, string]> = [
    ['hed', 'HED'],
    ['hen', 'HEN'],
    ['hefd', 'HEFD'],
    ['hefn', 'HEFN'],
    ['rn', 'RN'],
    ['rndf', 'RNDF'],
    ['rd', 'RD'],
  ]
  const titulos = [...fijos, ...Array.from({ length: diasMes }, (_, i) => String(i + 1)), 'Total h', 'Promedio', ...tipos.map((t) => t[1])]

  ws.mergeCells(1, 1, 1, 8)
  const t = ws.getCell(1, 1)
  t.value = `RECARGOS (HORAS) · ${liq.consecutivo} · ${periodo(liq.mes, liq.anio)}`
  t.font = { bold: true, size: 13, color: { argb: marca.color } }
  ws.mergeCells(2, 1, 2, 8)
  const s = ws.getCell(2, 1)
  s.value = 'HED/HEN: horas extra diurnas/nocturnas · HEFD/HEFN: extra festivas · RN: recargo nocturno · RNDF: nocturno dominical/festivo · RD: dominical'
  s.font = { size: 8, color: { argb: GRIS } }

  const filaEnc = 4
  encabezadoTabla(ws.getRow(filaEnc), titulos, marca)
  ;[12, 10, 30, 26].forEach((w, i) => (ws.getColumn(i + 1).width = w))
  for (let c = fijos.length + 1; c <= titulos.length; c++) ws.getColumn(c).width = c <= fijos.length + diasMes ? 4.5 : 8

  filas.forEach((f, i) => {
    const dias = Array.from({ length: diasMes }, (_, d) => {
      const h = Number(f.days?.[d] ?? 0)
      return h ? h : null
    })
    const r = ws.getRow(filaEnc + 1 + i)
    r.values = [
      f.planilla ?? '',
      f.placa ?? '',
      f.conductor ?? '',
      f.empresa ?? '',
      ...dias,
      Number(f.total ?? 0),
      Number(f.promedio ?? 0),
      ...tipos.map(([k]) => Number(f[k] ?? 0)),
    ]
    for (let c = 1; c <= titulos.length; c++) {
      const cell = r.getCell(c)
      cell.border = borde(marca.colorLinea)
      cell.font = { size: 9 }
      if (c > fijos.length) {
        cell.numFmt = FMT_HORAS
        cell.alignment = { horizontal: 'center' }
      }
      if (i % 2 === 1) cell.fill = relleno(marca.colorSuave)
    }
  })

  const primera = filaEnc + 1
  const ultima = filaEnc + filas.length
  const tot = ws.getRow(ultima + 1)
  ws.mergeCells(ultima + 1, 1, ultima + 1, fijos.length)
  tot.getCell(1).value = 'TOTALES'
  tot.getCell(1).alignment = { horizontal: 'right' }
  for (let c = fijos.length + 1; c <= titulos.length; c++) {
    const letra = ws.getColumn(c).letter
    // El promedio no se suma: se promedia.
    const fn = titulos[c - 1] === 'Promedio' ? 'AVERAGE' : 'SUM'
    tot.getCell(c).value = { formula: `${fn}(${letra}${primera}:${letra}${ultima})` }
    tot.getCell(c).numFmt = FMT_HORAS
    tot.getCell(c).alignment = { horizontal: 'center' }
  }
  for (let c = 1; c <= titulos.length; c++) {
    const cell = tot.getCell(c)
    cell.font = { bold: true, size: 9 }
    cell.fill = relleno(marca.colorSuave)
    cell.border = borde(marca.colorLinea)
  }

  ws.views = [{ state: 'frozen', xSplit: fijos.length, ySplit: filaEnc }]
  ws.autoFilter = { from: { row: filaEnc, column: 1 }, to: { row: ultima, column: titulos.length } }
}

// ── Hoja 3: trazabilidad ────────────────────────────────────────────────
function totalDeFoto(foto: unknown): number | null {
  const t = (foto as { total?: unknown } | null)?.total
  const n = Number(t)
  return t === undefined || t === null || Number.isNaN(n) ? null : n
}

function hojaTrazabilidad(wb: ExcelJS.Workbook, liq: LiquidacionParaExcel, marca: MarcaExcel) {
  if (liq.historial.length === 0) return
  const ws = wb.addWorksheet('Trazabilidad', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const titulos = ['Fecha y hora', 'Evento', 'Estado anterior', 'Estado nuevo', 'Usuario', 'Motivo', 'Total en ese momento']
  ;[18, 18, 16, 16, 28, 50, 20].forEach((w, i) => (ws.getColumn(i + 1).width = w))

  ws.mergeCells(1, 1, 1, 5)
  const t = ws.getCell(1, 1)
  t.value = `TRAZABILIDAD · ${liq.consecutivo}`
  t.font = { bold: true, size: 13, color: { argb: marca.color } }

  const filaEnc = 3
  encabezadoTabla(ws.getRow(filaEnc), titulos, marca)
  const eventos = [...liq.historial].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
  eventos.forEach((e, i) => {
    const r = ws.getRow(filaEnc + 1 + i)
    const tipo = e.accion ?? 'cambio_estado'
    r.values = [
      enBogota(e.created_at),
      EVENTOS[tipo] ?? tipo,
      e.estado_anterior ? (ESTADOS[e.estado_anterior] ?? e.estado_anterior) : '',
      ESTADOS[e.estado_nuevo] ?? e.estado_nuevo,
      e.usuario?.nombre ?? 'Sistema',
      e.motivo ?? '',
      totalDeFoto(e.snapshot),
    ]
    r.getCell(1).numFmt = FMT_FECHA_HORA
    r.getCell(7).numFmt = FMT_COP
    r.getCell(6).alignment = { wrapText: true, vertical: 'top' }
    for (let c = 1; c <= titulos.length; c++) {
      const cell = r.getCell(c)
      cell.border = borde(marca.colorLinea)
      cell.font = { size: 9 }
      if (c !== 6) cell.alignment = { vertical: 'top' }
      if (i % 2 === 1) cell.fill = relleno(marca.colorSuave)
    }
  })
  ws.views = [{ state: 'frozen', ySplit: filaEnc }]
  ws.autoFilter = { from: { row: filaEnc, column: 1 }, to: { row: filaEnc + eventos.length, column: titulos.length } }
}

export async function generarExcelLiquidacion(
  liq: LiquidacionParaExcel,
  marca: MarcaExcel,
): Promise<{ buffer: Buffer; filename: string }> {
  const wb = new ExcelJS.Workbook()
  wb.creator = marca.razonSocial
  wb.created = new Date()
  wb.title = `Liquidación ${liq.consecutivo}`

  hojaLiquidacion(wb, liq, marca)
  hojaRecargos(wb, liq, marca)
  hojaTrazabilidad(wb, liq, marca)

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, filename: nombreArchivoLiquidacion(liq) }
}
