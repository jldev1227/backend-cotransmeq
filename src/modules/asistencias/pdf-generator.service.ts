import PDFDocument from 'pdfkit'
import { Readable } from 'stream'
import * as path from 'path'
import * as fs from 'fs'

interface FormularioData {
  tematica: string
  objetivo?: string
  fecha: string
  hora_inicio?: string
  hora_finalizacion?: string
  duracion_minutos?: number
  tipo_evento: string
  tipo_evento_otro?: string
  lugar_sede?: string
  nombre_instructor?: string
  observaciones?: string
}

interface RespuestaData {
  nombre_completo: string
  numero_documento: string
  cargo: string
  numero_telefono: string
  fecha_respuesta: string
  firma?: string // Base64 de la imagen
}

export class PDFGeneratorService {
  static async generarPDFAsistencia(
    formulario: FormularioData,
    respuestas: RespuestaData[]
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        // Crear documento PDF en tamaño carta horizontal
        const doc = new PDFDocument({
          size: 'LETTER',
          layout: 'landscape',
          margins: { top: 40, bottom: 40, left: 40, right: 40 }
        })

        const chunks: Buffer[] = []

        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const pageWidth = doc.page.width

        // Header con Logo
        try {
          // In production (dist folder), assets are at dist/assets
          // In development (src folder), assets are at src/assets
          const isDist = __dirname.includes('/dist/')
          const logoPath = isDist 
            ? path.join(__dirname, '../../assets/cotransmeq-logo.png')
            : path.join(__dirname, '../../assets/cotransmeq-logo.png')
          
          if (fs.existsSync(logoPath)) {
            // Logo en la esquina superior izquierda (reducido 14%)
            doc.image(logoPath, 40, 30, { 
              width: 155,
              height: 43
            })
          } else {
            console.error('Logo not found at:', logoPath)
            // Fallback to text
            doc
              .fontSize(20)
              .font('Helvetica-Bold')
              .text('TRANSMERALDA S.A.S', 40, 40)
          }
        } catch (error) {
          console.error('Error loading logo:', error)
          // Si no se encuentra el logo, usar texto como fallback
          doc
            .fontSize(20)
            .font('Helvetica-Bold')
            .text('TRANSMERALDA S.A.S', 40, 40)
        }

        // Título centrado
        doc
          .fontSize(14)
          .font('Helvetica-Bold')
          .text('REGISTRO DE ASISTENCIA A EVENTOS', 240, 45, { 
            width: 300, 
            align: 'center' 
          })

        // Información del código y versión (esquina superior derecha)
        doc
          .fontSize(9)
          .font('Helvetica')
          .text('Código: HSEG-FR-16', pageWidth - 200, 40, { width: 160, align: 'right' })
          .text('Versión: 3', pageWidth - 200, 52, { width: 160, align: 'right' })
          .text(
            'Fecha: 14/01/2026',
            pageWidth - 200,
            64,
            { width: 160, align: 'right' }
          )

        // Línea separadora
        doc
          .strokeColor('#000000')
          .lineWidth(1)
          .moveTo(40, 85)
          .lineTo(pageWidth - 40, 85)
          .stroke()

        // INFORMACIÓN GENERAL
        let yPos = 100
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .fillColor('#000000')
          .text('INFORMACIÓN GENERAL', 40, yPos)

        yPos += 15

        // Tabla de información general con 6 columnas
        const tableStartX = 40
        const tableWidth = pageWidth - 80
        const colWidth = tableWidth / 6
        const infoRowHeight = 28
        const labelHeight = 12
        const valueHeight = infoRowHeight - labelHeight

        // Preparar datos
        let tipoEventoLabel = formulario.tipo_evento
        if (formulario.tipo_evento === 'capacitacion') tipoEventoLabel = 'CAPACITACIÓN'
        else if (formulario.tipo_evento === 'asesoria') tipoEventoLabel = 'ASESORÍA'
        else if (formulario.tipo_evento === 'charla') tipoEventoLabel = 'CHARLA'
        else if (formulario.tipo_evento === 'induccion') tipoEventoLabel = 'INDUCCIÓN'
        else if (formulario.tipo_evento === 'reunion') tipoEventoLabel = 'REUNIÓN'
        else if (formulario.tipo_evento === 'divulgacion') tipoEventoLabel = 'DIVULGACIÓN'
        else if (formulario.tipo_evento === 'otro') tipoEventoLabel = formulario.tipo_evento_otro || 'OTRO'

        const fechaFormato = new Date(formulario.fecha).toLocaleDateString('es-CO', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })

        const duracionTexto = formulario.duracion_minutos 
          ? `${Math.floor(formulario.duracion_minutos / 60)}H ${formulario.duracion_minutos % 60}M`
          : 'N/A'

        // Fila 1: Tipo Evento | Fecha | Hora Inicio | Hora Fin | Duración | Lugar
        const fila1 = [
          { label: 'TIPO EVENTO', value: tipoEventoLabel.toUpperCase() },
          { label: 'FECHA', value: fechaFormato },
          { label: 'HORA INICIO', value: formulario.hora_inicio || 'N/A' },
          { label: 'HORA FIN', value: formulario.hora_finalizacion || 'N/A' },
          { label: 'DURACIÓN', value: duracionTexto },
          { label: 'LUGAR/CIUDAD', value: formulario.lugar_sede?.toUpperCase() || 'N/A' }
        ]

        // Dibujar fila 1
        fila1.forEach((item, index) => {
          const cellX = tableStartX + (index * colWidth)
          
          // Borde y fondo del label
          doc.rect(cellX, yPos, colWidth, labelHeight).fillAndStroke('#e8e8e8', '#000000')
          
          // Label
          doc.fillColor('#000000').fontSize(6).font('Helvetica-Bold')
            .text(item.label, cellX + 2, yPos + 3, { 
              width: colWidth - 4, 
              align: 'center',
              lineBreak: false
            })
          
          // Borde del value
          doc.rect(cellX, yPos + labelHeight, colWidth, valueHeight).stroke('#000000')
          
          // Value - centrado vertical
          doc.fontSize(7).font('Helvetica')
            .text(item.value, cellX + 2, yPos + labelHeight + 5, { 
              width: colWidth - 4, 
              align: 'center',
              lineBreak: false
            })
        })

        yPos += infoRowHeight

        // Fila 2: Tema (ocupa 4 columnas) | Instructor (ocupa 2 columnas)
        // Label Tema
        doc.rect(tableStartX, yPos, colWidth * 4, labelHeight).fillAndStroke('#e8e8e8', '#000000')
        doc.fillColor('#000000').fontSize(6).font('Helvetica-Bold')
          .text('TEMA', tableStartX + 2, yPos + 3, { 
            width: (colWidth * 4) - 4, 
            align: 'center' 
          })
        
        // Label Instructor
        doc.rect(tableStartX + (colWidth * 4), yPos, colWidth * 2, labelHeight).fillAndStroke('#e8e8e8', '#000000')
        doc.fillColor('#000000').fontSize(6).font('Helvetica-Bold')
          .text('INSTRUCTOR', tableStartX + (colWidth * 4) + 2, yPos + 3, { 
            width: (colWidth * 2) - 4, 
            align: 'center' 
          })

        // Value Tema - centrado vertical
        doc.rect(tableStartX, yPos + labelHeight, colWidth * 4, valueHeight).stroke('#000000')
        doc.fontSize(7).font('Helvetica')
          .text(formulario.tematica.toUpperCase(), tableStartX + 2, yPos + labelHeight + 5, { 
            width: (colWidth * 4) - 4, 
            align: 'center',
            lineBreak: false
          })
        
        // Value Instructor - centrado vertical
        doc.rect(tableStartX + (colWidth * 4), yPos + labelHeight, colWidth * 2, valueHeight).stroke('#000000')
        doc.fontSize(7).font('Helvetica')
          .text(formulario.nombre_instructor?.toUpperCase() || 'N/A', tableStartX + (colWidth * 4) + 2, yPos + labelHeight + 5, { 
            width: (colWidth * 2) - 4, 
            align: 'center',
            lineBreak: false
          })

        yPos += infoRowHeight

        // Fila 3: Objetivo (ocupa todas las 6 columnas)
        if (formulario.objetivo) {
          // Label Objetivo
          doc.rect(tableStartX, yPos, tableWidth, labelHeight).fillAndStroke('#e8e8e8', '#000000')
          doc.fillColor('#000000').fontSize(6).font('Helvetica-Bold')
            .text('OBJETIVO', tableStartX + 2, yPos + 3, { 
              width: tableWidth - 4, 
              align: 'left' 
            })
          
          // Calcular altura del objetivo basada en el contenido
          // IMPORTANTE: Usar el mismo fontSize y font antes de calcular heightOfString
          const objetivoText = formulario.objetivo.toUpperCase()
          doc.fontSize(7).font('Helvetica')
          const textHeight = doc.heightOfString(objetivoText, { 
            width: tableWidth - 8,
            lineGap: 2
          })
          const objetivoHeight = Math.max(valueHeight, textHeight + 8) // Mínimo valueHeight, añadir padding
          
          // Value Objetivo - con padding vertical
          doc.rect(tableStartX, yPos + labelHeight, tableWidth, objetivoHeight).stroke('#000000')
          doc.text(objetivoText, tableStartX + 4, yPos + labelHeight + 4, { 
            width: tableWidth - 8, 
            align: 'left',
            lineGap: 2
          })
          
          yPos += labelHeight + objetivoHeight
        }

        yPos += 10

        // RELACIÓN DE ASISTENTES
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .fillColor('#000000')
          .text('RELACIÓN DE ASISTENTES', 40, yPos)

        yPos += 20

        // Tabla de asistentes
        const tableTop = yPos
        const tableHeaders = ['No.', 'NOMBRE COMPLETO', 'CÉDULA', 'CARGO / ROL', 'TELÉFONO', 'FIRMA']
        const colWidths = [30, 200, 80, 140, 80, 180]
        const colPositions = [40]

        // Calcular posiciones de columnas
        for (let i = 0; i < colWidths.length - 1; i++) {
          colPositions.push(colPositions[i] + colWidths[i])
        }

        // Dibujar encabezados de tabla
        doc
          .fontSize(8)
          .font('Helvetica-Bold')
          .fillColor('#000000')

        tableHeaders.forEach((header, i) => {
          // Rectángulo de fondo para encabezado
          doc
            .rect(colPositions[i], tableTop, colWidths[i], 20)
            .fillAndStroke('#e0e0e0', '#000000')

          // Texto del encabezado
          doc
            .fillColor('#000000')
            .text(
              header,
              colPositions[i] + 3,
              tableTop + 6,
              { width: colWidths[i] - 6, align: 'center' }
            )
        })

        // Dibujar filas de asistentes
        yPos = tableTop + 20
        const assistantRowHeight = 25

        respuestas.forEach((respuesta, index) => {
          // Verificar si necesitamos nueva página
          if (yPos + assistantRowHeight > doc.page.height - 60) {
            doc.addPage()
            yPos = 40
          }

          doc.fontSize(7).font('Helvetica')

          // Dibujar bordes de celda y contenido
          colPositions.forEach((pos, i) => {
            // Borde de celda
            doc.rect(pos, yPos, colWidths[i], assistantRowHeight).stroke('#000000')
          })

          // No. - Centrado vertical
          doc.text(
            String(index + 1),
            colPositions[0],
            yPos + (assistantRowHeight / 2) - 3,
            { width: colWidths[0], align: 'center' }
          )

          // Nombre - Centrado vertical
          doc.text(
            respuesta.nombre_completo.toUpperCase(),
            colPositions[1] + 3,
            yPos + (assistantRowHeight / 2) - 3,
            { width: colWidths[1] - 6, align: 'center' }
          )

          // Cédula - Centrado vertical y horizontal
          doc.text(
            respuesta.numero_documento,
            colPositions[2],
            yPos + (assistantRowHeight / 2) - 3,
            { width: colWidths[2], align: 'center' }
          )

          // Cargo - Centrado vertical
          doc.text(
            respuesta.cargo.toUpperCase(),
            colPositions[3] + 3,
            yPos + (assistantRowHeight / 2) - 3,
            { width: colWidths[3] - 6, align: 'center' }
          )

          // Teléfono - Centrado vertical y horizontal
          doc.text(
            respuesta.numero_telefono,
            colPositions[4],
            yPos + (assistantRowHeight / 2) - 3,
            { width: colWidths[4], align: 'center' }
          )

          // Firma - Renderizar imagen Base64
          try {
            if (respuesta.firma && respuesta.firma.startsWith('data:image')) {
              // Extraer el base64 puro (sin el prefijo data:image/png;base64,)
              const base64Data = respuesta.firma.split(',')[1]
              const imageBuffer = Buffer.from(base64Data, 'base64')
              
              // Calcular dimensiones para centrar y hacer zoom a la firma
              const cellCenterX = colPositions[5] + (colWidths[5] / 2)
              const cellCenterY = yPos + (assistantRowHeight / 2)
              
              // Aumentar el tamaño de la firma (35% más grande)
              const firmaMaxWidth = (colWidths[5] - 8) * 1.35
              const firmaMaxHeight = (assistantRowHeight - 4) * 1.35
              
              // Calcular posición para centrar la firma escalada
              const firmaX = cellCenterX - (firmaMaxWidth / 2)
              const firmaY = cellCenterY - (firmaMaxHeight / 2)
              
              // Renderizar la imagen de firma centrada y escalada
              doc.image(imageBuffer, firmaX, firmaY, {
                fit: [firmaMaxWidth, firmaMaxHeight],
                align: 'center',
                valign: 'center'
              })
            }
          } catch (error) {
            // Si hay error al renderizar la imagen, mostrar línea para firma
            const firmaX = colPositions[5]
            const firmaWidth = colWidths[5]
            const firmaY = yPos + (assistantRowHeight / 2)
            
            doc
              .strokeColor('#cccccc')
              .lineWidth(0.5)
              .moveTo(firmaX + 10, firmaY + 5)
              .lineTo(firmaX + firmaWidth - 10, firmaY + 5)
              .stroke()
              .strokeColor('#000000')
              .lineWidth(1)
          }

          yPos += assistantRowHeight
        })

        // Sección de observaciones
        yPos += 10
        if (yPos + 60 > doc.page.height - 60) {
          doc.addPage()
          yPos = 40
        }

        doc.fontSize(9).font('Helvetica-Bold').text('OBSERVACIONES:', 40, yPos)
        
        // Si hay observaciones, mostrarlas en el cuadro con altura dinámica
        if (formulario.observaciones) {
          const observacionesText = formulario.observaciones
          const textHeight = doc.heightOfString(observacionesText, { 
            width: pageWidth - 90,
            lineGap: 2
          })
          const observacionesHeight = Math.max(30, textHeight + 10) // Mínimo 30px, añadir padding
          
          doc
            .rect(40, yPos + 15, pageWidth - 80, observacionesHeight)
            .stroke('#000000')
          
          doc.fontSize(8).font('Helvetica')
            .text(observacionesText, 45, yPos + 20, { 
              width: pageWidth - 90,
              align: 'left',
              lineGap: 2
            })
          
          yPos += observacionesHeight + 25
        } else {
          // Si no hay observaciones, mostrar cuadro vacío
          doc
            .rect(40, yPos + 15, pageWidth - 80, 30)
            .stroke('#000000')
          
          yPos += 55
        }
        doc.fontSize(9).font('Helvetica-Bold').text('FIRMA INSTRUCTOR / CONFERENCISTA:', 40, yPos)
        
        // Línea centrada para la firma (200px de ancho, centrada en la página)
        const lineWidth = 200
        const lineStartX = (pageWidth - lineWidth) / 2
        doc
          .moveTo(lineStartX, yPos + 30)
          .lineTo(lineStartX + lineWidth, yPos + 30)
          .stroke()

        // Finalizar documento
        doc.end()
      } catch (error) {
        reject(error)
      }
    })
  }
}
