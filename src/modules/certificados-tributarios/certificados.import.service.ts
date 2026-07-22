import AdmZip from 'adm-zip'
import { getIo } from '../../sockets'
import {
	detectarRootPrefix,
	extractNitFromFilename,
	extractTipoFromFilename,
	normalizeTipo,
	TipoCertificado
} from './certificados.helper'
import { S3ConfigError, uploadPdf } from './certificados.s3'

export interface ImportZipResult {
	jobId: string
	anio: number
	total: number
	exitosos: number
	fallidos: number
	omitidos: number
	errores: Array<{ archivo: string; motivo: string }>
	detalle: Array<{ nit: string; tipo: string; archivo: string; key: string }>
}

export type ImportProgressEvent = {
	jobId: string
	phase: 'started' | 'processing' | 'finished' | 'error'
	total?: number
	processed?: number
	current?: string
	result?: ImportZipResult
	error?: string
}

export function emitImportProgress(userId: string | null, event: ImportProgressEvent) {
	const io = getIo()
	const room = userId ? `user-${userId}` : 'certificados-import'
	io.to(room).emit('certificados:import-progress', event)
}

export async function importZip(params: {
	buffer: Buffer
	anio: number
	jobId: string
	userId: string | null
}): Promise<ImportZipResult> {
	const { buffer, anio, jobId, userId } = params

	emitImportProgress(userId, { jobId, phase: 'started', total: 0 })

	const zip = new AdmZip(buffer)
	const entries = zip.getEntries()

	const pdfEntries = entries.filter(
		(e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.pdf')
	)

	const rootPrefix = detectarRootPrefix(pdfEntries.map((e) => e.entryName))

	const result: ImportZipResult = {
		jobId,
		anio,
		total: pdfEntries.length,
		exitosos: 0,
		fallidos: 0,
		omitidos: 0,
		errores: [],
		detalle: []
	}

	emitImportProgress(userId, { jobId, phase: 'processing', total: result.total })

	let processed = 0
	for (const entry of pdfEntries) {
		processed += 1
		const relativePath = rootPrefix
			? entry.entryName.slice(rootPrefix.length)
			: entry.entryName
		const segments = relativePath.split('/').filter(Boolean)
		const filename = segments.pop() ?? entry.entryName

		const carpetaTipo = segments.length > 0 ? segments[segments.length - 1] : ''
		const tipoDetectado = extractTipoFromFilename(filename)
		const tipo: TipoCertificado = normalizeTipo(carpetaTipo) ?? tipoDetectado

		const nit = extractNitFromFilename(filename)
		if (!nit) {
			result.omitidos += 1
			result.errores.push({
				archivo: entry.entryName,
				motivo: 'No se pudo extraer NIT del nombre'
			})
			emitImportProgress(userId, {
				jobId,
				phase: 'processing',
				total: result.total,
				processed,
				current: entry.entryName
			})
			continue
		}

		try {
			const { key } = await uploadPdf({
				nit,
				anio,
				tipo,
				filename,
				contentType: 'application/pdf',
				body: entry.getData()
			})
			result.exitosos += 1
			result.detalle.push({ nit, tipo, archivo: filename, key })
		} catch (err: any) {
			if (err instanceof S3ConfigError) throw err
			result.fallidos += 1
			result.errores.push({
				archivo: filename,
				motivo: err?.message ?? 'Error desconocido'
			})
		}

		emitImportProgress(userId, {
			jobId,
			phase: 'processing',
			total: result.total,
			processed,
			current: entry.entryName
		})
	}

	emitImportProgress(userId, { jobId, phase: 'finished', result })
	return result
}
