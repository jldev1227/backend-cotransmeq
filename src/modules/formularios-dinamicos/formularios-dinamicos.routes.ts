import type { FastifyInstance } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { prisma } from '../../config/prisma'
import { AREAS } from '../../config/permissions'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { FormulariosController } from './formularios-dinamicos.controller'
import { snapshotMetricas } from './formularios-dinamicos.observabilidad'
import { FormulariosDocumentoPdfService } from './formularios-documento-pdf.service'
import {
  destinatarioPorId,
  enviarCampana,
  enviarGuia,
  listarAudiencia
} from './formularios-campana-email.service'

/**
 * Rutas administrativas del constructor de formularios.
 *
 * `moduleId` propio (`formularios`) y no reutilizado: este módulo expone datos
 * que ningún otro expone —envíos con datos de salud, fatiga y firmas de los
 * conductores— así que su permiso tiene que poder concederse y revocarse por
 * separado. El mapa de `config/permissions.ts` lo define, y `checkAccess`
 * deniega cualquier moduleId ausente de ese mapa.
 *
 * El permiso se aplica SIEMPRE en el servidor. El guard del frontend solo
 * decide qué se pinta; quien llame a la API directamente pasa por aquí.
 *
 * Orden de declaración: las rutas literales van ANTES que las paramétricas
 * (`/asignaciones` antes de `/:formId`), porque si no Fastify resolvería
 * `/api/formularios/asignaciones` como el formulario con id "asignaciones".
 */
const MODULO = 'formularios'

export async function formulariosDinamicosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  /// Lectura: `read` alcanza para consultar el catálogo y los envíos.
  const puedeLeer = { preHandler: requirePermission(MODULO, 'read') }
  /// Escritura: `full`. Publicar una versión o asignarla cambia lo que cientos
  /// de conductores tienen que diligenciar.
  const puedeEditar = { preHandler: requirePermission(MODULO, 'full') }

  /**
   * `bodyLimit` del árbol de una versión.
   *
   * El default de Fastify es 1 MiB y el árbol serializado del preoperacional
   * FR-09 —280 campos, 385 opciones, 246 reglas— lo pasa de largo. Sin este
   * límite explícito, el autosave del builder fallaría con un `413` genérico
   * antes de llegar al handler, y el conflicto parecería un problema de red.
   *
   * 8 MiB deja margen para el formulario más grande imaginable sin abrir la
   * puerta a que alguien mande cien megas por esta ruta.
   */
  const limiteArbol = { bodyLimit: 8 * 1024 * 1024 }

  /**
   * Métricas del módulo.
   *
   * Contadores del PROCESO, no de la instalación: se reinician con el proceso y la
   * respuesta lo declara en `scope`. Sirven para responder «¿cuántos replays
   * idempotentes hubo?» sin abrir los logs, y para que un scraper futuro los lea
   * sin tocar los puntos de instrumentación.
   *
   * Detrás del permiso `read` del módulo: los contadores revelan volumen de
   * operación y no deben ser públicos.
   */
  app.get('/formularios/metricas', puedeLeer, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return reply.send({ success: true, data: snapshotMetricas() })
  })

  // ── Comunicación de lanzamiento al Portal del Conductor ────────────────
  // Cada mensaje se envía individualmente porque contiene un token privado.
  app.get('/formularios/campana-portal/audiencia', puedeLeer, async (request, reply) => {
    try {
      const { periodo } = request.query as { periodo?: string }
      const data = await listarAudiencia(periodo)
      return reply.send({ success: true, data, meta: { total: data.destinatarios.length } })
    } catch (error) {
      return reply.status(400).send({ success: false, error: { code: 'CAMPAIGN_INVALID', message: error instanceof Error ? error.message : 'Solicitud inválida.' } })
    }
  })

  app.post('/formularios/campana-portal/test', puedeEditar, async (request, reply) => {
    try {
      const { conductorId, to } = request.body as { conductorId?: string; to?: string }
      if (!conductorId || !to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return reply.status(400).send({ success: false, error: { code: 'CAMPAIGN_INVALID', message: 'conductorId y to válido son obligatorios.' } })
      }
      const destinatario = await destinatarioPorId(conductorId)
      const result = await enviarGuia(destinatario, to)
      return reply.send({ success: true, data: { id: result?.id ?? null, to, conductorId, test: true } })
    } catch (error) {
      return reply.status(400).send({ success: false, error: { code: 'CAMPAIGN_SEND_FAILED', message: error instanceof Error ? error.message : 'No fue posible enviar la prueba.' } })
    }
  })

  app.post('/formularios/campana-portal/enviar', puedeEditar, async (request, reply) => {
    try {
      const { periodo, confirmacion } = request.body as { periodo?: string; confirmacion?: string }
      const data = await enviarCampana(periodo, confirmacion || '')
      return reply.send({ success: data.fallidos === 0, data })
    } catch (error) {
      return reply.status(400).send({ success: false, error: { code: 'CAMPAIGN_SEND_FAILED', message: error instanceof Error ? error.message : 'No fue posible enviar la campaña.' } })
    }
  })

  // ── Audiencia interna del asignador ──────────────────────────────────────

  /**
   * Usuarios internos activos y los cargos que existen, para el editor de
   * asignaciones.
   *
   * Endpoint propio y no `GET /api/usuarios` por dos razones. La primera es de
   * permisos: `usuarios` es `full: ['administracion']`, y quien asigna
   * formularios suele ser HSEQ, así que reutilizarlo le daría un 403 en la
   * mitad de los casos. La segunda es de superficie: el listado general
   * devuelve teléfono, rol, permisos y último acceso; aquí basta con lo que
   * pinta el desplegable.
   *
   * `cargos` sale de la misma consulta y no de una segunda: `users.cargo` es
   * texto libre, y ofrecerlo como `datalist` es lo único que evita que un target
   * `CARGO` se escriba distinto a como está en la ficha del usuario y no alcance
   * a nadie.
   */
  app.get('/formularios/audiencia/usuarios', puedeLeer, async (_request, reply) => {
    const usuarios = await prisma.usuarios.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, correo: true, cargo: true, area: true },
      orderBy: { nombre: 'asc' },
    })
    const cargos = [
      ...new Set(usuarios.map((u) => u.cargo?.trim()).filter((c): c is string => Boolean(c))),
    ].sort((a, b) => a.localeCompare(b, 'es'))
    return reply.send({ success: true, data: { usuarios, cargos, areas: AREAS } })
  })

  // ── Plantillas de cards ──────────────────────────────────────────────────
  app.get('/form-field-templates', puedeLeer, FormulariosController.listarPlantillas)
  app.post(
    '/form-field-templates',
    { ...puedeEditar, bodyLimit: 1024 * 1024 },
    FormulariosController.crearPlantilla,
  )
  app.patch(
    '/form-field-templates/:id',
    { ...puedeEditar, bodyLimit: 1024 * 1024 },
    FormulariosController.actualizarPlantilla,
  )
  app.delete('/form-field-templates/:id', puedeEditar, FormulariosController.eliminarPlantilla)

  // ── Envíos (antes de `/:formId`) ─────────────────────────────────────────
  app.get('/formularios/submissions/export.csv', puedeLeer, FormulariosController.exportarEnvios)
  app.get('/formularios/submissions/:id', puedeLeer, FormulariosController.obtenerEnvio)
  app.get('/formularios/submissions', puedeLeer, FormulariosController.listarEnvios)
  app.post('/formularios/submissions/:id/void', puedeEditar, FormulariosController.anularEnvio)

  /**
   * PDF del documento de un envío.
   *
   * Recibe el cuerpo y la hoja de estilos que el cliente YA tiene en pantalla y
   * solo pone Chromium. Es la única forma de que el PDF sea idéntico al preview
   * sin reimplementar en el servidor los diecinueve tipos de campo y su
   * disposición adaptativa; ese segundo renderizador divergiría del primero a la
   * primera modificación.
   *
   * `bodyLimit` explícito: el de Fastify es 1 MiB y un preoperacional de 131
   * ítems con su hoja de estilos lo roza. Sin esto el fallo llega como un 413
   * genérico antes de tocar el handler.
   */
  app.post(
    '/formularios/documento/pdf',
    { bodyLimit: 8 * 1024 * 1024, ...puedeLeer },
    FormulariosDocumentoPdfService.renderizar,
  )

  // ── Asignaciones (antes de `/:formId`) ───────────────────────────────────
  app.get('/formularios/asignaciones', puedeLeer, FormulariosController.listarAsignaciones)
  app.post('/formularios/asignaciones', puedeEditar, FormulariosController.crearAsignacion)
  app.get('/formularios/asignaciones/:id', puedeLeer, FormulariosController.obtenerAsignacion)
  app.patch('/formularios/asignaciones/:id', puedeEditar, FormulariosController.actualizarAsignacion)
  app.post(
    '/formularios/asignaciones/:id/pause',
    puedeEditar,
    FormulariosController.cambiarEstadoAsignacion('PAUSED'),
  )
  app.post(
    '/formularios/asignaciones/:id/resume',
    puedeEditar,
    FormulariosController.cambiarEstadoAsignacion('ACTIVE'),
  )
  app.post(
    '/formularios/asignaciones/:id/close',
    puedeEditar,
    FormulariosController.cambiarEstadoAsignacion('CLOSED'),
  )

  // ── Catálogo ─────────────────────────────────────────────────────────────
  app.get('/formularios', puedeLeer, FormulariosController.listar)
  app.post('/formularios', puedeEditar, FormulariosController.crear)
  app.get('/formularios/:formId', puedeLeer, FormulariosController.obtener)
  app.patch('/formularios/:formId', puedeEditar, FormulariosController.actualizar)
  app.delete('/formularios/:formId', puedeEditar, FormulariosController.eliminar)
  app.post('/formularios/:formId/restore', puedeEditar, FormulariosController.restaurar)
  app.post('/formularios/:formId/duplicate', puedeEditar, FormulariosController.duplicar)

  // ── Versiones ────────────────────────────────────────────────────────────
  app.get('/formularios/:formId/versions/:versionId', puedeLeer, FormulariosController.obtenerVersion)
  /// `PUT` y no `PATCH`: reemplaza el árbol completo. Un PATCH parcial sobre un
  /// árbol con reordenamientos no tiene semántica clara.
  app.put(
    '/formularios/:formId/versions/:versionId',
    { ...puedeEditar, ...limiteArbol },
    FormulariosController.guardarVersion,
  )
  app.post('/formularios/:formId/versions/:versionId/validate', puedeLeer, FormulariosController.validarVersion)
  app.post('/formularios/:formId/versions/:versionId/clone', puedeEditar, FormulariosController.clonarVersion)
  app.post('/formularios/:formId/versions/:versionId/publish', puedeEditar, FormulariosController.publicarVersion)
  app.post('/formularios/:formId/versions/:versionId/archive', puedeEditar, FormulariosController.archivarVersion)
}
