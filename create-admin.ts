import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function createAdmin() {
  try {
    console.log('🔌 Conectando a la base de datos...')
    
    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash('admin123', 10)
    
    console.log('👤 Creando usuario administrador...')
    
    const now = new Date()
    
    const admin = await prisma.usuarios.upsert({
      where: { correo: 'admin@cotransmeq.com' },
      update: {},
      create: {
        id: randomUUID(),
        nombre: 'Administrador',
        correo: 'admin@cotransmeq.com',
        password: hashedPassword,
        telefono: '3001234567',
        role: 'admin',
        permisos: {
          admin: true,
          flota: true,
          nomina: true,
          servicios: true,
          conductores: true,
          vehiculos: true,
          clientes: true,
          reportes: true,
          configuracion: true
        },
        created_at: now,
        updated_at: now
      }
    })
    
    console.log('✅ Usuario administrador creado exitosamente:')
    console.log('   Email:', admin.correo)
    console.log('   Contraseña: admin123')
    console.log('   Rol:', admin.role)
    console.log('   Permisos:', JSON.stringify(admin.permisos, null, 2))
    
  } catch (error) {
    console.error('❌ Error creando administrador:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

createAdmin()
  .then(() => {
    console.log('🎉 Proceso completado')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Error fatal:', error)
    process.exit(1)
  })
