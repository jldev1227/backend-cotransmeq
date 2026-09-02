import { FastifyInstance } from 'fastify'
import { CustomPlacesController } from './custom-places.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function customPlacesRoutes(app: FastifyInstance) {
	// Todas las rutas requieren autenticación.
	// El SvelteKit proxy (/api/maps/custom-place) reenvía el Bearer token
	// del usuario en la llamada interna a NestJS.
	app.addHook('onRequest', authMiddleware)

	// IMPORTANTE: las rutas más específicas van ANTES que /:id
	app.get('/custom-places', CustomPlacesController.search)

	app.post('/custom-places', CustomPlacesController.create)

	app.get('/custom-places/:id', CustomPlacesController.findById)

	app.patch('/custom-places/:id', CustomPlacesController.update)

	app.delete('/custom-places/:id', CustomPlacesController.remove)
}
