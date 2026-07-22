import type { FastifyRequest, FastifyReply } from 'fastify'
import { InduccionesService } from './inducciones.service'
import {
  createInduccionVisitanteSchema,
  updateInduccionVisitanteSchema,
  filtrosInduccionSchema
} from './inducciones.schema'
import { getIo } from '../../sockets'
import * as XLSX from 'xlsx'

export class InduccionesController {
  /**
   * Crear un nuevo registro de inducción/reinducción de visitante
   * POST /api/inducciones
   */
  static async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = createInduccionVisitanteSchema.parse(request.body)
      // Ruta pública — el userId viene del JWT si existe, si no se usa null
      const userId = (request as any).user?.sub ?? null

      const induccion = await InduccionesService.crear(body, userId)

      try {
        const io = getIo()
        io.emit('inducciones:created', { induccion, timestamp: new Date().toISOString() })
      } catch {
        request.log.warn('Socket.io not available for event emission')
      }

      return reply.status(201).send({
        success: true,
        message: 'Inducción registrada exitosamente',
        data: induccion
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al registrar la inducción'
      })
    }
  }

  /**
   * Obtener todas las inducciones con filtros y paginación
   * GET /api/inducciones
   */
  static async obtenerTodos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const filtros = filtrosInduccionSchema.parse(request.query)
      const resultado = await InduccionesService.obtenerTodos(filtros)

      return reply.status(200).send({ success: true, ...resultado })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener las inducciones'
      })
    }
  }

  /**
   * Obtener una inducción por ID
   * GET /api/inducciones/:id
   */
  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const induccion = await InduccionesService.obtenerPorId(id)

      if (!induccion) {
        return reply.status(404).send({ success: false, message: 'Inducción no encontrada' })
      }

      return reply.status(200).send({ success: true, data: induccion })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener la inducción'
      })
    }
  }

  /**
   * Actualizar una inducción
   * PATCH /api/inducciones/:id
   */
  static async actualizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const body = updateInduccionVisitanteSchema.parse(request.body)
      const induccion = await InduccionesService.actualizar(id, body)

      try {
        const io = getIo()
        io.emit('inducciones:updated', { induccion, timestamp: new Date().toISOString() })
      } catch {
        request.log.warn('Socket.io not available for event emission')
      }

      return reply.status(200).send({
        success: true,
        message: 'Inducción actualizada exitosamente',
        data: induccion
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al actualizar la inducción'
      })
    }
  }

  /**
   * Eliminar una inducción
   * DELETE /api/inducciones/:id
   */
  static async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      await InduccionesService.eliminar(id)

      return reply.status(200).send({ success: true, message: 'Inducción eliminada exitosamente' })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al eliminar la inducción'
      })
    }
  }

  /**
   * Obtener estadísticas
   * GET /api/inducciones/estadisticas
   */
  static async obtenerEstadisticas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const estadisticas = await InduccionesService.obtenerEstadisticas()
      return reply.status(200).send({ success: true, data: estadisticas })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener estadísticas'
      })
    }
  }

  /**
   * Exportar a Excel
   * GET /api/inducciones/:id/exportar/excel
   */
  static async exportarExcel(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = await InduccionesService.exportarDatos(id)

      const workbook = XLSX.utils.book_new()

      // Hoja 1: Encabezado
      const wsHeader = XLSX.utils.aoa_to_sheet([
        ['INDUCCIÓN / REINDUCCIÓN VISITANTES'],
        [''],
        ['Código', data.codigo, '', 'Versión', data.version],
        ['Fecha', data.fecha_documento],
        [''],
        ['Sede visitada', data.sede]
      ])
      XLSX.utils.book_append_sheet(workbook, wsHeader, 'Encabezado')

      // Hoja 2: Visitante
      const wsVisitante = XLSX.utils.aoa_to_sheet([
        ['DATOS DEL VISITANTE'],
        [''],
        ['Nombre y Apellido', data.visitante.nombre],
        ['Cargo', data.visitante.cargo],
        ['C.C.', data.visitante.cedula],
        ['Entidad / Empresa', data.visitante.entidad]
      ])
      XLSX.utils.book_append_sheet(workbook, wsVisitante, 'Visitante')

      // Hoja 3: Temas informados
      const wsTemas = XLSX.utils.aoa_to_sheet([
        ['DECLARACIÓN Y REGISTRO DE VISITA'],
        [''],
        ['SÍ', 'NO', 'TEMA INFORMADO'],
        ...data.temas.map(t => [t.confirmado ? 'X' : '', !t.confirmado ? 'X' : '', t.label])
      ])
      XLSX.utils.book_append_sheet(workbook, wsTemas, 'Temas Informados')

      // Hoja 4: Resumen
      const wsResumen = XLSX.utils.aoa_to_sheet([
        ['RESUMEN'],
        [''],
        ['Conformidad general', `${data.porcentaje_conformidad}%`],
        ['Observaciones', data.observaciones ?? 'N/A'],
        ['Fecha de registro', data.created_at]
      ])
      XLSX.utils.book_append_sheet(workbook, wsResumen, 'Resumen')

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
      const fileName = `induccion_${data.visitante.nombre.replace(/[^a-zA-Z0-9]/g, '_')}_${data.fecha_documento.replace(/\//g, '-')}.xlsx`

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`)

      return reply.send(buffer)
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al exportar Excel'
      })
    }
  }

  /**
   * Exportar a PDF con HTML inline (sin PDFGeneratorService)
   * GET /api/inducciones/:id/exportar/pdf
   */
  static async exportarPDF(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = await InduccionesService.exportarDatos(id)

      const temasHtml = data.temas.map((t, i) => `
        <tr>
          <td style="text-align:center;font-weight:bold;color:${t.confirmado ? '#16a34a' : '#dc2626'}">
            ${t.confirmado ? '✓' : '✗'}
          </td>
          <td style="text-align:center;font-weight:bold;color:${!t.confirmado ? '#dc2626' : '#16a34a'}">
            ${!t.confirmado ? '✓' : ''}
          </td>
          <td style="font-size:11px">${i + 1}. ${t.label}</td>
        </tr>
      `).join('')

      const firmaVisitanteImg = data.visitante.firma
        ? `<img src="${data.visitante.firma}" style="height:48px;border:1px solid #e5e7eb;border-radius:4px;" />`
        : '<span style="color:#9ca3af">Sin firma</span>'

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 16px; }
    .header-title { font-size: 16px; font-weight: bold; color: #059669; }
    .header-meta { font-size: 10px; color: #6b7280; text-align: right; line-height: 1.6; }
    .badge { display: inline-block; background: #ecfdf5; color: #065f46; border: 1px solid #6ee7b7; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: bold; }
    .section { margin-bottom: 14px; }
    .section-title { font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .field label { font-size: 10px; color: #9ca3af; }
    .field p { font-weight: 600; color: #111; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f9fafb; font-size: 10px; text-transform: uppercase; color: #6b7280; padding: 6px 8px; text-align: left; border: 1px solid #e5e7eb; }
    td { padding: 5px 8px; border: 1px solid #e5e7eb; vertical-align: top; }
    .conformidad { background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 6px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
    .pct { font-size: 22px; font-weight: bold; color: #059669; }
    .declaration { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px 14px; font-size: 11px; color: #1e40af; margin-top: 14px; }
  </style>
</head>
<body>

  <!-- Encabezado -->
  <div class="header">
    <div>
      <div class="header-title">INDUCCIÓN / REINDUCCIÓN VISITANTES</div>
      <div style="margin-top:4px">
        <span class="badge">${data.sede}</span>
      </div>
    </div>
    <div class="header-meta">
      <div><strong>Código:</strong> ${data.codigo}</div>
      <div><strong>Versión:</strong> ${data.version}</div>
      <div><strong>Fecha:</strong> ${data.fecha_documento}</div>
    </div>
  </div>

  <!-- Datos del visitante -->
  <div class="section">
    <div class="section-title">Datos del Visitante</div>
    <div class="grid2">
      <div class="field"><label>Nombre y Apellido</label><p>${data.visitante.nombre}</p></div>
      <div class="field"><label>C.C.</label><p>${data.visitante.cedula}</p></div>
      <div class="field"><label>Cargo</label><p>${data.visitante.cargo}</p></div>
      <div class="field"><label>Entidad / Empresa</label><p>${data.visitante.entidad}</p></div>
    </div>
    <div style="margin-top:8px">
      <div class="field"><label>Firma</label><div style="margin-top:4px">${firmaVisitanteImg}</div></div>
    </div>
  </div>

  <!-- Temas informados -->
  <div class="section">
    <div class="section-title">Declaración y Registro de Visita</div>
    <table>
      <thead>
        <tr>
          <th style="width:40px">SÍ</th>
          <th style="width:40px">NO</th>
          <th>Tema Informado</th>
        </tr>
      </thead>
      <tbody>${temasHtml}</tbody>
    </table>
  </div>

  <!-- Conformidad -->
  <div class="conformidad">
    <div>
      <div style="font-size:11px;color:#6b7280">Conformidad general</div>
      <div class="pct">${data.porcentaje_conformidad}%</div>
    </div>
    <div style="font-size:11px;color:#6b7280;text-align:right">
      ${data.temas.filter(t => t.confirmado).length} / ${data.temas.length} temas confirmados
    </div>
  </div>

  ${data.observaciones ? `
  <div class="section" style="margin-top:12px">
    <div class="section-title">Observaciones</div>
    <p style="font-size:11px;color:#374151">${data.observaciones}</p>
  </div>` : ''}

  <!-- Declaración -->
  <div class="declaration">
    <strong>Declaro</strong> que COTRANSMEQ S.A.S. me suministró la información indicada en esta lista,
    que la he leído y comprendido, y que me comprometo a cumplir las normas durante mi permanencia en sus instalaciones.
  </div>

</body>
</html>`

      // Devolver HTML con header para que el browser lo imprima / descargue
      const fileName = `induccion_${data.visitante.nombre.replace(/[^a-zA-Z0-9]/g, '_')}_${data.fecha_documento.replace(/\//g, '-')}.html`

      reply.header('Content-Type', 'text/html; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`)

      return reply.send(html)
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al exportar PDF'
      })
    }
  }
}