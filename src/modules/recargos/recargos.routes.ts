import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { RecargosController } from './recargos.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { prisma } from '../../config/prisma'
import { randomUUID } from 'crypto'

export async function recargosRoutes(fastify: FastifyInstance) {
  // Aplicar middleware de autenticación a TODAS las rutas de recargos
  fastify.addHook('onRequest', authMiddleware)
  
  // Obtener tipos de recargo (debe ir primero para evitar conflicto con /:id)
  fastify.get('/recargos/tipos-recargo/activos', RecargosController.obtenerTiposRecargo)

  // Obtener estadísticas (debe ir antes de /:id)
  fastify.get('/recargos/estadisticas/resumen', RecargosController.obtenerEstadisticas)
  
  // Obtener recargos para canvas (con filtros)
  fastify.get('/recargos', RecargosController.obtenerParaCanvas)

  // Siguiente número de planilla libre (auto-generación en ModalFormRecargo).
  // Va antes de /:id para que no se confunda con el GET de un recargo específico.
  fastify.get('/recargos/next-numero-planilla', RecargosController.obtenerSiguienteNumeroPlanilla)

  // Obtener un recargo por ID
  fastify.get('/recargos/:id', RecargosController.obtenerPorId)

  // Obtener un reporte de mes y año
  fastify.get('/recargos/reporte', RecargosController.reportePdf)

  // Crear recargo
  fastify.post('/recargos', RecargosController.crear)

  // Actualizar recargo
  fastify.put('/recargos/:id', RecargosController.actualizar)

  // Eliminar recargo (soft delete)
  fastify.delete('/recargos/:id', RecargosController.eliminar)

  // Eliminar múltiples recargos (soft delete)
  fastify.post('/recargos/eliminar-multiple', RecargosController.eliminarMultiple)

  // Restaurar recargo
  fastify.patch('/recargos/restaurar/:id', RecargosController.restaurar)

  // Restaurar múltiples recargos
  fastify.post('/recargos/restaurar-multiple', RecargosController.restaurarMultiple)

  // Cambiar estado de múltiples recargos
  fastify.patch('/recargos/cambiar-estado-multiple', RecargosController.cambiarEstadoMultiple)

  // Liquidar recargo
  fastify.post('/recargos/:id/liquidar', RecargosController.liquidar)

  // Duplicar recargo
  fastify.post('/recargos/:id/duplicar', RecargosController.duplicar)

  // Recalcular un recargo existente con la config salarial y % de tipos
  // vigentes en cada día. Útil cuando cambian tarifarios y se quiere
  // aplicar el recálculo a planillas ya creadas.
  fastify.post('/recargos/:id/recalcular', RecargosController.recalcular)

  // Recalcular MÚLTIPLES recargos en bulk. Retorna inmediatamente con
  // `{ batchId, total }` y procesa en background, emitiendo progress
  // events al room del usuario. El cliente persiste el batchId en
  // localStorage para reanudar tras recarga de página.
  fastify.post('/recargos/recalcular-bulk', RecargosController.recalcularBulk)

  // Consultar el estado de un batch bulk (para reanudar UI tras
  // recarga de página). Retorna 404 si no existe o si ya fue purgado.
  fastify.get('/recargos/recalcular-bulk/:batchId', RecargosController.getBatchStatus)

  // ═══════════════════════════════════════════════════════════
  // IMPORTAR DESDE TRANSMERALDA
  //
  // Va DESPUÉS de /recalcular-bulk/:batchId para que el `batchId` no se
  // confunda con un segment estático de la ruta.
  // ═══════════════════════════════════════════════════════════

  // Sincronizar conductores Cotransmeq en Transmeralda (marca inactivos
  // a quienes no tengan liquidaciones en 2026). Idempotente.
  // Va antes de los otros para que el operador pueda ejecutarlo una vez
  // antes de pedir el preview.
  fastify.post(
    '/recargos/importar-desde-transmeralda/sincronizar-conductores-cotransmeq',
    RecargosController.sincronizarConductoresCotransmeqTransmeralda,
  )

  // Preview de planillas importables (POST con body, GET con query — el
  // controller acepta ambos). Filtra por mes/año en Transmeralda.
  fastify.post(
    '/recargos/importar-desde-transmeralda/preview',
    RecargosController.previewImportarTransmeralda,
  )
  // Mismo endpoint accesible por GET (conveniencia para el botón del page
  // que podría querer disparar el preview también por query string).
  fastify.get(
    '/recargos/importar-desde-transmeralda/preview',
    RecargosController.previewImportarTransmeralda,
  )

  // Crea en Cotransmeq las placas y empresas que faltan en el preview.
  // NO importa planillas — solo entidades. POST con body { mes, año }.
  fastify.post(
    '/recargos/importar-desde-transmeralda/crear-entidades-faltantes',
    RecargosController.crearEntidadesFaltantesTransmeralda,
  )

  // Ejecuta la importación de las planillas seleccionadas.
  fastify.post(
    '/recargos/importar-desde-transmeralda',
    RecargosController.importarDesdeTransmeralda,
  )

  // ═══════════════════════════════════════════════════════════
  // CONFIGURACIONES SALARIOS RECARGOS — CRUD + Socket
  // ═══════════════════════════════════════════════════════════

  // GET /api/recargos/configuraciones-salarios — Listar todas
  fastify.get('/recargos/configuraciones-salarios', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { activo, empresa_id } = request.query as { activo?: string; empresa_id?: string }

      const where: any = { deleted_at: null }
      if (activo !== undefined) where.activo = activo === 'true'
      if (empresa_id) where.empresa_id = empresa_id

      const configs = await prisma.configuraciones_salarios.findMany({
        where,
        include: {
          clientes: { select: { id: true, nombre: true, nit: true } },
          usuarios: { select: { id: true, nombre: true, correo: true } }
        },
        orderBy: [{ activo: 'desc' }, { vigencia_desde: 'desc' }]
      })

      reply.send({ success: true, data: configs })
    } catch (err: any) {
      request.log.error(err, 'Error obteniendo configuraciones salarios')
      reply.status(500).send({ success: false, message: err.message })
    }
  })

  // GET /api/recargos/configuraciones-salarios/:id — Obtener una
  fastify.get('/recargos/configuraciones-salarios/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string }
      const config = await prisma.configuraciones_salarios.findUnique({
        where: { id },
        include: {
          clientes: { select: { id: true, nombre: true, nit: true } },
          usuarios: { select: { id: true, nombre: true, correo: true } }
        }
      })
      if (!config || config.deleted_at) {
        return reply.status(404).send({ success: false, message: 'Configuración no encontrada' })
      }
      reply.send({ success: true, data: config })
    } catch (err: any) {
      request.log.error(err, 'Error obteniendo configuración salario')
      reply.status(500).send({ success: false, message: err.message })
    }
  })

  // POST /api/recargos/configuraciones-salarios — Crear
  fastify.post('/recargos/configuraciones-salarios', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any
      const userId = (request as any).user?.id

      const config = await prisma.configuraciones_salarios.create({
        data: {
          id: randomUUID(),
          empresa_id: body.empresa_id || null,
          salario_basico: body.salario_basico,
          valor_hora_trabajador: body.valor_hora_trabajador,
          horas_mensuales_base: body.horas_mensuales_base ?? 240,
          vigencia_desde: new Date(body.vigencia_desde),
          vigencia_hasta: body.vigencia_hasta ? new Date(body.vigencia_hasta) : null,
          activo: body.activo ?? true,
          observaciones: body.observaciones || null,
          paga_dias_festivos: body.paga_dias_festivos ?? false,
          porcentaje_festivos: body.porcentaje_festivos ?? 75,
          seguridad_social: body.seguridad_social ?? 0,
          administracion: body.administracion ?? 0,
          prueba_antigeno_covid: body.prueba_antigeno_covid ?? 0,
          prestaciones_sociales: body.prestaciones_sociales ?? 0,
          // Umbrales de jornada: si no se envían, usan los defaults del
          // schema (10.33 / 7.33). Son configurables por fecha para
          // soportar cambios de normativa (ej: 15-jul).
          jornada_normal_horas: body.jornada_normal_horas ?? 10.33,
          jornada_festiva_horas: body.jornada_festiva_horas ?? 7.33,
          sede: body.sede || null,
          creado_por_id: userId,
          created_at: new Date(),
          updated_at: new Date()
        },
        include: {
          clientes: { select: { id: true, nombre: true, nit: true } },
          usuarios: { select: { id: true, nombre: true, correo: true } }
        }
      })

      // Emitir socket
      const io = (request.server as any).io
      if (io) {
        io.emit('config-salario-creada', { configId: config.id, config })
      }

      reply.status(201).send({ success: true, message: 'Configuración creada', data: config })
    } catch (err: any) {
      request.log.error(err, 'Error creando configuración salario')
      reply.status(500).send({ success: false, message: err.message })
    }
  })

  // PUT /api/recargos/configuraciones-salarios/:id — Actualizar
  fastify.put('/recargos/configuraciones-salarios/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as any

      const existing = await prisma.configuraciones_salarios.findUnique({ where: { id } })
      if (!existing || existing.deleted_at) {
        return reply.status(404).send({ success: false, message: 'Configuración no encontrada' })
      }

      const updateData: any = { updated_at: new Date() }
      if (body.empresa_id !== undefined) updateData.empresa_id = body.empresa_id || null
      if (body.salario_basico !== undefined) updateData.salario_basico = body.salario_basico
      if (body.valor_hora_trabajador !== undefined) updateData.valor_hora_trabajador = body.valor_hora_trabajador
      if (body.horas_mensuales_base !== undefined) updateData.horas_mensuales_base = body.horas_mensuales_base
      if (body.vigencia_desde !== undefined) updateData.vigencia_desde = new Date(body.vigencia_desde)
      if (body.vigencia_hasta !== undefined) updateData.vigencia_hasta = body.vigencia_hasta ? new Date(body.vigencia_hasta) : null
      if (body.activo !== undefined) updateData.activo = body.activo
      if (body.observaciones !== undefined) updateData.observaciones = body.observaciones
      if (body.paga_dias_festivos !== undefined) updateData.paga_dias_festivos = body.paga_dias_festivos
      if (body.porcentaje_festivos !== undefined) updateData.porcentaje_festivos = body.porcentaje_festivos
      if (body.seguridad_social !== undefined) updateData.seguridad_social = body.seguridad_social
      if (body.administracion !== undefined) updateData.administracion = body.administracion
      if (body.prueba_antigeno_covid !== undefined) updateData.prueba_antigeno_covid = body.prueba_antigeno_covid
      if (body.prestaciones_sociales !== undefined) updateData.prestaciones_sociales = body.prestaciones_sociales
      if (body.jornada_normal_horas !== undefined) updateData.jornada_normal_horas = body.jornada_normal_horas
      if (body.jornada_festiva_horas !== undefined) updateData.jornada_festiva_horas = body.jornada_festiva_horas
      if (body.sede !== undefined) updateData.sede = body.sede || null

      const config = await prisma.configuraciones_salarios.update({
        where: { id },
        data: updateData,
        include: {
          clientes: { select: { id: true, nombre: true, nit: true } },
          usuarios: { select: { id: true, nombre: true, correo: true } }
        }
      })

      // Emitir socket
      const io = (request.server as any).io
      if (io) {
        io.emit('config-salario-actualizada', { configId: config.id, config })
      }

      reply.send({ success: true, message: 'Configuración actualizada', data: config })
    } catch (err: any) {
      request.log.error(err, 'Error actualizando configuración salario')
      reply.status(500).send({ success: false, message: err.message })
    }
  })

  // DELETE /api/recargos/configuraciones-salarios/:id — Soft delete
  fastify.delete('/recargos/configuraciones-salarios/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string }

      const existing = await prisma.configuraciones_salarios.findUnique({ where: { id } })
      if (!existing || existing.deleted_at) {
        return reply.status(404).send({ success: false, message: 'Configuración no encontrada' })
      }

      await prisma.configuraciones_salarios.update({
        where: { id },
        data: { deleted_at: new Date(), activo: false, updated_at: new Date() }
      })

      // Emitir socket
      const io = (request.server as any).io
      if (io) {
        io.emit('config-salario-eliminada', { configId: id })
      }

      reply.send({ success: true, message: 'Configuración eliminada' })
    } catch (err: any) {
      request.log.error(err, 'Error eliminando configuración salario')
      reply.status(500).send({ success: false, message: err.message })
    }
  })

  // GET /api/recargos/empresas-disponibles — Empresas para select
  fastify.get('/recargos/empresas-disponibles', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const empresas = await prisma.clientes.findMany({
        where: { deletedAt: null, oculto: false },
        select: { id: true, nombre: true, nit: true },
        orderBy: { nombre: 'asc' }
      })
      reply.send({ success: true, data: empresas })
    } catch (err: any) {
      reply.status(500).send({ success: false, message: err.message })
    }
  })

  // ═══════════════════════════════════════════════════════════
  // TIPOS DE RECARGO VIGENTES — Para wizard del ModalFormRecargo
  // ═══════════════════════════════════════════════════════════

  // GET /api/recargos/tipos-recargo/vigentes?fecha=YYYY-MM-DD
  // Devuelve los tipos de recargo vigentes en una fecha concreta.
  // Si se pasa rango (?fecha_desde=...&fecha_hasta=...), devuelve TODAS las
  // versiones que aplican dentro del rango (para que la UI pueda mostrar el
  // timeline de cambios de porcentaje).
  fastify.get('/recargos/tipos-recargo/vigentes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { fecha, fecha_desde, fecha_hasta } = request.query as {
        fecha?: string;
        fecha_desde?: string;
        fecha_hasta?: string;
      }

      let fechaConsulta: Date
      let fechaMin: Date
      let fechaMax: Date

      if (fecha) {
        fechaConsulta = new Date(fecha + 'T00:00:00Z')
        fechaMin = fechaConsulta
        fechaMax = fechaConsulta
      } else if (fecha_desde && fecha_hasta) {
        fechaMin = new Date(fecha_desde + 'T00:00:00Z')
        fechaMax = new Date(fecha_hasta + 'T23:59:59Z')
      } else {
        return reply.status(400).send({
          success: false,
          message: 'Debe pasar ?fecha=YYYY-MM-DD o ?fecha_desde=...&fecha_hasta=...'
        })
      }

      const tipos = await prisma.tipos_recargos.findMany({
        where: {
          activo: true,
          deleted_at: null,
          vigencia_desde: { lte: fechaMax },
          OR: [
            { vigencia_hasta: null },
            { vigencia_hasta: { gte: fechaMin } }
          ]
        },
        orderBy: [{ codigo: 'asc' }, { vigencia_desde: 'desc' }]
      })

      reply.send({ success: true, data: tipos })
    } catch (err: any) {
      request.log.error(err, 'Error obteniendo tipos de recargo vigentes')
      reply.status(500).send({ success: false, message: err.message })
    }
  })

  // GET /api/recargos/configuraciones-salarios/vigentes?empresa_id=...&fecha=YYYY-MM-DD
  // Devuelve la config salarial vigente para una empresa y fecha.
  fastify.get('/recargos/configuraciones-salarios/vigentes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { empresa_id, fecha } = request.query as { empresa_id?: string; fecha: string }

      if (!fecha) {
        return reply.status(400).send({
          success: false,
          message: 'Debe pasar ?fecha=YYYY-MM-DD'
        })
      }

      const fechaConsulta = new Date(fecha + 'T12:00:00Z')

      const configs = await prisma.configuraciones_salarios.findMany({
        where: {
          activo: true,
          deleted_at: null,
          vigencia_desde: { lte: fechaConsulta },
          OR: [
            { vigencia_hasta: null },
            { vigencia_hasta: { gte: fechaConsulta } }
          ]
        },
        orderBy: [{ empresa_id: 'desc' }, { vigencia_desde: 'desc' }]
      })

      // Prioridad: específica de la empresa > base
      const config =
        configs.find((c) => c.empresa_id === empresa_id) ||
        configs.find((c) => c.empresa_id === null) ||
        null

      reply.send({ success: true, data: config })
    } catch (err: any) {
      request.log.error(err, 'Error obteniendo config salarial vigente')
      reply.status(500).send({ success: false, message: err.message })
    }
  })
}
