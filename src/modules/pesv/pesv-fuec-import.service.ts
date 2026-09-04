/**
 * Importación histórica de `extractos.txt` a las tablas relacionales.
 *
 * Cuatro garantías, y las cuatro vienen de un daño concreto que ya ocurrió:
 *
 *  1. **No toca el TXT.** Se abre en solo lectura. El archivo sigue siendo el
 *     respaldo histórico y el módulo de Extractos sigue escribiéndolo.
 *  2. **Es idempotente.** Cada fila tiene una huella estable sobre su contenido
 *     normalizado; reimportar el mismo archivo no crea nada. La huella NO usa
 *     el número de línea: el archivo se reordena al añadir filas por arriba, y
 *     con la posición dentro, la segunda importación duplicaría todo.
 *  3. **No inventa entidades.** El `sincronizar()` viejo CREABA un conductor por
 *     cada nombre que no encontrara, en cada carga de la página. En producción
 *     dejó once conductores con identificación `EXT-<timestamp>`, uno de ellos
 *     llamado literalmente «0». Aquí, lo que no se resuelve con seguridad va a
 *     la bandeja de conciliación con su línea y su texto original.
 *  4. **Deja informe.** Importados, ya existentes y no conciliados con motivo.
 */

import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { prisma } from '../../config/prisma'
import { normalizarPlaca, normalizarTexto, pareceNombreDePersona } from './dominio/calidad'
import { PesvError } from './dominio/errores'
import { registrarAuditoria } from './pesv-auditoria'
import type { ActorPesv } from './pesv-ciclos.service'
import { huellaFilaFuec } from './pesv-contratos.service'

/** Mismo archivo que lee el módulo de Extractos. Solo lectura. */
const RUTA_TXT = path.join(__dirname, '../../../extractos.txt')

export interface FilaExtractoTxt {
  linea: number
  textoOriginal: string
  consecutivo: string
  contratante: string
  origenDestino: string
  fechaInicial: string
  fechaFinal: string
  placa: string
  numInterno: string
  numTarjetaOperacion: string
  conductores: Array<{ nombre: string; vigenciaPase: string }>
}

/**
 * Parsea el TXT tab-separado.
 *
 * Reproduce la tolerancia del parser de Extractos —comillas de Excel, campos con
 * tabulador dentro, `##########` como relleno— porque el archivo es el mismo y
 * un parser más estricto dejaría fuera filas que hoy sí se muestran.
 */
export function parsearTxt(contenido: string): FilaExtractoTxt[] {
  const filas: FilaExtractoTxt[] = []
  const lineas = contenido.split('\n')

  for (let i = 0; i < lineas.length; i++) {
    const cruda = lineas[i]
    if (!cruda.trim()) continue

    let cols = cruda.replace(/"/g, '').split('\t')

    /// Un campo con tabulador dentro (típico del contratante exportado desde
    /// Excel) desplaza todas las columnas. Se reconstruye por la cola, que es
    /// la parte que siempre tiene doce campos.
    if (cols.length > 14) {
      const consecutivo = cols[0]?.trim() ?? ''
      const contratante = cols
        .slice(1, cols.length - 12)
        .map((c) => c.trim())
        .filter(Boolean)
        .join(' ')
      cols = [consecutivo, contratante, ...cols.slice(cols.length - 12)]
    }

    const consecutivo = cols[0]?.trim() ?? ''
    if (!consecutivo || consecutivo.includes('#') || consecutivo.includes('REF') || Number.isNaN(Number(consecutivo))) {
      continue
    }

    const limpiar = (v: string | undefined) => {
      const t = v?.trim() ?? ''
      return /^#+$/.test(t) ? '' : t
    }

    filas.push({
      linea: i + 1,
      textoOriginal: cruda.replace(/\r$/, ''),
      consecutivo: consecutivo.padStart(4, '0'),
      contratante: limpiar(cols[1]),
      origenDestino: limpiar(cols[2]),
      fechaInicial: limpiar(cols[3]),
      fechaFinal: limpiar(cols[4]),
      placa: limpiar(cols[5]),
      numInterno: limpiar(cols[6]),
      numTarjetaOperacion: limpiar(cols[7]),
      conductores: [
        { nombre: limpiar(cols[8]), vigenciaPase: limpiar(cols[9]) },
        { nombre: limpiar(cols[10]), vigenciaPase: limpiar(cols[11]) },
        { nombre: limpiar(cols[12]), vigenciaPase: limpiar(cols[13]) },
      ].filter((c) => c.nombre !== ''),
    })
  }

  return filas
}

/**
 * Fecha del TXT a `YYYY-MM-DD`, o `null`.
 *
 * El archivo mezcla `DD/MM/YYYY`, `D/M/YY` y algún `YYYY-MM-DD`. Se acepta lo
 * que se pueda interpretar SIN ambigüedad y se rechaza el resto: adivinar entre
 * `03/04/2026` como 3 de abril o 4 de marzo produciría vigencias falsas, y una
 * vigencia falsa en un FUEC es exactamente lo que el módulo viene a evitar.
 *
 * El criterio: si el primer número es mayor que 12, es día. Si no lo es, se
 * asume `DD/MM` porque es el formato colombiano y el archivo entero lo usa.
 */
export function parsearFechaTxt(valor: string): string | null {
  const v = valor.trim()
  if (!v) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (iso) return v

  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(v)
  if (!m) return null

  const dia = Number(m[1])
  const mes = Number(m[2])
  let anio = Number(m[3])
  if (anio < 100) anio += anio < 70 ? 2000 : 1900

  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null
  if (anio < 2000 || anio > 2100) return null

  /// Comprobación real de existencia: 31/02 no es una fecha, y aceptarla
  /// produciría un `Date` que salta al 3 de marzo sin avisar.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null

  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Huella de una incidencia de conciliación.
 *
 * Deriva de la huella de la fila MÁS el motivo, y se vuelve a hashear en vez de
 * concatenar: `source_hash` es `VARCHAR(64)` y un `<huella>-cliente` son 71
 * caracteres, que Postgres rechaza con un error que no menciona la longitud.
 * Una misma fila puede producir varias incidencias distintas —cliente sin
 * resolver Y vehículo sin resolver— y cada una necesita su clave estable para
 * que el `upsert` siga siendo idempotente.
 */
export function huellaIncidencia(huellaFila: string, motivo: string): string {
  return createHash('sha256').update(`${huellaFila}|${motivo}`).digest('hex')
}

export type MotivoConciliacion =
  | 'CLIENTE_NO_RESUELTO'
  | 'VEHICULO_NO_RESUELTO'
  | 'CONDUCTOR_NO_RESUELTO'
  | 'FECHAS_INVALIDAS'
  | 'CONSECUTIVO_INVALIDO'
  | 'AMBIGUO'

export interface InformeImportacion {
  archivo: string
  filasLeidas: number
  importadas: number
  yaExistian: number
  aConciliacion: number
  porMotivo: Record<string, number>
  /** Primeras 50 filas problemáticas, con su línea y su texto. */
  muestraNoConciliadas: Array<{ linea: number; motivo: MotivoConciliacion; texto: string }>
  ejecutadoAt: string
  simulacion: boolean
}

export interface OpcionesImportacion {
  /** `true` = no escribe nada; solo informa qué haría. */
  simulacion?: boolean
  /** Limita cuántas filas procesa. Útil para una primera pasada de revisión. */
  limite?: number
  /** Ruta alternativa del archivo. Solo para pruebas. */
  ruta?: string
}

/**
 * Importa el TXT.
 *
 * Cada fila produce un contrato y un extracto. El contrato se deduplica por
 * (contratante normalizado + vigencia): el archivo repite el mismo contratante
 * en cientos de filas, y crear un contrato por fila llenaría la tabla de
 * duplicados que después habría que fusionar a mano.
 */
export async function importarExtractosTxt(
  actor: ActorPesv,
  opciones: OpcionesImportacion = {},
): Promise<InformeImportacion> {
  const ruta = opciones.ruta ?? RUTA_TXT
  if (!fs.existsSync(ruta)) {
    throw new PesvError('IMPORTACION_FUENTE_AUSENTE', `No se encontró el archivo de extractos en ${ruta}.`)
  }

  const contenido = fs.readFileSync(ruta, 'utf-8')
  const filas = parsearTxt(contenido)
  const aProcesar = opciones.limite ? filas.slice(0, opciones.limite) : filas

  const informe: InformeImportacion = {
    archivo: ruta,
    filasLeidas: filas.length,
    importadas: 0,
    yaExistian: 0,
    aConciliacion: 0,
    porMotivo: {},
    muestraNoConciliadas: [],
    ejecutadoAt: new Date().toISOString(),
    simulacion: opciones.simulacion === true,
  }

  /// Los maestros se cargan UNA vez. Resolver por fila serían cuatro consultas
  /// por cada una de las 4.000 líneas del archivo.
  const [clientes, vehiculos, conductores] = await Promise.all([
    prisma.clientes.findMany({
      where: { deletedAt: null },
      select: { id: true, nombre: true, nit: true },
    }),
    prisma.vehiculos.findMany({ where: { deleted_at: null }, select: { id: true, placa: true } }),
    prisma.conductores.findMany({
      where: { deleted_at: null },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
    }),
  ])

  const clientePorNombre = new Map<string, string>()
  for (const c of clientes) {
    if (c.nombre) clientePorNombre.set(normalizarTexto(c.nombre), c.id)
  }
  const vehiculoPorPlaca = new Map<string, string>()
  for (const v of vehiculos) {
    const placa = normalizarPlaca(v.placa)
    if (placa) vehiculoPorPlaca.set(placa, v.id)
  }
  const conductorPorNombre = new Map<string, string[]>()
  for (const c of conductores) {
    const clave = normalizarTexto(`${c.nombre} ${c.apellido}`)
    const lista = conductorPorNombre.get(clave) ?? []
    lista.push(c.id)
    conductorPorNombre.set(clave, lista)
  }

  const anotar = (motivo: MotivoConciliacion, fila: FilaExtractoTxt) => {
    informe.aConciliacion += 1
    informe.porMotivo[motivo] = (informe.porMotivo[motivo] ?? 0) + 1
    if (informe.muestraNoConciliadas.length < 50) {
      informe.muestraNoConciliadas.push({ linea: fila.linea, motivo, texto: fila.textoOriginal.slice(0, 300) })
    }
  }

  const registrarIncidencia = async (motivo: MotivoConciliacion, fila: FilaExtractoTxt, huella: string, detalle: Record<string, unknown>) => {
    anotar(motivo, fila)
    if (opciones.simulacion) return
    await prisma.fuec_import_issue.upsert({
      where: { source_hash: huella },
      update: { motivo, source_line: fila.linea, source_text: fila.textoOriginal, detalle_json: detalle as never },
      create: {
        source_hash: huella,
        source_line: fila.linea,
        source_text: fila.textoOriginal,
        motivo,
        detalle_json: detalle as never,
      },
    })
  }

  /// Cache de contratos creados en ESTA ejecución: sin ella, mil filas del
  /// mismo contratante crearían mil contratos idénticos.
  const contratosDeLaCorrida = new Map<string, string>()

  for (const fila of aProcesar) {
    const huella = huellaFilaFuec({
      consecutivo: fila.consecutivo,
      contratante: fila.contratante,
      placa: fila.placa,
      fechaInicial: fila.fechaInicial,
      fechaFinal: fila.fechaFinal,
    })

    const yaImportada = await prisma.fuec_extract.findUnique({
      where: { source_hash: huella },
      select: { id: true },
    })
    if (yaImportada) {
      informe.yaExistian += 1
      continue
    }

    const desde = parsearFechaTxt(fila.fechaInicial)
    const hasta = parsearFechaTxt(fila.fechaFinal)
    if (!desde || !hasta) {
      await registrarIncidencia('FECHAS_INVALIDAS', fila, huella, {
        fechaInicial: fila.fechaInicial,
        fechaFinal: fila.fechaFinal,
      })
      continue
    }

    const consecutivo = Number(fila.consecutivo)
    if (!Number.isInteger(consecutivo) || consecutivo <= 0) {
      await registrarIncidencia('CONSECUTIVO_INVALIDO', fila, huella, { consecutivo: fila.consecutivo })
      continue
    }

    const contratanteNorm = normalizarTexto(fila.contratante)
    if (!contratanteNorm) {
      await registrarIncidencia('CLIENTE_NO_RESUELTO', fila, huella, { contratante: fila.contratante })
      continue
    }
    /// El cliente se resuelve si coincide; si no, el contrato se crea igual con
    /// el nombre del archivo y `cliente_id` nulo. NO se crea el cliente: eso es
    /// justo lo que llenó la base de entidades basura la vez anterior.
    const clienteId = clientePorNombre.get(contratanteNorm) ?? null

    const placa = normalizarPlaca(fila.placa)
    const vehiculoId = placa ? (vehiculoPorPlaca.get(placa) ?? null) : null

    const claveContrato = `${contratanteNorm}|${desde}|${hasta}`
    let contratoId = contratosDeLaCorrida.get(claveContrato) ?? null

    if (opciones.simulacion) {
      informe.importadas += 1
      if (!clienteId) anotar('CLIENTE_NO_RESUELTO', fila)
      else if (!vehiculoId && placa) anotar('VEHICULO_NO_RESUELTO', fila)
      continue
    }

    if (!contratoId) {
      const existente = await prisma.transport_contract.findFirst({
        where: {
          deleted_at: null,
          contratante_nombre: fila.contratante.trim(),
          fecha_inicio: new Date(`${desde}T00:00:00Z`),
          fecha_fin: new Date(`${hasta}T00:00:00Z`),
        },
        select: { id: true },
      })
      if (existente) {
        contratoId = existente.id
      } else {
        const creado = await prisma.transport_contract.create({
          data: {
            numero: `TXT-${fila.consecutivo}`,
            contratante_nombre: fila.contratante.trim(),
            cliente_id: clienteId,
            origen: fila.origenDestino || null,
            fecha_inicio: new Date(`${desde}T00:00:00Z`),
            fecha_fin: new Date(`${hasta}T00:00:00Z`),
            estado: 'VIGENTE',
            source: 'LEGACY_TXT',
            source_line: fila.linea,
            source_text: fila.textoOriginal,
            creado_por_id: actor.id,
          },
        })
        contratoId = creado.id
      }
      contratosDeLaCorrida.set(claveContrato, contratoId)
    }

    /// Los conductores se concilian por nombre normalizado y SOLO si la
    /// coincidencia es única. Dos personas que se llaman igual son un caso real
    /// y elegir una sería atribuir un servicio a quien no lo condujo.
    const conductoresFila = fila.conductores
      .filter((c) => pareceNombreDePersona(c.nombre))
      .map((c, i) => {
        const candidatos = conductorPorNombre.get(normalizarTexto(c.nombre)) ?? []
        return {
          conductor_id: candidatos.length === 1 ? candidatos[0] : null,
          nombre: c.nombre.trim(),
          licencia_vigencia: parsearFechaTxt(c.vigenciaPase)
            ? new Date(`${parsearFechaTxt(c.vigenciaPase)}T00:00:00Z`)
            : null,
          orden: i + 1,
          ambiguo: candidatos.length > 1,
        }
      })

    await prisma.fuec_extract.create({
      data: {
        consecutivo,
        numero_completo: fila.consecutivo,
        contrato_id: contratoId,
        vehiculo_id: vehiculoId,
        vehiculo_placa: placa ?? (fila.placa || null),
        numero_interno: fila.numInterno || null,
        tarjeta_operacion: fila.numTarjetaOperacion || null,
        origen_destino: fila.origenDestino || null,
        vigencia_desde: new Date(`${desde}T00:00:00Z`),
        vigencia_hasta: new Date(`${hasta}T00:00:00Z`),
        estado: 'VIGENTE',
        source: 'LEGACY_TXT',
        source_line: fila.linea,
        source_text: fila.textoOriginal,
        source_hash: huella,
        /// El snapshot guarda la fila tal cual venía. Es lo que permite volver
        /// al archivo cuando una conciliación resulte estar mal.
        snapshot_json: { ...fila } as never,
        creado_por_id: actor.id,
        conductores: {
          create: conductoresFila.map(({ ambiguo: _ambiguo, ...c }) => c),
        },
      },
    })
    informe.importadas += 1

    /// La fila se importó, pero lo que no se pudo conciliar se anota igual: el
    /// extracto existe y le falta el vínculo, que es un trabajo pendiente
    /// visible y no un dato perdido.
    if (!clienteId) {
      await registrarIncidencia('CLIENTE_NO_RESUELTO', fila, huellaIncidencia(huella, 'cliente'), {
        contratante: fila.contratante,
        contratoId,
      })
    }
    if (placa && !vehiculoId) {
      await registrarIncidencia('VEHICULO_NO_RESUELTO', fila, huellaIncidencia(huella, 'vehiculo'), { placa: fila.placa })
    }
    const sinResolver = conductoresFila.filter((c) => !c.conductor_id)
    if (sinResolver.length > 0) {
      await registrarIncidencia('CONDUCTOR_NO_RESUELTO', fila, huellaIncidencia(huella, 'conductores'), {
        nombres: sinResolver.map((c) => c.nombre),
        ambiguos: conductoresFila.filter((c) => c.ambiguo).map((c) => c.nombre),
      })
    }
  }

  await registrarAuditoria({
    entidad: 'IMPORTACION',
    entidadId: null,
    accion: opciones.simulacion ? 'SIMULAR_IMPORTACION_FUEC' : 'IMPORTAR_FUEC',
    actor,
    detalle: {
      filasLeidas: informe.filasLeidas,
      importadas: informe.importadas,
      yaExistian: informe.yaExistian,
      aConciliacion: informe.aConciliacion,
    },
  })

  return informe
}

export interface FiltrosConciliacion {
  motivo?: MotivoConciliacion
  resuelto?: boolean
  limite?: number
}

/** Bandeja de conciliación: lo que la importación no pudo resolver. */
export async function listarConciliacion(filtros: FiltrosConciliacion = {}) {
  return prisma.fuec_import_issue.findMany({
    where: {
      ...(filtros.motivo ? { motivo: filtros.motivo } : {}),
      ...(filtros.resuelto !== undefined ? { resuelto: filtros.resuelto } : {}),
    },
    orderBy: [{ resuelto: 'asc' }, { source_line: 'asc' }],
    take: Math.min(filtros.limite ?? 200, 1000),
  })
}

export async function marcarConciliado(id: string, actor: ActorPesv) {
  const actualizado = await prisma.fuec_import_issue.update({
    where: { id },
    data: { resuelto: true, resuelto_at: new Date() },
  })
  await registrarAuditoria({
    entidad: 'IMPORTACION',
    entidadId: id,
    accion: 'CONCILIAR',
    actor,
    detalle: { motivo: actualizado.motivo, linea: actualizado.source_line },
  })
  return actualizado
}
