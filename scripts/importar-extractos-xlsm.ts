/**
 * Importa el libro «OP-FR-04, Extractos De Contrato» (xlsm) con el que se
 * venían emitiendo los extractos a mano:
 *
 *   CONTRATANTE         → catálogo `fuec_contratante` (contrato, NIT, responsable)
 *   VEHICULOS           → ficha del vehículo (número interno, tarjeta de operación,
 *                         afiliación; marca/modelo/clase solo si faltaban)
 *   CONDUCTORES         → ficha del conductor (cédula si faltaba, vigencia de la licencia)
 *   DATOS / afiliadoras → catálogo `fuec_catalogo` (objetos y convenios)
 *   HISTORIAL_EXTRACTOS → `fuec_extract` con source=XLSM (sin firma: no los emitió el sistema)
 *
 * Idempotente: cada fila del historial lleva un `source_hash`; reimportar no
 * duplica. Lo que no cuadra (placa o conductor que no existe en la base) se
 * importa igual y queda anotado en `fuec_import_issue`.
 *
 * Uso:
 *   npx tsx scripts/importar-extractos-xlsm.ts "<ruta al .xlsm>" [--dry-run] [--sin-historial]
 */
import { createHash } from 'crypto'
import * as XLSX from 'xlsx'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/config/prisma'
import { FUEC } from '../src/modules/extractos/fuec.config'
import { esAfiliacionPropia, normalizar, normalizarPlaca, numeroFuec, pad4 } from '../src/modules/extractos/extractos.service'
import type { SnapshotFuec } from '../src/modules/extractos/fuec-firma'

const args = process.argv.slice(2)
const RUTA = args.find((a) => !a.startsWith('--'))
const DRY_RUN = args.includes('--dry-run')
const SIN_HISTORIAL = args.includes('--sin-historial')
if (!RUTA) {
  console.error('Uso: npx tsx scripts/importar-extractos-xlsm.ts "<ruta.xlsm>" [--dry-run] [--sin-historial]')
  process.exit(1)
}

type Celda = string | number | null
const PLACEHOLDER = /^(#+|X+|N\/?A|-)$/i

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return !s || PLACEHOLDER.test(s) ? null : s
}
function serialAFecha(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10)
}
const aFecha = (s: string) => new Date(`${s}T00:00:00Z`)
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const soloDigitos = (s: string | null) => (s ? s.replace(/\D/g, '') : '')

function hoja(libro: XLSX.WorkBook, nombre: string): Celda[][] {
  const h = libro.Sheets[nombre]
  if (!h) throw new Error(`El libro no tiene la hoja ${nombre}`)
  return XLSX.utils.sheet_to_json<Celda[]>(h, { header: 1, raw: true, defval: null })
}
/** Filas como objetos usando la fila `fila` (0-based) como cabecera. */
function tabla(filas: Celda[][], fila: number): Array<Record<string, Celda>> {
  const cab = (filas[fila] ?? []).map((c) => String(c ?? '').trim())
  return filas.slice(fila + 1).map((f) => Object.fromEntries(cab.map((k, i) => [k, f[i] ?? null]))).filter((o) => Object.values(o).some((v) => v !== null))
}

/** Misma persona aunque el orden nombre/apellido cambie o sobre una inicial. */
function clavesNombre(nombre: string): string[] {
  const n = normalizar(nombre).replace(/[^A-Z0-9 ]/g, '')
  const tokens = n.split(' ').filter(Boolean)
  return [n, [...tokens].sort().join(' '), tokens.filter((t) => t.length > 1).sort().join(' ')]
}

interface Resumen {
  contratantes: { nuevos: number; actualizados: number }
  vehiculos: { actualizados: number; sinFicha: string[] }
  conductores: { actualizados: number; cedulasPuestas: number; sinFicha: string[] }
  catalogo: { objetos: number; convenios: number; origenes: number }
  historial: { leidos: number; nuevos: number; yaEstaban: number; conIncidencia: number; porMotivo: Record<string, number> }
}

async function main() {
  const libro = XLSX.readFile(RUTA!, { cellDates: false })
  const resumen: Resumen = {
    contratantes: { nuevos: 0, actualizados: 0 },
    vehiculos: { actualizados: 0, sinFicha: [] },
    conductores: { actualizados: 0, cedulasPuestas: 0, sinFicha: [] },
    catalogo: { objetos: 0, convenios: 0, origenes: 0 },
    historial: { leidos: 0, nuevos: 0, yaEstaban: 0, conIncidencia: 0, porMotivo: {} },
  }
  const escribir = !DRY_RUN
  const ahora = new Date()

  // ── Fichas existentes ──────────────────────────────────────────────
  const [vehiculosDb, conductoresDb, clientesDb, contratantesDb] = await Promise.all([
    prisma.vehiculos.findMany({ where: { deleted_at: null }, select: { id: true, placa: true, marca: true, modelo: true, clase_vehiculo: true, numero_interno: true, tarjeta_operacion: true, empresa_afiliacion: true } }),
    prisma.conductores.findMany({ where: { deleted_at: null }, select: { id: true, nombre: true, apellido: true, numero_identificacion: true, vencimiento_licencia: true } }),
    prisma.clientes.findMany({ where: { deletedAt: null }, select: { id: true, nit: true, nombre: true } }),
    prisma.fuec_contratante.findMany({ where: { deleted_at: null } }),
  ])
  const vehiculoPorPlaca = new Map(vehiculosDb.map((v) => [normalizarPlaca(v.placa), v]))
  const conductorPorClave = new Map<string, (typeof conductoresDb)[number]>()
  const conductorPorCedula = new Map<string, (typeof conductoresDb)[number]>()
  for (const c of conductoresDb) {
    for (const k of clavesNombre(`${c.nombre} ${c.apellido}`)) if (k && !conductorPorClave.has(k)) conductorPorClave.set(k, c)
    if (c.numero_identificacion) conductorPorCedula.set(soloDigitos(c.numero_identificacion), c)
  }
  const buscarConductor = (nombre: string | null, cedula: string | null) => {
    if (cedula && conductorPorCedula.get(soloDigitos(cedula))) return conductorPorCedula.get(soloDigitos(cedula))!
    if (!nombre) return null
    for (const k of clavesNombre(nombre)) if (conductorPorClave.has(k)) return conductorPorClave.get(k)!
    return null
  }
  const clientePorNit = new Map(clientesDb.filter((c) => c.nit).map((c) => [soloDigitos(c.nit), c]))
  const clientePorNombre = new Map(clientesDb.filter((c) => c.nombre).map((c) => [normalizar(c.nombre), c]))

  // ── CONTRATANTE → fuec_contratante ─────────────────────────────────
  const contratantePorNombre = new Map(contratantesDb.map((c) => [normalizar(c.nombre), c]))
  const contratanteIdPorNombre = new Map<string, string>()
  const contratoPorNombre = new Map<string, string | null>()
  for (const f of tabla(hoja(libro, 'CONTRATANTE'), 0)) {
    const nombre = texto(f.NOMBRE_CONT)
    if (!nombre) continue
    const nit = texto(f.NUM_ID)
    const cliente = (nit && clientePorNit.get(soloDigitos(nit))) || clientePorNombre.get(normalizar(nombre)) || null
    const datos = {
      nombre,
      nit,
      numero_contrato: texto(f.NUM_CONTRATO),
      cliente_id: cliente?.id ?? null,
      responsable_nombre: texto(f.NOM_RES),
      responsable_cedula: texto(f.NUM_CED_RES),
      responsable_telefono: texto(f.TEL_RES),
      responsable_direccion: texto(f.DIR_RES),
    }
    contratoPorNombre.set(normalizar(nombre), datos.numero_contrato)
    const existente = contratantePorNombre.get(normalizar(nombre))
    if (existente) {
      resumen.contratantes.actualizados++
      contratanteIdPorNombre.set(normalizar(nombre), existente.id)
      if (escribir) await prisma.fuec_contratante.update({ where: { id: existente.id }, data: datos })
    } else {
      resumen.contratantes.nuevos++
      if (escribir) {
        const creado = await prisma.fuec_contratante.create({ data: datos })
        contratanteIdPorNombre.set(normalizar(nombre), creado.id)
      }
    }
  }

  // ── VEHICULOS → ficha ──────────────────────────────────────────────
  const vehiculoHoja = new Map<string, { modelo: string | null; marca: string | null; clase: string | null; afiliacion: string | null }>()
  const convenios = new Set<string>()
  for (const f of tabla(hoja(libro, 'VEHICULOS'), 0)) {
    const placa = texto(f.PLACA)
    if (!placa) continue
    const p = normalizarPlaca(placa)
    const afiliacion = texto(f.EMPRESA_AFIL)
    const datosHoja = { modelo: texto(f.MODELO), marca: texto(f.MARCA), clase: texto(f.CLASE)?.toUpperCase() ?? null, afiliacion }
    vehiculoHoja.set(p, datosHoja)
    if (afiliacion && !esAfiliacionPropia(afiliacion)) convenios.add(afiliacion.toUpperCase())
    const v = vehiculoPorPlaca.get(p)
    if (!v) {
      resumen.vehiculos.sinFicha.push(p)
      continue
    }
    const numeroInterno = texto(f.NUM_INT)
    const data: Prisma.vehiculosUpdateInput = {}
    if (numeroInterno) data.numero_interno = pad4(numeroInterno)
    const tarjeta = texto(f.NUM_T_O)
    if (tarjeta) data.tarjeta_operacion = tarjeta
    if (afiliacion && !esAfiliacionPropia(afiliacion)) data.empresa_afiliacion = afiliacion.toUpperCase()
    if (datosHoja.marca && !v.marca) data.marca = datosHoja.marca
    if (datosHoja.modelo && !v.modelo) data.modelo = datosHoja.modelo
    if (datosHoja.clase && (!v.clase_vehiculo || v.clase_vehiculo === 'POR DEFINIR')) data.clase_vehiculo = datosHoja.clase
    if (Object.keys(data).length) {
      resumen.vehiculos.actualizados++
      if (escribir) await prisma.vehiculos.update({ where: { id: v.id }, data })
    }
  }

  // ── CONDUCTORES → ficha ────────────────────────────────────────────
  const conductorHoja = new Map<string, { cedula: string | null; vigencia: string | null }>()
  for (const f of tabla(hoja(libro, 'CONDUCTORES'), 0)) {
    const nombre = texto(f.NOMBRES_APELLIDOS)
    if (!nombre) continue
    const cedula = texto(f.NUM_DOC)
    const vigencia = serialAFecha(f.FEC_VEN_PASE)
    for (const k of clavesNombre(nombre)) if (!conductorHoja.has(k)) conductorHoja.set(k, { cedula, vigencia })
    const c = buscarConductor(nombre, cedula)
    if (!c) {
      resumen.conductores.sinFicha.push(nombre)
      continue
    }
    const data: Prisma.conductoresUpdateInput = {}
    // La vigencia del libro manda salvo que la ficha ya tenga una renovación posterior.
    if (vigencia && (ymd(c.vencimiento_licencia) ?? '') < vigencia) data.vencimiento_licencia = aFecha(vigencia)
    if (cedula && !c.numero_identificacion && !conductorPorCedula.has(soloDigitos(cedula))) {
      data.numero_identificacion = soloDigitos(cedula)
      conductorPorCedula.set(soloDigitos(cedula), c)
      resumen.conductores.cedulasPuestas++
    }
    if (Object.keys(data).length) {
      resumen.conductores.actualizados++
      if (escribir) await prisma.conductores.update({ where: { id: c.id }, data })
    }
  }

  // ── Catálogos: objetos (hoja DATOS) y convenios (afiliadoras) ──────
  const usarCatalogo = async (tipo: 'OBJETO' | 'CONVENIO' | 'ORIGEN_DESTINO', textoCat: string, usos: number) => {
    if (!escribir) return
    await prisma.fuec_catalogo.upsert({
      where: { tipo_texto: { tipo, texto: textoCat } },
      create: { tipo, texto: textoCat, usos, ultimo_uso_at: usos ? ahora : null },
      update: { usos: { increment: usos }, deleted_at: null },
    })
  }
  if (libro.Sheets.DATOS) {
    for (const f of hoja(libro, 'DATOS')) {
      // La hoja arranca en C2, así que el rango leído empieza en la primera celda con algo.
      const t = texto(f.find((c) => c !== null))
      if (!t || normalizar(t) === 'OBJETO CONTRATO') continue
      resumen.catalogo.objetos++
      await usarCatalogo('OBJETO', t, normalizar(t) === normalizar(FUEC.objeto_defecto) ? 1 : 0)
    }
  }
  for (const c of convenios) {
    resumen.catalogo.convenios++
    await usarCatalogo('CONVENIO', c, 0)
  }

  // ── HISTORIAL_EXTRACTOS → fuec_extract ─────────────────────────────
  if (!SIN_HISTORIAL) {
    const filas = tabla(hoja(libro, 'HISTORIAL_EXTRACTOS'), 1)
    const hashesExistentes = new Set((await prisma.fuec_extract.findMany({ where: { source: 'XLSM' }, select: { source_hash: true } })).map((e) => e.source_hash))
    const usosOrigen = new Map<string, number>()
    const pendientes: Array<{ data: Prisma.fuec_extractCreateInput; incidencias: Array<{ motivo: string; detalle: unknown }>; linea: number; textoFila: string }> = []

    for (const [i, f] of filas.entries()) {
      const consecutivo = Number(String(f.CONSECUTIVO ?? '').trim())
      const desde = serialAFecha(f.FECHA_INICIAL)
      const hasta = serialAFecha(f.FECHA_FINAL)
      if (!Number.isInteger(consecutivo) || consecutivo <= 0 || !desde || !hasta) continue
      resumen.historial.leidos++
      const textoFila = JSON.stringify(f)
      const hash = createHash('sha256').update(`XLSM|${consecutivo}|${textoFila}`).digest('hex')
      if (hashesExistentes.has(hash)) {
        resumen.historial.yaEstaban++
        continue
      }
      const incidencias: Array<{ motivo: string; detalle: unknown }> = []
      const contratanteNombre = texto(f.CONTRATANTE)
      const clave = normalizar(contratanteNombre)
      let contratanteId = contratanteNombre ? contratanteIdPorNombre.get(clave) ?? null : null
      if (contratanteNombre && !contratoPorNombre.has(clave)) {
        incidencias.push({ motivo: 'CLIENTE_NO_RESUELTO', detalle: { contratante: contratanteNombre } })
        if (escribir && !contratanteId) {
          const creado = await prisma.fuec_contratante.create({ data: { nombre: contratanteNombre } })
          contratanteId = creado.id
          contratanteIdPorNombre.set(clave, creado.id)
          resumen.contratantes.nuevos++
        }
        contratoPorNombre.set(clave, null)
      }
      const contrato = contratoPorNombre.get(clave) ?? '0'
      const placaTxt = texto(f.PLACA)
      const placa = placaTxt ? normalizarPlaca(placaTxt) : null
      const vehiculo = placa ? vehiculoPorPlaca.get(placa) ?? null : null
      if (!placa) incidencias.push({ motivo: 'VEHICULO_NO_RESUELTO', detalle: { placa: null } })
      else if (!vehiculo) incidencias.push({ motivo: 'VEHICULO_NO_RESUELTO', detalle: { placa } })
      const vh = placa ? vehiculoHoja.get(placa) : undefined
      const convenioCrudo = vh?.afiliacion ?? vehiculo?.empresa_afiliacion ?? null
      const convenio = esAfiliacionPropia(convenioCrudo) ? 'N/A' : convenioCrudo!.toUpperCase()
      const origen = texto(f['ORIGEN DESTINO'])
      if (origen) usosOrigen.set(origen, (usosOrigen.get(origen) ?? 0) + 1)

      const drivers: Prisma.fuec_extract_driverCreateWithoutFuecInput[] = []
      for (const n of [1, 2, 3]) {
        const nombre = texto(f[`NOM_COND_${n}`])
        if (!nombre) continue
        const hojaC = clavesNombre(nombre).map((k) => conductorHoja.get(k)).find(Boolean)
        const ficha = buscarConductor(nombre, hojaC?.cedula ?? null)
        if (!ficha) incidencias.push({ motivo: 'CONDUCTOR_NO_RESUELTO', detalle: { conductor: nombre } })
        const vigencia = serialAFecha(f[`FEC_VEN_PASE${n}`]) ?? hojaC?.vigencia ?? ymd(ficha?.vencimiento_licencia) ?? null
        drivers.push({
          conductor: ficha ? { connect: { id: ficha.id } } : undefined,
          nombre: nombre.toUpperCase(),
          identificacion: hojaC?.cedula ?? ficha?.numero_identificacion ?? null,
          licencia_vigencia: vigencia ? aFecha(vigencia) : null,
          orden: n,
        })
      }
      const responsable = contratantesDb.find((c) => c.id === contratanteId)
      const v = {
        placa: placa ?? '',
        modelo: vh?.modelo ?? vehiculo?.modelo ?? null,
        marca: vh?.marca ?? vehiculo?.marca ?? null,
        clase: vh?.clase ?? (vehiculo?.clase_vehiculo && vehiculo.clase_vehiculo !== 'POR DEFINIR' ? vehiculo.clase_vehiculo : null),
        numero_interno: texto(f.NUM_INTERNO) ? pad4(texto(f.NUM_INTERNO)) : null,
        tarjeta_operacion: texto(f.NUM_TAR_OPE),
      }
      const numero = numeroFuec(Number(desde.slice(0, 4)), contrato, consecutivo)
      const snapshot: SnapshotFuec = {
        numero,
        consecutivo,
        empresa: { razon_social: FUEC.razon_social, nit: FUEC.nit },
        contrato_numero: pad4(contrato),
        contratante: { nombre: contratanteNombre ?? '', nit: null },
        objeto_contrato: FUEC.objeto_defecto,
        origen_destino: origen ?? '',
        convenio,
        vigencia_desde: desde,
        vigencia_hasta: hasta,
        vehiculo: v,
        conductores: drivers.map((d) => ({ nombre: d.nombre, cedula: d.identificacion ?? null, licencia_vigencia: ymd(d.licencia_vigencia as Date | null) })),
        responsable: {
          nombre: responsable?.responsable_nombre ?? null,
          cedula: responsable?.responsable_cedula ?? null,
          telefono: responsable?.responsable_telefono ?? null,
          direccion: responsable?.responsable_direccion ?? null,
        },
        emitido_at: aFecha(desde).toISOString(),
      }
      pendientes.push({
        linea: i + 3,
        textoFila,
        incidencias,
        data: {
          consecutivo,
          numero_completo: numero,
          contratante: contratanteId ? { connect: { id: contratanteId } } : undefined,
          contratante_nombre: contratanteNombre,
          contrato_numero: contrato,
          objeto_contrato: FUEC.objeto_defecto,
          origen_destino: origen,
          convenio,
          vigencia_desde: aFecha(desde),
          vigencia_hasta: aFecha(hasta),
          vehiculo: vehiculo ? { connect: { id: vehiculo.id } } : undefined,
          vehiculo_placa: placa,
          modelo: v.modelo,
          marca: v.marca,
          clase: v.clase,
          numero_interno: v.numero_interno,
          tarjeta_operacion: v.tarjeta_operacion,
          responsable_json: snapshot.responsable as unknown as Prisma.InputJsonValue,
          responsable: snapshot.responsable.nombre,
          estado: 'VIGENTE',
          source: 'XLSM',
          source_line: i + 3,
          source_text: textoFila,
          source_hash: hash,
          snapshot_json: snapshot as unknown as Prisma.InputJsonValue,
          emitido_at: aFecha(desde),
          conductores: { create: drivers },
        },
      })
      if (incidencias.length) {
        resumen.historial.conIncidencia++
        for (const inc of incidencias) resumen.historial.porMotivo[inc.motivo] = (resumen.historial.porMotivo[inc.motivo] ?? 0) + 1
      }
    }

    resumen.historial.nuevos = pendientes.length
    for (const [origen, usos] of usosOrigen) {
      resumen.catalogo.origenes++
      await usarCatalogo('ORIGEN_DESTINO', origen, usos)
    }
    if (escribir) {
      /// Lotes cortos y timeout largo: contra prod por túnel cada consulta tarda ~40 ms.
      const LOTE = 25
      for (let i = 0; i < pendientes.length; i += LOTE) {
        const lote = pendientes.slice(i, i + LOTE)
        await prisma.$transaction(async (tx) => {
          for (const p of lote) {
            await tx.fuec_extract.create({ data: p.data })
            if (p.incidencias.length) {
              await tx.fuec_import_issue.upsert({
                where: { source_hash: p.data.source_hash! },
                create: { source_hash: p.data.source_hash!, source_line: p.linea, source_text: p.textoFila, motivo: p.incidencias[0].motivo, detalle_json: { incidencias: p.incidencias } as unknown as Prisma.InputJsonValue },
                update: { detalle_json: { incidencias: p.incidencias } as unknown as Prisma.InputJsonValue, resuelto: false },
              })
            }
          }
        }, { timeout: 120_000, maxWait: 20_000 })
        process.stdout.write(`\r  historial: ${Math.min(i + LOTE, pendientes.length)}/${pendientes.length}`)
      }
      if (pendientes.length) process.stdout.write('\n')
    }
  }

  // ── Resumen ────────────────────────────────────────────────────────
  const unicos = (xs: string[]) => [...new Set(xs)]
  console.log(`\n${DRY_RUN ? '🟡 DRY-RUN (no se escribió nada)' : '✅ Importado'} · ${RUTA}`)
  console.log(`Contratantes: ${resumen.contratantes.nuevos} nuevos · ${resumen.contratantes.actualizados} actualizados`)
  console.log(`Vehículos: ${resumen.vehiculos.actualizados} fichas actualizadas · ${unicos(resumen.vehiculos.sinFicha).length} placas del libro sin ficha`)
  if (resumen.vehiculos.sinFicha.length) console.log(`   sin ficha: ${unicos(resumen.vehiculos.sinFicha).join(', ')}`)
  console.log(`Conductores: ${resumen.conductores.actualizados} fichas actualizadas (${resumen.conductores.cedulasPuestas} cédulas completadas) · ${unicos(resumen.conductores.sinFicha).length} nombres del libro sin ficha`)
  if (resumen.conductores.sinFicha.length) console.log(`   sin ficha: ${unicos(resumen.conductores.sinFicha).join(' | ')}`)
  console.log(`Catálogos: ${resumen.catalogo.objetos} objetos · ${resumen.catalogo.convenios} convenios · ${resumen.catalogo.origenes} origen-destino`)
  if (!SIN_HISTORIAL) {
    console.log(`Historial: ${resumen.historial.leidos} leídos · ${resumen.historial.nuevos} nuevos · ${resumen.historial.yaEstaban} ya estaban · ${resumen.historial.conIncidencia} con incidencia`)
    for (const [m, n] of Object.entries(resumen.historial.porMotivo)) console.log(`   ${m}: ${n}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
