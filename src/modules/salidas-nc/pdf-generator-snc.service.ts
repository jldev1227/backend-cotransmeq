import PDFDocument from 'pdfkit'
import * as path from 'path'
import * as fs from 'fs'

interface SalidaNC {
  id: string
  numero_snc: number
  fecha_deteccion: Date | string
  fecha_evento: Date | string
  detectado_por: string
  area_proceso: string
  tipo_deteccion: string
  tipo_deteccion_otro?: string | null
  vehiculo_placa?: string | null
  ruta_trayecto?: string | null
  turno_horario?: string | null
  conductor_nombre?: string | null
  conductor_cedula?: string | null
  cliente_contrato?: string | null
  servicio_afectado?: string | null
  descripcion_nc: string
  clasificacion_nc: string
  tipo_salida_nc: string
  tipo_salida_nc_otro?: string | null
  estado: string
  observaciones?: string | null
  // Sección 3
  tratamiento_seleccionado?: string | null
  descripcion_accion_tomada?: string | null
  responsable_accion?: string | null
  fecha_implementacion?: Date | string | null
  autoridad_disposicion?: string | null
  // Sección 4
  concesion_solicitada?: boolean | null
  condiciones_concesion?: string | null
  concesion_cliente_nombre?: string | null
  concesion_cliente_fecha?: Date | string | null
  concesion_medio?: string | null
  // Sección 5
  metodo_verificacion?: string | null
  metodo_verificacion_otro?: string | null
  resultado_verificacion?: string | null
  cumple_requisitos?: boolean | null
  responsable_verificacion?: string | null
  fecha_verificacion?: Date | string | null
  firma_verificacion?: string | null
  // Relaciones
  conductor?: { nombre: string; apellido: string; numero_identificacion: string } | null
  vehiculo?: { placa: string; marca: string; modelo: string } | null
  cliente?: { nombre: string; nit: string } | null
  creado_por?: { nombre: string; correo: string } | null
}

// ── Labels para el PDF ──
const CLASIFICACION_LABELS: Record<string, string> = {
  CRITICA: 'CRÍTICA — Afecta seguridad de personas',
  MAYOR: 'MAYOR — Afecta conformidad del servicio',
  MENOR: 'MENOR — Desviación controlable'
}

const TIPO_DETECCION_LABELS: Record<string, string> = {
  DURANTE_SERVICIO: 'Durante el servicio',
  POST_SERVICIO: 'Post servicio',
  AUDITORIA_INTERVENTORIA: 'Auditoría / Interventoría',
  REPORTE_CLIENTE: 'Reporte del cliente',
  OTRO: 'Otro'
}

const TIPO_SALIDA_NC_LABELS: Record<string, string> = {
  GPS_SISTEMA_TECNOLOGICO: 'GPS / Sistema tecnológico',
  INCUMPLIMIENTO_RUTA_HORARIO_DESTINO: 'Incumplimiento ruta/horario/destino',
  VEHICULO_DIFERENTE_SIN_APROBACION: 'Vehículo diferente sin aprobación',
  FALLA_MECANICA_ELECTRICA: 'Falla mecánica/eléctrica',
  DOCUMENTACION_VENCIDA_INCOMPLETA: 'Documentación vencida/incompleta',
  CONDUCTOR_NO_APTO_INFRACCION_VIAL: 'Conductor no apto / infracción vial',
  QUEJA_CLIENTE: 'Queja del cliente',
  HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE: 'Hallazgo auditoría/interventoría/cliente',
  PERSONAL_NO_AUTORIZADO_TRANSPORTADO: 'Personal no autorizado transportado',
  OTRO: 'Otro'
}

const ESTADO_LABELS: Record<string, string> = {
  ABIERTA: 'ABIERTA',
  EN_TRATAMIENTO: 'EN TRATAMIENTO',
  CERRADA: 'CERRADA'
}

const TRATAMIENTO_LABELS: Record<string, string> = {
  CORRECCION: 'Corrección — Acción inmediata para eliminar la NC',
  CONTENCION: 'Contención — Control de efectos mientras se define disposición',
  SUSPENSION: 'Suspensión — Detener la prestación del servicio',
  CONCESION: 'Concesión — Autorización formal del cliente'
}

const MEDIO_AUTORIZACION_LABELS: Record<string, string> = {
  ESCRITO: 'Escrito',
  CORREO: 'Correo electrónico',
  ACTA: 'Acta'
}

const METODO_VERIFICACION_LABELS: Record<string, string> = {
  REVISION_DOCUMENTAL: 'Revisión documental',
  VERIFICACION_OPERATIVA_CAMPO: 'Verificación operativa en campo',
  CONFIRMACION_GPS_PLATAFORMA: 'Confirmación GPS / plataforma',
  CONFIRMACION_CLIENTE_INTERVENTOR: 'Confirmación del cliente / interventor',
  OTRO: 'Otro'
}

export class PDFGeneratorSNCService {
  static async generarPDF(salida: SalidaNC): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          layout: 'portrait',
          margins: { top: 20, bottom: 30, left: 35, right: 35 }
        })

        const chunks: Buffer[] = []
        doc.on('data', (chunk) => chunks.push(chunk))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const pageWidth = doc.page.width
        const contentWidth = pageWidth - 70 // 35 + 35

        // ══════════════════════════════════════════════
        // HELPERS
        // ══════════════════════════════════════════════

        const formatearFecha = (fecha: Date | string | null | undefined): string => {
          if (!fecha) return 'N/A'
          const date = new Date(fecha)
          return date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })
        }

        const val = (v: any): string => {
          if (v === null || v === undefined || v === '') return 'N/A'
          if (typeof v === 'boolean') return v ? 'SÍ' : 'NO'
          return String(v)
        }

        const COLORS = {
          headerBg: '#DC2626',     // red-600
          headerText: '#FFFFFF',
          sectionBg: '#FEE2E2',    // red-100
          sectionText: '#991B1B',  // red-800
          labelBg: '#F3F4F6',      // gray-100
          cellBorder: '#D1D5DB',   // gray-300
          black: '#000000',
          greenBg: '#D1FAE5',
          greenText: '#065F46',
          yellowBg: '#FEF3C7',
          yellowText: '#92400E',
          redBg: '#FEE2E2',
          redText: '#991B1B',
          blueBg: '#DBEAFE',
          blueText: '#1E40AF',
          amberBg: '#FEF3C7',
          amberText: '#92400E',
        }

        // Estado badge colors
        const getEstadoColor = (estado: string) => {
          switch (estado) {
            case 'CERRADA': return { bg: COLORS.greenBg, text: COLORS.greenText }
            case 'EN_TRATAMIENTO': return { bg: COLORS.yellowBg, text: COLORS.yellowText }
            default: return { bg: COLORS.redBg, text: COLORS.redText }
          }
        }

        // Clasificación badge colors
        const getClasifColor = (clasif: string) => {
          switch (clasif) {
            case 'CRITICA': return { bg: COLORS.redBg, text: COLORS.redText }
            case 'MAYOR': return { bg: '#FFEDD5', text: '#9A3412' }
            default: return { bg: COLORS.yellowBg, text: COLORS.yellowText }
          }
        }

        let yPos = 20
        const leftX = 35

        // ══════════════════════════════════════════════
        // Celda helpers
        // ══════════════════════════════════════════════

        const crearCelda = (x: number, y: number, w: number, label: string, value: string, multiline = false): number => {
          const labelH = 11
          let valueH = 15

          if (multiline) {
            doc.fontSize(7).font('Helvetica')
            const textH = doc.heightOfString(value, { width: w - 8 })
            valueH = Math.min(Math.max(15, textH + 6), 60)
          }

          // Label bg
          doc.rect(x, y, w, labelH).fillAndStroke(COLORS.labelBg, COLORS.cellBorder)
          doc.fillColor(COLORS.black).fontSize(6).font('Helvetica-Bold')
            .text(label, x + 3, y + 2.5, { width: w - 6, lineBreak: false })

          // Value
          doc.rect(x, y + labelH, w, valueH).stroke(COLORS.cellBorder)
          doc.fillColor(COLORS.black).fontSize(7).font('Helvetica')
            .text(value, x + 4, y + labelH + 3, {
              width: w - 8,
              height: multiline ? valueH - 5 : undefined,
              ellipsis: true
            })

          return labelH + valueH
        }

        const seccionHeader = (titulo: string, numero: string, y: number, norma?: string): number => {
          const h = 16
          doc.rect(leftX, y, contentWidth, h).fillAndStroke(COLORS.sectionBg, COLORS.cellBorder)

          // Número en círculo
          doc.circle(leftX + 12, y + h / 2, 7).fill(COLORS.headerBg)
          doc.fillColor('#FFFFFF').fontSize(7).font('Helvetica-Bold')
            .text(numero, leftX + 7, y + 4, { width: 10, align: 'center' })

          // Título
          doc.fillColor(COLORS.sectionText).fontSize(8).font('Helvetica-Bold')
            .text(titulo, leftX + 24, y + 4, { width: contentWidth - 30 })

          if (norma) {
            doc.fontSize(6).font('Helvetica').fillColor('#6B7280')
              .text(norma, leftX + 24, y + 4, { width: contentWidth - 30, align: 'right' })
          }

          return h + 3
        }

        // Check if we need new page
        const checkPage = (needed: number) => {
          if (yPos + needed > doc.page.height - 40) {
            doc.addPage()
            yPos = 20
          }
        }

        // ══════════════════════════════════════════════
        // HEADER: Logo + Título + Estado
        // ══════════════════════════════════════════════

        // Logo
        try {
          const isDist = __dirname.includes('/dist/')
          const logoPath = isDist
            ? path.join(__dirname, '../../assets/transmeralda-logo.webp')
            : path.join(__dirname, '../../assets/transmeralda-logo.webp')

          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, leftX, yPos, { width: 130, height: 36 })
          }
        } catch {
          doc.fontSize(14).font('Helvetica-Bold').text('COTRANSMEQ S.A.S', leftX, yPos)
        }

        // Título centrado
        doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.headerBg)
          .text('REGISTRO DE SALIDA', 0, yPos + 5, { width: pageWidth, align: 'center' })
        doc.fontSize(12).font('Helvetica-Bold').fillColor(COLORS.headerBg)
          .text('NO CONFORME', 0, yPos + 19, { width: pageWidth, align: 'center' })

        // Número SNC y Estado (derecha)
        const sncNum = `SNC-${String(salida.numero_snc).padStart(4, '0')}`
        doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.black)
          .text(sncNum, pageWidth - 165, yPos + 3, { width: 130, align: 'right' })

        // Estado badge
        const estadoColor = getEstadoColor(salida.estado)
        const estadoLabel = ESTADO_LABELS[salida.estado] || salida.estado
        const badgeW = 90
        const badgeX = pageWidth - 165 + 40
        doc.roundedRect(badgeX, yPos + 20, badgeW, 14, 3).fill(estadoColor.bg)
        doc.fillColor(estadoColor.text).fontSize(7).font('Helvetica-Bold')
          .text(estadoLabel, badgeX, yPos + 23, { width: badgeW, align: 'center' })

        // Línea separadora
        yPos += 42
        doc.strokeColor(COLORS.headerBg).lineWidth(1.5)
          .moveTo(leftX, yPos).lineTo(pageWidth - 35, yPos).stroke()
        yPos += 8

        // ══════════════════════════════════════════════
        // SECCIÓN 1: IDENTIFICACIÓN
        // ══════════════════════════════════════════════

        yPos += seccionHeader('IDENTIFICACIÓN DE LA SALIDA NO CONFORME', '1', yPos)

        const col2 = contentWidth / 2
        const col3 = contentWidth / 3
        const col4 = contentWidth / 4

        // Fila 1: Fecha Detección | Fecha Evento | Detectado por
        let h1 = crearCelda(leftX, yPos, col3, 'FECHA DETECCIÓN', formatearFecha(salida.fecha_deteccion))
        let h2 = crearCelda(leftX + col3, yPos, col3, 'FECHA DEL EVENTO', formatearFecha(salida.fecha_evento))
        let h3 = crearCelda(leftX + col3 * 2, yPos, col3, 'DETECTADO POR', val(salida.detectado_por))
        yPos += Math.max(h1, h2, h3)

        // Fila 2: Área/Proceso | Tipo Detección | Clasificación
        const tipoDetLabel = salida.tipo_deteccion === 'OTRO' && salida.tipo_deteccion_otro
          ? `Otro: ${salida.tipo_deteccion_otro}`
          : TIPO_DETECCION_LABELS[salida.tipo_deteccion] || salida.tipo_deteccion

        const clasificLabel = CLASIFICACION_LABELS[salida.clasificacion_nc] || salida.clasificacion_nc

        h1 = crearCelda(leftX, yPos, col3, 'ÁREA / PROCESO', val(salida.area_proceso))
        h2 = crearCelda(leftX + col3, yPos, col3, 'TIPO DE DETECCIÓN', tipoDetLabel)
        h3 = crearCelda(leftX + col3 * 2, yPos, col3, 'CLASIFICACIÓN NC', clasificLabel)
        yPos += Math.max(h1, h2, h3)

        // Fila 3: Conductor | Cédula | Placa
        h1 = crearCelda(leftX, yPos, col3, 'CONDUCTOR', val(salida.conductor_nombre))
        h2 = crearCelda(leftX + col3, yPos, col3, 'CÉDULA CONDUCTOR', val(salida.conductor_cedula))
        h3 = crearCelda(leftX + col3 * 2, yPos, col3, 'PLACA VEHÍCULO', val(salida.vehiculo_placa))
        yPos += Math.max(h1, h2, h3)

        // Fila 4: Ruta | Turno | Cliente
        h1 = crearCelda(leftX, yPos, col3, 'RUTA / TRAYECTO', val(salida.ruta_trayecto))
        h2 = crearCelda(leftX + col3, yPos, col3, 'TURNO / HORARIO', val(salida.turno_horario))
        h3 = crearCelda(leftX + col3 * 2, yPos, col3, 'CLIENTE / CONTRATO', val(salida.cliente_contrato))
        yPos += Math.max(h1, h2, h3)

        // Fila 5: Servicio Afectado (full width)
        yPos += crearCelda(leftX, yPos, contentWidth, 'SERVICIO AFECTADO', val(salida.servicio_afectado), true)

        yPos += 6

        // ══════════════════════════════════════════════
        // SECCIÓN 2: DESCRIPCIÓN DE LA NC
        // ══════════════════════════════════════════════

        checkPage(100)
        yPos += seccionHeader('DESCRIPCIÓN DE LA SALIDA NO CONFORME', '2', yPos, 'ISO 8.7.2 a')

        // Tipo de Salida NC
        const tipoSalidaLabel = salida.tipo_salida_nc === 'OTRO' && salida.tipo_salida_nc_otro
          ? `Otro: ${salida.tipo_salida_nc_otro}`
          : TIPO_SALIDA_NC_LABELS[salida.tipo_salida_nc] || salida.tipo_salida_nc

        h1 = crearCelda(leftX, yPos, col2, 'TIPO DE SALIDA NO CONFORME', tipoSalidaLabel)
        h2 = crearCelda(leftX + col2, yPos, col2, 'CLASIFICACIÓN', clasificLabel)
        yPos += Math.max(h1, h2)

        // Descripción NC (full width, multiline)
        yPos += crearCelda(leftX, yPos, contentWidth, 'DESCRIPCIÓN DETALLADA DE LA NO CONFORMIDAD', val(salida.descripcion_nc), true)

        // Observaciones
        if (salida.observaciones) {
          yPos += crearCelda(leftX, yPos, contentWidth, 'OBSERVACIONES', val(salida.observaciones), true)
        }

        yPos += 6

        // ══════════════════════════════════════════════
        // SECCIÓN 3: TRATAMIENTO APLICADO
        // ══════════════════════════════════════════════

        checkPage(100)
        yPos += seccionHeader('TRATAMIENTO APLICADO', '3', yPos, 'ISO 8.7.1 a-d / 8.7.2 b-c')

        const tratamientoLabel = salida.tratamiento_seleccionado
          ? (TRATAMIENTO_LABELS[salida.tratamiento_seleccionado] || salida.tratamiento_seleccionado)
          : 'N/A'

        h1 = crearCelda(leftX, yPos, col2, 'TRATAMIENTO SELECCIONADO', tratamientoLabel)
        h2 = crearCelda(leftX + col2, yPos, col2, 'AUTORIDAD QUE DECIDIÓ', val(salida.autoridad_disposicion))
        yPos += Math.max(h1, h2)

        // Descripción acción tomada
        yPos += crearCelda(leftX, yPos, contentWidth, 'DESCRIPCIÓN DE LA ACCIÓN TOMADA', val(salida.descripcion_accion_tomada), true)

        // Responsable | Fecha implementación
        h1 = crearCelda(leftX, yPos, col2, 'RESPONSABLE DE LA ACCIÓN', val(salida.responsable_accion))
        h2 = crearCelda(leftX + col2, yPos, col2, 'FECHA DE IMPLEMENTACIÓN', formatearFecha(salida.fecha_implementacion))
        yPos += Math.max(h1, h2)

        yPos += 6

        // ══════════════════════════════════════════════
        // SECCIÓN 4: CONCESIÓN (solo si aplica)
        // ══════════════════════════════════════════════

        if (salida.tratamiento_seleccionado === 'CONCESION' || salida.concesion_solicitada) {
          checkPage(80)
          yPos += seccionHeader('CONCESIÓN FORMAL DEL CLIENTE', '4', yPos, 'ISO 8.7.1 d / 8.7.2 c')

          h1 = crearCelda(leftX, yPos, col3, '¿SE SOLICITÓ CONCESIÓN?', salida.concesion_solicitada ? 'SÍ' : 'NO')
          h2 = crearCelda(leftX + col3, yPos, col3, 'REPRESENTANTE CLIENTE', val(salida.concesion_cliente_nombre))
          h3 = crearCelda(leftX + col3 * 2, yPos, col3, 'FECHA AUTORIZACIÓN', formatearFecha(salida.concesion_cliente_fecha))
          yPos += Math.max(h1, h2, h3)

          h1 = crearCelda(leftX, yPos, col2, 'MEDIO DE AUTORIZACIÓN', salida.concesion_medio ? (MEDIO_AUTORIZACION_LABELS[salida.concesion_medio] || salida.concesion_medio) : 'N/A')
          h2 = crearCelda(leftX + col2, yPos, col2, 'CONDICIONES DE LA CONCESIÓN', val(salida.condiciones_concesion), true)
          yPos += Math.max(h1, h2)

          yPos += 6
        }

        // ══════════════════════════════════════════════
        // SECCIÓN 5: VERIFICACIÓN DE CONFORMIDAD
        // ══════════════════════════════════════════════

        checkPage(100)
        const secNum = (salida.tratamiento_seleccionado === 'CONCESION' || salida.concesion_solicitada) ? '5' : '4'
        yPos += seccionHeader('VERIFICACIÓN DE CONFORMIDAD POST-CORRECCIÓN', secNum, yPos, 'ISO 8.7.1 párrafo final')

        const metodoLabel = salida.metodo_verificacion === 'OTRO' && salida.metodo_verificacion_otro
          ? `Otro: ${salida.metodo_verificacion_otro}`
          : salida.metodo_verificacion
            ? (METODO_VERIFICACION_LABELS[salida.metodo_verificacion] || salida.metodo_verificacion)
            : 'N/A'

        h1 = crearCelda(leftX, yPos, col2, 'MÉTODO DE VERIFICACIÓN', metodoLabel)

        let cumpleLabel = 'N/A'
        if (salida.cumple_requisitos === true) cumpleLabel = '✓ SÍ — Cierre de la SNC'
        else if (salida.cumple_requisitos === false) cumpleLabel = '✗ NO — Escalar AC'

        h2 = crearCelda(leftX + col2, yPos, col2, '¿CUMPLE REQUISITOS?', cumpleLabel)
        yPos += Math.max(h1, h2)

        // Resultado verificación
        yPos += crearCelda(leftX, yPos, contentWidth, 'RESULTADO DE LA VERIFICACIÓN', val(salida.resultado_verificacion), true)

        // Responsable | Fecha | Firma
        h1 = crearCelda(leftX, yPos, col3, 'RESPONSABLE VERIFICACIÓN', val(salida.responsable_verificacion))
        h2 = crearCelda(leftX + col3, yPos, col3, 'FECHA VERIFICACIÓN', formatearFecha(salida.fecha_verificacion))
        h3 = crearCelda(leftX + col3 * 2, yPos, col3, 'FIRMA VERIFICADOR', val(salida.firma_verificacion))
        yPos += Math.max(h1, h2, h3)

        yPos += 10

        // ══════════════════════════════════════════════
        // FOOTER: Nota ISO
        // ══════════════════════════════════════════════

        checkPage(30)
        doc.fontSize(6).font('Helvetica').fillColor('#9CA3AF')
          .text(
            'Registro de Salida No Conforme según ISO 9001:2015 — Cláusula 8.7 Control de las Salidas No Conformes',
            leftX, yPos, { width: contentWidth, align: 'center' }
          )

        doc.end()
      } catch (error) {
        console.error('Error generando PDF SNC:', error)
        reject(error)
      }
    })
  }
}
