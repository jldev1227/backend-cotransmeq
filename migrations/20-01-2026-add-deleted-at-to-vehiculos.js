const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runMigration() {
  console.log('🚀 Ejecutando migración: Add deleted_at to vehiculos...\n');

  try {
    // Ejecutar la migración SQL
    await prisma.$executeRawUnsafe(`
      ALTER TABLE vehiculos 
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    `);

    console.log('✅ Columna deleted_at agregada exitosamente');

    // Crear índice para mejor rendimiento
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_vehiculos_deleted_at ON vehiculos(deleted_at);
    `);

    console.log('✅ Índice idx_vehiculos_deleted_at creado exitosamente');

    // Agregar comentario
    await prisma.$executeRawUnsafe(`
      COMMENT ON COLUMN vehiculos.deleted_at IS 'Timestamp when the vehicle was soft deleted. NULL means the vehicle is active.';
    `);

    console.log('✅ Comentario agregado a la columna');

    console.log('\n============================================================');
    console.log('✅ MIGRACIÓN COMPLETADA EXITOSAMENTE');
    console.log('============================================================\n');
  } catch (error) {
    console.error('❌ Error al ejecutar la migración:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
