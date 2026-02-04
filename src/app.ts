import fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import * as path from 'path'
import { env } from './config/env'
import { prisma } from './config/prisma'
import { initSockets } from './sockets'
import { logger } from './utils/logger'
import { authRoutes } from './modules/auth/auth.routes'
import { usuariosRoutes } from './modules/usuarios/usuarios.routes'
import { vehiculosRoutes } from './modules/vehiculos/vehiculos.routes'
import { serviciosRoutes } from './modules/servicios/servicios.routes'
import { clientesRoutes } from './modules/clientes/clientes.routes'
import { municipiosRoutes } from './modules/municipios/municipios.routes'
import { conductoresRoutes } from './modules/conductores/conductores.routes'
import { asistenciasRoutes } from './modules/asistencias/asistencias.routes'
import { accionesCorrectivasRoutes } from './modules/acciones-correctivas/acciones-correctivas.routes'
import { recargosRoutes } from './modules/recargos/recargos.routes'
import { documentosRoutes } from './modules/documentos/documentos.routes'
import { evaluacionesRoutes } from './modules/evaluaciones/evaluacion.routes'
import { cronRoutes } from './modules/cron/cron.routes'

export function buildApp() {
    const app = fastify({ logger: logger as any })

    app.register(helmet as any)
    app.register(multipart as any, {
        limits: {
            fileSize: 5 * 1024 * 1024 // 5MB
        }
    })
    
    // Register static files for assets (logo, etc.)
    app.register(staticFiles, {
        root: path.join(__dirname, 'assets'),
        prefix: '/assets/'
    })
    
    app.register(cors, {
        origin: [
            'http://localhost:5173', 
            'http://localhost:3000',
            'https://cotransmeq-app.vercel.app'
        ],
        credentials: true
    })

    app.register(swagger as any, {
        routePrefix: '/docs',
        swagger: {
            info: { title: 'Cotransmeq API', version: '0.1.0' }
        },
        exposeRoute: true
    })

    // health
    app.get('/', async () => ({ status: 'ok' }))

    // attach prisma to request
    app.addHook('onRequest', async (request, reply) => {
        (request as any).prisma = prisma
    })

    // register auth routes without prefix (for consistency with frontend)
    app.register(authRoutes, { prefix: '/api'})
    
    // register other routes with /api prefix
    app.register(usuariosRoutes, { prefix: '/api' })
    app.register(vehiculosRoutes, { prefix: '/api' })
    app.register(serviciosRoutes, { prefix: '/api' })
    app.register(clientesRoutes, { prefix: '/api' })
    app.register(municipiosRoutes, { prefix: '/api' })
    app.register(conductoresRoutes, { prefix: '/api' })
    app.register(asistenciasRoutes, { prefix: '/api' })
    app.register(accionesCorrectivasRoutes, { prefix: '/api' })
    app.register(recargosRoutes, { prefix: '/api' })
    app.register(documentosRoutes, { prefix: '/api' })
    app.register(evaluacionesRoutes, { prefix: '/api' })
    app.register(cronRoutes, { prefix: '/api' })

    // sockets are initialized in server
    return app
}
