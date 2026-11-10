import { FastifyInstance } from "fastify";
import { LiquidacionesTercerosIngresosController } from "./liquidaciones-terceros-ingresos.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permissions.middleware";
import { IngresosSnapshotsService } from './ingresos-snapshots.service';

/**
 * Ingresos de Transmeralda — hojas «OTROS INGRESOS» y «ADICIONALES».
 *
 * Reutiliza el moduleId `liquidaciones-terceros` en vez de estrenar uno:
 * la vista no expone nada que ese módulo no exponga ya (los mismos items,
 * presentados de otra forma), y `checkAccess` deniega los moduleId
 * desconocidos, así que un id nuevo obligaría a tocar también el mapa de
 * permisos del frontend.
 *
 * La TABLA sigue siendo de solo lectura: sus filas son items de
 * `liquidacion_tercero`. Lo que se escribe es la capa de decisiones encima
 * —qué filas bajan a adicionales, con qué porcentajes, y los conceptos del
 * pie—, y por eso el guardado pide permiso de edición.
 */
const MODULO = "liquidaciones-terceros";

export async function liquidacionesTercerosIngresosRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);

  // Lectura: basta `limited` (facturación y contabilidad consultan estos
  // datos aunque no los editen).
  const puedeLeer = { preHandler: requirePermission(MODULO, "limited") };
  // Escritura: `full`, el mismo nivel que exigen los otros canvas del módulo
  // para guardar. La capa de decisiones cambia lo que se le paga al tercero.
  /// `limited` y no `full`: facturación y contabilidad también editan cierres
  /// (ver `liquidaciones-terceros-descuentos.routes.ts`).
  const puedeEditar = { preHandler: requirePermission(MODULO, "limited") };

  const periodo = (query: any) => {
    const anio = Number(query?.anio);
    const mes = Number(query?.mes);
    if (!Number.isInteger(anio) || anio < 2000 || !Number.isInteger(mes) || mes < 1 || mes > 12)
      throw new Error('Periodo inválido');
    return { anio, mes };
  };
  const responder = async (reply: any, tarea: () => Promise<any>) => {
    try { return reply.send(await tarea()); }
    catch (error: any) { return reply.status(error?.statusCode ?? (error?.message?.includes('no encontrado') ? 404 : 400)).send({ error: error?.message ?? 'Error de snapshots' }); }
  };

  app.get('/liquidaciones-terceros-ingresos/snapshots', puedeLeer,
    (request, reply) => responder(reply, () => { const { anio, mes } = periodo(request.query); return IngresosSnapshotsService.listar(anio, mes); }));
  app.post('/liquidaciones-terceros-ingresos/snapshots', puedeEditar,
    (request, reply) => responder(reply, () => { const { anio, mes } = periodo(request.body); return IngresosSnapshotsService.capturar(anio, mes, (request as any).user?.id ?? null); }));
  app.get('/liquidaciones-terceros-ingresos/snapshots/:id', puedeLeer,
    (request, reply) => responder(reply, () => IngresosSnapshotsService.obtener((request.params as any).id)));
  app.get('/liquidaciones-terceros-ingresos/snapshots/:id/diff', puedeLeer,
    (request, reply) => responder(reply, () => IngresosSnapshotsService.diff((request.params as any).id, (request.query as any)?.vs)));
  app.post('/liquidaciones-terceros-ingresos/snapshots/:id/revertir', puedeEditar,
    (request, reply) => responder(reply, () => IngresosSnapshotsService.revertir((request.params as any).id, (request as any).user?.id, (request.body as any)?.placa ?? null)));

  /// Los 12 meses de un año en una sola petición (canvas anual).
  /// Se declara ANTES que la ruta raíz para que no haya ambigüedad.
  app.get(
    "/liquidaciones-terceros-ingresos/anual",
    puedeLeer,
    LiquidacionesTercerosIngresosController.listarAnual,
  );

  /// Estado editable de un mes (sin las filas derivadas).
  app.get(
    "/liquidaciones-terceros-ingresos/estado",
    puedeLeer,
    LiquidacionesTercerosIngresosController.estadoPorPeriodo,
  );

  /// Guardado idempotente del mes. Crea la cabecera en el primer guardado,
  /// así que no hay paso previo de «generar borrador».
  app.post(
    "/liquidaciones-terceros-ingresos/guardar",
    puedeEditar,
    LiquidacionesTercerosIngresosController.guardarBorrador,
  );

  /// Lista plana de un mes/año.
  app.get(
    "/liquidaciones-terceros-ingresos",
    puedeLeer,
    LiquidacionesTercerosIngresosController.listarPorPeriodo,
  );
}
