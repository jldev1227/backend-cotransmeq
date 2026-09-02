import { FastifyInstance } from "fastify";
import { LiquidacionesTercerosIngresosController } from "./liquidaciones-terceros-ingresos.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permissions.middleware";

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
  const puedeEditar = { preHandler: requirePermission(MODULO, "full") };

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
