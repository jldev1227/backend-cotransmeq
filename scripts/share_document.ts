import 'dotenv/config'
import { readFile } from 'fs/promises'
import path from 'path'
import { randomUUID, randomBytes } from 'crypto'
import { uploadToS3, getS3SignedUrl } from '../src/config/aws'
import { prisma } from '../src/config/prisma'

function normalizeText(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function findConductorMatch(candidate: string) {
  const candidateNorm = normalizeText(candidate)
  const conductores = await prisma.conductores.findMany({ select: { id: true, nombre: true, apellido: true, numero_identificacion: true } })

  for (const c of conductores) {
    const nameFull = `${c.nombre || ''} ${c.apellido || ''}`
    const norm = normalizeText(nameFull)
    if (norm && candidateNorm.includes(norm)) return c

    const last = normalizeText(c.apellido || '')
    const firstToken = normalizeText((c.nombre || '').split(' ')[0] || '')
    if (last && candidateNorm.includes(last) && firstToken && candidateNorm.includes(firstToken)) return c

    const tokens = normalizeText(nameFull).split(' ').filter(Boolean)
    if (tokens.length >= 2) {
      const matches = tokens.filter(t => candidateNorm.includes(t))
      if (matches.length >= 2) return c
    }
  }
  return null
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 1) {
    console.error('Usage: tsx scripts/share_document.ts <filePath> [expiresHours]')
    process.exit(1)
  }

  const filePath = args[0]
  // Default share token expiration: 365 days (in hours). Presigned S3 URLs are still limited to 7 days.
  const expiresHours = Number(args[1] ?? 24 * 365)

  try {
    console.log('Reading file:', filePath)
    const buffer = await readFile(filePath)
    const filename = path.basename(filePath)

    // generate token (hex) and an uuid id
    const token = randomBytes(32).toString('hex')
    const id = randomUUID()

    // s3 key
    const s3Key = `documentos_compartidos/${token}/${filename}`

    console.log('Uploading to S3 key:', s3Key)
    // assume PDF mime type; if different, user can adjust
    await uploadToS3(s3Key, buffer, 'application/pdf')

  // presigned URL for 7 days (AWS S3 presigned URL max expiry is 7 days)
  const presigned = await getS3SignedUrl(s3Key, 3600 * 24 * 7)

    // persist to database
    await prisma.$connect()

    const now = new Date()
    const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000)

    const record = await prisma.documentos_compartidos.create({
      data: {
        id,
        token,
        filename,
        original_name: filename,
        s3_key: s3Key,
        s3_url: presigned,
        expires_at: expiresAt,
        signed: false,
        created_at: now,
        updated_at: now
      }
    })

    // Try to match the conductor by deriving a candidate name from the filename
    try {
      let candidate = filename.replace(/_?recargos[_ ]?.*$/i, '')
      candidate = candidate.replace(/_?recargos.*$/i, '')
      candidate = candidate.replace(/\.pdf$/i, '')
      candidate = candidate.replace(/[_\-]+/g, ' ')
      candidate = candidate.trim()

      console.log('Candidate name for match:', candidate)
      await prisma.$connect()
      const match = await findConductorMatch(candidate)
      if (match) {
        await prisma.documentos_compartidos.update({ where: { id: record.id }, data: { conductor_id: match.id } })
        console.log('Matched conductor:', match.nombre, match.apellido, match.numero_identificacion)
      } else {
        console.log('No match found for', filename)
      }
    } catch (e) {
      console.warn('Matching error:', e)
    }
    console.log('\n=== Documento compartido creado ===')
    console.log('id:', record.id)
    console.log('token:', record.token)
    console.log('s3_key:', record.s3_key)
  console.log('presigned url (7d):', presigned)
    console.log('expires_at:', record.expires_at)

    await prisma.$disconnect()
  } catch (err: any) {
    console.error('Error:', err.message || err)
    try { await prisma.$disconnect() } catch {};
    process.exit(1)
  }
}

main()
