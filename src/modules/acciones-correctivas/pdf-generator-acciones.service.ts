import PDFDocument from 'pdfkit'
import * as path from 'path'
import * as fs from 'fs'

interface AccionCorrectiva {
  accion_numero: string
  lugar_sede?: string | null
  proceso_origen_hallazgo?: string | null
  componente_elemento_referencia?: string | null
  fuente_genero_hallazgo?: string | null
  marco_legal_normativo?: string | null
  fecha_identificacion_hallazgo?: Date | null
  descripcion_hallazgo?: string | null
  tipo_hallazgo_detectado?: string | null
  variable_categoria_analisis?: string | null
  correccion_solucion_inmediata?: string | null
  fecha_implementacion?: Date | null
  valoracion_riesgo?: string | null
  requiere_actualizar_matriz?: string | null
  tipo_accion_ejecutar?: string | null
  analisis_causas?: string[] | null // Array de 5 porqués
  descripcion_accion_plan?: string | null
  fecha_limite_implementacion?: Date | null
  responsable_ejecucion?: string | null
  fecha_seguimiento?: Date | null
  estado_accion_planeada?: string | null
  descripcion_estado_observaciones?: string | null
  fecha_evaluacion_eficacia?: Date | null
  criterio_evaluacion_eficacia?: string | null
  analisis_evidencias_cierre?: string | null
  evaluacion_cierre_eficaz?: string | null
  soporte_cierre_eficaz?: string | null
  fecha_cierre_definitivo?: Date | null
  responsable_cierre?: string | null
}

export class PDFGeneratorAccionesService {
  static async generarPDFAccion(accion: AccionCorrectiva): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        // Crear documento PDF en tamaño carta HORIZONTAL con márgenes reducidos
        const doc = new PDFDocument({
          size: 'LETTER',
          layout: 'landscape',
          margins: { top: 15, bottom: 20, left: 30, right: 30 }
        })

        const chunks: Buffer[] = []

        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const pageWidth = doc.page.width
        const pageHeight = doc.page.height

        // Header con Logo (más pequeño)
        try {
          const isDist = __dirname.includes('/dist/')
          const logoPath = isDist 
            ? path.join(__dirname, '../../assets/cotransmeq-logo.png')
            : path.join(__dirname, '../../assets/cotransmeq-logo.png')
          
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 30, 12, { width: 110, height: 30 })
          }
        } catch (error) {
          doc.fontSize(14).font('Helvetica-Bold').text('TRANSMERALDA S.A.S', 30, 15)
        }

        // Título centrado (más compacto)
        doc
          .fontSize(10)
          .font('Helvetica-Bold')
          .text('MATRIZ DE ACCIONES CORRECTIVAS Y PREVENTIVAS', 200, 20, { 
            width: 350, 
            align: 'center' 
          })

        // Información del código y versión (más compacto)
        doc
          .fontSize(6.5)
          .font('Helvetica')
          .text('Código: HSEQ-MTR-07', pageWidth - 150, 15, { width: 120, align: 'right' })
          .text('Versión: 5', pageWidth - 150, 23, { width: 120, align: 'right' })
          .text('Fecha: 14/01/2026', pageWidth - 150, 31, { width: 120, align: 'right' })

        // Línea separadora
        doc
          .strokeColor('#000000')
          .lineWidth(0.5)
          .moveTo(30, 45)
          .lineTo(pageWidth - 30, 45)
          .stroke()

        let yPos = 49

        const formatearFecha = (fecha: Date | null | undefined) => {
          if (!fecha) return 'N/A'
          const date = new Date(fecha)
          return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
        }

        const formatearValor = (valor: any) => {
          if (valor === null || valor === undefined) return 'N/A'
          if (typeof valor === 'boolean') return valor ? 'SÍ' : 'NO'
          // Manejar strings booleanos
          if (typeof valor === 'string') {
            const lower = valor.toLowerCase()
            if (lower === 'true' || lower === 'yes' || lower === 'sí' || lower === 'si') return 'SÍ'
            if (lower === 'false' || lower === 'no') return 'NO'
          }
          // Manejar arrays (5 porqués)
          if (Array.isArray(valor)) {
            return valor
              .filter(item => item && item.trim())
              .map((item, index) => `${index + 1}. ${item}`)
              .join('\n') || 'N/A'
          }
          return String(valor).toUpperCase()
        }

        // Función para crear una celda con label y value (más compacta)
        const crearCelda = (x: number, y: number, width: number, label: string, value: string, multiline: boolean = false) => {
          const labelHeight = 9
          let valueHeight = 13
          
          if (multiline) {
            doc.fontSize(6).font('Helvetica')
            const textHeight = doc.heightOfString(value, { width: width - 6, lineGap: 0 })
            // Limitar altura máxima para campos multilínea
            valueHeight = Math.min(Math.max(13, textHeight + 4), 40)
          }

          // Label con fondo gris
          doc.rect(x, y, width, labelHeight).fillAndStroke('#e8e8e8', '#000000')
          doc.fillColor('#000000').fontSize(5.5).font('Helvetica-Bold')
            .text(label, x + 2, y + 2, { width: width - 4, align: 'left', lineBreak: false })

          // Value
          doc.rect(x, y + labelHeight, width, valueHeight).stroke('#000000')
          doc.fontSize(6).font('Helvetica')
            .text(value, x + 3, y + labelHeight + 2, { 
              width: width - 6, 
              align: 'left',
              lineGap: 0,
              ellipsis: multiline ? true : false,
              height: multiline ? valueHeight - 4 : undefined
            })

          return labelHeight + valueHeight
        }

        const tableStartX = 30
        const tableWidth = pageWidth - 60
        const col1 = tableWidth / 4
        const col2 = tableWidth / 4
        const col3 = tableWidth / 4
        const col4 = tableWidth / 4

        // NÚMERO DE ACCIÓN (destacado, más compacto)
        doc.rect(tableStartX, yPos, tableWidth, 12).fillAndStroke('#10b981', '#000000')
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF')
          .text(`ACCIÓN No. ${accion.accion_numero}`, tableStartX + 8, yPos + 3)
        yPos += 16

        // SECCIÓN 1: IDENTIFICACIÓN DEL HALLAZGO
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000')
          .text('1. IDENTIFICACIÓN DEL HALLAZGO', tableStartX, yPos)
        yPos += 9

        // Fila 1: Lugar | Fecha | Tipo | Categoría (4 columnas)
        let h1 = crearCelda(tableStartX, yPos, col1, 'LUGAR / SEDE', formatearValor(accion.lugar_sede))
        let h2 = crearCelda(tableStartX + col1, yPos, col2, 'FECHA IDENTIF.', formatearFecha(accion.fecha_identificacion_hallazgo))
        let h3 = crearCelda(tableStartX + col1 + col2, yPos, col3, 'TIPO HALLAZGO', formatearValor(accion.tipo_hallazgo_detectado))
        let h4 = crearCelda(tableStartX + col1 + col2 + col3, yPos, col4, 'CATEGORÍA', formatearValor(accion.variable_categoria_analisis))
        yPos += Math.max(h1, h2, h3, h4)

        // Fila 2: Proceso (2 cols) | Fuente (2 cols)
        h1 = crearCelda(tableStartX, yPos, col1 + col2, 'PROCESO ORIGEN', formatearValor(accion.proceso_origen_hallazgo))
        h2 = crearCelda(tableStartX + col1 + col2, yPos, col3 + col4, 'FUENTE', formatearValor(accion.fuente_genero_hallazgo))
        yPos += Math.max(h1, h2)

        // Fila 3: Componente (2 cols) | Marco Legal (2 cols)
        h1 = crearCelda(tableStartX, yPos, col1 + col2, 'COMPONENTE / ELEMENTO', formatearValor(accion.componente_elemento_referencia))
        h2 = crearCelda(tableStartX + col1 + col2, yPos, col3 + col4, 'MARCO LEGAL', formatearValor(accion.marco_legal_normativo))
        yPos += Math.max(h1, h2)

        // Fila 4: Descripción Hallazgo (full width, multiline)
        yPos += crearCelda(tableStartX, yPos, tableWidth, 'DESCRIPCIÓN DEL HALLAZGO', formatearValor(accion.descripcion_hallazgo), true)

        yPos += 5

        // SECCIÓN 2: CORRECCIÓN INMEDIATA
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000')
          .text('2. CORRECCIÓN INMEDIATA', tableStartX, yPos)
        yPos += 9

        // Fila 1: Corrección (full width, multiline)
        yPos += crearCelda(tableStartX, yPos, tableWidth, 'CORRECCIÓN O SOLUCIÓN INMEDIATA', formatearValor(accion.correccion_solucion_inmediata), true)

        // Fila 2: Fecha (2 cols) | Riesgo | Actualizar
        h1 = crearCelda(tableStartX, yPos, col1 + col2, 'FECHA IMPLEMENTACIÓN', formatearFecha(accion.fecha_implementacion))
        h2 = crearCelda(tableStartX + col1 + col2, yPos, col3, 'RIESGO', formatearValor(accion.valoracion_riesgo))
        h3 = crearCelda(tableStartX + col1 + col2 + col3, yPos, col4, '¿ACTUALIZAR?', formatearValor(accion.requiere_actualizar_matriz))
        yPos += Math.max(h1, h2, h3)

        yPos += 5

        // SECCIÓN 3: ANÁLISIS Y PLAN DE ACCIÓN
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000')
          .text('3. ANÁLISIS Y PLAN DE ACCIÓN', tableStartX, yPos)
        yPos += 9

        // Fila 1: Tipo Acción (2 cols) | Fecha Límite | Responsable
        h1 = crearCelda(tableStartX, yPos, col1 + col2, 'TIPO DE ACCIÓN', formatearValor(accion.tipo_accion_ejecutar))
        h2 = crearCelda(tableStartX + col1 + col2, yPos, col3, 'FECHA LÍMITE', formatearFecha(accion.fecha_limite_implementacion))
        h3 = crearCelda(tableStartX + col1 + col2 + col3, yPos, col4, 'RESPONSABLE', formatearValor(accion.responsable_ejecucion))
        yPos += Math.max(h1, h2, h3)

        // Fila 2: Análisis de Causas (fila completa - 4 columnas)
        yPos += crearCelda(tableStartX, yPos, tableWidth, 'ANÁLISIS DE CAUSAS (5 Por qué)', formatearValor(accion.analisis_causas), true)

        // Fila 3: Descripción del Plan de Acción (fila completa - 4 columnas)
        yPos += crearCelda(tableStartX, yPos, tableWidth, 'PLAN DE ACCIÓN', formatearValor(accion.descripcion_accion_plan), true)

        yPos += 5

        // SECCIÓN 4: SEGUIMIENTO
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000')
          .text('4. SEGUIMIENTO', tableStartX, yPos)
        yPos += 9

        // Fila 1: Fecha | Estado | Descripción (inline)
        h1 = crearCelda(tableStartX, yPos, col1, 'FECHA SEGUIM.', formatearFecha(accion.fecha_seguimiento))
        h2 = crearCelda(tableStartX + col1, yPos, col2, 'ESTADO', formatearValor(accion.estado_accion_planeada))
        h3 = crearCelda(tableStartX + col1 + col2, yPos, col3 + col4, 'OBSERVACIONES', formatearValor(accion.descripcion_estado_observaciones), true)
        yPos += Math.max(h1, h2, h3)

        yPos += 5

        // SECCIÓN 5: EVALUACIÓN DE EFICACIA
        doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000')
          .text('5. EVALUACIÓN DE EFICACIA', tableStartX, yPos)
        yPos += 9

        // Fila 1: Fecha | Evaluación | Criterio (2 cols)
        h1 = crearCelda(tableStartX, yPos, col1, 'FECHA EVAL.', formatearFecha(accion.fecha_evaluacion_eficacia))
        h2 = crearCelda(tableStartX + col1, yPos, col2, 'EFICAZ', formatearValor(accion.evaluacion_cierre_eficaz))
        h3 = crearCelda(tableStartX + col1 + col2, yPos, col3 + col4, 'CRITERIO EVALUACIÓN', formatearValor(accion.criterio_evaluacion_eficacia), true)
        yPos += Math.max(h1, h2, h3)

        // Fila 2: Análisis/Evidencias (2 cols) | Soporte (2 cols)
        h1 = crearCelda(tableStartX, yPos, col1 + col2, 'EVIDENCIAS CIERRE', formatearValor(accion.analisis_evidencias_cierre), true)
        h2 = crearCelda(tableStartX + col1 + col2, yPos, col3 + col4, 'SOPORTE', formatearValor(accion.soporte_cierre_eficaz), true)
        yPos += Math.max(h1, h2)

        // Fila 3: Fecha Cierre (2 cols) | Responsable Cierre (2 cols)
        h1 = crearCelda(tableStartX, yPos, col1 + col2, 'FECHA CIERRE', formatearFecha(accion.fecha_cierre_definitivo))
        h2 = crearCelda(tableStartX + col1 + col2, yPos, col3 + col4, 'RESPONSABLE CIERRE', formatearValor(accion.responsable_cierre))
        yPos += Math.max(h1, h2)

        // Finalizar documento
        doc.end()
      } catch (error) {
        console.error('Error generando PDF:', error)
        reject(error)
      }
    })
  }
}
