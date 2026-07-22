/**
 * Script para sincronizar archivos existentes en S3 con la base de datos.
 * Escanea todos los archivos en certificados-tributarios/, crea registros en certificado_archivo,
 * y los vincula automáticamente a terceros por coincidencia de NIT.
 *
 * Uso: npx tsx src/scripts/sync-certificados-s3.ts
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'
import { parseS3Key } from '../modules/certificados-tributarios/certificados.helper'
import { env } from '../config/env'

const prisma = new PrismaClient()

function extractNombreFromFilename(filename: string, nit: string): string | null {
  const base = filename.replace(/\.pdf$/i, '').replace(/\.zip$/i, '')
  const nitIndex = base.indexOf(nit)
  if (nitIndex === -1) return null

  const afterNit = base.substring(nitIndex + nit.length)
  const parts = afterNit.split(/[_\-\s]+/).filter(Boolean)

  if (parts.length === 0) return null

  return parts
    .join(' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

async function syncCertificados() {
  console.log('🔄 Iniciando sincronización de certificados S3 → DB...\n')

  const client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
  })

  const bucket = env.AWS_S3_BUCKET_NAME
  const prefix = 'certificados-tributarios/'

  // 1. Listar todos los objetos en S3
  console.log('📦 Escaneando S3...')
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

  console.log(`   ${allObjects.length} archivos encontrados en S3\n`)

  // 2. Parsear cada key y extraer metadata
  const parsedFiles = allObjects
    .map((obj) => {
      if (!obj.Key) return null
      return parseS3Key(obj.Key)
    })
    .filter(Boolean) as Array<{ nit: string; anio: number; tipo: string; filename: string }>

  console.log(`   ${parsedFiles.length} archivos válidos parseados\n`)

  // 3. Obtener terceros existentes para matching
  const terceros = await prisma.terceros.findMany({
    where: { activo: true, deleted_at: null },
    select: { id: true, identificacion: true, nombre_completo: true }
  })

  const nitToTercero = new Map<string, { id: string; nombre: string }>()
  for (const t of terceros) {
    if (t.identificacion) {
      const cleanNit = t.identificacion.replace(/\D/g, '')
      nitToTercero.set(cleanNit, { id: t.id, nombre: t.nombre_completo })
    }
  }

  console.log(`   ${terceros.length} terceros activos cargados para matching`)
  console.log(`   ${nitToTercero.size} terceros con NIT válido\n`)

  // 4. Obtener tipos de certificado
  const tiposCert = await prisma.tipo_certificado.findMany({
    where: { activo: true }
  })
  const tipoByCodigo = new Map(tiposCert.map((t) => [t.codigo, t.id]))

  // 5. Procesar cada archivo
  let created = 0
  let skipped = 0
  let linked = 0
  let createdTerceros = 0
  let errors = 0

  for (const file of parsedFiles) {
    try {
      // Verificar si ya existe
      const existing = await prisma.certificado_archivo.findUnique({
        where: { s3_key: `certificados-tributarios/${file.nit}/AÑO ${file.anio}/${file.tipo}/${file.filename}` }
      })

      if (existing) {
        skipped++
        continue
      }

      // Buscar tercero por NIT
      let tercero = nitToTercero.get(file.nit)
      const tipoCertId = tipoByCodigo.get(file.tipo) || null

      // Si no existe tercero, crearlo extrayendo nombre del filename
      if (!tercero) {
        const nombreExtraido = extractNombreFromFilename(file.filename, file.nit)
        const nombreCompletado = nombreExtraido || `Tercero NIT ${file.nit}`

        const nuevoTercero = await prisma.terceros.create({
          data: {
            nombre_completo: nombreCompletado,
            identificacion: file.nit,
            tipo_persona: 'PERSONA'
          }
        })

        nitToTercero.set(file.nit, { id: nuevoTercero.id, nombre: nuevoTercero.nombre_completo })
        tercero = { id: nuevoTercero.id, nombre: nuevoTercero.nombre_completo }
        createdTerceros++
      }

      const s3Key = `certificados-tributarios/${file.nit}/AÑO ${file.anio}/${file.tipo}/${file.filename}`

      await prisma.certificado_archivo.create({
        data: {
          s3_key: s3Key,
          filename: file.filename,
          nit: file.nit,
          anio: file.anio,
          tipo: file.tipo,
          tercero_id: tercero.id,
          tipo_certificado_id: tipoCertId
        }
      })

      created++
      linked++
    } catch (err: any) {
      errors++
      console.error(`   ❌ Error procesando ${file.filename}: ${err.message}`)
    }
  }

  // 6. Auto-vincular certificados que tienen tercero_id pero no tienen vinculo explicito
  const archivosConTercero = await prisma.certificado_archivo.findMany({
    where: { tercero_id: { not: null } },
    select: { id: true, tercero_id: true }
  })

  let vinculosCreados = 0
  for (const archivo of archivosConTercero) {
    try {
      const existing = await prisma.certificado_tercero.findUnique({
        where: {
          tercero_id_certificado_id: {
            tercero_id: archivo.tercero_id!,
            certificado_id: archivo.id
          }
        }
      })

      if (!existing) {
        await prisma.certificado_tercero.create({
          data: {
            tercero_id: archivo.tercero_id!,
            certificado_id: archivo.id
          }
        })
        vinculosCreados++
      }
    } catch {
      // Ignorar duplicados
    }
  }

  console.log('\n📊 Resumen:')
  console.log(`   ✅ Certificados creados: ${created}`)
  console.log(`   ⏭️  Omitidos (ya existen): ${skipped}`)
  console.log(`   🔗 Vinculados a terceros: ${linked}`)
  console.log(`   👤 Terceros creados: ${createdTerceros}`)
  console.log(`   📎 Vínculos explícitos creados: ${vinculosCreados}`)
  console.log(`   ❌ Errores: ${errors}`)
  console.log(`\n✅ Sincronización completa!`)
}

syncCertificados()
  .catch((err) => {
    console.error('Error fatal:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
