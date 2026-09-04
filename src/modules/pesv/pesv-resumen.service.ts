/**
 * Resumen del ciclo: lo que se ve al abrir el módulo.
 *
 * Regla de oro de esta pantalla: **no muestra cumplimiento ficticio.** Si no hay
 * ciclo, lo dice. Si un indicador no se puede calcular, aparece como
 * `SIN_DATOS` con el motivo. Si un paso tiene archivos pero sin aprobar, cuenta
 * como en revisión y no como cumplido.
 *
 * Todas las consultas van en paralelo y comparten una única `fechaCorte`: con
 * un instante por bloque, dos tarjetas de la misma pantalla podrían responder a
 * fotos distintas y nadie sabría cuál mirar.
 */

import { prisma } from '../../config/prisma'
import { construirPeriodo, hoyEnBogota, type Periodo } from './dominio/periodos'
import { calcularIndicadores, coberturaGlobal, type ResultadoIndicador } from './indicadores'
import {
  obtenerCicloDelAnio,
  obtenerMatriz,
  resumirMatriz,
  type FilaMatriz,
} from './pesv-ciclos.service'
import { evaluarCobertura, resumirCobertura } from './pesv-contratos.service'
import { listarDocumentos, resumirDocumentos } from './pesv-documentos.service'
import { alertasMantenimiento } from './pesv-operacion.service'

export interface AlertaResumen {
  code: string
  titulo: string
  detalle: string
  cantidad: number
  severidad: 'CRITICA' | 'ALTA' | 'MEDIA' | 'INFORMATIVA'
  enlace: string
}

export interface ResumenPesv {
  ciclo: {
    id: string
    anio: number
    nivel: string
    estado: string
    lider: string | null
    diasPorVencer: number
  } | null
  /** Qué hacer cuando no hay ciclo. La pantalla no inventa uno. */
  sinCiclo: { anio: number; mensaje: string; accion: string } | null
  periodo: Periodo
  fechaCorte: string
  cumplimiento: ReturnType<typeof resumirMatriz> | null
  evidencias: {
    pendientesRevision: number
    rechazadas: number
    vencidas: number
    enlace: string
  }
  indicadores: {
    total: number
    ok: number
    alerta: number
    critico: number
    sinDatos: number
    criticos: Array<Pick<ResultadoIndicador, 'code' | 'nombre' | 'value' | 'unit' | 'target' | 'status'>>
    cobertura: ReturnType<typeof coberturaGlobal>
  }
  documentos: ReturnType<typeof resumirDocumentos>
  inspecciones: { indicador: ResultadoIndicador | null }
  mantenimiento: { vencidos: number; proximos: number }
  velocidad: { eventos: number; indicador: ResultadoIndicador | null }
  siniestros: { total: number; conFatalidad: number; sinInvestigar: number }
  contratos: ReturnType<typeof resumirCobertura>
  actividades: { total: number; vencidas: number; completadas: number; pendientes: number }
  alertas: AlertaResumen[]
}

/**
 * Arma el resumen.
 *
 * `conTendencia: false` en los indicadores del resumen: aquí solo se necesitan
 * los estados, y calcular el período anterior duplicaría catorce consultas para
 * una flecha que esta pantalla no pinta. El detalle de indicadores sí la trae.
 */
export async function construirResumen(anio: number, trimestre?: number | null, mes?: number | null): Promise<ResumenPesv> {
  const periodo = construirPeriodo(anio, trimestre, mes)
  const fechaCorte = new Date().toISOString()
  const hoy = hoyEnBogota()
  const ciclo = await obtenerCicloDelAnio(anio)

  const [
    matriz,
    evidenciasAgrupadas,
    indicadores,
    documentos,
    mantenimiento,
    cobertura,
    siniestros,
    actividades,
    eventosVelocidad,
  ] = await Promise.all([
    ciclo ? obtenerMatriz(ciclo.id) : Promise.resolve<FilaMatriz[]>([]),
    ciclo
      ? prisma.pesv_evidence.groupBy({
          by: ['estado_revision'],
          where: { deleted_at: null, requisito: { cycle_id: ciclo.id, deleted_at: null } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    calcularIndicadores(ciclo?.id ?? null, periodo, { conTendencia: false }),
    listarDocumentos({ corte: hoy }),
    alertasMantenimiento(ciclo?.dias_por_vencer ?? 30),
    evaluarCobertura({ desde: periodo.desde, hasta: periodo.hasta }),
    prisma.pesv_incident.findMany({
      where: {
        deleted_at: null,
        fecha: { gte: new Date(`${periodo.desde}T00:00:00Z`), lte: new Date(`${periodo.hasta}T00:00:00Z`) },
        ...(ciclo ? { cycle_id: ciclo.id } : {}),
      },
      select: { id: true, severidad: true, investigacion_realizada: true },
    }),
    prisma.actividades_pesv.groupBy({
      by: ['estado'],
      where: {
        deleted_at: null,
        ...(ciclo ? { OR: [{ cycle_id: ciclo.id }, { cycle_id: null, anio }] } : { anio }),
      },
      _count: { _all: true },
    }),
    prisma.pesv_speed_event.count({
      where: {
        deleted_at: null,
        business_date: {
          gte: new Date(`${periodo.desde}T00:00:00Z`),
          lte: new Date(`${periodo.hasta}T00:00:00Z`),
        },
      },
    }),
  ])

  const vencidas = ciclo
    ? await prisma.pesv_evidence.count({
        where: {
          deleted_at: null,
          estado_revision: 'APROBADO',
          vigencia_hasta: { lt: new Date(`${hoy}T00:00:00Z`) },
          requisito: { cycle_id: ciclo.id, deleted_at: null },
        },
      })
    : 0

  const contarEvidencias = (estado: string) =>
    evidenciasAgrupadas.find((g) => g.estado_revision === estado)?._count._all ?? 0

  const porEstadoActividad = (estado: string) =>
    actividades.find((a) => a.estado === estado)?._count._all ?? 0

  const cumplimiento = ciclo ? resumirMatriz(matriz) : null
  const resumenDocs = resumirDocumentos(documentos)
  const resumenCobertura = resumirCobertura(cobertura)

  const indicadoresCriticos = indicadores.filter((i) => i.status === 'CRITICO' || i.status === 'ALERTA')

  const resumen: ResumenPesv = {
    ciclo: ciclo
      ? {
          id: ciclo.id,
          anio: ciclo.anio,
          nivel: ciclo.nivel,
          estado: ciclo.estado,
          lider: ciclo.lider_nombre,
          diasPorVencer: ciclo.dias_por_vencer,
        }
      : null,
    sinCiclo: ciclo
      ? null
      : {
          anio,
          mensaje: `No hay un ciclo PESV abierto para ${anio}. Sin ciclo no hay matriz de pasos ni metas contra las que medir.`,
          /// El ciclo se crea explícitamente y con autoría. Sembrarlo al abrir
          /// la pantalla dejaría ciclos creados por quien pasó por ahí.
          accion: 'Cree el ciclo anual desde el encabezado del módulo.',
        },
    periodo,
    fechaCorte,
    cumplimiento,
    evidencias: {
      pendientesRevision: contarEvidencias('PENDIENTE'),
      rechazadas: contarEvidencias('RECHAZADO'),
      vencidas,
      enlace: '/dashboard/pesv?vista=matriz&panel=bandeja&estadoEvidencia=PENDIENTE',
    },
    indicadores: {
      total: indicadores.length,
      ok: indicadores.filter((i) => i.status === 'OK').length,
      alerta: indicadores.filter((i) => i.status === 'ALERTA').length,
      critico: indicadores.filter((i) => i.status === 'CRITICO').length,
      sinDatos: indicadores.filter((i) => i.status === 'SIN_DATOS').length,
      criticos: indicadoresCriticos.map((i) => ({
        code: i.code,
        nombre: i.nombre,
        value: i.value,
        unit: i.unit,
        target: i.target,
        status: i.status,
      })),
      cobertura: coberturaGlobal(indicadores),
    },
    documentos: resumenDocs,
    inspecciones: { indicador: indicadores.find((i) => i.code === 'IDP') ?? null },
    mantenimiento: {
      vencidos:
        mantenimiento.planes.filter((p) => p.estado === 'VENCIDO').length +
        mantenimiento.intervenciones.filter((i) => i.estado === 'VENCIDO').length,
      proximos:
        mantenimiento.planes.filter((p) => p.estado === 'PROXIMO').length +
        mantenimiento.intervenciones.filter((i) => i.estado === 'PROXIMO').length,
    },
    velocidad: { eventos: eventosVelocidad, indicador: indicadores.find((i) => i.code === 'ELVL') ?? null },
    siniestros: {
      total: siniestros.length,
      conFatalidad: siniestros.filter((s) => s.severidad === 'FATALIDAD').length,
      sinInvestigar: siniestros.filter((s) => !s.investigacion_realizada).length,
    },
    contratos: resumenCobertura,
    actividades: {
      total: actividades.reduce((a, g) => a + g._count._all, 0),
      vencidas: porEstadoActividad('VENCIDA'),
      completadas: porEstadoActividad('COMPLETADA'),
      pendientes: porEstadoActividad('PENDIENTE') + porEstadoActividad('EN_PROGRESO'),
    },
    alertas: [],
  }

  resumen.alertas = construirAlertas(resumen, matriz)
  return resumen
}

/**
 * Alertas accionables, ordenadas por severidad.
 *
 * Cada una lleva enlace al sitio donde se corrige. Una alerta sin destino es
 * una queja: el usuario ve que algo va mal y tiene que adivinar dónde tocar, y
 * a la tercera vez deja de mirarlas.
 */
function construirAlertas(resumen: ResumenPesv, matriz: FilaMatriz[]): AlertaResumen[] {
  const alertas: AlertaResumen[] = []
  const agregar = (a: AlertaResumen) => {
    if (a.cantidad > 0) alertas.push(a)
  }

  if (resumen.siniestros.conFatalidad > 0) {
    agregar({
      code: 'SINIESTROS_FATALES',
      titulo: 'Siniestros con fatalidad en el periodo',
      detalle: 'Exigen investigación interna, acción correctiva y reporte.',
      cantidad: resumen.siniestros.conFatalidad,
      severidad: 'CRITICA',
      enlace: '/dashboard/pesv?vista=operacion&panel=siniestros',
    })
  }

  agregar({
    code: 'SINIESTROS_SIN_INVESTIGAR',
    titulo: 'Siniestros sin investigación registrada',
    detalle: 'El paso 13 exige investigación de causas para cada evento.',
    cantidad: resumen.siniestros.sinInvestigar,
    severidad: 'ALTA',
    enlace: '/dashboard/pesv?vista=operacion&panel=siniestros',
  })

  agregar({
    code: 'DOCUMENTOS_VENCIDOS',
    titulo: 'Documentos vencidos',
    detalle: 'Un documento vencido no habilita al conductor ni al vehículo.',
    cantidad: resumen.documentos.vencidos,
    severidad: 'CRITICA',
    enlace: '/dashboard/pesv?vista=documentos&estadoVigencia=VENCIDO',
  })

  agregar({
    code: 'DOCUMENTOS_POR_VENCER',
    titulo: 'Documentos próximos a vencer',
    detalle: `Dentro de la ventana de ${resumen.ciclo?.diasPorVencer ?? 30} días configurada.`,
    cantidad: resumen.documentos.porVencer,
    severidad: 'MEDIA',
    enlace: '/dashboard/pesv?vista=documentos&estadoVigencia=POR_VENCER',
  })

  agregar({
    code: 'EVIDENCIAS_PENDIENTES',
    titulo: 'Evidencias esperando revisión de HSEQ',
    detalle: 'Mientras no se aprueben, sus pasos no pueden declararse cumplidos.',
    cantidad: resumen.evidencias.pendientesRevision,
    severidad: 'ALTA',
    enlace: resumen.evidencias.enlace,
  })

  agregar({
    code: 'EVIDENCIAS_VENCIDAS',
    titulo: 'Evidencias aprobadas pero vencidas',
    detalle: 'Su vigencia expiró: dejaron de acreditar el requisito.',
    cantidad: resumen.evidencias.vencidas,
    severidad: 'ALTA',
    enlace: '/dashboard/pesv?vista=matriz&panel=bandeja',
  })

  agregar({
    code: 'MANTENIMIENTOS_VENCIDOS',
    titulo: 'Mantenimientos vencidos',
    detalle: 'Vehículos operando con el preventivo fuera de plazo.',
    cantidad: resumen.mantenimiento.vencidos,
    severidad: 'CRITICA',
    enlace: '/dashboard/pesv?vista=operacion&panel=mantenimiento',
  })

  agregar({
    code: 'SERVICIOS_SIN_COBERTURA',
    titulo: 'Servicios sin contrato o FUEC válido',
    detalle: 'No se puede demostrar la habilitación del desplazamiento.',
    cantidad: resumen.contratos.sinCobertura,
    severidad: 'ALTA',
    enlace: '/dashboard/pesv?vista=contratos',
  })

  agregar({
    code: 'ACTIVIDADES_ATRASADAS',
    titulo: 'Actividades del plan anual atrasadas',
    detalle: 'Pasaron su fecha límite sin ejecutarse.',
    cantidad: resumen.actividades.vencidas,
    severidad: 'MEDIA',
    enlace: '/dashboard/pesv?vista=plan&estado=VENCIDA',
  })

  agregar({
    code: 'PASOS_VENCIDOS',
    titulo: 'Pasos de la matriz con plazo vencido',
    detalle: 'Su fecha límite pasó y siguen sin cumplirse.',
    cantidad: matriz.filter((f) => f.vencido).length,
    severidad: 'ALTA',
    enlace: '/dashboard/pesv?vista=matriz',
  })

  agregar({
    code: 'INDICADORES_CRITICOS',
    titulo: 'Indicadores en estado crítico',
    detalle: 'Están fuera de la meta aprobada por HSEQ.',
    cantidad: resumen.indicadores.critico,
    severidad: 'ALTA',
    enlace: '/dashboard/pesv?vista=indicadores&estado=CRITICO',
  })

  /// `SIN_DATOS` es informativo y no una falla: durante la transición habrá
  /// indicadores sin insumos, y presentarlos en rojo haría que el panel
  /// pareciera roto en vez de honesto. Pero se listan, porque cada uno señala
  /// una captura que falta.
  agregar({
    code: 'INDICADORES_SIN_DATOS',
    titulo: 'Indicadores sin datos suficientes',
    detalle: 'No se calculan por falta de insumos. Cada uno explica qué falta capturar.',
    cantidad: resumen.indicadores.sinDatos,
    severidad: 'INFORMATIVA',
    enlace: '/dashboard/pesv?vista=indicadores&estado=SIN_DATOS',
  })

  agregar({
    code: 'DOCUMENTOS_OBLIGATORIOS_SIN_ACREDITAR',
    titulo: 'Documentos obligatorios sin acreditar',
    detalle: 'Faltan, están vencidos o no han pasado revisión.',
    cantidad: resumen.documentos.obligatoriosSinAcreditar,
    severidad: 'ALTA',
    enlace: '/dashboard/pesv?vista=documentos',
  })

  const orden = { CRITICA: 0, ALTA: 1, MEDIA: 2, INFORMATIVA: 3 }
  return alertas.sort((a, b) => orden[a.severidad] - orden[b.severidad] || b.cantidad - a.cantidad)
}
