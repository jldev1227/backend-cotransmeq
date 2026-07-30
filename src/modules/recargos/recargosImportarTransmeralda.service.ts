import { randomUUID } from 'crypto'
import { prisma } from '../../config/prisma'
import { getPrismaTransmeralda } from '../../config/prismaTransmeralda'
import { RecargosService } from './recargos.service'

/**
 * Servicio de importación de recargos desde Transmeralda → Cotransmeq.
 *
 * Reglas de negocio:
 *   - Se muestran TODAS las planillas de Transmeralda del mes/año.
 *   - Para cada planilla, match por `numero_identificacion` contra Cotransmeq.
 *   - Si el conductor NO existe en Cotransmeq → no importable (no se crean
 *     conductores automáticamente: hay temas legales/contractuales).
 *   - Si la PLACA no existe en Cotransmeq → se crea automáticamente desde
 *     los datos de TM (mismo placa, marca, modelo, etc.).
 *   - Si la EMPRESA no existe en Cotransmeq → se crea automáticamente desde
 *     TM (mismo nombre, nit, etc.).
 *   - Deduplicación: una planilla se considera "ya importada" si existe
 *     en Cotransmeq con (conductor_id, numero_planilla, mes, año) — esas
 *     salen tachadas en el preview y se omiten en la importación.
 */

const TARGET_YEAR = 2026

/**
 * Convierte un array de días (números) en una representación compacta
 * de rangos consecutivos, separada por comas.
 *
 * Ejemplos:
 *   [1, 2, 3, 4, 5]              → "1-5"
 *   [1]                          → "1"
 *   [1, 2, 3, 5, 6, 7]           → "1-3, 5-7"
 *   [1, 3, 5, 7]                 → "1, 3, 5, 7"
 *   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19, 20]
 *                                → "1-10, 15-20"
 *   []                           → "—"
 *
 * Sirve para mostrar los días laborados de una planilla de manera
 * compacta y al mismo tiempo distinguir visualmente planillas que
 * comparten el mismo conteo pero cubren rangos distintos (ej: dos
 * planillas de 10 días podrían ser 1-10 y 11-20, planillas distintas;
 * o ambas 1-10, en cuyo caso son la misma).
 */
export function diasARangos(dias: number[]): string {
  if (!dias || dias.length === 0) return '—'
  const sorted = [...dias].sort((a, b) => a - b)
  const rangos: string[] = []
  let inicio = sorted[0]
  let fin = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === fin + 1) {
      fin = sorted[i]
    } else {
      rangos.push(inicio === fin ? `${inicio}` : `${inicio}-${fin}`)
      inicio = sorted[i]
      fin = sorted[i]
    }
  }
  rangos.push(inicio === fin ? `${inicio}` : `${inicio}-${fin}`)
  return rangos.join(', ')
}

/**
 * Normaliza el `numero_planilla` que viene de Transmeralda para guardarlo
 * en Cotransmeq.
 *
 * Regla (transmeralda → cotransmeq):
 *   - Si ya empieza con "TM-" (case insensitive) → se deja tal cual.
 *   - Si es SOLO un número (ej: "7176", "12345") → se le agrega "TM-":
 *       "7176"     → "TM-7176"
 *       "TM-7176"  → "TM-7176" (omitido por la primera regla)
 *   - Si tiene otra forma (texto, mezcla, guiones, etc.) → se deja tal
 *     cual. Ej: "TRANSCANI STP-253" se queda igual.
 *
 * Razón: en Transmeralda algunas planillas se numeran solo con dígitos
 * (porque se importaron de un sistema anterior) y otras ya con "TM-".
 * En Cotransmeq queremos que todas las planillas de origen TM tengan el
 * prefijo "TM-" para distinguirlas de las planillas nativas CM-XXXX.
 */
export function normalizarNumeroPlanillaTM(
  numero: string | null | undefined,
): string {
  if (!numero) return '';
  const t = String(numero).trim();
  if (!t) return '';
  // Ya tiene TM- al inicio (case insensitive): omitir
  if (/^TM-/i.test(t)) return t;
  // Solo dígitos: agregar TM-
  if (/^\d+$/.test(t)) return `TM-${t}`;
  // Otros casos: dejar tal cual (texto con guiones, prefijos propios, etc.)
  return t;
}

export interface PreviewPlanillaItem {
  source_id: string
  conductor_nombre: string
  conductor_identificacion: string
  empresa_nombre: string
  vehiculo_placa: string
  /** Numero de planilla ORIGINAL de TM (puede ser "7176" o "TM-7176") */
  numero_planilla_original: string
  /** Numero de planilla NORMALIZADO (siempre con TM- si era dígito puro) */
  numero_planilla_normalizado: string
  /** Alias de `numero_planilla_normalizado` para retrocompatibilidad */
  numero_planilla: string
  mes: number
  año: number
  dias_count: number
  /**
   * Lista de días laborados en orden ascendente. Ej: [1, 2, 3, 5, 6, 7].
   * Útil para tooltips y para que el frontend pueda operar sobre
   * el detalle sin volver a pedirlo.
   */
  dias_lista: number[]
  /**
   * Mismos días pero compactados como rangos consecutivos separados
   * por coma. Ej: "1-3, 5-7". Es lo que se muestra en la columna
   * "Días" de la tabla del modal.
   */
  dias_rangos: string
  /** Ya importado en Cotransmeq (matching por conductor+planilla+mes+año) */
  ya_importado: boolean
  /** El conductor existe en Cotransmeq */
  conductor_existe_en_destino: boolean
  /**
   * El conductor en Cotransmeq está en un estado "califica para
   * import": existe y su `estado` NO es `inactivo`. Cualquier otro
   * enum del estado (activo, disponible, servicio, programado,
   * descanso, suspendido, retirado) cuenta.
   */
  conductor_activo_en_destino: boolean
  /** El conductor en TM está activo (post-sincronización) */
  conductor_activo_en_origen: boolean
  /** La placa no existe en Cotransmeq — se va a crear al importar */
  vehiculo_no_existe_en_destino: boolean
  /** La empresa no existe en Cotransmeq — se va a crear al importar */
  empresa_no_existe_en_destino: boolean
  /** Razón por la que NO se puede importar */
  motivo_no_importable: string | null
  /** ID del recargo en Cotransmeq si ya fue importado */
  imported_id: string | null
}

export interface PreviewImportResult {
  mes: number
  año: number
  total: number
  importables: number
  ya_importadas: number
  no_importables: number
  /** Cantidad de planillas filtradas por no tener el conductor activo en CM */
  filtradas_por_conductor_inactivo: number
  /** Cantidad de placas que se crearán al importar */
  vehiculos_a_crear: number
  /** Cantidad de empresas que se crearán al importar */
  empresas_a_crear: number
  /** Si el preview se pidió con `incluir_no_importables: true` */
  incluir_no_importables: boolean
  planillas: PreviewPlanillaItem[]
}

export const RecargosImportarTransmeraldaService = {
  /**
   * En Transmeralda, marca `inactivo` a todos los conductores que NO tienen
   * liquidaciones en 2026. Idempotente.
   */
  async sincronizarConductoresCotransmeq() {
    const tm = getPrismaTransmeralda()

    const conductoresConLiq2026 = await tm.liquidaciones.findMany({
      where: {
        conductor_id: { not: null },
        fecha_liquidacion: {
          gte: new Date(`${TARGET_YEAR}-01-01T00:00:00Z`),
          lt: new Date(`${TARGET_YEAR + 1}-01-01T00:00:00Z`)
        }
      },
      select: { conductor_id: true },
      distinct: ['conductor_id']
    })
    const idsConLiq = new Set(
      conductoresConLiq2026.map((l) => l.conductor_id).filter(Boolean) as string[]
    )

    const activosAntes = await tm.conductores.count({
      where: { estado: 'activo', deleted_at: null }
    })

    const updateResult = await tm.conductores.updateMany({
      where: {
        id: { notIn: Array.from(idsConLiq) },
        estado: 'activo',
        deleted_at: null
      },
      data: { estado: 'inactivo' }
    })

    const reactivateResult = await tm.conductores.updateMany({
      where: {
        id: { in: Array.from(idsConLiq) },
        estado: { not: 'activo' },
        deleted_at: null
      },
      data: { estado: 'activo' }
    })

    const activosDespues = await tm.conductores.count({
      where: { estado: 'activo', deleted_at: null }
    })

    return {
      year: TARGET_YEAR,
      conductores_con_liquidaciones_2026: idsConLiq.size,
      activos_antes: activosAntes,
      activos_despues: activosDespues,
      marcados_inactivos: updateResult.count,
      reactivados: reactivateResult.count
    }
  },

  /**
   * Devuelve el preview de TODAS las planillas de Transmeralda del mes/año
   * (no filtra por conductor activo en TM — el usuario quiere verlas todas
   * para saber qué hay y decidir manualmente).
   *
   * Por defecto NO trae las planillas no importables (conductor inactivo
   * en CM, conductor no existe, sin planilla, etc.) — solo las
   * importables + las ya importadas. Pasar `incluirNoImportables: true`
   * para diagnóstico (mostrarlas tachadas con su motivo).
   *
   * Marca:
   *   - `ya_importado`: ya está en Cotransmeq → tachada, no se reimporta
   *   - `motivo_no_importable`: solo si el conductor no existe en CM
   *   - `vehiculo_no_existe_en_destino`: se va a crear al importar
   *   - `empresa_no_existe_en_destino`: se va a crear al importar
   */
  async obtenerPreview(
    mes: number,
    año: number,
    incluirNoImportables: boolean = false,
  ): Promise<PreviewImportResult> {
    const tm = getPrismaTransmeralda()

    // 1. TODAS las planillas de TM para ese mes/año (sin filtrar por
    //    estado del conductor). El usuario puede ver conductores
    //    inactivos en TM para entender qué falta.
    const planillasTM = await tm.recargos_planillas.findMany({
      where: {
        deleted_at: null,
        mes,
        a_o: año
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
            estado: true
          }
        },
        vehiculos: { select: { id: true, placa: true } },
        clientes: { select: { id: true, nombre: true } },
        dias_laborales_planillas: {
          where: { deleted_at: null },
          select: { id: true, dia: true },
          orderBy: { dia: 'asc' }
        }
      },
      orderBy: [{ created_at: 'desc' }]
    })

    if (planillasTM.length === 0) {
      return {
        mes,
        año,
        total: 0,
        importables: 0,
        ya_importadas: 0,
        no_importables: 0,
        filtradas_por_conductor_inactivo: 0,
        vehiculos_a_crear: 0,
        empresas_a_crear: 0,
        incluir_no_importables: incluirNoImportables,
        planillas: []
      }
    }

    // 2. Indexar por identificacion y placa para hacer 1 query por tabla
    const identificaciones = Array.from(
      new Set(
        planillasTM
          .map((p) => p.conductores?.numero_identificacion)
          .filter((x): x is string => !!x)
      )
    )
    const placas = Array.from(
      new Set(planillasTM.map((p) => p.vehiculos?.placa).filter((x): x is string => !!x))
    )
    const empresaIdsTM = Array.from(
      new Set(planillasTM.map((p) => p.empresa_id).filter(Boolean))
    )

    // Resolver nombres de empresas en TM (para crear en CM)
    const empresasTM = empresaIdsTM.length
      ? await tm.clientes.findMany({
          where: { id: { in: empresaIdsTM } },
          select: { id: true, nombre: true, nit: true }
        })
      : []
    const tmEmpById = new Map(empresasTM.map((e) => [e.id, e]))

    // Resolver placas en TM con todos sus datos (para crear en CM)
    const vehiculoIdsTM = Array.from(
      new Set(planillasTM.map((p) => p.vehiculo_id).filter(Boolean))
    )
    const vehiculosTM = vehiculoIdsTM.length
      ? await tm.vehiculos.findMany({
          where: { id: { in: vehiculoIdsTM } },
        })
      : []
    const tmVehById = new Map(vehiculosTM.map((v) => [v.id, v]))

    // 3. Queries a Cotransmeq
    const [conductoresCM, vehiculosCM, empresasCM] = await Promise.all([
      identificaciones.length
        ? prisma.conductores.findMany({
            where: { numero_identificacion: { in: identificaciones } },
            select: { id: true, numero_identificacion: true, estado: true }
          })
        : Promise.resolve([]),
      placas.length
        ? prisma.vehiculos.findMany({
            where: { placa: { in: placas } },
            select: { id: true, placa: true }
          })
        : Promise.resolve([]),
      // Match por nombre (TM y CM usan los mismos nombres de clientes)
      prisma.clientes.findMany({
        where: { deletedAt: null, nombre: { in: empresasTM.map((e) => e.nombre).filter((n): n is string => !!n) } },
        select: { id: true, nombre: true }
      })
    ])

    // 3b. Regla de negocio: califican para import los conductores que
    //     existen en Cotransmeq Y cuyo `estado` NO es `inactivo`.
    //     Se incluyen TODOS los demás enums del estado:
    //       activo, suspendido, retirado, disponible, programado,
    //       servicio, descanso.
    //
    //     `inactivo` se considera "conductor que no nos interesa"
    //     (probablemente un ex-conductor o uno dado de baja). El
    //     usuario puede correr el query PSQL de sincronización
    //     para marcar `inactivo` a los que no tengan liquidaciones
    //     2026 — pero esa decisión es de negocio, no del import.
    const idsConductorCalifica = new Set(
      conductoresCM
        .filter((c) => c.estado !== 'inactivo')
        .map((c) => c.id)
    )

    const condByIdent = new Map(
      conductoresCM.map((c) => [c.numero_identificacion, c])
    )
    const vehByPlaca = new Map(vehiculosCM.map((v) => [v.placa, v]))
    const empByNombre = new Map(
      empresasCM.map((e) => [e.nombre?.toLowerCase() || '', e])
    )

    // 4. Detectar ya importados
    //    IMPORTANTE: el matching se hace sobre el numero_planilla
    //    NORMALIZADO (con prefijo TM- si corresponde). Así si TM tiene
    //    "7176" y CM tiene "TM-7176" matchean como la misma planilla.
    const tuplasMatch = planillasTM
      .map((p) => {
        const ident = p.conductores?.numero_identificacion
        const cond = ident ? condByIdent.get(ident) : null
        return {
          source: p,
          conductorDestinoId: cond?.id ?? null,
          numero_planilla_normalizado: normalizarNumeroPlanillaTM(p.numero_planilla)
        }
      })
      .filter(
        (x) => x.conductorDestinoId !== null && x.numero_planilla_normalizado
      )
      .map((x) => ({
        conductor_id: x.conductorDestinoId!,
        numero_planilla: x.numero_planilla_normalizado,
        mes: x.source.mes,
        a_o: x.source.a_o
      }))

    const importadosCotransmeq = tuplasMatch.length
      ? await prisma.recargos_planillas.findMany({
          where: {
            deleted_at: null,
            OR: tuplasMatch.map((t) => ({
              conductor_id: t.conductor_id,
              numero_planilla: t.numero_planilla,
              mes: t.mes,
              a_o: t.a_o
            }))
          },
          select: {
            id: true,
            conductor_id: true,
            numero_planilla: true,
            mes: true,
            a_o: true
          }
        })
      : []

    const importedByKey = new Map<string, string>()
    for (const i of importadosCotransmeq) {
      importedByKey.set(
        `${i.conductor_id}__${i.numero_planilla}__${i.mes}__${i.a_o}`,
        i.id
      )
    }

    // 5. Armar respuesta
    const vehiculosACrear = new Set<string>()
    const empresasACrear = new Set<string>()

    const items: PreviewPlanillaItem[] = planillasTM.map((p) => {
      const identificacion = p.conductores?.numero_identificacion || null
      const conductorDestino = identificacion
        ? condByIdent.get(identificacion)
        : null
      const placa = p.vehiculos?.placa || null
      const vehiculoDestino = placa ? vehByPlaca.get(placa) : null

      // Empresa: match por nombre
      const empresaTMData = tmEmpById.get(p.empresa_id)
      const nombreEmpresaLower = empresaTMData?.nombre?.toLowerCase() || null
      const empresaDestino = nombreEmpresaLower
        ? empByNombre.get(nombreEmpresaLower)
        : null

      // Normalizar el número de planilla para el matching (TM-XXXX)
      const numeroNormalizado = normalizarNumeroPlanillaTM(p.numero_planilla)
      const key = `${conductorDestino?.id}__${numeroNormalizado}__${p.mes}__${p.a_o}`
      const importedId = importedByKey.get(key) || null
      const yaImportado = importedByKey.has(key)

      const conductorExiste = !!conductorDestino
      // Conductor califica en CM: existe y su estado NO es 'inactivo'.
      // Cualquier otro enum (activo, disponible, servicio, programado,
      // descanso, suspendido, retirado) es válido.
      const conductorActivoEnCM =
        !!conductorDestino && idsConductorCalifica.has(conductorDestino.id)
      const vehiculoNoExiste = !!placa && !vehiculoDestino
      const empresaNoExiste = !!nombreEmpresaLower && !empresaDestino
      const conductorActivoTM = p.conductores?.estado === 'activo'

      // Días laborados: array ascendente + versión compacta en rangos.
      // Esto permite al usuario ver "1-10, 15-20" en la columna
      // "Días" y distinguir planillas con el mismo conteo pero
      // cubriendo rangos distintos.
      const diasLista = p.dias_laborales_planillas
        .map((d) => d.dia)
        .sort((a, b) => a - b)
      const diasRangos = diasARangos(diasLista)

      // Track entidades a crear
      if (vehiculoNoExiste && placa) vehiculosACrear.add(placa)
      if (empresaNoExiste && empresaTMData?.nombre) {
        empresasACrear.add(empresaTMData.nombre)
      }

      // Motivo no importable (casos residuales, ya filtramos por
      // estado del conductor en CM al final del map):
      //   1. Conductor sin identificación
      //   2. Conductor no existe en CM
      //   3. Conductor existe pero está inactivo en CM
      //      (importante para que el badge muestre el motivo correcto
      //      cuando el toggle "Mostrar tachadas" está activo)
      //   4. Sin número de planilla
      const motivos: string[] = []
      if (!identificacion) motivos.push('Conductor sin identificación')
      else if (!conductorDestino) motivos.push('Conductor no existe en Cotransmeq')
      else if (!conductorActivoEnCM)
        motivos.push('Conductor inactivo en Cotransmeq')
      if (!p.numero_planilla) motivos.push('Sin número de planilla')

      return {
        source_id: p.id,
        conductor_nombre: `${p.conductores?.nombre ?? ''} ${p.conductores?.apellido ?? ''}`.trim(),
        conductor_identificacion: identificacion || '',
        empresa_nombre: p.clientes?.nombre || '—',
        vehiculo_placa: placa || '—',
        numero_planilla_original: p.numero_planilla || '',
        numero_planilla_normalizado: numeroNormalizado || '—',
        numero_planilla: numeroNormalizado || '—',
        mes: p.mes,
        año: p.a_o,
        dias_count: diasLista.length,
        dias_lista: diasLista,
        dias_rangos: diasRangos,
        ya_importado: yaImportado,
        conductor_existe_en_destino: conductorExiste,
        conductor_activo_en_destino: conductorActivoEnCM,
        conductor_activo_en_origen: conductorActivoTM,
        vehiculo_no_existe_en_destino: vehiculoNoExiste,
        empresa_no_existe_en_destino: empresaNoExiste,
        motivo_no_importable: motivos.length > 0 ? motivos.join(' · ') : null,
        imported_id: importedId
      }
    })

    // 5b. FILTRO PRINCIPAL: por defecto, solo se devuelven al preview
    //     las planillas cuyo conductor en Cotransmeq está
    //     `estado = 'activo'` y las ya importadas. Si se pasa
    //     `incluirNoImportables`, también se traen las tachadas con
    //     su motivo (útil para diagnóstico).
    const itemsFiltrados = incluirNoImportables
      ? items
      : items.filter((i) => i.conductor_activo_en_destino || i.ya_importado)

    const importables = itemsFiltrados.filter(
      (i) =>
        !i.ya_importado &&
        i.motivo_no_importable === null
    ).length
    const yaImportadas = itemsFiltrados.filter((i) => i.ya_importado).length
    const noImportables = itemsFiltrados.filter(
      (i) => !i.ya_importado && i.motivo_no_importable !== null
    ).length
    // Cuántas se quedaron fuera por el filtro de conductor inactivo
    // (antes del filtro de `motivo_no_importable`).
    const filtradasPorConductorInactivo = items.filter(
      (i) => !i.conductor_activo_en_destino
    ).length

    return {
      mes,
      año,
      total: itemsFiltrados.length,
      importables,
      ya_importadas: yaImportadas,
      no_importables: noImportables,
      filtradas_por_conductor_inactivo: filtradasPorConductorInactivo,
      vehiculos_a_crear: vehiculosACrear.size,
      empresas_a_crear: empresasACrear.size,
      incluir_no_importables: incluirNoImportables,
      planillas: itemsFiltrados
    }
  },

  /**
   * Crea en Cotransmeq las placas y empresas que faltan (basado en el
   * preview actual). NO importa planillas. Útil para pre-crear y luego
   * re-abrir el preview, donde esas filas ya no aparecerán como
   * "a crear".
   */
  async crearEntidadesFaltantes(mes: number, año: number, userId: string) {
    // Traer también los no importables para crear TODAS las entidades
    // faltantes (no solo las de los importables).
    const preview = await this.obtenerPreview(mes, año, true)

    const tm = getPrismaTransmeralda()
    const now = new Date()

    let vehiculosCreados = 0
    let empresasCreadas = 0
    const errores: Array<{ tipo: 'vehiculo' | 'empresa'; origen_id: string; error: string }> = []

    // Crear vehículos faltantes
    for (const item of preview.planillas) {
      if (!item.vehiculo_no_existe_en_destino) continue
      try {
        // Buscar el vehículo en TM por placa
        const vehiculoTM = await tm.vehiculos.findFirst({
          where: { placa: item.vehiculo_placa }
        })
        if (!vehiculoTM) continue

        // Verificar de nuevo por si fue creado entre el preview y ahora
        const existing = await prisma.vehiculos.findFirst({
          where: { placa: item.vehiculo_placa }
        })
        if (existing) continue

        await prisma.vehiculos.create({
          data: {
            id: randomUUID(),
            placa: vehiculoTM.placa,
            marca: vehiculoTM.marca,
            linea: vehiculoTM.linea,
            modelo: vehiculoTM.modelo,
            color: vehiculoTM.color,
            clase_vehiculo: vehiculoTM.clase_vehiculo || 'PARTICULAR',
            tipo_carroceria: vehiculoTM.tipo_carroceria,
            combustible: vehiculoTM.combustible,
            numero_motor: vehiculoTM.numero_motor,
            vin: vehiculoTM.vin,
            numero_serie: vehiculoTM.numero_serie,
            numero_chasis: vehiculoTM.numero_chasis,
            propietario_nombre: vehiculoTM.propietario_nombre,
            propietario_identificacion: vehiculoTM.propietario_identificacion,
            kilometraje: vehiculoTM.kilometraje || 0,
            fecha_matricula: vehiculoTM.fecha_matricula,
            estado: 'disponible',
            oculto: false,
            created_at: now,
            updated_at: now
          } as any
        })
        vehiculosCreados++
      } catch (e: any) {
        errores.push({
          tipo: 'vehiculo',
          origen_id: item.source_id,
          error: e?.message || 'Error desconocido'
        })
      }
    }

    // Crear empresas faltantes
    for (const item of preview.planillas) {
      if (!item.empresa_no_existe_en_destino) continue
      try {
        // Buscar la empresa en TM por nombre
        const empresaTM = await tm.clientes.findFirst({
          where: { nombre: item.empresa_nombre }
        })
        if (!empresaTM) continue

        // Verificar de nuevo
        const existing = await prisma.clientes.findFirst({
          where: { nombre: empresaTM.nombre }
        })
        if (existing) continue

        await prisma.clientes.create({
          data: {
            id: randomUUID(),
            nombre: empresaTM.nombre,
            nit: empresaTM.nit,
            representante: empresaTM.representante,
            cedula: empresaTM.cedula,
            telefono: empresaTM.telefono,
            direccion: empresaTM.direccion,
            requiere_osi: empresaTM.requiere_osi ?? false,
            paga_recargos: empresaTM.paga_recargos ?? false,
            tipo: empresaTM.tipo || 'EMPRESA',
            correo: empresaTM.correo,
            oculto: false,
            createdAt: now,
            updatedAt: now
          } as any
        })
        empresasCreadas++
      } catch (e: any) {
        errores.push({
          tipo: 'empresa',
          origen_id: item.source_id,
          error: e?.message || 'Error desconocido'
        })
      }
    }

    return {
      vehiculos_creados: vehiculosCreados,
      empresas_creadas: empresasCreadas,
      errores
    }
  },

  /**
   * Importa a Cotransmeq las planillas seleccionadas. Auto-crea las
   * placas y empresas faltantes en el mismo flujo.
   */
  async importarPlanillas(sourceIds: string[], userId: string) {
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      throw new Error('Debe proporcionar al menos un source_id')
    }
    const cleanIds = Array.from(
      new Set(sourceIds.filter((x) => typeof x === 'string' && x.length > 0))
    ).slice(0, 200)
    if (cleanIds.length === 0) {
      throw new Error('Ninguno de los source_id es válido')
    }

    const tm = getPrismaTransmeralda()

    // 1. Leer las planillas TM con sus dias
    const planillasTM = await tm.recargos_planillas.findMany({
      where: {
        id: { in: cleanIds },
        deleted_at: null
      },
      include: {
        dias_laborales_planillas: {
          where: { deleted_at: null },
          orderBy: { dia: 'asc' }
        }
      }
    })

    if (planillasTM.length === 0) {
      throw new Error('Ninguna de las planillas solicitadas existe en Transmeralda')
    }

    // 2. Resolver mapeos a Cotransmeq
    const identsSet = new Set<string>()
    const placasSet = new Set<string>()
    const empresaIdsTMSet = new Set<string>()
    const vehiculoIdsTMSet = new Set<string>()

    for (const p of planillasTM) {
      if (p.conductor_id) {
        const c = await tm.conductores.findUnique({
          where: { id: p.conductor_id },
          select: { numero_identificacion: true }
        })
        if (c?.numero_identificacion) identsSet.add(c.numero_identificacion)
      }
      if (p.vehiculo_id) vehiculoIdsTMSet.add(p.vehiculo_id)
      if (p.empresa_id) empresaIdsTMSet.add(p.empresa_id)
    }

    const vehiculosTMFull = vehiculoIdsTMSet.size
      ? await tm.vehiculos.findMany({ where: { id: { in: Array.from(vehiculoIdsTMSet) } } })
      : []
    const tmVehById = new Map(vehiculosTMFull.map((v) => [v.id, v]))
    for (const v of vehiculosTMFull) {
      if (v.placa) placasSet.add(v.placa)
    }

    const empresasTMFull = empresaIdsTMSet.size
      ? await tm.clientes.findMany({ where: { id: { in: Array.from(empresaIdsTMSet) } } })
      : []
    const tmEmpById = new Map(empresasTMFull.map((e) => [e.id, e]))

    const idents = Array.from(identsSet)
    const placas = Array.from(placasSet)
    const nombresEmpresas = empresasTMFull
      .map((e) => e.nombre)
      .filter((n): n is string => !!n)

    // 3. Queries a Cotransmeq
    const [conductoresCM, vehiculosCM, empresasCM] = await Promise.all([
      idents.length
        ? prisma.conductores.findMany({
            where: { numero_identificacion: { in: idents } },
            select: { id: true, numero_identificacion: true, estado: true }
          })
        : Promise.resolve([]),
      placas.length
        ? prisma.vehiculos.findMany({
            where: { placa: { in: placas } },
            select: { id: true, placa: true }
          })
        : Promise.resolve([]),
      nombresEmpresas.length
        ? prisma.clientes.findMany({
            where: { nombre: { in: nombresEmpresas } },
            select: { id: true, nombre: true }
          })
        : Promise.resolve([])
    ])

    // 3b. Regla: solo importamos planillas de conductores que NO estén
    //     `inactivo` en Cotransmeq. Cualquier otro enum del estado
    //     (activo, disponible, servicio, programado, descanso, etc.)
    //     califica. Coincide con el filtro del preview (defensa en
    //     profundidad por si el cliente seleccionó source_ids que ya
    //     no califican).
    const idsConductorCalifica = new Set(
      conductoresCM
        .filter((c) => c.estado !== 'inactivo')
        .map((c) => c.id)
    )

    const condByIdent = new Map(
      conductoresCM.map((c) => [c.numero_identificacion, c.id])
    )
    const vehByPlaca = new Map(vehiculosCM.map((v) => [v.placa, v.id]))
    const empByNombre = new Map(
      empresasCM.map((e) => [e.nombre || '', e.id])
    )

    const now = new Date()
    const importadas: Array<{ source_id: string; new_id: string; numero_planilla: string }> = []
    const omitidas: Array<{ source_id: string; motivo: string }> = []
    const errores: Array<{ source_id: string; error: string }> = []
    let vehiculosCreados = 0
    let empresasCreadas = 0

    for (const p of planillasTM) {
      try {
        // Resolver conductor
        const conductorTM = await tm.conductores.findUnique({
          where: { id: p.conductor_id },
          select: { numero_identificacion: true }
        })
        const ident = conductorTM?.numero_identificacion
        let conductorIdCM = ident ? condByIdent.get(ident) : null

        if (!ident) {
          omitidas.push({ source_id: p.id, motivo: 'Conductor sin identificación' })
          continue
        }
        if (!conductorIdCM) {
          omitidas.push({
            source_id: p.id,
            motivo: 'Conductor no existe en Cotransmeq (los conductores NO se crean automáticamente por temas contractuales)'
          })
          continue
        }
        // Regla de negocio: solo importamos recargos de conductores
        // que NO estén `inactivo` en Cotransmeq. Cualquier otro
        // estado (activo, disponible, servicio, programado, etc.)
        // califica. Coincide con el filtro del preview.
        if (!idsConductorCalifica.has(conductorIdCM)) {
          omitidas.push({
            source_id: p.id,
            motivo: 'Conductor inactivo en Cotransmeq (no se importa)'
          })
          continue
        }

        // Resolver vehículo (crear si no existe)
        const vehiculoTM = tmVehById.get(p.vehiculo_id)
        let vehiculoIdCM = vehiculoTM?.placa
          ? vehByPlaca.get(vehiculoTM.placa)
          : null
        if (!vehiculoIdCM && vehiculoTM?.placa) {
          // Crear vehículo en CM
          const nuevoVehiculo = await prisma.vehiculos.create({
            data: {
              id: randomUUID(),
              placa: vehiculoTM.placa,
              marca: vehiculoTM.marca,
              linea: vehiculoTM.linea,
              modelo: vehiculoTM.modelo,
              color: vehiculoTM.color,
              clase_vehiculo: vehiculoTM.clase_vehiculo || 'PARTICULAR',
              tipo_carroceria: vehiculoTM.tipo_carroceria,
              combustible: vehiculoTM.combustible,
              numero_motor: vehiculoTM.numero_motor,
              vin: vehiculoTM.vin,
              numero_serie: vehiculoTM.numero_serie,
              numero_chasis: vehiculoTM.numero_chasis,
              propietario_nombre: vehiculoTM.propietario_nombre,
              propietario_identificacion: vehiculoTM.propietario_identificacion,
              kilometraje: vehiculoTM.kilometraje || 0,
              fecha_matricula: vehiculoTM.fecha_matricula,
              estado: 'disponible',
              oculto: false,
              created_at: now,
              updated_at: now
            } as any,
            select: { id: true }
          })
          vehiculoIdCM = nuevoVehiculo.id
          vehByPlaca.set(vehiculoTM.placa, nuevoVehiculo.id)
          vehiculosCreados++
        }
        if (!vehiculoIdCM) {
          omitidas.push({ source_id: p.id, motivo: 'Vehículo no encontrado en TM' })
          continue
        }

        // Resolver empresa (crear si no existe)
        const empresaTM = tmEmpById.get(p.empresa_id)
        let empresaIdCM = empresaTM?.nombre
          ? empByNombre.get(empresaTM.nombre)
          : null
        if (!empresaIdCM && empresaTM?.nombre) {
          const nuevaEmpresa = await prisma.clientes.create({
            data: {
              id: randomUUID(),
              nombre: empresaTM.nombre,
              nit: empresaTM.nit,
              representante: empresaTM.representante,
              cedula: empresaTM.cedula,
              telefono: empresaTM.telefono,
              direccion: empresaTM.direccion,
              requiere_osi: empresaTM.requiere_osi ?? false,
              paga_recargos: empresaTM.paga_recargos ?? false,
              tipo: empresaTM.tipo || 'EMPRESA',
              correo: empresaTM.correo,
              oculto: false,
              createdAt: now,
              updatedAt: now
            } as any,
            select: { id: true }
          })
          empresaIdCM = nuevaEmpresa.id
          empByNombre.set(empresaTM.nombre, nuevaEmpresa.id)
          empresasCreadas++
        }
        if (!empresaIdCM) {
          omitidas.push({ source_id: p.id, motivo: 'Empresa no encontrada en TM' })
          continue
        }

        if (!p.numero_planilla) {
          omitidas.push({ source_id: p.id, motivo: 'Planilla sin número' })
          continue
        }

        // Normalizar numero_planilla (agrega TM- si es solo dígito)
        const numeroPlanillaFinal = normalizarNumeroPlanillaTM(p.numero_planilla)
        if (!numeroPlanillaFinal) {
          omitidas.push({ source_id: p.id, motivo: 'Planilla sin número válido' })
          continue
        }

        // Deduplicación: comparar contra el numero NORMALIZADO para
        // cubrir el caso "7176" en TM vs "TM-7176" en CM.
        const existing = await prisma.recargos_planillas.findFirst({
          where: {
            conductor_id: conductorIdCM,
            numero_planilla: numeroPlanillaFinal,
            mes: p.mes,
            a_o: p.a_o,
            deleted_at: null
          },
          select: { id: true }
        })
        if (existing) {
          omitidas.push({
            source_id: p.id,
            motivo: `Ya importada (recargo_id=${existing.id})`
          })
          continue
        }

        // 4. Crear recargo_planilla + dias_laborales_planillas
        const newRecargoId = randomUUID()
        await prisma.$transaction(async (tx) => {
          await tx.recargos_planillas.create({
            data: {
              id: newRecargoId,
              conductor_id: conductorIdCM!,
              vehiculo_id: vehiculoIdCM!,
              empresa_id: empresaIdCM!,
              numero_planilla: numeroPlanillaFinal,
              mes: p.mes,
              a_o: p.a_o,
              observaciones: p.observaciones
                ? `[Importado de Transmeralda] ${p.observaciones}`
                : '[Importado de Transmeralda]',
              estado: 'pendiente',
              version: 1,
              creado_por_id: userId,
              created_at: now,
              updated_at: now,
              // Marcamos el origen para que la UI pueda mostrar el badge
              // "Trasladado de Transmeralda" y permitir filtrar.
              imported_from_transmeralda_id: p.id,
              imported_from_transmeralda_at: now,
              via_trocha: p.via_trocha ?? false,
              via_afirmado: p.via_afirmado ?? false,
              via_mixto: p.via_mixto ?? false,
              via_pavimentada: p.via_pavimentada ?? false,
              riesgo_desniveles: p.riesgo_desniveles ?? false,
              riesgo_deslizamientos: p.riesgo_deslizamientos ?? false,
              riesgo_sin_senalizacion: p.riesgo_sin_senalizacion ?? false,
              riesgo_animales: p.riesgo_animales ?? false,
              riesgo_peatones: p.riesgo_peatones ?? false,
              riesgo_trafico_alto: p.riesgo_trafico_alto ?? false,
              estado_conductor: p.estado_conductor as any,
              fuente_consulta: p.fuente_consulta as any,
              calificacion_servicio: p.calificacion_servicio as any,
              tiempo_disponibilidad_horas: p.tiempo_disponibilidad_horas,
              duracion_trayecto_horas: p.duracion_trayecto_horas,
              numero_dias_servicio: p.numero_dias_servicio,
              servicio_id: null
            } as any
          })

          if (p.dias_laborales_planillas.length > 0) {
            await tx.dias_laborales_planillas.createMany({
              data: p.dias_laborales_planillas.map((d) => ({
                id: randomUUID(),
                recargo_planilla_id: newRecargoId,
                dia: d.dia,
                hora_inicio: d.hora_inicio,
                hora_fin: d.hora_fin,
                total_horas: d.total_horas,
                horas_ordinarias: d.horas_ordinarias,
                es_festivo: d.es_festivo,
                es_domingo: d.es_domingo,
                observaciones: d.observaciones,
                creado_por_id: userId,
                created_at: now,
                updated_at: now,
                disponibilidad: d.disponibilidad,
                kilometraje_inicial: d.kilometraje_inicial,
                kilometraje_final: d.kilometraje_final,
                pernocte: d.pernocte,
                continua_siguiente_dia: d.continua_siguiente_dia ?? false
              }))
            })
          }
        })

        // 5. Recalcular para regenerar detalles con config CM
        try {
          await RecargosService.recalcular(newRecargoId, userId)
        } catch (recErr: any) {
          console.warn(
            `[importarTransmeralda] recalcular() falló para ${newRecargoId}:`,
            recErr?.message || recErr
          )
        }

        try {
          await RecargosService.actualizarTotales(newRecargoId)
        } catch (totErr: any) {
          console.warn(
            `[importarTransmeralda] actualizarTotales() falló para ${newRecargoId}:`,
            totErr?.message || totErr
          )
        }

        importadas.push({
          source_id: p.id,
          new_id: newRecargoId,
          numero_planilla: numeroPlanillaFinal
        })
      } catch (err: any) {
        console.error(`[importarTransmeralda] Error en ${p.id}:`, err)
        errores.push({
          source_id: p.id,
          error: err?.message || 'Error desconocido'
        })
      }
    }

    return {
      solicitadas: cleanIds.length,
      importadas: importadas.length,
      omitidas: omitidas.length,
      errores: errores.length,
      vehiculos_creados: vehiculosCreados,
      empresas_creadas: empresasCreadas,
      detalle: {
        importadas,
        omitidas,
        errores
      }
    }
  }
}
