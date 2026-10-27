import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { EncuestasService } from './encuestas.service'
import type { Pregunta } from './encuestas.schema'

function textoRespuesta(p: Pregunta, valor: unknown): string {
  if (valor == null) return ''
  if (p.tipo === 'OPCION_UNICA') return p.opciones.find(o => o.id === valor)?.texto || String(valor)
  if (p.tipo === 'OPCION_MULTIPLE' && Array.isArray(valor)) {
    return valor.map(v => p.opciones.find(o => o.id === v)?.texto || String(v)).join('; ')
  }
  if (p.tipo === 'SI_NO') return valor === true ? 'Sí' : 'No'
  return String(valor)
}

export async function exportarExcel(id: string): Promise<Buffer> {
  const { encuesta, respuestas, preguntas } = await EncuestasService.todasLasRespuestas(id)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Encuestas'
  const hoja = workbook.addWorksheet('Respuestas', { views: [{ state: 'frozen', ySplit: 1 }] })
  hoja.columns = [
    { header: 'Fecha', key: 'fecha', width: 24 },
    { header: 'Nombre', key: 'nombre', width: 24 },
    { header: 'Correo', key: 'correo', width: 30 },
    { header: 'Coincide IP', key: 'ip', width: 15 },
    { header: 'Coincide dispositivo', key: 'dispositivo', width: 23 },
    ...preguntas.map((p, i) => ({ header: `${i + 1}. ${p.titulo}`, key: p.id, width: 38 }))
  ]
  hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF075D4B' } }
  hoja.autoFilter = { from: 'A1', to: { row: 1, column: hoja.columns.length } }
  for (const r of respuestas) {
    const valores = r.respuestas as Record<string, unknown>
    const fila: Record<string, string> = {
      fecha: r.created_at.toISOString(),
      nombre: r.nombre || '',
      correo: r.correo || '',
      ip: r.coincide_ip ? 'Sí' : 'No',
      dispositivo: r.coincide_dispositivo ? 'Sí' : 'No'
    }
    for (const p of preguntas) fila[p.id] = textoRespuesta(p, valores[p.id])
    hoja.addRow(fila)
  }
  const resumen = workbook.addWorksheet('Resumen')
  resumen.addRow(['Encuesta', encuesta.titulo])
  resumen.addRow(['Estado', encuesta.estado])
  resumen.addRow(['Respuestas', respuestas.length])
  resumen.addRow(['Exportado', new Date().toISOString()])
  resumen.getColumn(1).width = 22
  resumen.getColumn(2).width = 60
  return Buffer.from(await workbook.xlsx.writeBuffer() as any)
}

export async function exportarPdf(id: string): Promise<Buffer> {
  const datos = await EncuestasService.resultados(id)
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46 })
    const partes: Buffer[] = []
    doc.on('data', (parte: Buffer) => partes.push(parte))
    doc.on('end', () => resolve(Buffer.concat(partes)))
    doc.on('error', reject)
    doc.fillColor('#075d4b').fontSize(22).text(datos.encuesta.titulo)
    doc.moveDown(0.4).fillColor('#64748b').fontSize(10)
      .text(`Reporte generado el ${new Date().toLocaleString('es-CO')} · ${datos.total} respuestas`)
    if (datos.encuesta.descripcion) doc.moveDown(0.6).fillColor('#334155').text(datos.encuesta.descripcion)
    doc.moveDown(1).fillColor('#0f172a').fontSize(15).text('Participación')
    doc.moveDown(0.25).fontSize(10).text(`Respuestas recibidas: ${datos.total}`)
    if (datos.encuesta.registrar_origen) {
      doc.text(`Coincidencias de IP: ${datos.coincidencias_ip} · de dispositivo: ${datos.coincidencias_dispositivo}`)
    }
    for (const q of datos.analisis) {
      if (doc.y > 680) doc.addPage()
      doc.moveDown(0.8).fillColor('#075d4b').fontSize(13).text(q.titulo)
      doc.fillColor('#64748b').fontSize(9).text(`${q.respondidas} respuestas`)
      if (q.promedio != null) doc.text(`Promedio: ${q.promedio}`)
      if (q.nps != null) doc.text(`NPS: ${q.nps}`)
      if (q.opciones.length) {
        for (const o of q.opciones) {
          if (doc.y > 720) doc.addPage()
          doc.fillColor('#334155').fontSize(9).text(`${o.texto} · ${o.total} (${o.porcentaje} %)`, { width: 480 })
          if (doc.y > 750) doc.addPage()
          const barraY = doc.y + 3
          doc.roundedRect(46, barraY, 480, 5, 2).fill('#e2e8f0')
          if (o.porcentaje > 0) doc.roundedRect(46, barraY, Math.max(2, 480 * o.porcentaje / 100), 5, 2).fill('#0e9f77')
          doc.y = barraY + 14
        }
      } else if (q.textos.length) {
        for (const texto of q.textos.slice(0, 8)) {
          if (doc.y > 735) doc.addPage()
          doc.fillColor('#334155').fontSize(9).text(`• ${texto}`, { width: 490 })
          doc.moveDown(0.2)
        }
      }
    }
    doc.end()
  })
}
