import 'dotenv/config'
import { readdir } from 'fs/promises'
import path from 'path'
import { readFile } from 'fs/promises'
import { randomBytes } from 'crypto'
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
    // Exact inclusion test
    if (norm && candidateNorm.includes(norm)) return c

    // Fallback: check lastname and at least first name token
    const last = normalizeText(c.apellido || '')
    const firstToken = normalizeText((c.nombre || '').split(' ')[0] || '')
    if (last && candidateNorm.includes(last) && firstToken && candidateNorm.includes(firstToken)) return c

    // Fallback: any 2 tokens from conductor's name present in candidate
    const tokens = normalizeText(nameFull).split(' ').filter(Boolean)
    if (tokens.length >= 2) {
      const matches = tokens.filter(t => candidateNorm.includes(t))
      if (matches.length >= 2) return c
    }
  }
  return null
}

async function processDirectory(dirPath: string, expiresHours = 24 * 365) {
  await prisma.$connect()
  try {
    const files = await readdir(dirPath)
    const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'))
    console.log('Found PDFs:', pdfs.length)

    for (const file of pdfs) {
      const fullPath = path.join(dirPath, file)
      console.log('\nProcessing:', file)
      const buffer = await readFile(fullPath)
      const token = randomBytes(32).toString('hex')
      const s3Key = `documentos_compartidos/${token}/${file}`

      console.log('Uploading to S3:', s3Key)
      await uploadToS3(s3Key, buffer, 'application/pdf')

  // presigned URL limited to 7 days by AWS; we still store the s3_key and generate presigned URLs on-demand
  const presigned = await getS3SignedUrl(s3Key, 3600 * 24 * 7)

      const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000)

      const record = await prisma.documentos_compartidos.create({
        data: {
          token,
          filename: file,
          original_name: file,
          s3_key: s3Key,
          s3_url: presigned,
          expires_at: expiresAt,
          signed: false
        }
      })

      console.log('Created record id:', record.id)

      // Try to derive candidate name from filename. Remove trailing _RECARGOS part if present
      let candidate = file.replace(/_?recargos[_ ]?.*$/i, '')
      candidate = candidate.replace(/_?recargos.*$/i, '')
      candidate = candidate.replace(/\.pdf$/i, '')
      candidate = candidate.replace(/[_\-]+/g, ' ')
      candidate = candidate.trim()

      console.log('Candidate name for match:', candidate)
      const match = await findConductorMatch(candidate)
      if (match) {
        await prisma.documentos_compartidos.update({ where: { id: record.id }, data: { conductor_id: match.id } })
        console.log('Matched conductor:', match.nombre, match.apellido, match.numero_identificacion)
      } else {
        console.log('No match found for', file)
      }
    }

    console.log('\nDone processing directory')
  } catch (err: any) {
    console.error('Error:', err.message || err)
  } finally {
    await prisma.$disconnect()
  }
}

const dir = process.argv[2] || '/Users/julianlopez/Downloads/RECARGOS/COTRANSMEQ'
processDirectory(dir).catch(err => { console.error(err); process.exit(1) })
