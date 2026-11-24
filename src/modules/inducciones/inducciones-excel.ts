import ExcelJS from 'exceljs'
import type { InduccionesService } from './inducciones.service'

type Datos = Awaited<ReturnType<typeof InduccionesService.exportarDatos>>

/** Una hoja imprimible y legible, con la misma jerarquía del PDF documental. */
export async function generarExcelInduccion(datos: Datos, empresa: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = empresa
  wb.subject = 'Inducción de visitantes HSEQ-FR-66'
  const ws = wb.addWorksheet('Inducción', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
    views: [{ state: 'frozen', ySplit: 13 }]
  })
  ws.columns = [
    { width: 6 }, { width: 17 }, { width: 18 }, { width: 18 },
    { width: 18 }, { width: 18 }, { width: 16 }, { width: 15 }
  ]
  ws.pageSetup.margins = { left: .3, right: .3, top: .4, bottom: .4, header: .15, footer: .2 }
  ws.headerFooter.oddFooter = `${empresa} · HSEQ-FR-66 &RPágina &P de &N`

  const verde = 'FF104E35'
  const palido = 'FFEDF5EF'
  const tinta = 'FF18312B'
  const borde = 'FFD4E0D8'
  const etiqueta = 'FF5B7065'
  const unir = (fila: number, desde: string, hasta: string, texto: string) => {
    ws.mergeCells(`${desde}${fila}:${hasta}${fila}`)
    ws.getCell(`${desde}${fila}`).value = texto
  }
  const banda = (fila: number, texto: string) => {
    unir(fila, 'A', 'H', texto)
    const row = ws.getRow(fila)
    row.height = 20
    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: verde } }
      cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.alignment = { vertical: 'middle' }
    })
  }
  const dato = (fila: number, col: 'A' | 'E', label: string, value: string) => {
    const fin = col === 'A' ? 'D' : 'H'
    ws.mergeCells(`${col}${fila}:${fin}${fila}`)
    const cell = ws.getCell(`${col}${fila}`)
    cell.value = { richText: [
      { text: `${label.toUpperCase()}  `, font: { bold: true, color: { argb: etiqueta }, size: 9 } },
      { text: value || '—', font: { color: { argb: tinta }, size: 10 } }
    ] }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'hair', color: { argb: borde } } }
  }

  unir(1, 'A', 'F', empresa.toUpperCase())
  unir(2, 'A', 'F', 'INDUCCIÓN / REINDUCCIÓN DE VISITANTES')
  ws.getCell('G1').value = 'CÓDIGO'
  ws.getCell('H1').value = datos.codigo
  ws.getCell('G2').value = 'VERSIÓN'
  ws.getCell('H2').value = datos.version
  for (const address of ['A1', 'A2']) {
    ws.getCell(address).font = { name: 'Aptos Display', size: address === 'A1' ? 14 : 10, bold: true, color: { argb: address === 'A1' ? verde : 'FF425166' } }
  }
  ws.getRow(1).height = 25
  ws.getRow(2).height = 20
  for (const address of ['G1', 'G2']) ws.getCell(address).font = { name: 'Aptos', size: 9, bold: true, color: { argb: etiqueta } }
  ws.mergeCells('A4:D4'); ws.getCell('A4').value = `SEDE  ${datos.sede}`
  ws.mergeCells('E4:H4'); ws.getCell('E4').value = `FECHA  ${datos.fecha_documento}`
  for (const address of ['A4', 'E4']) {
    const cell = ws.getCell(address)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: palido } }
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: verde } }
    cell.alignment = { vertical: 'middle' }
  }
  ws.getRow(4).height = 24

  banda(6, 'DATOS DEL VISITANTE')
  dato(7, 'A', 'Nombre', datos.visitante.nombre)
  dato(7, 'E', 'Documento', datos.visitante.cedula)
  dato(8, 'A', 'Cargo', datos.visitante.cargo)
  dato(8, 'E', 'Empresa', datos.visitante.entidad)
  dato(9, 'A', 'Responsable', datos.responsable.nombre)
  dato(9, 'E', 'Cargo', datos.responsable.cargo)
  for (const fila of [7, 8, 9]) ws.getRow(fila).height = 25

  banda(11, 'TEMAS INFORMADOS')
  ws.mergeCells('B13:G13')
  ws.getCell('A13').value = '#'
  ws.getCell('B13').value = 'VERIFICACIÓN'
  ws.getCell('H13').value = 'RESPUESTA'
  ws.getRow(13).eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: verde } }
    cell.font = { name: 'Aptos', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { vertical: 'middle', horizontal: cell.address.startsWith('H') ? 'center' : 'left' }
  })
  ws.getRow(13).height = 22
  datos.temas.forEach((tema, i) => {
    const fila = i + 14
    ws.mergeCells(`B${fila}:G${fila}`)
    ws.getCell(`A${fila}`).value = i + 1
    ws.getCell(`B${fila}`).value = tema.label
    ws.getCell(`H${fila}`).value = tema.confirmado ? 'SÍ' : 'NO'
    ws.getRow(fila).height = 30
    ws.getRow(fila).eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 ? 'FFF5F8F6' : 'FFFFFFFF' } }
      cell.font = { name: 'Aptos', size: 10, color: { argb: tinta }, bold: cell.address.startsWith('H') }
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: cell.address.startsWith('H') ? 'center' : 'left' }
      cell.border = { bottom: { style: 'hair', color: { argb: borde } } }
    })
  })
  const resumen = datos.temas.length + 14
  ws.mergeCells(`A${resumen}:G${resumen}`)
  ws.getCell(`A${resumen}`).value = `TEMAS CONFIRMADOS · ${datos.temas.filter(t => t.confirmado).length} de ${datos.temas.length}`
  ws.getCell(`H${resumen}`).value = `${datos.porcentaje_conformidad}%`
  ws.getRow(resumen).height = 24
  ws.getRow(resumen).eachCell({ includeEmpty: true }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: palido } }
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: verde } }
  })
  const obs = resumen + 2
  banda(obs, 'OBSERVACIONES')
  unir(obs + 1, 'A', 'H', datos.observaciones || 'Sin observaciones')
  ws.getRow(obs + 1).height = 38
  ws.getCell(`A${obs + 1}`).alignment = { vertical: 'top', wrapText: true }
  ws.getCell(`A${obs + 1}`).font = { name: 'Aptos', size: 10, color: { argb: tinta } }
  unir(obs + 3, 'A', 'H', `Firmas originales conservadas en el PDF · Registrado: ${datos.created_at}`)
  ws.getCell(`A${obs + 3}`).font = { name: 'Aptos', size: 9, italic: true, color: { argb: etiqueta } }

  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
}
