import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { CustomPlacesController } from './custom-places.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'
import { prisma } from '../../config/prisma'

/// Cambiar o borrar un lugar: quien lo creó, o quien gestiona servicios. Antes
/// cualquier sesión podía renombrar o borrar los pozos y campamentos de todos.
const gestionaServicios = requirePermission('servicios', 'full')
async function autorOGestor(request: FastifyRequest, reply: FastifyReply) {
	const { id } = request.params as { id: string }
	const lugar = await prisma.custom_places
		.findUnique({ where: { id }, select: { creado_por_id: true } })
		.catch(() => null)
	if (lugar?.creado_por_id && lugar.creado_por_id === (request as any).user?.id) return
	return gestionaServicios(request, reply)
}

export async function customPlacesRoutes(app: FastifyInstance) {
	// Todas las rutas requieren autenticación.
	// El SvelteKit proxy (/api/maps/custom-place) reenvía el Bearer token
	// del usuario en la llamada interna a NestJS.
	app.addHook('onRequest', authMiddleware)

	// IMPORTANTE: las rutas más específicas van ANTES que /:id
	app.get('/custom-places', CustomPlacesController.search)

	app.post('/custom-places', CustomPlacesController.create)

	app.get('/custom-places/:id', CustomPlacesController.findById)

	app.patch('/custom-places/:id', { preHandler: autorOGestor }, CustomPlacesController.update)

	app.delete('/custom-places/:id', { preHandler: autorOGestor }, CustomPlacesController.remove)
}
