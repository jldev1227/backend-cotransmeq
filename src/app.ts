import fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import multipart from '@fastify/multipart'
import staticFiles from '@fastify/static'
import * as path from 'path'
import { env } from './config/env'
import { prisma } from './config/prisma'
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
import { documentosCompartidosRoutes } from './modules/documentos/documentos-compartidos.routes'
import { evaluacionesRoutes } from './modules/evaluaciones/evaluacion.routes'
import { liquidacionesRoutes } from './modules/liquidaciones/liquidaciones.routes'
import { primasRoutes } from './modules/primas/primas.routes'
import { extractosRoutes } from './modules/extractos/extractos.routes'
import { salidasNCRoutes } from './modules/salidas-nc/salidas-nc.routes'
import { liquidacionesServiciosRoutes } from './modules/liquidaciones-servicios/liquidaciones-servicios.routes'
import { induccionesRoutes } from './modules/inducciones/inducciones.routes'
import { diasLaboradosRoutes } from './modules/dias-laborados/dias-laborados.routes'
import { desprendibleFirmaRoutes } from './modules/liquidaciones/desprendible-firma.routes'
import { conductorPortalRoutes } from './modules/conductor-portal/conductor-portal.routes'
import { pesvRoutes } from './modules/pesv/pesv.routes'
import { notificacionesRoutes } from './modules/notificaciones/notificaciones.routes'
import { actividadesPesvRoutes } from './modules/actividades-pesv/actividades-pesv.routes'
import { contabilidadRoutes } from './modules/contabilidad/contabilidad.routes'
import { certificadosTributariosRoutes } from './modules/certificados-tributarios/certificados.routes'
import { certificadosPublicosRoutes } from './modules/certificados-tributarios/certificados-public.routes'
import { tipoCertificadoRoutes } from './modules/certificados-tributarios/tipo-certificado.controller'
import { certificadoArchivoRoutes } from './modules/certificados-tributarios/certificado-archivo.controller'
import { certificacionEnvioRoutes } from './modules/certificados-tributarios/certificacion-envio.controller'
import { certificadosTerceroPublicRoutes } from './modules/certificados-tributarios/certificados-tercero-public.routes'
import { facturacionLiquidacionesRoutes } from './modules/facturacion-liquidaciones/facturacion-liquidaciones.routes'
import { tercerosRoutes } from './modules/terceros/terceros.routes'
import { sesionesRoutes } from './modules/sesiones/sesiones.routes'
import { liquidacionesTercerosRoutes } from './modules/liquidaciones-terceros/liquidaciones-terceros.routes'
import { pdfRoutes } from './modules/pdf/pdf.routes'
import { liquidacionesTercerosDescuentosRoutes } from './modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.routes'
import { invitacionesRoutes } from './modules/invitaciones/invitaciones.routes'
import { liquidacionesChatRoutes } from './modules/liquidaciones-chat/liquidaciones-chat.routes'
import { liquidacionesSnapshotsRoutes } from './modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.routes'
import { formulariosSarlaftRoutes } from './modules/formularios-sarlaft/formularios-sarlaft.routes'

export function buildApp() {
    const app = fastify({ logger: logger as any })

    app.register(helmet as any)
    app.register(multipart as any, {
        limits: {
            fileSize: 200 * 1024 * 1024 // 200MB (para ZIPs de certificados)
        }
    })
    
    // Register static files for assets (logo, etc.)
    app.register(staticFiles, {
        root: path.join(__dirname, 'assets'),
        prefix: '/assets/'
    })
    
    const defaultOrigins = [
        'http://localhost:5173',
        'http://localhost:3000',
        'https://transmeralda-app.vercel.app'
    ]

    const envOrigins = (env.FRONTEND_URL ?? '')
        .split(',')
        .map(o => o.trim())
        .filter(Boolean)

    const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]))

    app.register(cors, {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true)
            } else {
                callback(new Error('Not allowed by CORS'), false)
            }
        },
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
    app.register(induccionesRoutes, { prefix: '/api' })
    app.register(accionesCorrectivasRoutes, { prefix: '/api' })
    app.register(recargosRoutes, { prefix: '/api' })
    app.register(documentosRoutes, { prefix: '/api' })
    app.register(documentosCompartidosRoutes, { prefix: '/api' })
    app.register(evaluacionesRoutes, { prefix: '/api' })
    app.register(liquidacionesRoutes, { prefix: '/api' })
    app.register(primasRoutes, { prefix: '/api' })
    app.register(extractosRoutes, { prefix: '/api' })
    app.register(salidasNCRoutes, { prefix: '/api' })
    app.register(liquidacionesServiciosRoutes, { prefix: '/api' })
    app.register(diasLaboradosRoutes, { prefix: '/api' })
    app.register(pesvRoutes, { prefix: '/api' })
    app.register(actividadesPesvRoutes, { prefix: '/api' })
    app.register(contabilidadRoutes, { prefix: '/api' })
    app.register(certificadosTributariosRoutes, { prefix: '/api' })
    app.register(facturacionLiquidacionesRoutes, { prefix: '/api' })
    app.register(tercerosRoutes, { prefix: '/api' })
    app.register(liquidacionesTercerosRoutes, { prefix: '/api' })
    app.register(pdfRoutes, { prefix: '/api' })
    app.register(liquidacionesTercerosDescuentosRoutes, { prefix: '/api' })
    app.register(notificacionesRoutes, { prefix: '/api' })
    app.register(sesionesRoutes, { prefix: '/api' })
    app.register(invitacionesRoutes, { prefix: '/api' })
    app.register(liquidacionesChatRoutes, { prefix: '/api' })
    app.register(liquidacionesSnapshotsRoutes, { prefix: '/api' })
    
    // Rutas públicas de firma de desprendible (sin auth para conductor)
    app.register(desprendibleFirmaRoutes, { prefix: '/api' })
    
    // Portal del conductor (auth por magic link, acceso a desprendibles + días laborados)
    app.register(conductorPortalRoutes, { prefix: '/api' })

    // Portal público de certificados tributarios (sin auth)
    app.register(certificadosPublicosRoutes, { prefix: '/api' })

    // Tipos de certificado CRUD
    app.register(tipoCertificadoRoutes, { prefix: '/api' })

    // Certificado archivo (DB records + presigned URLs)
    app.register(certificadoArchivoRoutes, { prefix: '/api' })

    // Certificación envío (email + audit log)
    app.register(certificacionEnvioRoutes, { prefix: '/api' })

    // Portal público de certificaciones para terceros (token-based)
    app.register(certificadosTerceroPublicRoutes, { prefix: '/api' })

    // Formularios públicos SARLAFT + PTEE (clientes, proveedores, accionistas, personal)
    app.register(formulariosSarlaftRoutes, { prefix: '/api' })

    // sockets are initialized in server
    return app
}
