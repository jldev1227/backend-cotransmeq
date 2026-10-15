import { prisma } from '../../config/prisma'

export type TipoEntidadAnalitica = 'conductor' | 'vehiculo' | 'cliente' | 'tercero'

export interface PeriodoAnalitica {
  desde: Date
  hasta: Date
  desdeIso: string
  hastaIso: string
  historico?: boolean
}

const numero = (valor: unknown) => Number(valor ?? 0)

/// Los formularios históricos no siempre tienen propósito PESV: el nombre publicado
/// sigue identificando el preoperacional sin reclasificar otros envíos.
const esPreoperacional = (assignment: { name: string; pesv_proposito: string | null }) =>
  assignment.pesv_proposito === 'PREOPERACIONAL' || /preoperacion/i.test(assignment.name)

function hoyBogota() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)!.value
  return new Date(`${valor('year')}-${valor('month')}-${valor('day')}T00:00:00.000Z`)
}

const camposFuec = {
  id: true, numero_completo: true, consecutivo: true, estado: true,
  vigencia_desde: true, vigencia_hasta: true, vehiculo_placa: true,
} as const

function rangoMeses(periodo: PeriodoAnalitica) {
  const meses: Array<{ a_o: number; mes: number }> = []
  const cursor = new Date(Date.UTC(periodo.desde.getUTCFullYear(), periodo.desde.getUTCMonth(), 1))
  const fin = new Date(Date.UTC(periodo.hasta.getUTCFullYear(), periodo.hasta.getUTCMonth(), 1))
  while (cursor <= fin) {
    meses.push({ a_o: cursor.getUTCFullYear(), mes: cursor.getUTCMonth() + 1 })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return meses
}

function etiquetasMes(periodo: PeriodoAnalitica) {
  return rangoMeses(periodo).map(({ a_o, mes }) => `${a_o}-${String(mes).padStart(2, '0')}`)
}

function contarServiciosUnicos(
  servicios: Array<{ id: string }>,
  planillas: Array<{ id: string; servicio_id: string | null }>,
) {
  const ids = new Set(servicios.map((servicio) => `servicio:${servicio.id}`))
  for (const planilla of planillas) {
    ids.add(planilla.servicio_id ? `servicio:${planilla.servicio_id}` : `planilla:${planilla.id}`)
  }
  return ids.size
}

function faltantes(campos: Record<string, unknown>) {
  return Object.entries(campos)
    .filter(([, valor]) => valor == null || String(valor).trim() === '')
    .map(([campo]) => campo)
}

function agruparZonasCliente(servicios: any[]) {
  const zonas = new Map<string, { nombre: string; departamento: string | null; servicios: Set<string>; latitudes: number[]; longitudes: number[] }>()
  for (const servicio of servicios) {
    const extremos = [
      {
        nombre: servicio.origen_especifico,
        latitud: servicio.origen_latitud ?? servicio.municipios_servicio_origen_idTomunicipios?.latitud,
        longitud: servicio.origen_longitud ?? servicio.municipios_servicio_origen_idTomunicipios?.longitud,
        municipio: servicio.municipios_servicio_origen_idTomunicipios,
      },
      {
        nombre: servicio.destino_especifico,
        latitud: servicio.destino_latitud ?? servicio.municipios_servicio_destino_idTomunicipios?.latitud,
        longitud: servicio.destino_longitud ?? servicio.municipios_servicio_destino_idTomunicipios?.longitud,
        municipio: servicio.municipios_servicio_destino_idTomunicipios,
      },
    ]
    const zonasServicio = new Set<string>()
    for (const extremo of extremos) {
      const nombre = extremo.municipio?.nombre_municipio ?? extremo.nombre
      if (!nombre) continue
      const latitud = extremo.latitud == null ? null : Number(extremo.latitud)
      const longitud = extremo.longitud == null ? null : Number(extremo.longitud)
      const tieneCoordenadas = latitud != null && longitud != null && Number.isFinite(latitud) && Number.isFinite(longitud)
      const zonaId = extremo.municipio?.id ?? nombre.trim().toLocaleLowerCase('es-CO')
      let zona = zonas.get(zonaId)
      if (!zona) {
        zona = {
          nombre,
          departamento: extremo.municipio?.nombre_departamento ?? null,
          servicios: new Set<string>(),
          latitudes: [],
          longitudes: [],
        }
        zonas.set(zonaId, zona)
      }
      zonasServicio.add(zonaId)
      if (tieneCoordenadas) {
        zona.latitudes.push(latitud!)
        zona.longitudes.push(longitud!)
      }
    }
    for (const zonaId of zonasServicio) zonas.get(zonaId)?.servicios.add(servicio.id)
  }
  return [...zonas.values()]
    .map((zona) => ({
      nombre: zona.nombre,
      departamento: zona.departamento,
      servicios: zona.servicios.size,
      latitud: zona.latitudes.length ? zona.latitudes.reduce((suma, valor) => suma + valor, 0) / zona.latitudes.length : null,
      longitud: zona.longitudes.length ? zona.longitudes.reduce((suma, valor) => suma + valor, 0) / zona.longitudes.length : null,
    }))
    .sort((a, b) => b.servicios - a.servicios)
    .slice(0, 30)
}

async function conductor(id: string, periodo: PeriodoAnalitica) {
  const meses = rangoMeses(periodo)
  const [ficha, jornadas, servicios, planillas, liquidaciones, formularios, extractos] = await Promise.all([
    prisma.conductores.findFirst({ where: { id, deleted_at: null } }),
    prisma.registro_dia_laboral.findMany({
      where: { conductor_id: id, fecha: { gte: periodo.desde, lte: periodo.hasta }, deleted_at: null },
      select: {
        id: true,
        fecha: true,
        tipo: true,
        mantenimiento_vehiculo_placa: true,
        segmentos: {
          where: { deleted_at: null },
          select: { vehiculo_placa: true, km_inicial: true, km_final: true, horas_conducidas: true },
        },
        bonos: { where: { deleted_at: null }, select: { valor: true } },
      },
    }),
    prisma.servicio.findMany({
      where: {
        conductor_id: id,
        deleted_at: null,
        OR: [
          { fecha_realizacion: { gte: periodo.desde, lte: periodo.hasta } },
          { fecha_realizacion: null, fecha_solicitud: { gte: periodo.desde, lte: periodo.hasta } },
        ],
      },
      select: { id: true },
    }),
    prisma.recargos_planillas.findMany({
      where: { conductor_id: id, deleted_at: null, OR: meses },
      select: { id: true, servicio_id: true, total_dias_laborados: true },
    }),
    prisma.liquidaciones.findMany({
      where: { conductor_id: id, deleted_at: null },
      select: {
        periodo_start: true,
        periodo_end: true,
        sueldo_total: true,
        salario_devengado: true,
        total_recargos: true,
        total_bonificaciones: true,
      },
    }),
    prisma.form_submission.findMany({
      where: {
        conductor_id: id,
        business_date: { gte: periodo.desde, lte: periodo.hasta },
        status: 'SUBMITTED',
        deleted_at: null,
      },
      select: { id: true, vehicle_id: true, business_date: true, assignment: { select: { name: true, pesv_proposito: true } } },
    }),
    prisma.fuec_extract_driver.findMany({
      where: {
        conductor_id: id,
        fuec: { deleted_at: null, estado: { in: ['VIGENTE', 'VENCIDO'] } },
      },
      select: {
        fuec: {
          select: {
            ...camposFuec,
          },
        },
      },
      orderBy: { fuec: { vigencia_hasta: 'desc' } },
    }),
  ])
  if (!ficha) throw new Error('Conductor no encontrado')
  const [asistencias, evaluaciones] = ficha.numero_identificacion
    ? await Promise.all([
        prisma.respuestas_asistencia.count({
          where: {
            numero_documento: ficha.numero_identificacion,
            formulario: { fecha: { gte: periodo.desde, lte: periodo.hasta }, deleted_at: null },
          },
        }),
        prisma.resultado.findMany({
          where: {
            numero_documento: ficha.numero_identificacion,
            created_at: { gte: periodo.desde, lte: periodo.hasta },
          },
          select: { puntaje_total: true },
        }),
      ])
    : [0, []]

  const tipos: Record<string, number> = { LABORADO: 0, DISPONIBLE: 0, DESCANSO: 0, MANTENIMIENTO: 0 }
  const mantenimientos: Array<{ fecha: string; placa: string | null }> = []
  let kilometros = 0
  let horas = 0
  let bonosRecorridos = 0
  for (const jornada of jornadas) {
    const tipo = jornada.tipo.toUpperCase()
    tipos[tipo] = (tipos[tipo] ?? 0) + 1
    if (tipo === 'MANTENIMIENTO') {
      mantenimientos.push({
        fecha: jornada.fecha.toISOString().slice(0, 10),
        placa: jornada.mantenimiento_vehiculo_placa,
      })
    }
    for (const segmento of jornada.segmentos) {
      if (segmento.km_inicial != null && segmento.km_final != null)
        kilometros += Math.max(0, segmento.km_final - segmento.km_inicial)
      horas += numero(segmento.horas_conducidas)
    }
    bonosRecorridos += jornada.bonos.reduce((suma, bono) => suma + numero(bono.valor), 0)
  }

  const liquidacionesPeriodo = liquidaciones.filter((liquidacion) => {
    const inicio = new Date(liquidacion.periodo_start)
    const fin = new Date(liquidacion.periodo_end)
    return !Number.isNaN(inicio.getTime()) && !Number.isNaN(fin.getTime()) && fin >= periodo.desde && inicio <= periodo.hasta
  })
  const nomina = liquidacionesPeriodo.reduce(
    (acc, liquidacion) => ({
      total: acc.total + numero(liquidacion.sueldo_total || liquidacion.salario_devengado),
      recargos: acc.recargos + numero(liquidacion.total_recargos),
      bonificaciones: acc.bonificaciones + numero(liquidacion.total_bonificaciones),
    }),
    { total: 0, recargos: 0, bonificaciones: 0 },
  )
  const ahora = hoyBogota()
  const actual = extractos.find(({ fuec }) =>
    fuec.estado === 'VIGENTE' && fuec.vigencia_desde <= ahora && fuec.vigencia_hasta >= ahora,
  )?.fuec ?? extractos[0]?.fuec ?? null
  const fuecsVigentes = extractos
    .map(({ fuec }) => fuec)
    .filter((fuec) => fuec.estado === 'VIGENTE' && fuec.vigencia_desde <= ahora && fuec.vigencia_hasta >= ahora)
  const fuecsVencidosPeriodo = extractos
    .map(({ fuec }) => fuec)
    .filter((fuec) => fuec.vigencia_hasta >= periodo.desde && fuec.vigencia_hasta <= periodo.hasta && (fuec.vigencia_hasta < ahora || fuec.estado === 'VENCIDO'))
  const diasParaVencer = actual
    ? Math.ceil((actual.vigencia_hasta.getTime() - Date.now()) / 86_400_000)
    : null
  const hastaRegistro = periodo.hasta < ahora ? periodo.hasta : ahora
  const diasEsperados = hastaRegistro < periodo.desde
    ? 0
    : Math.floor((hastaRegistro.getTime() - periodo.desde.getTime()) / 86_400_000) + 1
  const diasRegistrados = new Set(jornadas.map((jornada) => jornada.fecha.toISOString().slice(0, 10))).size

  return {
    periodo: { desde: periodo.desdeIso, hasta: periodo.hastaIso },
    resumen: {
      servicios_desplazamientos: contarServiciosUnicos(servicios, planillas),
      dias_laborados: tipos.LABORADO ?? 0,
      dias_disponible: tipos.DISPONIBLE ?? 0,
      dias_descanso: tipos.DESCANSO ?? 0,
      dias_mantenimiento: tipos.MANTENIMIENTO ?? 0,
      dias_registrados: diasRegistrados,
      dias_sin_registro: Math.max(0, diasEsperados - diasRegistrados),
      kilometros,
      horas_conducidas: horas,
      nomina_total: nomina.total,
      recargos_nomina: nomina.recargos,
      bonificaciones: nomina.bonificaciones || bonosRecorridos,
      formularios: formularios.length,
      preoperacionales: formularios.filter((f) => esPreoperacional(f.assignment)).length,
      asistencias,
      evaluaciones: evaluaciones.length,
      puntaje_evaluaciones: evaluaciones.length
        ? Math.round(evaluaciones.reduce((s, item) => s + item.puntaje_total, 0) / evaluaciones.length)
        : 0,
      extractos_vencidos: new Set(fuecsVencidosPeriodo.map((fuec) => fuec.id)).size,
    },
    detalle: {
      mantenimientos,
      preoperacionales: formularios.filter((f) => esPreoperacional(f.assignment)).map((f) => ({
        id: f.id, nombre: f.assignment.name, fecha: f.business_date,
      })),
    },
    fuecs_vigentes: fuecsVigentes,
    fuecs_vencidos_periodo: fuecsVencidosPeriodo.slice(0, 30),
    extracto: actual
      ? {
          ...actual,
          dias_para_vencer: diasParaVencer,
          vencido: diasParaVencer! < 0 || actual.estado === 'VENCIDO',
          es_vigente: diasParaVencer! >= 0 && actual.estado === 'VIGENTE',
        }
      : null,
  }
}

async function vehiculo(id: string, periodo: PeriodoAnalitica) {
  const meses = rangoMeses(periodo)
  const [ficha, segmentos, jornadasMantenimiento, servicios, planillas, formularios, ordenes, recargos, documentos] =
    await Promise.all([
      prisma.vehiculos.findFirst({ where: { id, deleted_at: null } }),
      prisma.registro_dia_laboral_segmento.findMany({
        where: {
          vehiculo_id: id,
          deleted_at: null,
          registro_dia: { fecha: { gte: periodo.desde, lte: periodo.hasta }, deleted_at: null },
        },
        select: {
          km_inicial: true,
          km_final: true,
          registro_dia: { select: { conductor_id: true, fecha: true, conductor: { select: { nombre: true, apellido: true } } } },
        },
      }),
      prisma.registro_dia_laboral.findMany({
        where: {
          mantenimiento_vehiculo_id: id,
          fecha: { gte: periodo.desde, lte: periodo.hasta },
          deleted_at: null,
        },
        select: { id: true, fecha: true, conductor: { select: { id: true, nombre: true, apellido: true } } },
      }),
      prisma.servicio.findMany({
        where: {
          vehiculo_id: id,
          deleted_at: null,
          OR: [
            { fecha_realizacion: { gte: periodo.desde, lte: periodo.hasta } },
            { fecha_realizacion: null, fecha_solicitud: { gte: periodo.desde, lte: periodo.hasta } },
          ],
        },
        select: { id: true, conductor_id: true, conductores: { select: { nombre: true, apellido: true } } },
      }),
      prisma.recargos_planillas.findMany({
        where: { vehiculo_id: id, deleted_at: null, OR: meses },
        select: { id: true, servicio_id: true, conductor_id: true, conductores: { select: { nombre: true, apellido: true } } },
      }),
      prisma.form_submission.findMany({
        where: {
          vehicle_id: id,
          business_date: { gte: periodo.desde, lte: periodo.hasta },
          status: 'SUBMITTED',
          deleted_at: null,
        },
        select: { id: true, business_date: true, assignment: { select: { name: true, pesv_proposito: true } } },
      }),
      prisma.vehicle_maintenance_event.findMany({
        where: {
          vehiculo_id: id,
          deleted_at: null,
          OR: [
            { fecha_ejecucion: { gte: periodo.desde, lte: periodo.hasta } },
            { fecha_ejecucion: null, fecha_programada: { gte: periodo.desde, lte: periodo.hasta } },
          ],
        },
        select: { id: true, consecutivo: true, estado: true, descripcion: true, fecha_ejecucion: true, costo: true },
        orderBy: { consecutivo: 'desc' },
      }),
      prisma.recargos.findMany({
        where: { vehiculo_id: id, deleted_at: null, mes: { in: etiquetasMes(periodo) } },
        select: { valor: true },
      }),
      prisma.documento.findMany({
        where: { vehiculo_id: id, deleted_at: null },
        select: {
          id: true,
          categoria: true,
          tipo_documento: true,
          numero: true,
          estado: true,
          estado_revision: true,
          fecha_vigencia: true,
          fecha_vencimiento: true,
        },
        orderBy: { created_at: 'desc' },
      }),
    ])
  if (!ficha) throw new Error('Vehículo no encontrado')
  const fuecsVigentes = await prisma.fuec_extract.findMany({
    where: {
      vehiculo_id: id, deleted_at: null, estado: 'VIGENTE',
      vigencia_desde: { lte: hoyBogota() }, vigencia_hasta: { gte: hoyBogota() },
    },
    select: camposFuec,
    orderBy: { vigencia_hasta: 'asc' },
  })
  const fuecsRecientes = await prisma.fuec_extract.findMany({
    where: { vehiculo_id: id, deleted_at: null, estado: { in: ['VIGENTE', 'VENCIDO'] } },
    select: camposFuec,
    orderBy: { vigencia_hasta: 'desc' },
    take: 5,
  })
  const conductores = new Set<string>()
  const nombresConductores = new Map<string, string>()
  let kilometros = 0
  for (const segmento of segmentos) {
    conductores.add(segmento.registro_dia.conductor_id)
    nombresConductores.set(
      segmento.registro_dia.conductor_id,
      `${segmento.registro_dia.conductor.nombre} ${segmento.registro_dia.conductor.apellido}`.trim(),
    )
    if (segmento.km_inicial != null && segmento.km_final != null)
      kilometros += Math.max(0, segmento.km_final - segmento.km_inicial)
  }
  servicios.forEach((s) => {
    if (!s.conductor_id) return
    conductores.add(s.conductor_id)
    if (s.conductores) nombresConductores.set(s.conductor_id, `${s.conductores.nombre} ${s.conductores.apellido}`.trim())
  })
  planillas.forEach((p) => {
    conductores.add(p.conductor_id)
    nombresConductores.set(p.conductor_id, `${p.conductores.nombre} ${p.conductores.apellido}`.trim())
  })
  jornadasMantenimiento.forEach((j) => {
    conductores.add(j.conductor.id)
    nombresConductores.set(j.conductor.id, `${j.conductor.nombre} ${j.conductor.apellido}`.trim())
  })
  const preoperacionales = formularios.filter((f) => esPreoperacional(f.assignment))
  const actas = formularios.filter((f) => /acta.*entrega|entrega.*veh/i.test(f.assignment.name))
  const ahora = new Date()
  const documentosConVigencia = documentos.map((documento) => {
    const vencimiento = documento.fecha_vencimiento ?? documento.fecha_vigencia
    const diasParaVencer = vencimiento ? Math.ceil((vencimiento.getTime() - ahora.getTime()) / 86_400_000) : null
    return {
      ...documento,
      fecha_vencimiento: vencimiento?.toISOString().slice(0, 10) ?? null,
      dias_para_vencer: diasParaVencer,
      vencido: diasParaVencer != null && diasParaVencer < 0,
    }
  })
  return {
    periodo: { desde: periodo.desdeIso, hasta: periodo.hastaIso },
    resumen: {
      servicios_desplazamientos: contarServiciosUnicos(servicios, planillas),
      kilometros,
      conductores_distintos: conductores.size,
      dias_mantenimiento: jornadasMantenimiento.length,
      ordenes_mantenimiento: ordenes.length,
      costo_mantenimiento: ordenes.reduce((s, o) => s + numero(o.costo), 0),
      formularios: formularios.length,
      preoperacionales: preoperacionales.length,
      actas_entrega: actas.length,
      recargos_generados: recargos.reduce((s, r) => s + numero(r.valor), 0),
      documentos_vencidos: documentosConVigencia.filter((d) => d.vencido).length,
      documentos_por_vencer: documentosConVigencia.filter(
        (d) => d.dias_para_vencer != null && d.dias_para_vencer >= 0 && d.dias_para_vencer <= 30,
      ).length,
      documentos_sin_vigencia: documentosConVigencia.filter((d) => d.dias_para_vencer == null).length,
    },
    detalle: {
      mantenimientos: jornadasMantenimiento.map((j) => ({
        fecha: j.fecha.toISOString().slice(0, 10),
        conductor: `${j.conductor.nombre} ${j.conductor.apellido}`.trim(),
      })),
      ordenes,
      conductores: [...nombresConductores].map(([id, nombre]) => ({ id, nombre })),
      propietario: ficha.tercero_propietario_id
        ? { id: ficha.tercero_propietario_id, nombre: ficha.propietario_nombre, identificacion: ficha.propietario_identificacion }
        : null,
      documentos: documentosConVigencia,
      preoperacionales: preoperacionales.map((f) => ({ id: f.id, nombre: f.assignment.name, fecha: f.business_date })),
    },
    fuecs_vigentes: fuecsVigentes,
    fuecs_recientes: fuecsRecientes,
  }
}

async function cliente(id: string, periodo: PeriodoAnalitica) {
  const meses = periodo.historico ? [] : rangoMeses(periodo)
  const [ficha, servicios, planillas, segmentos, recargos, serviciosMapaHistorico] = await Promise.all([
    prisma.clientes.findFirst({ where: { id, deletedAt: null } }),
    prisma.servicio.findMany({
      where: {
        cliente_id: id,
        deleted_at: null,
        ...(!periodo.historico && { OR: [
          { fecha_realizacion: { gte: periodo.desde, lte: periodo.hasta } },
          { fecha_realizacion: null, fecha_solicitud: { gte: periodo.desde, lte: periodo.hasta } },
        ] }),
      },
      select: {
        id: true,
        fecha_realizacion: true,
        fecha_solicitud: true,
        origen_especifico: true,
        destino_especifico: true,
        origen_latitud: true,
        origen_longitud: true,
        destino_latitud: true,
        destino_longitud: true,
        municipios_servicio_origen_idTomunicipios: { select: { id: true, nombre_municipio: true, nombre_departamento: true, latitud: true, longitud: true } },
        municipios_servicio_destino_idTomunicipios: { select: { id: true, nombre_municipio: true, nombre_departamento: true, latitud: true, longitud: true } },
      },
    }),
    prisma.recargos_planillas.findMany({
      where: { empresa_id: id, deleted_at: null, ...(!periodo.historico && { OR: meses }) },
      select: { id: true, servicio_id: true, a_o: true, mes: true },
    }),
    prisma.registro_dia_laboral_segmento.findMany({
      where: {
        cliente_id: id,
        deleted_at: null,
        registro_dia: { deleted_at: null, ...(!periodo.historico && { fecha: { gte: periodo.desde, lte: periodo.hasta } }) },
      },
      select: { id: true, km_inicial: true, km_final: true },
    }),
    prisma.recargos.findMany({
      where: { empresa_id: id, deleted_at: null, ...(!periodo.historico && { mes: { in: etiquetasMes(periodo) } }) },
      select: { valor: true },
    }),
    periodo.historico ? Promise.resolve([]) : prisma.servicio.findMany({
      where: { cliente_id: id, deleted_at: null },
      select: {
        id: true,
        origen_especifico: true,
        destino_especifico: true,
        origen_latitud: true,
        origen_longitud: true,
        destino_latitud: true,
        destino_longitud: true,
        municipios_servicio_origen_idTomunicipios: { select: { id: true, nombre_municipio: true, nombre_departamento: true, latitud: true, longitud: true } },
        municipios_servicio_destino_idTomunicipios: { select: { id: true, nombre_municipio: true, nombre_departamento: true, latitud: true, longitud: true } },
      },
      orderBy: [{ fecha_realizacion: 'desc' }, { fecha_solicitud: 'desc' }],
      take: 2000,
    }),
  ])
  if (!ficha) throw new Error('Cliente no encontrado')
  const fuecsVigentes = await prisma.fuec_extract.findMany({
    where: {
      deleted_at: null, estado: 'VIGENTE',
      vigencia_desde: { lte: hoyBogota() }, vigencia_hasta: { gte: hoyBogota() },
      OR: [
        { contratante: { is: { cliente_id: id } } },
        ...(ficha.nit ? [{ contratante_nit: ficha.nit }] : []),
      ],
    },
    select: camposFuec,
    orderBy: { vigencia_hasta: 'asc' },
  })
  const zonas = agruparZonasCliente(servicios)
  const zonasHistoricas = periodo.historico ? zonas : agruparZonasCliente(serviciosMapaHistorico)
  const rutas = (periodo.historico ? [] : servicios)
    .map((s) => ({
      s,
      origenLatitud: s.origen_latitud ?? s.municipios_servicio_origen_idTomunicipios?.latitud,
      origenLongitud: s.origen_longitud ?? s.municipios_servicio_origen_idTomunicipios?.longitud,
      destinoLatitud: s.destino_latitud ?? s.municipios_servicio_destino_idTomunicipios?.latitud,
      destinoLongitud: s.destino_longitud ?? s.municipios_servicio_destino_idTomunicipios?.longitud,
    }))
    .filter(({ origenLatitud, origenLongitud, destinoLatitud, destinoLongitud }) =>
      origenLatitud != null && origenLongitud != null && destinoLatitud != null && destinoLongitud != null,
    )
    .map(({ s, origenLatitud, origenLongitud, destinoLatitud, destinoLongitud }) => ({
      servicio_id: s.id,
      origen: {
        nombre: s.municipios_servicio_origen_idTomunicipios?.nombre_municipio ?? s.origen_especifico,
        latitud: origenLatitud,
        longitud: origenLongitud,
      },
      destino: {
        nombre: s.municipios_servicio_destino_idTomunicipios?.nombre_municipio ?? s.destino_especifico,
        latitud: destinoLatitud,
        longitud: destinoLongitud,
      },
    }))
  const serviciosDesplazamientos = contarServiciosUnicos(servicios, planillas)
  const primeraActividad = periodo.historico
    ? [
        ...servicios.map((s) => (s.fecha_realizacion ?? s.fecha_solicitud).getTime()),
        ...planillas.map((p) => Date.UTC(p.a_o, p.mes - 1, 1)),
      ].reduce((menor, fecha) => Math.min(menor, fecha), Number.POSITIVE_INFINITY)
    : periodo.desde.getTime()
  const finActividad = periodo.historico ? Date.now() : periodo.hasta.getTime()
  const diasPeriodo = Math.max(1, Math.floor((finActividad - (Number.isFinite(primeraActividad) ? primeraActividad : finActividad)) / 86_400_000) + 1)
  const diasConServicios = new Set(
    servicios.map((servicio) => (servicio.fecha_realizacion ?? servicio.fecha_solicitud).toISOString().slice(0, 10)),
  ).size
  return {
    periodo: { desde: periodo.desdeIso, hasta: periodo.hastaIso, historico: !!periodo.historico },
    resumen: {
      servicios_desplazamientos: serviciosDesplazamientos,
      planillas: planillas.length,
      tramos_recorrido: segmentos.length,
      kilometros: segmentos.reduce(
        (s, segmento) => s + (segmento.km_inicial != null && segmento.km_final != null ? Math.max(0, segmento.km_final - segmento.km_inicial) : 0),
        0,
      ),
      recargos_generados: recargos.reduce((s, r) => s + numero(r.valor), 0),
      dias_con_servicios: diasConServicios,
      promedio_servicios_semana: Number(((serviciosDesplazamientos / diasPeriodo) * 7).toFixed(1)),
    },
    faltantes: faltantes({
      telefono: ficha.telefono,
      correo: ficha.correo,
      direccion: ficha.direccion,
      municipio_sede: ficha.municipio_sede,
      departamento_sede: ficha.departamento_sede,
    }),
    sede: { municipio: ficha.municipio_sede, departamento: ficha.departamento_sede },
    zonas,
    zonas_historicas: zonasHistoricas,
    rutas,
    fuecs_vigentes: fuecsVigentes,
  }
}

async function tercero(id: string, periodo: PeriodoAnalitica) {
  const [ficha, vehiculos, cierres] = await Promise.all([
    prisma.terceros.findFirst({ where: { id, deleted_at: null } }),
    prisma.vehiculos.findMany({
      where: { tercero_propietario_id: id, deleted_at: null },
      select: { id: true, placa: true, marca: true, linea: true, modelo: true, estado: true },
      orderBy: { placa: 'asc' },
    }),
    prisma.liquidacion_tercero_final.findMany({
      where: {
        tercero_id: id,
        deleted_at: null,
        OR: rangoMeses(periodo).map(({ a_o, mes }) => ({ anio: a_o, mes })),
      },
      select: { id: true, consecutivo: true, estado: true, total_pagar: true, anio: true, mes: true, created_at: true },
      orderBy: { created_at: 'desc' },
    }),
  ])
  if (!ficha) throw new Error('Tercero no encontrado')
  return {
    periodo: { desde: periodo.desdeIso, hasta: periodo.hastaIso },
    resumen: {
      vehiculos_propios: vehiculos.length,
      liquidaciones_finales: cierres.length,
      total_liquidado: cierres.reduce((s, cierre) => s + numero(cierre.total_pagar), 0),
    },
    faltantes: faltantes({
      identificacion: ficha.identificacion,
      telefono: ficha.telefono,
      correo: ficha.correo,
      direccion: ficha.direccion,
    }),
    notas: ficha.notas,
    vehiculos,
    liquidaciones: cierres,
  }
}

export async function obtenerAnaliticaIndividual(tipo: TipoEntidadAnalitica, id: string, periodo: PeriodoAnalitica) {
  if (tipo === 'conductor') return conductor(id, periodo)
  if (tipo === 'vehiculo') return vehiculo(id, periodo)
  if (tipo === 'cliente') return cliente(id, periodo)
  return tercero(id, periodo)
}
