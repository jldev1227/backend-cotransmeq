import { FastifyInstance } from 'fastify';
import { EvaluacionesController } from './evaluacion.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { permisoPorMetodo, requirePermission } from '../../middlewares/permissions.middleware';
import { crearLimitador, HORA, MINUTO, preHandlerLimite } from '../../utils/limitador';

/// Rutas de la página pública para responder: sin sesión, quedan fuera de la guarda.
const RUTAS_PUBLICAS = new Set(['/public/evaluaciones/:id', '/evaluaciones/:id/responder', '/evaluaciones/:id/verificar']);

/// Límites de las rutas públicas, por IP. Holgados a propósito: en una
/// capacitación el grupo entero responde desde el wifi de la sede, que sale a
/// internet por una sola IP. Frenan el barrido, no a un salón lleno.
const limiteVerificar = { porIp: crearLimitador({ max: 120, ventanaMs: 15 * MINUTO }) };
/// Responder además cuenta por evaluación y documento: nadie legítimo envía
/// la misma evaluación más de unas pocas veces (un reintento por error de red,
/// una evaluación editada a mitad); probar la nota con un documento tras otro
/// sí choca con el límite por IP.
const limiteResponder = {
  porIp: crearLimitador({ max: 120, ventanaMs: HORA }),
  porClave: crearLimitador({ max: 5, ventanaMs: HORA }),
};

export async function evaluacionesRoutes(app: FastifyInstance) {
  /// Solo pedían sesión: cualquiera del equipo veía las respuestas, documentos y
  /// firmas de quienes respondieron, y podía borrar evaluaciones. Ahora exigen
  /// el módulo `evaluaciones` (administración y HSEQ).
  app.addHook('preHandler', permisoPorMetodo('evaluaciones', {}, { excepto: (patron) => RUTAS_PUBLICAS.has(patron) }));

  // ============================================
  // RUTAS PROTEGIDAS (dashboard)
  // Devuelven la clave de respuestas y los datos, documentos y firmas de
  // quienes respondieron: nunca sin autenticación.
  // ============================================
  app.get('/evaluaciones', { onRequest: authMiddleware }, EvaluacionesController.list);
  app.get('/evaluaciones/:id', { onRequest: authMiddleware }, EvaluacionesController.findById);
  app.post('/evaluaciones', { onRequest: authMiddleware }, EvaluacionesController.create);
  app.put('/evaluaciones/:id', { onRequest: authMiddleware }, EvaluacionesController.update);
  app.delete('/evaluaciones/:id', { onRequest: authMiddleware }, EvaluacionesController.delete);

  // Resultados de quienes respondieron
  app.get('/evaluaciones/:id/resultados', { onRequest: authMiddleware }, EvaluacionesController.resultados);

  app.get('/evaluaciones/:id/resultados/:resultadoId', { onRequest: authMiddleware }, EvaluacionesController.resultado);

  // Corregir las respuestas de un resultado (solo quien administra evaluaciones)
  app.put(
    '/evaluaciones/:id/resultados/:resultadoId',
    { onRequest: authMiddleware, preHandler: requirePermission('evaluaciones', 'full') },
    EvaluacionesController.actualizarRespuestas,
  );

  // Exportar resultados a PDF
  app.get('/evaluaciones/:id/exportar-pdf', { onRequest: authMiddleware }, EvaluacionesController.exportarPDF);

  // Exportar resultado individual a PDF
  app.get('/evaluaciones/:id/resultados/:resultadoId/exportar-pdf', { onRequest: authMiddleware }, EvaluacionesController.exportarPDFIndividual);

  // Exportar ZIP con todos los PDFs individuales
  app.get('/evaluaciones/:id/exportar-zip', { onRequest: authMiddleware }, EvaluacionesController.exportarZIP);

  // ============================================
  // RUTAS PÚBLICAS (página para responder la evaluación)
  // ============================================

  // La evaluación sin la clave de respuestas
  app.get('/public/evaluaciones/:id', EvaluacionesController.findPublic);

  // Responder y consultar la propia respuesta (por huella del dispositivo).
  // Solo devuelven el resultado (puntaje, aprobado, aciertos): ni la clave ni datos personales
  app.post(
    '/evaluaciones/:id/responder',
    {
      preHandler: preHandlerLimite(limiteResponder, (r) => {
        const documento = (r.body as { numero_documento?: unknown } | null)?.numero_documento;
        return typeof documento === 'string' && documento.trim()
          ? `${(r.params as { id: string }).id}:${documento.trim()}`
          : null;
      }),
    },
    EvaluacionesController.responder,
  );
  app.get(
    '/evaluaciones/:id/verificar',
    { preHandler: preHandlerLimite(limiteVerificar) },
    EvaluacionesController.verificarDispositivo,
  );
}
