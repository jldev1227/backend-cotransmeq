import { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { authMiddleware } from '../../middlewares/auth.middleware'
import {
	assertS3Config,
	listAllNits,
	listCarpeta,
	listNitDocuments,
	S3ConfigError,
	uploadPdf
} from './certificados.s3'
import {
	extractNitFromFilename,
	extractTipoFromFilename,
	normalizeTipo,
	TIPOS_VALIDOS,
	TipoCertificado
} from './certificados.helper'
import { importZip, emitImportProgress } from './certificados.import.service'

const anioSchema = z.coerce.number().int().min(2000).max(2100)
const tipoSchema = z.enum(TIPOS_VALIDOS as unknown as [string, ...string[]])

export async function certificadosTributariosRoutes(app: FastifyInstance) {
	app.addHook('onRequest', authMiddleware)

	app.post('/certificados-tributarios/upload', {
		schema: {
			description: 'Sube un PDF de certificado y lo guarda en S3 con la jerarquía NIT/AÑO/TIPO',
			tags: ['certificados-tributarios'],
			consumes: ['multipart/form-data']
		}
	}, async (request, reply) => {
		try {
			assertS3Config()

			let fileBuffer: Buffer | null = null
			let filename = ''
			let nitField = ''
			let anioField = ''
			let tipoField = ''

			const parts = request.parts()
			for await (const part of parts) {
				if (part.type === 'file') {
					fileBuffer = await part.toBuffer()
					filename = part.filename ?? 'archivo.pdf'
				} else if (part.fieldname === 'nit') {
					nitField = (part as any).value ?? ''
				} else if (part.fieldname === 'anio') {
					anioField = (part as any).value ?? ''
				} else if (part.fieldname === 'tipo') {
					tipoField = (part as any).value ?? ''
				}
			}

			if (!fileBuffer) return reply.status(400).send({ error: 'Archivo requerido' })
			if (!filename.toLowerCase().endsWith('.pdf')) {
				return reply.status(400).send({ error: 'Solo se permiten archivos PDF' })
			}

			const nit = (nitField || extractNitFromFilename(filename) || '').replace(/\D/g, '')
			if (!/^\d{6,15}$/.test(nit)) {
				return reply
					.status(400)
					.send({ error: 'NIT inválido. No se pudo extraer del nombre del archivo.' })
			}

			const anioParsed = anioSchema.safeParse(anioField)
			if (!anioParsed.success) {
				return reply
					.status(400)
					.send({ error: 'Año inválido. Debe ser un número entre 2000 y 2100.' })
			}

			const tipo: TipoCertificado =
				(tipoField && tipoSchema.safeParse(tipoField).success
					? (tipoField as TipoCertificado)
					: extractTipoFromFilename(filename))

			const { key, url } = await uploadPdf({
				nit,
				anio: anioParsed.data,
				tipo,
				filename,
				contentType: 'application/pdf',
				body: fileBuffer
			})

			return reply.send({
				success: true,
				nit,
				anio: anioParsed.data,
				tipo,
				archivo: filename,
				key,
				size: fileBuffer.length,
				url
			})
		} catch (err: any) {
			if (err instanceof S3ConfigError) {
				return reply.status(500).send({ error: err.message, code: 'config_error' })
			}
			console.error('Error upload PDF:', err)
			return reply
				.status(500)
				.send({ error: 'Error al subir archivo', details: err?.message })
		}
	})

	app.post('/certificados-tributarios/import-zip', {
		schema: {
			description:
				'Importa un ZIP con estructura AÑO/TIPO/*.pdf, detecta NIT del nombre y sube a S3 en background con progreso por socket',
			tags: ['certificados-tributarios'],
			consumes: ['multipart/form-data']
		}
	}, async (request, reply) => {
		try {
			assertS3Config()

			let fileBuffer: Buffer | null = null
			let filename = ''
			let anioField = ''

			const parts = request.parts()
			for await (const part of parts) {
				if (part.type === 'file') {
					fileBuffer = await part.toBuffer()
					filename = part.filename ?? 'archivo.zip'
				} else if (part.fieldname === 'anio') {
					anioField = (part as any).value ?? ''
				}
			}

			if (!fileBuffer) return reply.status(400).send({ error: 'Archivo ZIP requerido' })
			if (!filename.toLowerCase().endsWith('.zip')) {
				return reply.status(400).send({ error: 'Solo se permiten archivos .zip' })
			}

			const anioParsed = anioSchema.safeParse(anioField)
			if (!anioParsed.success) {
				return reply
					.status(400)
					.send({ error: 'Año inválido. Debe ser un número entre 2000 y 2100.' })
			}

			const jobId = randomUUID()
			const userId = (request as any).user?.id ?? null

			const result = await importZip({
				buffer: fileBuffer,
				anio: anioParsed.data,
				jobId,
				userId
			})

			return reply.send({ success: true, resumen: result })
		} catch (err: any) {
			if (err instanceof S3ConfigError) {
				return reply.status(500).send({ error: err.message, code: 'config_error' })
			}
			console.error('Error import ZIP:', err)
			return reply
				.status(500)
				.send({ error: 'Error al procesar ZIP', details: err?.message })
		}
	})

	app.get('/certificados-tributarios/nits', {
		schema: {
			description: 'Lista todos los NITs con certificados en S3',
			tags: ['certificados-tributarios']
		}
	}, async (_request, reply) => {
		try {
			const nits = await listAllNits()
			return reply.send({ success: true, nits, total: nits.length })
		} catch (err: any) {
			if (err instanceof S3ConfigError) {
				return reply.status(500).send({ error: err.message, code: 'config_error' })
			}
			console.error('Error listar NITs:', err)
			return reply
				.status(500)
				.send({ error: 'Error al listar NITs', details: err?.message })
		}
	})

	app.get('/certificados-tributarios/list', {
		schema: {
			description: 'Lista los archivos de un NIT específico',
			tags: ['certificados-tributarios']
		}
	}, async (request, reply) => {
		try {
			const nit = String((request.query as any).nit ?? '')
			if (!/^\d{6,15}$/.test(nit)) {
				return reply.status(400).send({ error: 'NIT inválido' })
			}
			const items = await listCarpeta(`certificados-tributarios/${nit}/`)

			const grouped: Record<string, typeof items> = {}
			for (const item of items) {
				const parts = item.key.split('/')
				const carpeta = parts.slice(2, -1).join('/') || 'raíz'
				if (!grouped[carpeta]) grouped[carpeta] = []
				grouped[carpeta].push(item)
			}

			return reply.send({ success: true, nit, total: items.length, carpetas: grouped })
		} catch (err: any) {
			if (err instanceof S3ConfigError) {
				return reply.status(500).send({ error: err.message, code: 'config_error' })
			}
			console.error('Error listar por NIT:', err)
			return reply
				.status(500)
				.send({ error: 'Error al listar', details: err?.message })
		}
	})

	app.get('/certificados-tributarios/:nit', {
		schema: {
			description: 'Lista los documentos (con URLs firmadas) de un NIT para el portal público',
			tags: ['certificados-tributarios']
		}
	}, async (request, reply) => {
		try {
			const nit = (request.params as any).nit
			if (!/^\d{6,15}$/.test(nit)) {
				return reply
					.status(400)
					.send({ success: false, code: 'invalid_nit', error: 'NIT inválido' })
			}
			const { documentos, carpetas } = await listNitDocuments(nit)

			if (documentos.length === 0 && carpetas.length === 0) {
				return reply
					.status(404)
					.send({
						success: false,
						code: 'not_found',
						nit,
						error: `No se encontraron certificados para el NIT ${nit}.`,
						documentos: [],
						carpetas: []
					})
			}

			return reply.send({
				success: true,
				nit,
				documentos,
				carpetas,
				total: documentos.length
			})
		} catch (err: any) {
			if (err instanceof S3ConfigError) {
				return reply.status(500).send({ error: err.message, code: 'config_error' })
			}
			console.error('Error listar documentos:', err)
			return reply
				.status(500)
				.send({ error: 'Error al obtener los certificados', details: err?.message })
		}
	})
}
