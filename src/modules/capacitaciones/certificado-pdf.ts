import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { env } from '../../config/env'

export async function crearCertificadoPdf(data: {
  codigo: string; nombre: string; curso: string; emitidoAt: Date; vigenteHasta: Date | null
}): Promise<Buffer> {
  const base = (env.EMAIL_FRONTEND_URL || env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/+$/, '')
  const url = base + '/capacitaciones/verificar/' + encodeURIComponent(data.codigo)
  const qr = await QRCode.toDataURL(url, { width: 220, margin: 1 })
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 58 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.rect(28, 28, 785, 539).lineWidth(2).stroke('#176b50')
    doc.fontSize(12).fillColor('#176b50').text('CAPACITACIONES INTERNAS', 60, 78, { align: 'center' })
    doc.fontSize(34).fillColor('#173b31').text('Certificado de aprobación', 60, 130, { align: 'center' })
    doc.fontSize(14).fillColor('#47665b').text('Se certifica que', 70, 205, { align: 'center' })
    doc.fontSize(24).fillColor('#173b31').text(data.nombre, 70, 235, { align: 'center' })
    doc.fontSize(14).fillColor('#47665b').text('completó y aprobó la capacitación', 70, 288, { align: 'center' })
    doc.fontSize(20).fillColor('#173b31').text(data.curso, 70, 318, { align: 'center', width: 700 })
    const emitido = data.emitidoAt.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })
    doc.fontSize(11).fillColor('#47665b').text('Emitido: ' + emitido, 70, 407)
    if (data.vigenteHasta) doc.text('Vigente hasta: ' + data.vigenteHasta.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }), 70, 428)
    doc.text('Código: ' + data.codigo, 70, 460)
    doc.image(Buffer.from(qr.split(',')[1], 'base64'), 673, 405, { width: 85 })
    doc.end()
  })
}
