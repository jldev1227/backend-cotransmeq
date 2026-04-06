/**
 * Script de Migración: Transmeralda → Cotransmeq
 * 
 * Migra los días de recargos de la base de datos de Transmeralda hacia Cotransmeq
 * para los 9 conductores con liquidaciones pendientes (periodo Feb-Mar 2026).
 * 
 * Lógica:
 * 1. Conecta a ambas bases de datos
 * 2. Obtiene los días existentes en Cotransmeq para cada conductor (mes 2-3, año 2026)
 * 3. Obtiene los días en Transmeralda para los mismos conductores
 * 4. Identifica días FALTANTES comparando (conductor_id, mes, año, dia, hora_inicio, hora_fin)
 * 5. Para cada día faltante, crea la planilla (si no existe por numero_planilla) y el día con sus recargos recalculados
 * 
 * Usa JORNADA_NORMAL=10.33, JORNADA_FESTIVA=8.33
 */

import { Client } from 'pg'
import { randomUUID } from 'crypto'

// ============================================================
// CONFIGURACIÓN
// ============================================================
const COTRANSMEQ_URL = 'postgresql://Cotrans900:MEQ900**@cotransmeq.postgres.database.azure.com:5432/postgres?sslmode=require'
const TRANSMERALDA_URL = 'postgresql://postgres:Transmeralda2025@100.106.115.11:5432/transmeralda_db_18_7_2025'

const CONDUCTOR_IDS = [
  '889d93c7-24de-4038-b8cf-f7ef5c1573ee', // DAYRO RODRIGUEZ
  '05da4bcb-95ac-4ddb-9484-31dcba698008', // DIEGO FERNANDO
  '3f2be728-43c2-455e-9d27-9b333cfddac5', // HECTOR DUVAN
  'bdf569f4-1761-4158-a0da-12a2a131ec2b', // JONATHAN DAMAWER
  '825ca827-d5bd-4dc6-883a-e81b369ac75c', // JUAN SEBASTIAN
  '174954b5-9539-4369-bcf5-69d2813f7a73', // KEVIN ESNEIDER
  'c504503c-f3a1-412f-b3e9-caa53db9ae02', // OMAR SORACA
  'b7c08dc8-3bf9-44b0-8b6d-2aeedcaab1fd', // WILMER WILLERMAN JAMES
  'b6d4ec25-413f-475b-a85e-84f7a246ba5d', // YORK ESTEBAN
]

// Tipos de recargo en Cotransmeq
const TIPOS_RECARGO: Record<string, string> = {
  HED: '09ebdb5d-d4c1-47f7-9e45-5c9b7aa78c83',
  HEN: '321144e9-294f-47c9-b750-f1fe082a32d5',
  HEFD: '9714bb64-5030-468c-bb1c-b7cdd9d031b5',
  HEFN: 'b5a20064-d558-4ef4-a821-5c05e288fc34',
  RN: '5f5f5ec1-22ae-4c57-ba90-0ab95cf7268a',
  RD: '7bd9e5e6-e6c1-4fd2-a4d8-ce77db33ad82',
  RNDF: '7ae8c800-366a-41dd-8d29-d06e6002fc52',
}

// Constantes de jornada
const HORAS_LIMITE = {
  JORNADA_NORMAL: 10.33,
  JORNADA_FESTIVA: 8.33,
  INICIO_NOCTURNO: 19,
  FIN_NOCTURNO: 6,
}

// ============================================================
// CÁLCULO DE RECARGOS (idéntico al servicio)
// ============================================================
interface RecargosCalculados {
  hed: number; hen: number; hefd: number; hefn: number;
  rndf: number; rn: number; rd: number;
}

function calcularRecargosDia(
  hora_inicio: number, hora_fin: number, total_horas: number, es_domingo_o_festivo: boolean
): RecargosCalculados {
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rn = 0, rd = 0, rndf = 0

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
        if (nocturna) { hefn += fraccion } else { hefd += fraccion }
      } else {
        const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas
        if (fraccion <= horasRestantesJornada) {
          if (nocturna) { rndf += fraccion } else { rd += fraccion }
        } else {
          const parteOrdinaria = horasRestantesJornada
          const parteExtra = fraccion - parteOrdinaria
          if (nocturna) { rndf += parteOrdinaria; hefn += parteExtra }
          else { rd += parteOrdinaria; hefd += parteExtra }
        }
      }
    } else {
      if (esExtra) {
        if (nocturna) { hen += fraccion } else { hed += fraccion }
      } else {
        const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas
        if (fraccion <= horasRestantesJornada) {
          if (nocturna) { rn += fraccion }
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
    rd: Math.round(rd * 100) / 100,
  }
}

function calcularHorasOrdinarias(total_horas: number, es_domingo_o_festivo: boolean): number {
  const jornada = es_domingo_o_festivo ? HORAS_LIMITE.JORNADA_FESTIVA : HORAS_LIMITE.JORNADA_NORMAL
  return Math.round(Math.min(total_horas, jornada) * 100) / 100
}

// ============================================================
// TIPOS
// ============================================================
interface DiaKey {
  conductor_id: string
  mes: number
  anio: number
  dia: number
  hora_inicio: number
  hora_fin: number
}

interface TransmeraldaDia extends DiaKey {
  total_horas: number
  es_festivo: boolean
  es_domingo: boolean
  numero_planilla: string | null
  empresa_id: string
  vehiculo_id: string
  planilla_id: string
}

function makeDiaKey(d: DiaKey): string {
  return `${d.conductor_id}|${d.mes}|${d.anio}|${d.dia}|${d.hora_inicio}|${d.hora_fin}`
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('🚀 Iniciando migración Transmeralda → Cotransmeq')
  console.log('=' .repeat(70))

  const cotransmeq = new Client({ connectionString: COTRANSMEQ_URL })
  const transmeralda = new Client({ connectionString: TRANSMERALDA_URL })

  try {
    await cotransmeq.connect()
    console.log('✅ Conectado a Cotransmeq (Azure)')
    await transmeralda.connect()
    console.log('✅ Conectado a Transmeralda (100.106.115.11)')

    // 1. Obtener días existentes en Cotransmeq
    console.log('\n📋 Paso 1: Obteniendo días existentes en Cotransmeq...')
    const cotransmeqDiasResult = await cotransmeq.query(`
      SELECT rp.conductor_id, rp.mes, rp."año" as anio, d.dia, d.hora_inicio, d.hora_fin, d.total_horas, d.es_festivo, d.es_domingo
      FROM dias_laborales_planillas d
      JOIN recargos_planillas rp ON d.recargo_planilla_id = rp.id
      WHERE rp.conductor_id = ANY($1)
        AND rp.mes IN (2, 3)
        AND rp."año" = 2026
    `, [CONDUCTOR_IDS])

    const existingKeys = new Set<string>()
    for (const row of cotransmeqDiasResult.rows) {
      const key = makeDiaKey({
        conductor_id: row.conductor_id,
        mes: row.mes,
        anio: row.anio,
        dia: row.dia,
        hora_inicio: parseFloat(row.hora_inicio),
        hora_fin: parseFloat(row.hora_fin),
      })
      existingKeys.add(key)
    }
    console.log(`   → ${cotransmeqDiasResult.rows.length} días existentes en Cotransmeq`)
    console.log(`   → ${existingKeys.size} claves únicas`)

    // 2. Obtener días en Transmeralda
    console.log('\n📋 Paso 2: Obteniendo días de Transmeralda...')
    const transmeraldaDiasResult = await transmeralda.query(`
      SELECT rp.conductor_id, rp.mes, rp."año" as anio, rp.numero_planilla, rp.empresa_id, rp.vehiculo_id, rp.id as planilla_id,
        d.dia, d.hora_inicio, d.hora_fin, d.total_horas, d.es_festivo, d.es_domingo
      FROM dias_laborales_planillas d
      JOIN recargos_planillas rp ON d.recargo_planilla_id = rp.id
      WHERE rp.conductor_id = ANY($1)
        AND rp.mes IN (2, 3)
        AND rp."año" = 2026
      ORDER BY rp.conductor_id, rp.mes, d.dia, d.hora_inicio
    `, [CONDUCTOR_IDS])

    console.log(`   → ${transmeraldaDiasResult.rows.length} días en Transmeralda`)

    // 3. Identificar días faltantes
    console.log('\n📋 Paso 3: Identificando días faltantes...')
    const diasFaltantes: TransmeraldaDia[] = []

    for (const row of transmeraldaDiasResult.rows) {
      const key = makeDiaKey({
        conductor_id: row.conductor_id,
        mes: row.mes,
        anio: row.anio,
        dia: row.dia,
        hora_inicio: parseFloat(row.hora_inicio),
        hora_fin: parseFloat(row.hora_fin),
      })

      if (!existingKeys.has(key)) {
        diasFaltantes.push({
          conductor_id: row.conductor_id,
          mes: row.mes,
          anio: row.anio,
          dia: row.dia,
          hora_inicio: parseFloat(row.hora_inicio),
          hora_fin: parseFloat(row.hora_fin),
          total_horas: parseFloat(row.total_horas),
          es_festivo: row.es_festivo,
          es_domingo: row.es_domingo,
          numero_planilla: row.numero_planilla,
          empresa_id: row.empresa_id,
          vehiculo_id: row.vehiculo_id,
          planilla_id: row.planilla_id,
        })
      }
    }

    console.log(`   → ${diasFaltantes.length} días faltantes a migrar`)

    if (diasFaltantes.length === 0) {
      console.log('\n✅ No hay días faltantes. Todos los días ya están en Cotransmeq.')
      return
    }

    // Mostrar resumen por conductor
    const resumenPorConductor: Record<string, number> = {}
    for (const dia of diasFaltantes) {
      resumenPorConductor[dia.conductor_id] = (resumenPorConductor[dia.conductor_id] || 0) + 1
    }

    // Obtener nombres de conductores
    const conductorNombres = await cotransmeq.query(`
      SELECT id, nombre, apellido FROM conductores WHERE id = ANY($1)
    `, [CONDUCTOR_IDS])
    const nombreMap: Record<string, string> = {}
    for (const c of conductorNombres.rows) {
      nombreMap[c.id] = `${c.nombre} ${c.apellido}`
    }

    console.log('\n📊 Resumen de días faltantes por conductor:')
    for (const [conductorId, count] of Object.entries(resumenPorConductor)) {
      console.log(`   → ${nombreMap[conductorId] || conductorId}: ${count} días`)
    }

    // Listar cada día faltante
    console.log('\n📝 Días faltantes detallados:')
    for (const dia of diasFaltantes) {
      const esDomingoFestivo = dia.es_festivo || dia.es_domingo
      console.log(`   ${nombreMap[dia.conductor_id]?.padEnd(30)} | Mes ${dia.mes} Día ${String(dia.dia).padStart(2)} | ${dia.hora_inicio}-${dia.hora_fin} (${dia.total_horas}h) | ${esDomingoFestivo ? 'DOM/FEST' : 'NORMAL'} | Planilla: ${dia.numero_planilla || 'SIN'}`)
    }

    // 4. Agrupar días faltantes por planilla de origen (Transmeralda)
    //    Cada planilla de Transmeralda se migrará como una nueva planilla en Cotransmeq
    console.log('\n📋 Paso 4: Creando planillas y días en Cotransmeq...')

    // Agrupar por planilla de Transmeralda
    const porPlanilla = new Map<string, TransmeraldaDia[]>()
    for (const dia of diasFaltantes) {
      const planillaKey = dia.planilla_id
      if (!porPlanilla.has(planillaKey)) {
        porPlanilla.set(planillaKey, [])
      }
      porPlanilla.get(planillaKey)!.push(dia)
    }

    console.log(`   → ${porPlanilla.size} planillas a crear/actualizar en Cotransmeq`)

    // Verificar qué empresas de Transmeralda existen en Cotransmeq
    const empresasTransmeralda = new Set<string>()
    for (const dia of diasFaltantes) {
      empresasTransmeralda.add(dia.empresa_id)
    }

    const empresasExistentes = await cotransmeq.query(`
      SELECT id FROM empresas WHERE id = ANY($1)
    `, [Array.from(empresasTransmeralda)])
    const empresasExistentesSet = new Set(empresasExistentes.rows.map(r => r.id))

    // Empresa por defecto de Cotransmeq (FEPCO SERVICIOS S.A.S) para empresas que no existan
    const EMPRESA_DEFAULT = '6c53c8c6-633f-4c51-a1ae-7b9f7d7d7926'

    for (const empresaId of empresasTransmeralda) {
      if (!empresasExistentesSet.has(empresaId)) {
        console.log(`   ⚠️ Empresa ${empresaId} no existe en Cotransmeq, se usará FEPCO como default`)
      }
    }

    // Verificar qué vehículos existen en Cotransmeq
    const vehiculosTransmeralda = new Set<string>()
    for (const dia of diasFaltantes) {
      vehiculosTransmeralda.add(dia.vehiculo_id)
    }
    const vehiculosExistentes = await cotransmeq.query(`
      SELECT id FROM vehiculos WHERE id = ANY($1)
    `, [Array.from(vehiculosTransmeralda)])
    const vehiculosExistentesSet = new Set(vehiculosExistentes.rows.map(r => r.id))

    // Para vehículos que no existen, buscar el vehículo que usa cada conductor en planillas existentes de Cotransmeq
    const vehiculoFallbackPorConductor: Record<string, string> = {}
    const fallbackResult = await cotransmeq.query(`
      SELECT DISTINCT conductor_id, vehiculo_id
      FROM recargos_planillas
      WHERE conductor_id = ANY($1)
        AND vehiculo_id IS NOT NULL
      ORDER BY conductor_id
    `, [CONDUCTOR_IDS])
    for (const row of fallbackResult.rows) {
      if (!vehiculoFallbackPorConductor[row.conductor_id]) {
        vehiculoFallbackPorConductor[row.conductor_id] = row.vehiculo_id
      }
    }
    // Fallback global: primer vehículo que encontremos
    const VEHICULO_FALLBACK_GLOBAL = fallbackResult.rows.length > 0 ? fallbackResult.rows[0].vehiculo_id : null
    console.log(`   → Vehículos fallback por conductor cargados (${Object.keys(vehiculoFallbackPorConductor).length} conductores)`)

    let planillasCreadas = 0
    let diasCreados = 0
    let detallesCreados = 0

    // Usar transacción para atomicidad
    await cotransmeq.query('BEGIN')

    for (const [planillaTransId, dias] of porPlanilla) {
      const primerDia = dias[0]
      const empresaId = empresasExistentesSet.has(primerDia.empresa_id) 
        ? primerDia.empresa_id 
        : EMPRESA_DEFAULT
      const vehiculoId = vehiculosExistentesSet.has(primerDia.vehiculo_id) 
        ? primerDia.vehiculo_id 
        : (vehiculoFallbackPorConductor[primerDia.conductor_id] || VEHICULO_FALLBACK_GLOBAL)

      // Crear nueva planilla en Cotransmeq
      const nuevaPlanillaId = randomUUID()
      const numeroPlanilla = primerDia.numero_planilla || null

      // Calcular totales de la planilla
      let totalDias = dias.length
      let totalHorasTrabajadas = 0
      let totalHorasOrdinarias = 0

      for (const dia of dias) {
        totalHorasTrabajadas += dia.total_horas
        const esDomingoFestivo = dia.es_festivo || dia.es_domingo
        totalHorasOrdinarias += calcularHorasOrdinarias(dia.total_horas, esDomingoFestivo)
      }

      totalHorasTrabajadas = Math.round(totalHorasTrabajadas * 100) / 100
      totalHorasOrdinarias = Math.round(totalHorasOrdinarias * 100) / 100

      // INSERT planilla
      await cotransmeq.query(`
        INSERT INTO recargos_planillas (
          id, conductor_id, vehiculo_id, empresa_id, numero_planilla, mes, "año",
          total_dias_laborados, total_horas_trabajadas, total_horas_ordinarias,
          estado, version, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'activo', 1, NOW(), NOW()
        )
      `, [
        nuevaPlanillaId,
        primerDia.conductor_id,
        vehiculoId,
        empresaId,
        numeroPlanilla,
        primerDia.mes,
        primerDia.anio,
        totalDias,
        totalHorasTrabajadas,
        totalHorasOrdinarias,
      ])
      planillasCreadas++

      console.log(`   ✅ Planilla creada: ${numeroPlanilla || 'SIN NUMERO'} | ${nombreMap[primerDia.conductor_id]} | Mes ${primerDia.mes} | ${totalDias} días | ${totalHorasTrabajadas}h trabajadas`)

      // Crear cada día
      for (const dia of dias) {
        const esDomingoFestivo = dia.es_festivo || dia.es_domingo
        const horasOrdinarias = calcularHorasOrdinarias(dia.total_horas, esDomingoFestivo)
        const recargos = calcularRecargosDia(dia.hora_inicio, dia.hora_fin, dia.total_horas, esDomingoFestivo)

        const nuevoDiaId = randomUUID()

        // INSERT dia
        await cotransmeq.query(`
          INSERT INTO dias_laborales_planillas (
            id, recargo_planilla_id, dia, hora_inicio, hora_fin, total_horas,
            horas_ordinarias, es_festivo, es_domingo, pernocte, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, false, NOW(), NOW()
          )
        `, [
          nuevoDiaId,
          nuevaPlanillaId,
          dia.dia,
          dia.hora_inicio,
          dia.hora_fin,
          dia.total_horas,
          horasOrdinarias,
          dia.es_festivo,
          dia.es_domingo,
        ])
        diasCreados++

        // INSERT detalles de recargos
        const recargoEntries: [string, number][] = [
          ['HED', recargos.hed],
          ['HEN', recargos.hen],
          ['HEFD', recargos.hefd],
          ['HEFN', recargos.hefn],
          ['RN', recargos.rn],
          ['RD', recargos.rd],
          ['RNDF', recargos.rndf],
        ]

        for (const [codigo, horas] of recargoEntries) {
          if (horas > 0) {
            await cotransmeq.query(`
              INSERT INTO detalles_recargos_dias (
                id, dia_laboral_id, tipo_recargo_id, horas,
                calculado_automaticamente, activo, version,
                created_at, updated_at
              ) VALUES (
                $1, $2, $3, $4, true, true, 1, NOW(), NOW()
              )
            `, [
              randomUUID(),
              nuevoDiaId,
              TIPOS_RECARGO[codigo],
              horas,
            ])
            detallesCreados++
          }
        }
      }
    }

    console.log('\n' + '='.repeat(70))
    console.log('🎉 MIGRACIÓN COMPLETADA')
    console.log(`   → Planillas creadas: ${planillasCreadas}`)
    console.log(`   → Días creados: ${diasCreados}`)
    console.log(`   → Detalles de recargos creados: ${detallesCreados}`)
    console.log('='.repeat(70))

    await cotransmeq.query('COMMIT')
    console.log('✅ Transacción confirmada (COMMIT)')

  } catch (error) {
    try { await cotransmeq.query('ROLLBACK') } catch (e) {}
    console.error('❌ Error en la migración (ROLLBACK ejecutado):', error)
    throw error
  } finally {
    await cotransmeq.end()
    await transmeralda.end()
    console.log('\n🔌 Conexiones cerradas')
  }
}

main().catch(console.error)
