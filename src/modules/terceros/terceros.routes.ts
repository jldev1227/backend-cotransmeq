import { FastifyInstance } from 'fastify';
import { TercerosController } from './terceros.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

export async function tercerosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  // ─── Rutas específicas (antes de /:id) ───
  app.post('/terceros/importar-vehiculos', TercerosController.importarDesdeVehiculos);
  app.get('/terceros/buscar', TercerosController.buscar);

  // ─── CRUD ───
  app.get('/terceros', TercerosController.obtenerTodos);
  app.post('/terceros', TercerosController.crear);
  app.get('/terceros/:id', TercerosController.obtenerPorId);
  app.put('/terceros/:id', TercerosController.actualizar);
  app.delete('/terceros/:id', TercerosController.eliminar);
}
