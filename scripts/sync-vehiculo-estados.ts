#!/usr/bin/env ts-node
/**
 * Script para sincronizar estados de vehículos basado en servicios activos
 * 
 * Reglas:
 * - Si el vehículo tiene algún servicio en estado "en_curso" -> SERVICIO
 * - Si no tiene servicios en curso -> DISPONIBLE
 * 
 * Uso:
 * npx ts-node scripts/sync-vehiculo-estados.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface UpdateResult {
  vehiculoId: string;
  placa: string;
  estadoAnterior: string;
  estadoNuevo: string;
}

async function syncVehiculoEstados() {
  console.log('🚀 Iniciando sincronización de estados de vehículos...\n');

  try {
    // 1. Obtener todos los vehículos
    const vehiculos = await prisma.vehiculos.findMany({
      select: {
        id: true,
        placa: true,
        estado: true,
      },
    });

    console.log(`📊 Total de vehículos encontrados: ${vehiculos.length}\n`);

    const updates: UpdateResult[] = [];
    let sinCambios = 0;
    let errores = 0;

    // 2. Para cada vehículo, verificar si tiene servicios en curso
    for (const vehiculo of vehiculos) {
      try {
        // Buscar servicios en curso para este vehículo
        const serviciosEnCurso = await prisma.servicio.count({
          where: {
            vehiculo_id: vehiculo.id,
            estado: 'en_curso',
          },
        });

        // Determinar el nuevo estado
        const nuevoEstado = serviciosEnCurso > 0 ? 'SERVICIO' : 'DISPONIBLE';
        const estadoActual = vehiculo.estado;

        // Solo actualizar si el estado es diferente
        if (estadoActual !== nuevoEstado) {
          await prisma.vehiculos.update({
            where: { id: vehiculo.id },
            data: { estado: nuevoEstado },
          });

          updates.push({
            vehiculoId: vehiculo.id,
            placa: vehiculo.placa,
            estadoAnterior: estadoActual,
            estadoNuevo: nuevoEstado,
          });

          console.log(
            `✅ ${vehiculo.placa}: ${estadoActual} -> ${nuevoEstado} (${serviciosEnCurso} servicio(s) en curso)`
          );
        } else {
          sinCambios++;
        }
      } catch (error) {
        errores++;
        console.error(`❌ Error procesando vehículo ${vehiculo.placa}:`, error);
      }
    }

    // 3. Mostrar resumen
    console.log('\n' + '='.repeat(60));
    console.log('📋 RESUMEN DE SINCRONIZACIÓN');
    console.log('='.repeat(60));
    console.log(`Total de vehículos procesados: ${vehiculos.length}`);
    console.log(`✅ Vehículos actualizados: ${updates.length}`);
    console.log(`⚪ Sin cambios: ${sinCambios}`);
    console.log(`❌ Errores: ${errores}`);
    console.log('='.repeat(60));

    // 4. Mostrar detalle de actualizaciones
    if (updates.length > 0) {
      console.log('\n📝 DETALLE DE ACTUALIZACIONES:');
      console.log('-'.repeat(60));
      updates.forEach((update) => {
        console.log(
          `  ${update.placa.padEnd(10)} | ${update.estadoAnterior.padEnd(15)} -> ${update.estadoNuevo}`
        );
      });
      console.log('-'.repeat(60));
    }

    // 5. Estadísticas finales
    const estadisticas = await prisma.vehiculos.groupBy({
      by: ['estado'],
      _count: {
        id: true,
      },
    });

    console.log('\n📊 DISTRIBUCIÓN ACTUAL DE ESTADOS:');
    console.log('-'.repeat(60));
    estadisticas.forEach((stat) => {
      console.log(`  ${stat.estado.padEnd(20)}: ${stat._count.id} vehículos`);
    });
    console.log('-'.repeat(60));

    console.log('\n✨ Sincronización completada exitosamente!\n');
  } catch (error) {
    console.error('\n❌ Error general en la sincronización:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar el script
syncVehiculoEstados()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
