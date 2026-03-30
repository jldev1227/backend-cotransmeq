import PDFDocument from 'pdfkit'
import * as path from 'path'
import * as fs from 'fs'

interface EvaluacionData {
  titulo: string
  descripcion?: string | null
  requiere_firma: boolean
  created_at: string
  preguntas: PreguntaData[]
}

interface PreguntaData {
  id: string
  texto: string
  tipo: 'OPCION_UNICA' | 'OPCION_MULTIPLE' | 'NUMERICA' | 'TEXTO' | 'RELACION' | 'VERDADERO_FALSO'
  puntaje: number
  opciones: OpcionData[]
  relacionIzq: string[]
  relacionDer: string[]
  respuestaCorrecta?: number | null
}

interface OpcionData {
  id: string
  texto: string
  esCorrecta: boolean
}

interface ResultadoData {
  id: string
  nombre_completo: string
  numero_documento: string
  cargo: string
  correo: string
  telefono: string
  puntaje_total: number
  firma?: string | null
  created_at: string
  respuestas: RespuestaDetalleData[]
}

interface RespuestaDetalleData {
  id: string
  preguntaId: string
  valor_texto?: string | null
  valor_numero?: number | null
  opcionesIds: string[]
  relacion?: any
  puntaje: number
  pregunta?: PreguntaData
}

export class EvaluacionPDFGeneratorService {
  private static getFontsDir(): string {
    const isDist = __dirname.includes('/dist/')
    return isDist
      ? path.join(__dirname, '../../assets/fonts')
      : path.join(__dirname, '../../assets/fonts')
  }

  private static registerFonts(doc: typeof PDFDocument.prototype) {
    const fontsDir = this.getFontsDir()
    const regularPath = path.join(fontsDir, 'Roboto-Regular.ttf')
    const boldPath = path.join(fontsDir, 'Roboto-Bold.ttf')
    
    if (fs.existsSync(regularPath)) {
      doc.registerFont('Roboto', regularPath)
    }
    if (fs.existsSync(boldPath)) {
      doc.registerFont('Roboto-Bold', boldPath)
    }
  }

  static async generarPDFEvaluacion(
    evaluacion: EvaluacionData,
    resultados: ResultadoData[]
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          layout: 'landscape',
          margins: { top: 40, bottom: 40, left: 40, right: 40 }
        })

        this.registerFonts(doc)

        const chunks: Buffer[] = []
        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const pageWidth = doc.page.width
        const pageHeight = doc.page.height

        // ============================================
        // PÁGINA 1: Resumen general
        // ============================================
        this.renderHeader(doc, pageWidth)

        // Título del documento
        let yPos = 100
        doc
          .fontSize(14)
          .font('Roboto-Bold')
          .fillColor('#000000')
          .text('RESULTADOS DE EVALUACIÓN', 40, yPos, { width: pageWidth - 80, align: 'center' })

        yPos += 25

        // Información de la evaluación
        const tableStartX = 40
        const tableWidth = pageWidth - 80

        // Título de la evaluación
        doc.rect(tableStartX, yPos, tableWidth, 12).fillAndStroke('#e8e8e8', '#000000')
        doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
          .text('TÍTULO DE LA EVALUACIÓN', tableStartX + 4, yPos + 3, { width: tableWidth - 8, align: 'left' })
        
        doc.rect(tableStartX, yPos + 12, tableWidth, 18).stroke('#000000')
        doc.fontSize(8).font('Roboto')
          .text(evaluacion.titulo.toUpperCase(), tableStartX + 4, yPos + 17, { width: tableWidth - 8, align: 'left' })

        yPos += 30

        // Descripción si existe
        if (evaluacion.descripcion) {
          doc.rect(tableStartX, yPos, tableWidth, 12).fillAndStroke('#e8e8e8', '#000000')
          doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
            .text('DESCRIPCIÓN', tableStartX + 4, yPos + 3, { width: tableWidth - 8, align: 'left' })
          
          doc.fontSize(7).font('Roboto')
          const descHeight = Math.max(18, doc.heightOfString(evaluacion.descripcion, { width: tableWidth - 8 }) + 8)
          doc.rect(tableStartX, yPos + 12, tableWidth, descHeight).stroke('#000000')
          doc.text(evaluacion.descripcion, tableStartX + 4, yPos + 16, { width: tableWidth - 8, align: 'left' })

          yPos += 12 + descHeight
        }

        // Fila con info general: Fecha | Total Preguntas | Puntaje Total | Total Participantes | Requiere Firma
        const colCount = 5
        const colW = tableWidth / colCount
        const puntajeMaximo = evaluacion.preguntas.reduce((sum, p) => sum + p.puntaje, 0)
        const fechaCreacion = new Date(evaluacion.created_at).toLocaleDateString('es-CO', {
          day: '2-digit', month: '2-digit', year: 'numeric'
        })

        const infoItems = [
          { label: 'FECHA CREACIÓN', value: fechaCreacion },
          { label: 'TOTAL PREGUNTAS', value: String(evaluacion.preguntas.length) },
          { label: 'PUNTAJE MÁXIMO', value: String(puntajeMaximo) },
          { label: 'TOTAL PARTICIPANTES', value: String(resultados.length) },
          { label: 'REQUIERE FIRMA', value: evaluacion.requiere_firma ? 'SÍ' : 'NO' }
        ]

        yPos += 5
        infoItems.forEach((item, i) => {
          const cellX = tableStartX + (i * colW)
          doc.rect(cellX, yPos, colW, 12).fillAndStroke('#e8e8e8', '#000000')
          doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
            .text(item.label, cellX + 2, yPos + 3, { width: colW - 4, align: 'center', lineBreak: false })
          
          doc.rect(cellX, yPos + 12, colW, 16).stroke('#000000')
          doc.fontSize(8).font('Roboto')
            .text(item.value, cellX + 2, yPos + 16, { width: colW - 4, align: 'center', lineBreak: false })
        })

        yPos += 38

        // Tabla de resultados de participantes
        doc
          .fontSize(11)
          .font('Roboto-Bold')
          .fillColor('#000000')
          .text('RESUMEN DE PARTICIPANTES', tableStartX, yPos)

        yPos += 18

        const tableTop = yPos
        const hasSignature = evaluacion.requiere_firma
        
        let tableHeaders: string[]
        let colWidths: number[]
        
        if (hasSignature) {
          tableHeaders = ['No.', 'NOMBRE COMPLETO', 'CÉDULA', 'CARGO', 'CORREO', 'TELÉFONO', 'PUNTAJE', 'RESULTADO', 'FIRMA']
          const proportions = [3, 18, 8, 19, 11, 7, 6, 7, 14]
          const totalProp = proportions.reduce((a, b) => a + b, 0)
          colWidths = proportions.map(p => Math.round((p / totalProp) * tableWidth))
          const diff = tableWidth - colWidths.reduce((a, b) => a + b, 0)
          colWidths[colWidths.length - 1] += diff
        } else {
          tableHeaders = ['No.', 'NOMBRE COMPLETO', 'CÉDULA', 'CARGO', 'CORREO', 'TELÉFONO', 'PUNTAJE', 'RESULTADO']
          const proportions = [3, 20, 9, 21, 13, 9, 7, 7]
          const totalProp = proportions.reduce((a, b) => a + b, 0)
          colWidths = proportions.map(p => Math.round((p / totalProp) * tableWidth))
          const diff = tableWidth - colWidths.reduce((a, b) => a + b, 0)
          colWidths[colWidths.length - 1] += diff
        }
        
        const colPositions = [tableStartX]
        for (let i = 0; i < colWidths.length - 1; i++) {
          colPositions.push(colPositions[i] + colWidths[i])
        }

        // Encabezados
        doc.fontSize(7).font('Roboto-Bold').fillColor('#000000')
        tableHeaders.forEach((header, i) => {
          doc.rect(colPositions[i], tableTop, colWidths[i], 20).fillAndStroke('#e0e0e0', '#000000')
          doc.fillColor('#000000').text(header, colPositions[i] + 2, tableTop + 6, { width: colWidths[i] - 4, align: 'center' })
        })

        yPos = tableTop + 20
        const rowHeight = 25

        resultados.forEach((resultado, index) => {
          if (yPos + rowHeight > pageHeight - 60) {
            doc.addPage()
            yPos = 40

            this.renderHeader(doc, pageWidth)
            yPos = 100

            doc.fontSize(7).font('Roboto-Bold').fillColor('#000000')
            tableHeaders.forEach((header, i) => {
              doc.rect(colPositions[i], yPos, colWidths[i], 20).fillAndStroke('#e0e0e0', '#000000')
              doc.fillColor('#000000').text(header, colPositions[i] + 2, yPos + 6, { width: colWidths[i] - 4, align: 'center' })
            })
            yPos += 20
          }

          doc.fontSize(7).font('Roboto')

          colPositions.forEach((pos, i) => {
            doc.rect(pos, yPos, colWidths[i], rowHeight).stroke('#000000')
          })

          const midY = yPos + (rowHeight / 2) - 3

          doc.text(String(index + 1), colPositions[0], midY, { width: colWidths[0], align: 'center' })
          doc.text(resultado.nombre_completo.toUpperCase(), colPositions[1] + 3, midY, { width: colWidths[1] - 6, align: 'center' })
          doc.text(resultado.numero_documento, colPositions[2], midY, { width: colWidths[2], align: 'center' })
          doc.text(resultado.cargo.toUpperCase(), colPositions[3] + 3, midY, { width: colWidths[3] - 6, align: 'center' })
          doc.text(resultado.correo.toLowerCase(), colPositions[4] + 2, midY, { width: colWidths[4] - 4, align: 'center' })
          doc.text(resultado.telefono, colPositions[5], midY, { width: colWidths[5], align: 'center' })
          doc.font('Roboto-Bold').text(`${resultado.puntaje_total}/${puntajeMaximo}`, colPositions[6], midY, { width: colWidths[6], align: 'center' })
          
          const porcentaje = puntajeMaximo > 0 ? (resultado.puntaje_total / puntajeMaximo) * 100 : 0
          const aprobado = porcentaje >= 70
          doc.font('Roboto-Bold')
            .fillColor(aprobado ? '#16a34a' : '#dc2626')
            .text(aprobado ? 'APROBADO' : 'REPROBADO', colPositions[7], midY, { width: colWidths[7], align: 'center' })
          doc.fillColor('#000000')

          if (hasSignature) {
            try {
              if (resultado.firma && resultado.firma.startsWith('data:image')) {
                const base64Data = resultado.firma.split(',')[1]
                const imageBuffer = Buffer.from(base64Data, 'base64')
                const firmaMaxWidth = colWidths[8] - 10
                const firmaMaxHeight = rowHeight - 6
                const firmaX = colPositions[8] + 5
                const firmaY = yPos + 3
                doc.save()
                doc.rect(colPositions[8] + 1, yPos + 1, colWidths[8] - 2, rowHeight - 2).clip()
                doc.image(imageBuffer, firmaX, firmaY, {
                  fit: [firmaMaxWidth, firmaMaxHeight],
                  align: 'center',
                  valign: 'center'
                })
                doc.restore()
              }
            } catch (e) {
              // Silently handle signature errors
            }
          }

          doc.font('Roboto').fontSize(7)
          yPos += rowHeight
        })

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  static async generarPDFIndividual(
    evaluacion: EvaluacionData,
    resultado: ResultadoData
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          layout: 'landscape',
          margins: { top: 40, bottom: 40, left: 40, right: 40 }
        })

        this.registerFonts(doc)

        const chunks: Buffer[] = []
        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const pageWidth = doc.page.width
        const pageHeight = doc.page.height
        const tableStartX = 40
        const tableWidth = pageWidth - 80
        const puntajeMaximo = evaluacion.preguntas.reduce((sum, p) => sum + p.puntaje, 0)

        this.renderHeader(doc, pageWidth)

        let y = 100

        doc.fontSize(14).font('Roboto-Bold').fillColor('#000000')
          .text('DETALLE DE RESPUESTAS', 40, y, { width: pageWidth - 80, align: 'center' })
        y += 25

        doc.rect(tableStartX, y, tableWidth, 12).fillAndStroke('#e8e8e8', '#000000')
        doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
          .text('EVALUACIÓN', tableStartX + 4, y + 3, { width: tableWidth - 8, align: 'left' })
        doc.rect(tableStartX, y + 12, tableWidth, 18).stroke('#000000')
        doc.fontSize(8).font('Roboto')
          .text(evaluacion.titulo.toUpperCase(), tableStartX + 4, y + 17, { width: tableWidth - 8, align: 'left' })
        y += 35

        const infoColW = tableWidth / 3
        const infoParticipante = [
          { label: 'NOMBRE', value: resultado.nombre_completo.toUpperCase() },
          { label: 'DOCUMENTO', value: resultado.numero_documento },
          { label: 'CARGO', value: resultado.cargo.toUpperCase() },
        ]

        infoParticipante.forEach((item, i) => {
          const cx = tableStartX + (i * infoColW)
          doc.rect(cx, y, infoColW, 12).fillAndStroke('#e8e8e8', '#000000')
          doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
            .text(item.label, cx + 2, y + 3, { width: infoColW - 4, align: 'center', lineBreak: false })
          doc.rect(cx, y + 12, infoColW, 16).stroke('#000000')
          doc.fontSize(7).font('Roboto')
            .text(item.value, cx + 2, y + 16, { width: infoColW - 4, align: 'center', lineBreak: false })
        })
        y += 28

        const infoParticipante2 = [
          { label: 'CORREO', value: resultado.correo },
          { label: 'TELÉFONO', value: resultado.telefono },
          { label: 'PUNTAJE', value: `${resultado.puntaje_total} / ${puntajeMaximo}` },
        ]

        infoParticipante2.forEach((item, i) => {
          const cx = tableStartX + (i * infoColW)
          doc.rect(cx, y, infoColW, 12).fillAndStroke('#e8e8e8', '#000000')
          doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
            .text(item.label, cx + 2, y + 3, { width: infoColW - 4, align: 'center', lineBreak: false })
          doc.rect(cx, y + 12, infoColW, 16).stroke('#000000')
          doc.fontSize(7).font('Roboto')
            .text(item.value, cx + 2, y + 16, { width: infoColW - 4, align: 'center', lineBreak: false })
        })
        y += 33

        const porcentaje = puntajeMaximo > 0 ? (resultado.puntaje_total / puntajeMaximo) * 100 : 0
        const aprobado = porcentaje >= 70
        const fechaResp = new Date(resultado.created_at).toLocaleDateString('es-CO', {
          day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })

        const resColW = tableWidth / 2
        doc.rect(tableStartX, y, resColW, 12).fillAndStroke('#e8e8e8', '#000000')
        doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
          .text('RESULTADO', tableStartX + 2, y + 3, { width: resColW - 4, align: 'center', lineBreak: false })
        doc.rect(tableStartX, y + 12, resColW, 16).stroke('#000000')
        doc.fontSize(8).font('Roboto-Bold')
          .fillColor(aprobado ? '#16a34a' : '#dc2626')
          .text(aprobado ? 'APROBADO' : 'REPROBADO', tableStartX + 2, y + 16, { width: resColW - 4, align: 'center', lineBreak: false })
        doc.fillColor('#000000')

        doc.rect(tableStartX + resColW, y, resColW, 12).fillAndStroke('#e8e8e8', '#000000')
        doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
          .text('FECHA DE RESPUESTA', tableStartX + resColW + 2, y + 3, { width: resColW - 4, align: 'center', lineBreak: false })
        doc.rect(tableStartX + resColW, y + 12, resColW, 16).stroke('#000000')
        doc.fontSize(7).font('Roboto')
          .text(fechaResp, tableStartX + resColW + 2, y + 16, { width: resColW - 4, align: 'center', lineBreak: false })
        y += 38

        doc.fontSize(11).font('Roboto-Bold').fillColor('#000000').text('RESPUESTAS', 40, y)
        y += 18

        resultado.respuestas.forEach((respuesta, qIndex) => {
          const pregunta = respuesta.pregunta
          if (!pregunta) return

          const estimatedHeight = this.estimateQuestionHeight(pregunta, respuesta)
          if (y + estimatedHeight > pageHeight - 60) {
            doc.addPage()
            this.renderHeader(doc, pageWidth)
            y = 100
          }

          const tipoLabels: Record<string, string> = {
            'OPCION_UNICA': 'Opción Única',
            'OPCION_MULTIPLE': 'Opción Múltiple',
            'NUMERICA': 'Numérica',
            'TEXTO': 'Texto',
            'RELACION': 'Relación',
            'VERDADERO_FALSO': 'Verdadero o Falso'
          }

          doc.rect(tableStartX, y, tableWidth, 18).fillAndStroke('#f3f4f6', '#d1d5db')
          doc.fillColor('#000000').fontSize(7).font('Roboto-Bold')
            .text(`Pregunta ${qIndex + 1}`, tableStartX + 4, y + 2, { continued: true })
          doc.font('Roboto').fontSize(6)
            .text(`  [${tipoLabels[pregunta.tipo] || pregunta.tipo}]`, { continued: true })
          
          const puntajeText = `${respuesta.puntaje} / ${pregunta.puntaje} pts`
          const esCorrectaTotal = respuesta.puntaje === pregunta.puntaje
          const esParcial = respuesta.puntaje > 0 && !esCorrectaTotal
          doc.font('Roboto-Bold').fontSize(7)
            .fillColor(esCorrectaTotal ? '#16a34a' : esParcial ? '#ca8a04' : '#dc2626')
            .text(`   ${puntajeText}`)
          doc.fillColor('#000000')
          y += 18

          doc.fontSize(7).font('Roboto-Bold')
          const preguntaTextHeight = doc.heightOfString(pregunta.texto, { width: tableWidth - 8 }) + 6
          doc.rect(tableStartX, y, tableWidth, preguntaTextHeight).stroke('#d1d5db')
          doc.text(pregunta.texto, tableStartX + 4, y + 3, { width: tableWidth - 8 })
          y += preguntaTextHeight

          doc.rect(tableStartX, y, tableWidth, 12).fillAndStroke('#fef3c7', '#d1d5db')
          doc.fillColor('#000000').fontSize(6).font('Roboto-Bold')
            .text('RESPUESTA DEL PARTICIPANTE', tableStartX + 4, y + 3)
          y += 12

          if (pregunta.tipo === 'TEXTO') {
            const textoResp = respuesta.valor_texto || 'Sin respuesta'
            doc.fontSize(7).font('Roboto')
            const respHeight = Math.max(16, doc.heightOfString(textoResp, { width: tableWidth - 8 }) + 6)
            doc.rect(tableStartX, y, tableWidth, respHeight).stroke('#d1d5db')
            doc.text(textoResp, tableStartX + 4, y + 3, { width: tableWidth - 8 })
            y += respHeight

          } else if (pregunta.tipo === 'NUMERICA') {
            const valorNum = respuesta.valor_numero !== null && respuesta.valor_numero !== undefined
              ? String(respuesta.valor_numero)
              : respuesta.valor_texto || 'Sin respuesta'
            const correctaNum = pregunta.respuestaCorrecta !== null && pregunta.respuestaCorrecta !== undefined
              ? `  (Correcta: ${pregunta.respuestaCorrecta})`
              : ''
            doc.rect(tableStartX, y, tableWidth, 16).stroke('#d1d5db')
            doc.fontSize(7).font('Roboto')
              .text(`${valorNum}${correctaNum}`, tableStartX + 4, y + 4, { width: tableWidth - 8 })
            y += 16

          } else if (pregunta.tipo === 'OPCION_UNICA' || pregunta.tipo === 'OPCION_MULTIPLE') {
            const selectedIds: string[] = Array.isArray(respuesta.opcionesIds) ? respuesta.opcionesIds : []
            const optionHeight = 14
            const totalOptHeight = pregunta.opciones.length * optionHeight

            doc.rect(tableStartX, y, tableWidth, totalOptHeight).stroke('#d1d5db')

            pregunta.opciones.forEach((opcion, oIdx) => {
              const fueSeleccionada = selectedIds.includes(opcion.id)
              const opY = y + (oIdx * optionHeight)
              
              if (oIdx > 0) {
                doc.moveTo(tableStartX, opY).lineTo(tableStartX + tableWidth, opY).stroke('#e5e7eb')
              }

              const iconX = tableStartX + 7
              const iconY = opY + 7
              const iconR = 4

              if (fueSeleccionada && opcion.esCorrecta) {
                doc.save()
                doc.circle(iconX, iconY, iconR).fill('#16a34a')
                doc.strokeColor('#ffffff').lineWidth(1.2)
                doc.moveTo(iconX - 2, iconY).lineTo(iconX - 0.5, iconY + 2).lineTo(iconX + 2.5, iconY - 1.5).stroke()
                doc.restore()
                doc.fontSize(7).font('Roboto-Bold').fillColor('#16a34a')
                  .text(opcion.texto, tableStartX + 16, opY + 3, { width: tableWidth - 20 })
              } else if (fueSeleccionada && !opcion.esCorrecta) {
                doc.save()
                doc.circle(iconX, iconY, iconR).fill('#dc2626')
                doc.strokeColor('#ffffff').lineWidth(1.2)
                doc.moveTo(iconX - 2, iconY - 2).lineTo(iconX + 2, iconY + 2).stroke()
                doc.moveTo(iconX + 2, iconY - 2).lineTo(iconX - 2, iconY + 2).stroke()
                doc.restore()
                doc.fontSize(7).font('Roboto-Bold').fillColor('#dc2626')
                  .text(opcion.texto, tableStartX + 16, opY + 3, { width: tableWidth - 20 })
              } else if (!fueSeleccionada && opcion.esCorrecta) {
                doc.save()
                doc.circle(iconX, iconY, iconR).fill('#2563eb')
                doc.restore()
                doc.fontSize(7).font('Roboto').fillColor('#2563eb')
                  .text(opcion.texto, tableStartX + 16, opY + 3, { width: tableWidth - 20 })
              } else {
                doc.save()
                doc.circle(iconX, iconY, iconR).lineWidth(0.8).strokeColor('#9ca3af').stroke()
                doc.restore()
                doc.fontSize(7).font('Roboto').fillColor('#6b7280')
                  .text(opcion.texto, tableStartX + 16, opY + 3, { width: tableWidth - 20 })
              }
              doc.fillColor('#000000').strokeColor('#000000')
            })

            y += totalOptHeight

            const legendY = y + 1
            const legendData = [
              { color: '#16a34a', filled: true, label: 'Seleccionada correcta' },
              { color: '#dc2626', filled: true, label: 'Seleccionada incorrecta' },
              { color: '#2563eb', filled: true, label: 'Correcta no seleccionada' },
              { color: '#9ca3af', filled: false, label: 'No seleccionada' }
            ]
            let lx = tableStartX + 4
            doc.fontSize(5).font('Roboto')
            legendData.forEach((item, idx) => {
              doc.save()
              if (item.filled) {
                doc.circle(lx + 3, legendY + 3, 2.5).fill(item.color)
              } else {
                doc.circle(lx + 3, legendY + 3, 2.5).lineWidth(0.5).strokeColor(item.color).stroke()
              }
              doc.restore()
              const labelText = item.label + (idx < legendData.length - 1 ? '   |   ' : '')
              doc.fillColor('#9ca3af').text(labelText, lx + 8, legendY + 0.5, { continued: idx < legendData.length - 1, lineBreak: false })
              lx += 8 + doc.widthOfString(labelText) + 2
            })
            doc.fillColor('#000000').strokeColor('#000000')
            y += 12

          } else if (pregunta.tipo === 'RELACION') {
            const relaciones: { izq: string; der: string }[] = Array.isArray(respuesta.relacion) ? respuesta.relacion : []
            if (relaciones.length > 0) {
              const relHeight = relaciones.length * 14
              doc.rect(tableStartX, y, tableWidth, relHeight).stroke('#d1d5db')
              relaciones.forEach((rel, rIdx) => {
                const relY = y + (rIdx * 14)
                if (rIdx > 0) {
                  doc.moveTo(tableStartX, relY).lineTo(tableStartX + tableWidth, relY).stroke('#e5e7eb')
                }
                const idxIzq = pregunta.relacionIzq.indexOf(rel.izq)
                const esCorrecta = idxIzq !== -1 && pregunta.relacionDer[idxIzq] === rel.der
                
                const relIconX = tableStartX + 7
                const relIconY = relY + 7
                doc.save()
                if (esCorrecta) {
                  doc.circle(relIconX, relIconY, 4).fill('#16a34a')
                  doc.strokeColor('#ffffff').lineWidth(1.2)
                  doc.moveTo(relIconX - 2, relIconY).lineTo(relIconX - 0.5, relIconY + 2).lineTo(relIconX + 2.5, relIconY - 1.5).stroke()
                } else {
                  doc.circle(relIconX, relIconY, 4).fill('#dc2626')
                  doc.strokeColor('#ffffff').lineWidth(1.2)
                  doc.moveTo(relIconX - 2, relIconY - 2).lineTo(relIconX + 2, relIconY + 2).stroke()
                  doc.moveTo(relIconX + 2, relIconY - 2).lineTo(relIconX - 2, relIconY + 2).stroke()
                }
                doc.restore()
                doc.fontSize(7).font('Roboto')
                  .fillColor(esCorrecta ? '#16a34a' : '#dc2626')
                  .text(`${rel.izq}  -->  ${rel.der}`, tableStartX + 16, relY + 3, { width: tableWidth - 20 })
                doc.fillColor('#000000').strokeColor('#000000')
              })
              y += relHeight
            } else {
              doc.rect(tableStartX, y, tableWidth, 16).stroke('#d1d5db')
              doc.fontSize(7).font('Roboto').text('Sin respuesta', tableStartX + 4, y + 4)
              y += 16
            }

          } else if (pregunta.tipo === 'VERDADERO_FALSO') {
            const valorUsuario = respuesta.valor_numero
            const correcta = pregunta.respuestaCorrecta
            const esCorrecta = typeof valorUsuario === 'number' && correcta !== null && correcta !== undefined && valorUsuario === correcta
            
            doc.rect(tableStartX, y, tableWidth, 20).stroke('#d1d5db')
            
            const vfIconX = tableStartX + 7
            const vfIconY = y + 10
            doc.save()
            if (typeof valorUsuario === 'number') {
              if (esCorrecta) {
                doc.circle(vfIconX, vfIconY, 4).fill('#16a34a')
                doc.strokeColor('#ffffff').lineWidth(1.2)
                doc.moveTo(vfIconX - 2, vfIconY).lineTo(vfIconX - 0.5, vfIconY + 2).lineTo(vfIconX + 2.5, vfIconY - 1.5).stroke()
              } else {
                doc.circle(vfIconX, vfIconY, 4).fill('#dc2626')
                doc.strokeColor('#ffffff').lineWidth(1.2)
                doc.moveTo(vfIconX - 2, vfIconY - 2).lineTo(vfIconX + 2, vfIconY + 2).stroke()
                doc.moveTo(vfIconX + 2, vfIconY - 2).lineTo(vfIconX - 2, vfIconY + 2).stroke()
              }
              doc.restore()
              
              const respText = valorUsuario === 1 ? 'VERDADERO' : 'FALSO'
              doc.fontSize(7).font('Roboto-Bold')
                .fillColor(esCorrecta ? '#16a34a' : '#dc2626')
                .text(respText, tableStartX + 16, y + 6, { continued: true, width: tableWidth - 20 })
              
              if (!esCorrecta && correcta !== null && correcta !== undefined) {
                doc.font('Roboto').fillColor('#6b7280')
                  .text(`  (Correcta: ${correcta === 1 ? 'Verdadero' : 'Falso'})`)
              } else {
                doc.text('')
              }
            } else {
              doc.restore()
              doc.fontSize(7).font('Roboto').fillColor('#6b7280')
                .text('Sin respuesta', tableStartX + 4, y + 6, { width: tableWidth - 8 })
            }
            doc.fillColor('#000000').strokeColor('#000000')
            y += 20
          }

          y += 8
        })

        // Firma del participante (si aplica)
        if (evaluacion.requiere_firma && resultado.firma) {
          if (y + 80 > pageHeight - 60) {
            doc.addPage()
            this.renderHeader(doc, pageWidth)
            y = 100
          }

          y += 10
          doc.fontSize(9).font('Roboto-Bold').fillColor('#000000').text('FIRMA DEL PARTICIPANTE:', 40, y)
          y += 15

          try {
            if (resultado.firma.startsWith('data:image')) {
              const base64Data = resultado.firma.split(',')[1]
              const imageBuffer = Buffer.from(base64Data, 'base64')
              const firmaWidth = 200
              const firmaX = (pageWidth - firmaWidth) / 2
              doc.image(imageBuffer, firmaX, y, {
                fit: [firmaWidth, 50],
                align: 'center',
                valign: 'center'
              })
              y += 55
            }
          } catch (e) {
            const lineWidth = 200
            const lineStartX = (pageWidth - lineWidth) / 2
            doc.moveTo(lineStartX, y + 30).lineTo(lineStartX + lineWidth, y + 30).stroke()
            y += 35
          }

          const lineWidth = 200
          const lineStartX = (pageWidth - lineWidth) / 2
          doc.moveTo(lineStartX, y).lineTo(lineStartX + lineWidth, y).stroke()
          doc.fontSize(7).font('Roboto').text(resultado.nombre_completo.toUpperCase(), lineStartX, y + 3, { width: lineWidth, align: 'center' })
        }

        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }

  private static renderHeader(doc: typeof PDFDocument.prototype, pageWidth: number) {
    try {
      const isDist = __dirname.includes('/dist/')
      const logoPath = isDist
        ? path.join(__dirname, '../../assets/cotransmeq-logo.png')
        : path.join(__dirname, '../../assets/cotransmeq-logo.png')

      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, 30, { width: 155, height: 43 })
      } else {
        doc.fontSize(20).font('Roboto-Bold').text('COTRANSMEQ', 40, 40)
      }
    } catch (error) {
      doc.fontSize(20).font('Roboto-Bold').text('COTRANSMEQ', 40, 40)
    }

    // Título centrado
    doc
      .fontSize(14)
      .font('Roboto-Bold')
      .text('EVALUACIÓN DE CONOCIMIENTOS', 240, 45, { width: 300, align: 'center' })

    // Código y versión
    doc
      .fontSize(9)
      .font('Roboto')
      .text('Código: HSEG-FR-17', pageWidth - 200, 40, { width: 160, align: 'right' })
      .text('Versión: 1', pageWidth - 200, 52, { width: 160, align: 'right' })
      .text(
        `Fecha: ${new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })}`,
        pageWidth - 200, 64, { width: 160, align: 'right' }
      )

    // Línea separadora
    doc.strokeColor('#000000').lineWidth(1)
      .moveTo(40, 85).lineTo(pageWidth - 40, 85).stroke()
  }

  private static estimateQuestionHeight(pregunta: PreguntaData, respuesta: RespuestaDetalleData): number {
    let height = 18 + 20 + 12 + 8

    if (pregunta.tipo === 'TEXTO') {
      height += 30
    } else if (pregunta.tipo === 'NUMERICA') {
      height += 16
    } else if (pregunta.tipo === 'OPCION_UNICA' || pregunta.tipo === 'OPCION_MULTIPLE') {
      height += (pregunta.opciones.length * 14) + 10
    } else if (pregunta.tipo === 'RELACION') {
      const relaciones: any[] = Array.isArray(respuesta.relacion) ? respuesta.relacion : []
      height += Math.max(16, relaciones.length * 14)
    } else if (pregunta.tipo === 'VERDADERO_FALSO') {
      height += 20
    }

    return height
  }
}
