import { FastifyRequest, FastifyReply } from 'fastify'
import { ConciliacionTercerosService } from './conciliacion-terceros.service'

export class ConciliacionTercerosController {

  /**
   * POST /contabilidad/conciliacion-terceros
   * Recibe 2 archivos CSV/Excel via multipart:
   *   - contable: Movimiento auxiliar por cuenta contable
   *   - liquidaciones: Historial de liquidaciones de servicios para terceros
   */
  static async procesar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const parts = request.parts()
      let contableBuffer: Buffer | null = null
      let contableFilename = ''
      let liquidacionesBuffer: Buffer | null = null
      let liquidacionesFilename = ''

      for await (const part of parts) {
        if (part.type === 'file') {
          const buf = await part.toBuffer()
          if (part.fieldname === 'contable') {
            contableBuffer = buf
            contableFilename = part.filename || 'contable.csv'
          } else if (part.fieldname === 'liquidaciones') {
            liquidacionesBuffer = buf
            liquidacionesFilename = part.filename || 'liquidaciones.csv'
          }
        }
      }

      if (!contableBuffer) {
        return reply.status(400).send({ error: 'Falta el archivo contable (campo: contable)' })
      }
      if (!liquidacionesBuffer) {
        return reply.status(400).send({ error: 'Falta el archivo de liquidaciones (campo: liquidaciones)' })
      }

      // Parsear ambos archivos
      const registrosContables = ConciliacionTercerosService.parsearContable(contableBuffer, contableFilename)
      const registrosLiquidaciones = ConciliacionTercerosService.parsearLiquidaciones(liquidacionesBuffer, liquidacionesFilename)

      if (registrosContables.length === 0) {
        return reply.status(400).send({ error: 'El archivo contable no contiene registros válidos. Verifique el formato.' })
      }
      if (registrosLiquidaciones.length === 0) {
        return reply.status(400).send({ error: 'El archivo de liquidaciones no contiene registros válidos. Verifique el formato.' })
      }

      // Ejecutar conciliación
      const resultado = ConciliacionTercerosService.conciliar(registrosContables, registrosLiquidaciones)

      return reply.send(resultado)
    } catch (error: any) {
      console.error('Error en conciliación:', error)
      return reply.status(500).send({ error: error.message || 'Error procesando la conciliación' })
    }
  }

  /**
   * POST /contabilidad/conciliacion-terceros/excel
   * Recibe los mismos 2 archivos y retorna el Excel de conciliación
   */
  static async descargarExcel(request: FastifyRequest, reply: FastifyReply) {
    try {
      const parts = request.parts()
      let contableBuffer: Buffer | null = null
      let contableFilename = ''
      let liquidacionesBuffer: Buffer | null = null
      let liquidacionesFilename = ''

      for await (const part of parts) {
        if (part.type === 'file') {
          const buf = await part.toBuffer()
          if (part.fieldname === 'contable') {
            contableBuffer = buf
            contableFilename = part.filename || 'contable.csv'
          } else if (part.fieldname === 'liquidaciones') {
            liquidacionesBuffer = buf
            liquidacionesFilename = part.filename || 'liquidaciones.csv'
          }
        }
      }

      if (!contableBuffer || !liquidacionesBuffer) {
        return reply.status(400).send({ error: 'Se requieren ambos archivos (contable y liquidaciones)' })
      }

      const registrosContables = ConciliacionTercerosService.parsearContable(contableBuffer, contableFilename)
      const registrosLiquidaciones = ConciliacionTercerosService.parsearLiquidaciones(liquidacionesBuffer, liquidacionesFilename)

      const resultado = ConciliacionTercerosService.conciliar(registrosContables, registrosLiquidaciones)
      const excelBuffer = ConciliacionTercerosService.generarExcel(resultado)

      const now = new Date()
      const filename = `conciliacion_terceros_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.xlsx`

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(excelBuffer)
    } catch (error: any) {
      console.error('Error generando excel de conciliación:', error)
      return reply.status(500).send({ error: error.message || 'Error generando Excel' })
    }
  }
}
