import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../../config/env'
import {
	buildS3Key,
	parseS3Key,
	TipoCertificado,
	TIPOS_VALIDOS
} from './certificados.helper'

export interface DocumentoTributario {
	id: string
	nombre: string
	url: string
	tamano: number
	tipo: string
	fecha_creacion?: string
	carpeta: string
}

export interface CarpetaTributaria {
	nombre: string
	cantidad: number
}

export interface ListNitResult {
	documentos: DocumentoTributario[]
	carpetas: CarpetaTributaria[]
}

const URL_TTL_SECONDS = 3600

let cachedClient: S3Client | null = null

function getClient(): S3Client {
	if (cachedClient) return cachedClient
	cachedClient = new S3Client({
		region: env.AWS_REGION,
		credentials: {
			accessKeyId: env.AWS_ACCESS_KEY_ID,
			secretAccessKey: env.AWS_SECRET_ACCESS_KEY
		}
	})
	return cachedClient
}

function getBucket(): string {
	return env.AWS_S3_BUCKET_NAME
}

export class S3ConfigError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'S3ConfigError'
	}
}

export function assertS3Config(): void {
	if (!env.AWS_REGION || !env.AWS_S3_BUCKET_NAME || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
		throw new S3ConfigError(
			'Variables de AWS S3 incompletas. Configura AWS_REGION, AWS_S3_BUCKET_NAME, AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY.'
		)
	}
}

export async function ensureBucketExists(): Promise<void> {
	assertS3Config()
	const client = getClient()
	try {
		await client.send(new HeadBucketCommand({ Bucket: getBucket() }))
	} catch (err: any) {
		if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
			throw new S3ConfigError(`El bucket '${getBucket()}' no existe o no es accesible.`)
		}
		throw err
	}
}

function sortCarpetas(a: string, b: string): number {
	if (a === 'Sin carpeta') return 1
	if (b === 'Sin carpeta') return -1
	const yearA = parseInt(a.replace(/[^0-9]/g, ''), 10)
	const yearB = parseInt(b.replace(/[^0-9]/g, ''), 10)
	if (!isNaN(yearA) && !isNaN(yearB)) return yearB - yearA
	return a.localeCompare(b)
}

export async function listNitDocuments(nit: string): Promise<ListNitResult> {
	assertS3Config()
	const client = getClient()
	const bucket = getBucket()
	const prefix = `certificados-tributarios/${nit}/`

	const allObjects: any[] = []
	let continuationToken: string | undefined

	do {
		const res = await client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				ContinuationToken: continuationToken
			})
		)
		allObjects.push(...(res.Contents ?? []))
		continuationToken = res.NextContinuationToken
	} while (continuationToken)

	const documentos: DocumentoTributario[] = []
	const carpetasMap = new Map<string, number>()

	for (const obj of allObjects) {
		if (!obj.Key) continue
		const parsed = parseS3Key(obj.Key)
		if (!parsed) continue

		const url = await getSignedUrl(
			client,
			new GetObjectCommand({ Bucket: bucket, Key: obj.Key }),
			{ expiresIn: URL_TTL_SECONDS }
		)

		documentos.push({
			id: obj.Key,
			nombre: parsed.filename,
			url,
			tamano: obj.Size ?? 0,
			tipo: 'application/pdf',
			fecha_creacion: obj.LastModified?.toISOString(),
			carpeta: `AÑO ${parsed.anio} / ${parsed.tipo}`
		})

		const carpeta = `AÑO ${parsed.anio} / ${parsed.tipo}`
		carpetasMap.set(carpeta, (carpetasMap.get(carpeta) ?? 0) + 1)
	}

	const carpetas: CarpetaTributaria[] = Array.from(carpetasMap.entries())
		.map(([nombre, cantidad]) => ({ nombre, cantidad }))
		.sort((a, b) => sortCarpetas(a.nombre, b.nombre))

	documentos.sort((a, b) => sortCarpetas(a.carpeta, b.carpeta) || a.nombre.localeCompare(b.nombre))

	return { documentos, carpetas }
}

export interface NitSummary {
	nit: string
	total: number
	anios: string[]
}

export async function listAllNits(): Promise<NitSummary[]> {
	assertS3Config()
	const client = getClient()
	const bucket = getBucket()
	const prefix = 'certificados-tributarios/'

	const nitsMap = new Map<string, { total: number; anios: Set<string> }>()
	let continuationToken: string | undefined

	do {
		const res = await client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				Delimiter: '/',
				ContinuationToken: continuationToken
			})
		)

		for (const p of res.CommonPrefixes ?? []) {
			if (!p.Prefix) continue
			const nit = p.Prefix.replace(prefix, '').replace(/\/$/, '')
			if (!/^\d{6,15}$/.test(nit)) continue
			nitsMap.set(nit, { total: 0, anios: new Set() })
		}

		for (const obj of res.Contents ?? []) {
			if (!obj.Key) continue
			const rel = obj.Key.slice(prefix.length)
			const parts = rel.split('/')
			if (parts.length < 2) continue
			const nit = parts[0]
			if (!/^\d{6,15}$/.test(nit)) continue
			if (!nitsMap.has(nit)) nitsMap.set(nit, { total: 0, anios: new Set() })
			const e = nitsMap.get(nit)!
			e.total += 1
			if (parts[1]) e.anios.add(parts[1])
		}

		continuationToken = res.NextContinuationToken
	} while (continuationToken)

	return Array.from(nitsMap.entries())
		.map(([nit, info]) => ({
			nit,
			total: info.total,
			anios: Array.from(info.anios).sort()
		}))
		.sort((a, b) => b.total - a.total)
}

export interface UploadPdfInput {
	nit: string
	anio: number
	tipo: TipoCertificado
	filename: string
	contentType: string
	body: Buffer
}

export async function uploadPdf(input: UploadPdfInput): Promise<{ key: string; url: string }> {
	assertS3Config()
	const client = getClient()
	const bucket = getBucket()
	const key = buildS3Key(input.nit, input.anio, input.tipo, input.filename)

	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: input.body,
			ContentType: input.contentType
		})
	)

	const url = await getSignedUrl(
		client,
		new GetObjectCommand({ Bucket: bucket, Key: key }),
		{ expiresIn: URL_TTL_SECONDS }
	)

	return { key, url }
}

export async function listCarpeta(prefix: string): Promise<
	Array<{ key: string; size: number; lastModified?: string }>
> {
	assertS3Config()
	const client = getClient()
	const bucket = getBucket()
	const out: Array<{ key: string; size: number; lastModified?: string }> = []
	let continuationToken: string | undefined

	do {
		const res = await client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				ContinuationToken: continuationToken
			})
		)
		for (const obj of res.Contents ?? []) {
			if (!obj.Key) continue
			out.push({
				key: obj.Key,
				size: obj.Size ?? 0,
				lastModified: obj.LastModified?.toISOString()
			})
		}
		continuationToken = res.NextContinuationToken
	} while (continuationToken)

	return out
}
