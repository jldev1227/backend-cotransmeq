import { FastifyInstance } from 'fastify';
import { LiquidacionesTercerosPdfService } from './liquidaciones-terceros-pdf.service';
import { CanvasPdfService } from './canvas-pdf.service'
import { CanvasZipService } from './canvas-zip.service';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { permisoPorMetodo, requireAlgunPermiso } from '../../middlewares/permissions.middleware';

export async function liquidacionesTercerosPdfRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);
  /// Hasta oct-2026 este archivo solo pedía sesión: cualquiera del equipo (o un
  /// conductor con su enlace) leía y escribía aquí. Lectura y escritura del módulo `liquidaciones-terceros`.
  /// Escritura con limited: facturación y contabilidad también editan cierres (ver cierres-finales-estado.ts).
  app.addHook(
    'preHandler',
    permisoPorMetodo('liquidaciones-terceros', { lectura: 'limited', escritura: 'limited' }, {
      excepto: (patron) => patron.startsWith('/liquidaciones-terceros/canvas/'),
    }),
  );

  /// El PDF de un canvas también lo exporta el canvas de RECORRIDOS (que lee casi
  /// todo el equipo), no solo el de cierres: basta cualquiera de los dos permisos.
  const puedeExportarCanvas = requireAlgunPermiso(['recorridos', 'read'], ['liquidaciones-terceros', 'limited']);

  // PDF nativo de la liquidación, renderizado en el backend con
  // Puppeteer + Chromium. Reemplaza al `/api/pdf/from-html` para este
  // flujo: aprovecha la hoja Letter landscape al máximo y usa fuentes
  // embebidas (Fraunces / Inter Tight / JetBrains Mono) para mantener
  // la identidad visual del preview.
  app.get('/liquidaciones-terceros/:id/pdf', LiquidacionesTercerosPdfService.descargarPdf);

  // PDF de un CANVAS. A diferencia del anterior, el cuerpo lo compone el
  // cliente: lo que se imprime depende del mes, la hoja y las columnas que
  // el usuario haya dejado activas en el selector del preview. Aquí solo
  // se le añaden las fuentes embebidas y se pasa por Chromium.
  // Ruta bajo `/canvas/` y no `/:id/`: `:id` es un UUID de cierre y una
  // ruta hermana con literal evita que Fastify tenga que desambiguar.
  //
  // `bodyLimit` explícito: el de Fastify es 1 MiB y el cuerpo de un mes
  // con varios cientos de filas lo pasa de largo. Sin esto el fallo llega
  // como un 413 genérico antes de tocar el handler.
  app.post(
    '/liquidaciones-terceros/canvas/pdf',
    { bodyLimit: 8 * 1024 * 1024, preHandler: puedeExportarCanvas },
    CanvasPdfService.renderizar,
  );

  // Un PDF por hoja, empaquetados en un ZIP. `bodyLimit` mayor que el de arriba
  // porque aquí viajan las cuarenta hojas de un mes en una sola petición.
  app.post(
    '/liquidaciones-terceros/canvas/pdf-zip',
    { bodyLimit: 40 * 1024 * 1024, preHandler: puedeExportarCanvas },
    CanvasZipService.renderizar,
  );
}