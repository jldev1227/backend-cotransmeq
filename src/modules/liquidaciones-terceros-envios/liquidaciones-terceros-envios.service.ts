/**
 * Persistencia de los envíos por correo de liquidaciones de terceros.
 *
 * Cada intento de envío deja UNA fila en `liquidacion_tercero_envio`, se
 * complete o no: la pregunta que este módulo responde es "¿a quién se le
 * envió ya, cuándo y a qué correo?", y esa respuesta tiene que sobrevivir a
 * reinicios del proceso (la cola vive en memoria; el log no).
 */

import { prisma } from '../../config/prisma'
import { randomUUID } from 'crypto'

export type EnvioTipoRegistro = 'CIERRE' | 'INGRESO' | 'OCASIONAL'

export interface RegistroEnvioInput {
  tipo: EnvioTipoRegistro
  cierre_id: string | null
  origen_id: string | null
  tercero_id: string | null
  anio: number
  mes: number
  placa: string
  email_destino: string
  asunto: string
  mensaje: string | null
  adjuntos: Array<{ filename: string; size: number; tipo: string }>
  es_prueba: boolean
  enviado_por_id: string | null
  enviado_por: string | null
}

/** Resumen por cierre para pintar el estado en el canvas/modal. */
export interface EstadoEnvioCierre {
  cierre_id: string
  /** Último envío REAL (no prueba) que terminó en ENVIADO. */
  ultimo_enviado: { email_destino: string; enviado_at: string } | null
  /** Último intento real fallido posterior al último enviado, si lo hay. */
  ultimo_error: { email_destino: string; error: string | null; created_at: string } | null
  /** Nº de envíos reales completados. */
  enviados: number
  /** Nº de envíos de prueba completados. */
  pruebas: number
  /**
   * Último envío real correcto POR DESTINATARIO (correo en minúsculas).
   *
   * El agregado por cierre no basta desde que una placa multi-propietario
   * manda un correo a cada copropietario: con solo el contador, en cuanto se
   * le enviaba a uno la fila de TODOS los demás se pintaba de «enviado» y no
   * había forma de ver a quién faltaba.
   */
  por_destinatario: Record<string, { enviado_at: string }>
}

export const LiquidacionesTercerosEnviosService = {
  /** Crea la fila en ENVIANDO; la cola la resuelve a ENVIADO o ERROR. */
  async crearRegistro(input: RegistroEnvioInput) {
    return prisma.liquidacion_tercero_envio.create({
      data: {
        id: randomUUID(),
        tipo: input.tipo,
        cierre_id: input.cierre_id,
        origen_id: input.origen_id,
        tercero_id: input.tercero_id,
        anio: input.anio,
        mes: input.mes,
        placa: input.placa,
        email_destino: input.email_destino,
        asunto: input.asunto,
        mensaje: input.mensaje,
        adjuntos: input.adjuntos,
        estado: 'ENVIANDO',
        es_prueba: input.es_prueba,
        enviado_por_id: input.enviado_por_id,
        enviado_por: input.enviado_por,
      },
    })
  },

  async marcarEnviado(id: string, proveedor: string, messageId: string | null) {
    return prisma.liquidacion_tercero_envio.update({
      where: { id },
      data: { estado: 'ENVIADO', proveedor, message_id: messageId, enviado_at: new Date(), error: null },
    })
  },

  async marcarError(id: string, error: string) {
    return prisma.liquidacion_tercero_envio.update({
      where: { id },
      // El texto del error se corta: algunos SMTP devuelven volcados de
      // varios KB y esto es una columna de diagnóstico, no un log.
      data: { estado: 'ERROR', error: error.slice(0, 2000) },
    })
  },

  /**
   * Estado de envíos de TODOS los cierres de un periodo, agregado por cierre.
   *
   * Se trae el periodo completo y se reduce en memoria: un mes son decenas
   * de cierres con pocos envíos cada uno, y el shape de salida (último real,
   * último error, contadores) no se expresa bien en un solo groupBy.
   */
  async estadoPorPeriodo(anio: number, mes: number): Promise<Record<string, EstadoEnvioCierre>> {
    const filas = await prisma.liquidacion_tercero_envio.findMany({
      where: { anio, mes, tipo: 'CIERRE', cierre_id: { not: null } },
      orderBy: { created_at: 'desc' },
      select: {
        cierre_id: true,
        email_destino: true,
        estado: true,
        error: true,
        es_prueba: true,
        enviado_at: true,
        created_at: true,
      },
    })

    const out: Record<string, EstadoEnvioCierre> = {}
    for (const f of filas) {
      const cierreId = f.cierre_id!
      let e = out[cierreId]
      if (!e) {
        e = {
          cierre_id: cierreId,
          ultimo_enviado: null,
          ultimo_error: null,
          enviados: 0,
          pruebas: 0,
          por_destinatario: {},
        }
        out[cierreId] = e
      }
      if (f.estado === 'ENVIADO') {
        if (f.es_prueba) {
          e.pruebas++
        } else {
          e.enviados++
          const cuando = (f.enviado_at ?? f.created_at).toISOString()
          if (!e.ultimo_enviado) {
            e.ultimo_enviado = { email_destino: f.email_destino, enviado_at: cuando }
          }
          // Las filas vienen ordenadas por `created_at` descendente: la
          // primera que se ve de cada correo es la más reciente.
          const clave = f.email_destino.trim().toLowerCase()
          if (clave && !e.por_destinatario[clave]) {
            e.por_destinatario[clave] = { enviado_at: cuando }
          }
        }
      } else if (f.estado === 'ERROR' && !f.es_prueba && !e.ultimo_error && !e.ultimo_enviado) {
        // Solo interesa el error si es lo ÚLTIMO que pasó: un error antiguo
        // seguido de un envío correcto no debe pintar la fila en rojo.
        e.ultimo_error = {
          email_destino: f.email_destino,
          error: f.error,
          created_at: f.created_at.toISOString(),
        }
      }
    }
    return out
  },

  /**
   * Historial de envíos de un periodo para los canvas SIN cierre por placa
   * (ingresos y ocasional): la constancia es la lista tal cual, no un
   * agregado por cierre.
   */
  async historialPorPeriodo(tipo: EnvioTipoRegistro, anio: number, mes: number) {
    return prisma.liquidacion_tercero_envio.findMany({
      where: { tipo, anio, mes },
      orderBy: { created_at: 'desc' },
      take: 100,
      select: {
        id: true,
        placa: true,
        email_destino: true,
        asunto: true,
        estado: true,
        error: true,
        es_prueba: true,
        adjuntos: true,
        enviado_por: true,
        enviado_at: true,
        created_at: true,
      },
    })
  },

  /** Historial completo de un cierre, del más reciente al más antiguo. */
  async historialDeCierre(cierreId: string) {
    return prisma.liquidacion_tercero_envio.findMany({
      where: { cierre_id: cierreId },
      orderBy: { created_at: 'desc' },
      take: 50,
    })
  },
}
