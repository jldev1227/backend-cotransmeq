import cron, { ScheduledTask } from 'node-cron'
import { prisma } from '../config/prisma'

/**
 * Servicio de CRON para tareas programadas
 * 
 * Tareas implementadas:
 * - Actualizar servicios planificados a "en_curso" cuando llega su fecha de realización
 */

export class CronService {
  private static tasks: ScheduledTask[] = []

  /**
   * Inicia todos los CRON jobs
   */
  static start() {
    console.log('🕐 [CRON] Iniciando tareas programadas...')

    // CRON 1: Actualizar servicios planificados cada hora
    const updateServiciosTask = cron.schedule('0 * * * *', async () => {
      await this.actualizarServiciosPlanificados()
    })

    this.tasks.push(updateServiciosTask)

    console.log('✅ [CRON] Tareas programadas iniciadas:')
    console.log('   - Actualización de servicios planificados: cada hora')
    console.log('')
  }

  /**
   * Detiene todos los CRON jobs
   */
  static stop() {
    console.log('🛑 [CRON] Deteniendo tareas programadas...')
    this.tasks.forEach(task => task.stop())
    this.tasks = []
  }

  /**
   * Actualiza servicios planificados a "en_curso" cuando su fecha de realización es igual o anterior a ahora
   */
  private static async actualizarServiciosPlanificados() {
    try {
      const ahora = new Date()
      console.log(`\n⏰ [CRON] Ejecutando actualización de servicios planificados - ${ahora.toISOString()}`)

      // Buscar servicios planificados con fecha de realización igual o anterior a ahora
      const serviciosPendientes = await prisma.servicio.findMany({
        where: {
          estado: 'planificado',
          fecha_realizacion: {
            lte: ahora // Menor o igual a ahora
          }
        },
        select: {
          id: true,
          numero_planilla: true,
          fecha_realizacion: true,
          conductores: {
            select: {
              nombre: true,
              apellido: true
            }
          },
          vehiculos: {
            select: {
              placa: true
            }
          }
        }
      })

      if (serviciosPendientes.length === 0) {
        console.log('ℹ️  [CRON] No hay servicios planificados para actualizar')
        return
      }

      console.log(`📋 [CRON] Encontrados ${serviciosPendientes.length} servicio(s) para actualizar:`)

      let actualizados = 0
      let errores = 0

      // Actualizar cada servicio a "en_curso"
      for (const servicio of serviciosPendientes) {
        try {
          await prisma.servicio.update({
            where: { id: servicio.id },
            data: {
              estado: 'en_curso',
              observaciones: `Estado actualizado automáticamente por CRON el ${ahora.toLocaleString('es-CO')}`
            }
          })

          actualizados++

          const conductor = servicio.conductores
            ? `${servicio.conductores.nombre} ${servicio.conductores.apellido}`
            : 'Sin conductor'
          const vehiculo = servicio.vehiculos?.placa || 'Sin vehículo'
          const planilla = servicio.numero_planilla || 'Sin planilla'
          
          console.log(`   ✅ Servicio actualizado:`)
          console.log(`      - Planilla: ${planilla}`)
          console.log(`      - Conductor: ${conductor}`)
          console.log(`      - Vehículo: ${vehiculo}`)
          console.log(`      - Fecha realización: ${servicio.fecha_realizacion?.toLocaleString('es-CO')}`)
          console.log(`      - Estado: PLANIFICADO → EN_CURSO`)
          
        } catch (error) {
          errores++
          console.error(`   ❌ Error actualizando servicio ${servicio.id}:`, error)
        }
      }

      console.log('\n' + '='.repeat(60))
      console.log('📊 RESUMEN DE ACTUALIZACIÓN AUTOMÁTICA')
      console.log('='.repeat(60))
      console.log(`Total encontrados: ${serviciosPendientes.length}`)
      console.log(`✅ Actualizados correctamente: ${actualizados}`)
      console.log(`❌ Errores: ${errores}`)
      console.log('='.repeat(60) + '\n')

    } catch (error) {
      console.error('❌ [CRON] Error general en actualización de servicios:', error)
    }
  }

  /**
   * Ejecuta manualmente la actualización (útil para testing)
   */
  static async ejecutarActualizacionManual() {
    console.log('🔧 [CRON] Ejecutando actualización manual de servicios...')
    await this.actualizarServiciosPlanificados()
  }
}
