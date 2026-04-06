/**
 * Script para recalcular TODOS los recargos de COTRANSMEQ
 * Razón: JORNADA_NORMAL cambió de 9.33 a 10.33, JORNADA_FESTIVA de 7.33 a 8.33
 * Afecta: 120 planillas, 238 días laborales, 388 detalles de recargos
 * 
 * Ejecutar con: npx tsx scripts/recalcular-todos-recargos.ts
 */

import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

// Constantes anteriores (incorrectas)
const JORNADA_ANTERIOR = {
  NORMAL: 9.33,
  FESTIVA: 7.33
}

// Nuevas constantes correctas
const HORAS_LIMITE = {
  JORNADA_NORMAL: 10.33,
  JORNADA_FESTIVA: 8.33,
  INICIO_NOCTURNO: 19,
  FIN_NOCTURNO: 6
}

interface RecargosCalculados {
  hed: number
  hen: number
  hefd: number
  hefn: number
  rndf: number
  rn: number
  rd: number
}

function calcularRecargosDia(
  hora_inicio: number,
  hora_fin: number,
  total_horas: number,
  es_domingo_o_festivo: boolean
): RecargosCalculados {
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rndf = 0, rn = 0, rd = 0

  if (total_horas <= 0) {
    return { hed, hen, hefd, hefn, rndf, rn, rd }
  }

  const jornadaOrdinaria = es_domingo_o_festivo
    ? HORAS_LIMITE.JORNADA_FESTIVA
    : HORAS_LIMITE.JORNADA_NORMAL

  function esNocturna(hora: number): boolean {
    const h = hora % 24
    return h >= HORAS_LIMITE.INICIO_NOCTURNO || h < HORAS_LIMITE.FIN_NOCTURNO
  }

  let horaActual = hora_inicio
  let horasAcumuladas = 0

  while (horaActual < hora_fin) {
    const siguienteHora = Math.min(horaActual + 0.5, hora_fin)
    const fraccion = siguienteHora - horaActual
    const nocturna = esNocturna(horaActual)
    const esExtra = horasAcumuladas >= jornadaOrdinaria

    if (es_domingo_o_festivo) {
      if (esExtra) {
        if (nocturna) hefn += fraccion
        else hefd += fraccion
      } else {
        const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas
        if (fraccion <= horasRestantesJornada) {
          if (nocturna) rndf += fraccion
          else rd += fraccion
        } else {
          const parteOrdinaria = horasRestantesJornada
          const parteExtra = fraccion - parteOrdinaria
          if (nocturna) { rndf += parteOrdinaria; hefn += parteExtra }
          else { rd += parteOrdinaria; hefd += parteExtra }
        }
      }
    } else {
      if (esExtra) {
        if (nocturna) hen += fraccion
        else hed += fraccion
      } else {
        const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas
        if (fraccion <= horasRestantesJornada) {
          if (nocturna) rn += fraccion
        } else {
          const parteOrdinaria = horasRestantesJornada
          const parteExtra = fraccion - parteOrdinaria
          if (nocturna) { rn += parteOrdinaria; hen += parteExtra }
          else { hed += parteExtra }
        }
      }
    }

    horasAcumuladas += fraccion
    horaActual = siguienteHora
  }

  return {
    hed: Math.round(hed * 100) / 100,
    hen: Math.round(hen * 100) / 100,
    hefd: Math.round(hefd * 100) / 100,
    hefn: Math.round(hefn * 100) / 100,
    rndf: Math.round(rndf * 100) / 100,
    rn: Math.round(rn * 100) / 100,
    rd: Math.round(rd * 100) / 100
  }
}

async function main() {
  console.log('🔄 RECÁLCULO MASIVO DE RECARGOS - COTRANSMEQ')
  console.log('='.repeat(60))
  console.log(`📋 Jornada Normal: ${JORNADA_ANTERIOR.NORMAL} → ${HORAS_LIMITE.JORNADA_NORMAL}`)
  console.log(`📋 Jornada Festiva: ${JORNADA_ANTERIOR.FESTIVA} → ${HORAS_LIMITE.JORNADA_FESTIVA}`)
  console.log('='.repeat(60))

  // 1. Obtener tipos de recargo
  const tiposRecargo = await prisma.tipos_recargos.findMany({
    where: { activo: true }
  })
  const tiposMap = new Map(tiposRecargo.map(t => [t.codigo, t.id]))
  console.log(`\n📊 Tipos de recargo activos: ${[...tiposMap.keys()].join(', ')}`)

  // 2. Obtener TODAS las planillas activas
  const planillas = await prisma.recargos_planillas.findMany({
    where: {
      deleted_at: null
    },
    include: {
      conductores: { select: { nombre: true } },
      dias_laborales_planillas: {
        where: { deleted_at: null },
        include: {
          detalles_recargos_dias: {
            where: { deleted_at: null },
            include: {
              tipos_recargos: true
            }
          }
        }
      }
    },
    orderBy: [
      { conductor_id: 'asc' },
      { mes: 'asc' }
    ]
  })

  console.log(`\n📋 Total planillas a procesar: ${planillas.length}`)
  const totalDias = planillas.reduce((s, p) => s + p.dias_laborales_planillas.length, 0)
  console.log(`📅 Total días laborales: ${totalDias}`)

  const now = new Date()
  let totalDiasModificados = 0
  let totalDiasSinCambio = 0
  let totalDiasDisponibles = 0
  let totalPlanillasAfectadas = 0

  for (const planilla of planillas) {
    const conductorNombre = planilla.conductores?.nombre || 'N/A'
    let planillaModificada = false
    let diasModificadosEnPlanilla = 0

    for (const dia of planilla.dias_laborales_planillas) {
      const hora_inicio = Number(dia.hora_inicio)
      const hora_fin = Number(dia.hora_fin)
      const total_horas = Number(dia.total_horas)
      const es_domingo_o_festivo = dia.es_domingo || dia.es_festivo

      // Si es disponibilidad, los recargos deben ser 0
      if (dia.disponibilidad) {
        if (dia.detalles_recargos_dias.length > 0) {
          await prisma.detalles_recargos_dias.deleteMany({
            where: { dia_laboral_id: dia.id }
          })
          planillaModificada = true
          diasModificadosEnPlanilla++
          console.log(`  🟦 [${planilla.numero_planilla}] ${conductorNombre} | Día ${dia.dia}: DISPONIBLE - eliminados ${dia.detalles_recargos_dias.length} detalles`)
        } else {
          totalDiasDisponibles++
        }
        continue
      }

      // Calcular recargos con la NUEVA jornada
      const nuevosRecargos = calcularRecargosDia(
        hora_inicio,
        hora_fin,
        total_horas,
        es_domingo_o_festivo
      )

      // Obtener recargos actuales para comparar
      const recargosActuales: Record<string, number> = {}
      for (const detalle of dia.detalles_recargos_dias) {
        if (detalle.tipos_recargos) {
          recargosActuales[detalle.tipos_recargos.codigo] = Number(detalle.horas)
        }
      }

      // Verificar si hay cambios
      const tipos = ['hed', 'hen', 'hefd', 'hefn', 'rndf', 'rn', 'rd'] as const
      let hayCambios = false
      for (const tipo of tipos) {
        const actual = recargosActuales[tipo.toUpperCase()] || 0
        const nuevo = nuevosRecargos[tipo]
        if (Math.abs(actual - nuevo) > 0.001) {
          hayCambios = true
          break
        }
      }

      if (!hayCambios) {
        totalDiasSinCambio++
        continue
      }

      planillaModificada = true
      diasModificadosEnPlanilla++

      // Mostrar cambios
      const jornadaAnterior = es_domingo_o_festivo ? JORNADA_ANTERIOR.FESTIVA : JORNADA_ANTERIOR.NORMAL
      const jornadaNueva = es_domingo_o_festivo ? HORAS_LIMITE.JORNADA_FESTIVA : HORAS_LIMITE.JORNADA_NORMAL
      
      console.log(`\n   📅 [${planilla.numero_planilla}] ${conductorNombre} | Día ${dia.dia} | ${hora_inicio}-${hora_fin} (${total_horas}h) ${es_domingo_o_festivo ? '🔴 Dom/Fest' : '🟢 Normal'}`)
      console.log(`      Jornada: ${jornadaAnterior} → ${jornadaNueva}`)

      // Actualizar horas_ordinarias del día
      const nuevasHorasOrdinarias = Math.min(total_horas, jornadaNueva)
      
      await prisma.dias_laborales_planillas.update({
        where: { id: dia.id },
        data: {
          horas_ordinarias: nuevasHorasOrdinarias,
          updated_at: now
        }
      })

      for (const tipo of tipos) {
        const codigo = tipo.toUpperCase()
        const actual = recargosActuales[codigo] || 0
        const nuevo = nuevosRecargos[tipo]
        if (actual !== nuevo || (actual > 0 && nuevo === 0) || (actual === 0 && nuevo > 0)) {
          if (actual > 0 || nuevo > 0) {
            console.log(`      ${codigo}: ${actual} → ${nuevo}`)
          }
        }
      }

      // Eliminar detalles de recargos existentes
      await prisma.detalles_recargos_dias.deleteMany({
        where: { dia_laboral_id: dia.id }
      })

      // Crear nuevos detalles
      const detallesNuevos = [
        nuevosRecargos.hed > 0 && tiposMap.has('HED') ? { id: randomUUID(), dia_laboral_id: dia.id, tipo_recargo_id: tiposMap.get('HED')!, horas: nuevosRecargos.hed, created_at: now, updated_at: now } : null,
        nuevosRecargos.hen > 0 && tiposMap.has('HEN') ? { id: randomUUID(), dia_laboral_id: dia.id, tipo_recargo_id: tiposMap.get('HEN')!, horas: nuevosRecargos.hen, created_at: now, updated_at: now } : null,
        nuevosRecargos.hefd > 0 && tiposMap.has('HEFD') ? { id: randomUUID(), dia_laboral_id: dia.id, tipo_recargo_id: tiposMap.get('HEFD')!, horas: nuevosRecargos.hefd, created_at: now, updated_at: now } : null,
        nuevosRecargos.hefn > 0 && tiposMap.has('HEFN') ? { id: randomUUID(), dia_laboral_id: dia.id, tipo_recargo_id: tiposMap.get('HEFN')!, horas: nuevosRecargos.hefn, created_at: now, updated_at: now } : null,
        nuevosRecargos.rndf > 0 && tiposMap.has('RNDF') ? { id: randomUUID(), dia_laboral_id: dia.id, tipo_recargo_id: tiposMap.get('RNDF')!, horas: nuevosRecargos.rndf, created_at: now, updated_at: now } : null,
        nuevosRecargos.rn > 0 && tiposMap.has('RN') ? { id: randomUUID(), dia_laboral_id: dia.id, tipo_recargo_id: tiposMap.get('RN')!, horas: nuevosRecargos.rn, created_at: now, updated_at: now } : null,
        nuevosRecargos.rd > 0 && tiposMap.has('RD') ? { id: randomUUID(), dia_laboral_id: dia.id, tipo_recargo_id: tiposMap.get('RD')!, horas: nuevosRecargos.rd, created_at: now, updated_at: now } : null,
      ].filter(Boolean)

      for (const detalle of detallesNuevos) {
        if (detalle) {
          await prisma.detalles_recargos_dias.create({ data: detalle as any })
        }
      }
    }

    totalDiasModificados += diasModificadosEnPlanilla

    if (planillaModificada) {
      totalPlanillasAfectadas++

      // Actualizar totales de la planilla
      const diasActualizados = await prisma.dias_laborales_planillas.findMany({
        where: { recargo_planilla_id: planilla.id, deleted_at: null },
        select: { total_horas: true, horas_ordinarias: true, disponibilidad: true }
      })

      const diasNoDisponibles = diasActualizados.filter(d => !d.disponibilidad)
      const total_dias_laborados = diasNoDisponibles.length
      const total_horas_trabajadas = diasNoDisponibles.reduce((sum, d) => sum + Number(d.total_horas), 0)
      const total_horas_ordinarias = diasNoDisponibles.reduce((sum, d) => sum + Number(d.horas_ordinarias), 0)

      await prisma.recargos_planillas.update({
        where: { id: planilla.id },
        data: {
          total_dias_laborados,
          total_horas_trabajadas,
          total_horas_ordinarias,
          updated_at: now
        }
      })

      console.log(`   📊 [${planilla.numero_planilla}] ${conductorNombre}: ${diasModificadosEnPlanilla} días modificados → ${total_dias_laborados} días, ${total_horas_trabajadas.toFixed(1)}h trabajadas, ${total_horas_ordinarias.toFixed(2)}h ordinarias`)
    }
  }

  // Resumen final
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 RESUMEN FINAL')
  console.log('='.repeat(60))
  console.log(`   📋 Planillas procesadas: ${planillas.length}`)
  console.log(`   📋 Planillas afectadas: ${totalPlanillasAfectadas}`)
  console.log(`   📅 Días modificados: ${totalDiasModificados}`)
  console.log(`   ⏭️  Días sin cambio: ${totalDiasSinCambio}`)
  console.log(`   🟦 Días disponibles (ignorados): ${totalDiasDisponibles}`)
  console.log('='.repeat(60))
  console.log('✅ Recálculo completado exitosamente')
}

main()
  .catch(e => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
