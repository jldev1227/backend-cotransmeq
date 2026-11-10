import { createHash } from 'node:crypto'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { prisma } from '../src/config/prisma'

const FILA_INICIAL = 19
const FILA_FINAL = 185
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function valor(hoja: XLSX.WorkSheet, fila: number, columna: number): unknown {
  const celda = hoja[XLSX.utils.encode_cell({ r: fila - 1, c: columna - 1 })]
  return celda?.v ?? null
}

function texto(value: unknown) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return String(value).trim() || null
}

function marcador(value: unknown, tipo: 'P' | 'E') {
  const literal = String(value ?? '').trim().toUpperCase()
  return literal === tipo || literal === '1' || value === 1
}

function metaPrincipal(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1 ? value / 100 : value
  const literal = String(value ?? '').trim().replace(',', '.')
  const porcentaje = literal.match(/(?:≥|>=|>|=)?\s*(\d+(?:\.\d+)?)\s*%/)
  if (porcentaje) return Number(porcentaje[1]) / 100
  const numero = Number(literal)
  return Number.isFinite(numero) ? (numero > 1 ? numero / 100 : numero) : Number.NaN
}

function jsonSeguro(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(jsonSeguro)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSeguro(v)]))
  return value
}

function ultimoDia(anio: number, mes: number) {
  return new Date(Date.UTC(anio, mes, 0))
}

async function importar(archivo: string) {
  const libro = XLSX.readFile(archivo, { cellDates: true })
  const hoja = libro.Sheets['Plan de Trabajo 2026']
  const hojaIndicadores = libro.Sheets['O, M, I_PL']
  if (!hoja) throw new Error('El Excel no contiene la hoja “Plan de Trabajo 2026”.')
  if (!hojaIndicadores) throw new Error('El Excel no contiene la hoja “O, M, I_PL”.')
  const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(archivo))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const actividades: Array<Record<string, any>> = []
  const ocurrencias: Array<{ numero: number; mes: number; ejecutada: boolean }> = []
  const indicadores = Array.from({ length: 6 }, (_, index) => {
    const fila = 8 + index
    const numero = Number(valor(hojaIndicadores, fila, 4))
    const nombre = texto(valor(hojaIndicadores, fila, 5))
    // En la hoja fuente, S contiene el comparador ("=" o ">=") y U contiene
    // el límite adecuado/meta numérica. Las bandas originales se conservan abajo.
    const meta = metaPrincipal(valor(hojaIndicadores, fila, 21))
    if (numero !== index + 1 || !nombre || !Number.isFinite(meta)) {
      throw new Error(`La fila ${fila} de “O, M, I_PL” no contiene un indicador completo.`)
    }
    return {
      numero_indicador: numero,
      nombre,
      formula_fuente: texto(valor(hojaIndicadores, fila, 14)),
      meta_principal: meta,
      bandas_referencia: jsonSeguro({
        adecuado: valor(hojaIndicadores, fila, 21),
        riesgo: valor(hojaIndicadores, fila, 22),
        critico: valor(hojaIndicadores, fila, 23)
      }) as any,
      unidad: texto(valor(hojaIndicadores, fila, 24)),
      frecuencia: texto(valor(hojaIndicadores, fila, 25)),
      vigencia: texto(valor(hojaIndicadores, fila, 26)),
      datos_fuente: jsonSeguro(Object.fromEntries(Array.from({ length: 29 }, (_, column) => [
        XLSX.utils.encode_col(column), valor(hojaIndicadores, fila, column + 1)
      ]))) as any
    }
  })

  for (let fila = FILA_INICIAL; fila <= FILA_FINAL; fila++) {
    const unidad = texto(valor(hoja, fila, 2))
    const actividad = texto(valor(hoja, fila, 3))
    if (!unidad || !actividad) continue
    const pasoPesv = texto(valor(hoja, fila, 9))
    const registro = texto(valor(hoja, fila, 42))
    const evidencia = texto(valor(hoja, fila, 43))
    actividades.push({
      // El Excel mezcla números (1…246) con códigos N1…N7. Usa el orden de fila
      // como clave interna y conserva el identificador original en datos_fuente.A.
      numero_fuente: actividades.length + 1,
      fila_fuente: fila,
      unidad_programa: unidad,
      actividad,
      recursos: texto(valor(hoja, fila, 4)),
      responsable_cargos: texto(valor(hoja, fila, 5)),
      alcance: texto(valor(hoja, fila, 11)),
      metodo_seguimiento: texto(valor(hoja, fila, 12)),
      frecuencia_fuente: texto(valor(hoja, fila, 13)),
      es_pesv: Boolean(pasoPesv && !/^N\/?A$/i.test(pasoPesv)),
      paso_pesv: pasoPesv,
      requiere_evidencia: Boolean((registro && !/^N\/?A$/i.test(registro)) || (evidencia && !/^N\/?A$/i.test(evidencia))),
      avance_fuente: texto(valor(hoja, fila, 14)),
      estado_fuente: texto(valor(hoja, fila, 39)),
      fecha_ejecucion_fuente: texto(valor(hoja, fila, 40)),
      asistentes_fuente: texto(valor(hoja, fila, 41)),
      registro_fuente: registro,
      evidencia_fuente: evidencia,
      observacion_fuente: texto(valor(hoja, fila, 44)),
      datos_fuente: jsonSeguro(Object.fromEntries(Array.from({ length: 44 }, (_, index) => [
        XLSX.utils.encode_col(index), valor(hoja, fila, index + 1)
      ])))
    })
    for (let mes = 1; mes <= 12; mes++) {
      const planificada = marcador(valor(hoja, fila, 15 + (mes - 1) * 2), 'P')
      const ejecutada = marcador(valor(hoja, fila, 16 + (mes - 1) * 2), 'E')
      if (ejecutada && !planificada) throw new Error(`La fila ${fila} tiene ejecución ${MESES[mes - 1]} sin mes planificado.`)
      if (planificada) ocurrencias.push({ numero: actividades.at(-1)!.numero_fuente, mes, ejecutada })
    }
  }

  if (actividades.length !== 167 || ocurrencias.length !== 724 || ocurrencias.filter((o) => o.ejecutada).length !== 536) {
    throw new Error(`El archivo no coincide con el plan esperado: ${actividades.length} actividades, ${ocurrencias.length} meses y ${ocurrencias.filter((o) => o.ejecutada).length} ejecuciones.`)
  }

  const codigo = 'HSEQ-PL-01'
  const existente = await prisma.plan_trabajo_anual.findUnique({ where: { codigo_anio: { codigo, anio: 2026 } } })
  if (existente) {
    const [actividadesExistentes, ocurrenciasExistentes, indicadoresExistentes] = await Promise.all([
      prisma.plan_trabajo_actividad.count({ where: { plan_id: existente.id } }),
      prisma.plan_trabajo_ocurrencia.count({ where: { actividad: { plan_id: existente.id } } }),
      prisma.plan_trabajo_indicador_config.count({ where: { plan_id: existente.id } })
    ])
    if (actividadesExistentes === 167 && ocurrenciasExistentes === 724 && indicadoresExistentes === 6) {
      console.log(`Plan ${codigo}/2026 ya estaba cargado (${sha256.slice(0, 12)}); no se duplicó ni sobrescribió.`)
      return
    }
    throw new Error(`Ya existe un plan parcial ${codigo}/2026 (${actividadesExistentes} actividades, ${ocurrenciasExistentes} ocurrencias). No se modificó.`)
  }

  const nombreArchivo = path.basename(archivo)
  await prisma.$transaction(async (tx) => {
    const plan = await tx.plan_trabajo_anual.create({
      data: {
        codigo,
        nombre: 'Plan anual de trabajo HSEQ y PESV 2026',
        anio: 2026,
        estado: 'APROBADO',
        recordatorios_activos: false,
        fuente_archivo: nombreArchivo,
        fuente_sha256: sha256
      }
    })
    await tx.plan_trabajo_indicador_config.createMany({ data: indicadores.map((indicador) => ({ ...indicador, plan_id: plan.id })) })
    await tx.plan_trabajo_actividad.createMany({ data: actividades.map((actividad) => ({ ...actividad, plan_id: plan.id })) as any })
    const porNumero = new Map((await tx.plan_trabajo_actividad.findMany({ where: { plan_id: plan.id }, select: { id: true, numero_fuente: true } })).map((a) => [a.numero_fuente, a.id]))
    await tx.plan_trabajo_ocurrencia.createMany({
      data: ocurrencias.map((o) => ({
        actividad_id: porNumero.get(o.numero)!,
        mes: o.mes,
        fecha_vencimiento: ultimoDia(2026, o.mes),
        estado: o.ejecutada ? 'COMPLETADA' : 'PENDIENTE',
        ejecutada_en_mes_fuente: o.ejecutada
      }))
    })
  })
  console.log(`Importado ${codigo}/2026: ${actividades.length} actividades, ${ocurrencias.length} ocurrencias (${ocurrencias.filter((o) => o.ejecutada).length} ejecutadas).`)
}

const archivo = process.argv[2]
if (!archivo) throw new Error('Uso: npm run plan-trabajo:importar -- /ruta/al/plan.xlsx')
importar(archivo).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
