import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function migrate() {
  console.log('🚀 Iniciando migración de formularios_asistencia...')

  try {
    // 1. Agregar nuevas columnas
    console.log('📝 Agregando nuevas columnas...')
    await prisma.$executeRawUnsafe(`
      ALTER TABLE formularios_asistencia 
      ADD COLUMN IF NOT EXISTS hora_inicio VARCHAR(5);
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE formularios_asistencia 
      ADD COLUMN IF NOT EXISTS hora_finalizacion VARCHAR(5);
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE formularios_asistencia 
      ADD COLUMN IF NOT EXISTS duracion_minutos INTEGER;
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE formularios_asistencia 
      ADD COLUMN IF NOT EXISTS tipo_evento VARCHAR(50) DEFAULT 'capacitacion' NOT NULL;
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE formularios_asistencia 
      ADD COLUMN IF NOT EXISTS tipo_evento_otro VARCHAR(255);
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE formularios_asistencia 
      ADD COLUMN IF NOT EXISTS lugar_sede VARCHAR(255);
    `)
    await prisma.$executeRawUnsafe(`
      ALTER TABLE formularios_asistencia 
      ADD COLUMN IF NOT EXISTS nombre_instructor VARCHAR(255);
    `)

    console.log('✅ Columnas agregadas exitosamente')

    // 2. Verificar si la columna descripcion existe antes de renombrar
    console.log('📝 Renombrando columna descripcion a objetivo...')
    const checkColumn = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'formularios_asistencia' 
        AND column_name = 'descripcion'
      ) as exists;`
    )

    if (checkColumn[0]?.exists) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE formularios_asistencia 
        RENAME COLUMN descripcion TO objetivo;
      `)
      console.log('✅ Columna renombrada exitosamente')
    } else {
      console.log('⚠️  Columna descripcion ya no existe (posiblemente ya fue renombrada)')
    }

    // 3. Crear índice
    console.log('📝 Creando índice en tipo_evento...')
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS formularios_asistencia_tipo_evento_idx 
      ON formularios_asistencia(tipo_evento);
    `)
    console.log('✅ Índice creado exitosamente')

    console.log('🎉 Migración completada exitosamente!')
  } catch (error) {
    console.error('❌ Error durante la migración:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

migrate()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
