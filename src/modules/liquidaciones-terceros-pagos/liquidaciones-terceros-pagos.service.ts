/**
 * Pagos de los cierres finales de terceros: cuándo, cómo y con qué soporte
 * se le pagó al propietario.
 *
 * El paso a PAGADA lo sigue haciendo `CierreEstadoService`, que llama a
 * `registrarEnTx` dentro de su misma transacción: así no puede quedar un
 * cierre PAGADA sin su fila de pago (ni una fila sin el estado) porque uno de
 * los dos pasos falló a medias.
 */
import { randomUUID } from 'crypto'
import path from 'path'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl, uploadToS3 } from '../../config/aws'
import { aFechaDb, isoDia, PREFIJO_COMPROBANTE_PAGO_TERCERO } from '../../lib/pagos/medios'
import type { DatosPagoCierre } from './pago-cierre'

export class ErrorPagoCierre extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
  }
}

const SELECT_PAGO = {
  id: true,
  liquidacion_tercero_final_id: true,
  fecha: true,
  medio: true,
  referencia: true,
  valor: true,
  comprobante_s3_key: true,
  comprobante_nombre: true,
  observaciones: true,
  created_at: true,
  deleted_at: true,
  motivo_eliminacion: true,
  registrado_por: { select: { id: true, nombre: true } },
} satisfies Prisma.liquidacion_tercero_final_pagoSelect

type FilaPago = Prisma.liquidacion_tercero_final_pagoGetPayload<{ select: typeof SELECT_PAGO }>

function serializar(p: FilaPago) {
  return {
    id: p.id,
    cierre_id: p.liquidacion_tercero_final_id,
    fecha: isoDia(p.fecha)!,
    medio: p.medio,
    referencia: p.referencia,
    valor: p.valor == null ? null : Number(p.valor),
    tiene_comprobante: Boolean(p.comprobante_s3_key),
    comprobante_nombre: p.comprobante_nombre,
    observaciones: p.observaciones,
    registrado: p.created_at.toISOString(),
    registrado_por: p.registrado_por ? { id: p.registrado_por.id, nombre: p.registrado_por.nombre } : null,
    archivado: p.deleted_at ? p.deleted_at.toISOString() : null,
    motivo_archivo: p.motivo_eliminacion,
  }
}

export type PagoCierre = ReturnType<typeof serializar>

/** Los cierres que se ven como pagados: PAGADA y el heredado FACTURADA. */
const ESTADOS_PAGADOS = ['PAGADA', 'FACTURADA']

export const LiquidacionesTercerosPagosService = {
  /**
   * Crea el pago vivo de un cierre dentro de la transacción del cambio de
   * estado. Si quedara uno vivo de antes (no debería: salir de PAGADA lo
   * archiva), se archiva primero para no chocar con el índice único parcial.
   */
  async registrarEnTx(
    tx: Prisma.TransactionClient,
    cierreId: string,
    pago: DatosPagoCierre,
    usuarioId: string | null,
    valor: Prisma.Decimal | number | null,
  ) {
    await this.archivarEnTx(tx, cierreId, usuarioId, 'Reemplazado por un pago nuevo')
    return tx.liquidacion_tercero_final_pago.create({
      data: {
        liquidacion_tercero_final_id: cierreId,
        fecha: aFechaDb(pago.fecha),
        medio: pago.medio,
        referencia: pago.referencia ?? null,
        observaciones: pago.observaciones ?? null,
        comprobante_s3_key: pago.comprobante_s3_key ?? null,
        comprobante_nombre: pago.comprobante_s3_key ? (pago.comprobante_nombre ?? null) : null,
        valor: valor == null ? null : Number(valor),
        registrado_por_id: usuarioId,
      },
      select: { id: true },
    })
  },

  /** Archiva (no borra) el pago vivo: el cierre dejó de estar pagado. */
  async archivarEnTx(tx: Prisma.TransactionClient, cierreId: string, usuarioId: string | null, motivo: string) {
    await tx.liquidacion_tercero_final_pago.updateMany({
      where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
      data: { deleted_at: new Date(), eliminado_por_id: usuarioId, motivo_eliminacion: motivo },
    })
  },

  /**
   * Pago vivo de un cierre y los archivados, más si el cierre «debería»
   * tenerlo. `sin_registro` es el caso de los PAGADA anteriores a este
   * registro: están pagados, pero nadie anotó cómo.
   */
  async obtener(cierreId: string) {
    const cierre = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: cierreId, deleted_at: null },
      select: { id: true, estado: true, placa: true, consecutivo: true, total_pagar: true },
    })
    if (!cierre) throw new ErrorPagoCierre('Cierre no encontrado', 404)
    const filas = await prisma.liquidacion_tercero_final_pago.findMany({
      where: { liquidacion_tercero_final_id: cierreId },
      select: SELECT_PAGO,
      orderBy: { created_at: 'desc' },
    })
    const activo = filas.find((f) => !f.deleted_at) ?? null
    const pagado = ESTADOS_PAGADOS.includes(cierre.estado)
    return {
      cierre: {
        id: cierre.id,
        estado: cierre.estado,
        placa: cierre.placa,
        consecutivo: cierre.consecutivo,
        total_pagar: Number(cierre.total_pagar),
      },
      pago: activo ? serializar(activo) : null,
      sin_registro: pagado && !activo,
      historial: filas.filter((f) => f.deleted_at).map(serializar),
    }
  },

  /**
   * Pagos vivos de los cierres de un periodo, por id de cierre. Es lo que
   * pinta el canvas junto al estado de cada hoja sin pedir uno a uno.
   */
  async porPeriodo(anio: number, mes: number) {
    const filas = await prisma.liquidacion_tercero_final_pago.findMany({
      where: { deleted_at: null, liquidacion_tercero_final: { anio, mes, deleted_at: null } },
      select: SELECT_PAGO,
    })
    return Object.fromEntries(filas.map((f) => [f.liquidacion_tercero_final_id, serializar(f)]))
  },

  /**
   * Registra o corrige el pago de un cierre que YA está PAGADA, sin tocar
   * su estado. Cubre los PAGADA históricos «sin registro» y la corrección de
   * un dato mal digitado; el anterior queda archivado, no se pisa.
   */
  async completar(cierreId: string, pago: DatosPagoCierre, usuarioId: string | null) {
    const cierre = await prisma.liquidacion_tercero_final.findFirst({
      where: { id: cierreId, deleted_at: null },
      select: { estado: true, total_pagar: true },
    })
    if (!cierre) throw new ErrorPagoCierre('Cierre no encontrado', 404)
    if (!ESTADOS_PAGADOS.includes(cierre.estado)) {
      throw new ErrorPagoCierre(
        `El cierre está ${cierre.estado}: el pago se registra al marcarlo PAGADA desde el estado.`,
        409,
      )
    }
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM liquidacion_tercero_final WHERE id = ${cierreId}::uuid FOR UPDATE`
      /// Corregir la fecha o la referencia sin volver a subir el soporte no
      /// debe dejar el pago vivo sin él: se hereda del registro que se archiva.
      if (!pago.comprobante_s3_key) {
        const previo = await tx.liquidacion_tercero_final_pago.findFirst({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
          select: { comprobante_s3_key: true, comprobante_nombre: true },
        })
        if (previo?.comprobante_s3_key) {
          pago = { ...pago, comprobante_s3_key: previo.comprobante_s3_key, comprobante_nombre: previo.comprobante_nombre }
        }
      }
      await this.registrarEnTx(tx, cierreId, pago, usuarioId, cierre.total_pagar)
    })
    return this.obtener(cierreId)
  },

  /**
   * Sube el comprobante ANTES de marcar el cierre (o el lote) como PAGADA y
   * devuelve la clave que luego viaja con el cambio de estado. Un lote de
   * hojas pagadas con una sola transferencia comparte el mismo soporte.
   *
   * Si el usuario cancela después de subir, el archivo queda sin fila que lo
   * use. Es el precio de no tener que mandar el archivo dentro del cambio de
   * estado, que es JSON y lo comparten la hoja suelta y el lote.
   */
  async subirComprobante(archivo: { buffer: Buffer; nombre: string; mimetype: string }, hoy: string) {
    const ext = (path.extname(archivo.nombre) || '.pdf').toLowerCase().replace('.jpeg', '.jpg')
    if (!/^\.(pdf|jpg|png|webp)$/.test(ext)) throw new ErrorPagoCierre('El comprobante debe ser PDF o imagen')
    const s3Key = `${PREFIJO_COMPROBANTE_PAGO_TERCERO}${hoy.slice(0, 7)}/${randomUUID()}${ext}`
    await uploadToS3(s3Key, archivo.buffer, archivo.mimetype)
    return { s3_key: s3Key, nombre: archivo.nombre.slice(0, 255) }
  },

  /** URL firmada (15 min) del comprobante de un pago, vivo o archivado. */
  async urlComprobante(pagoId: string) {
    const p = await prisma.liquidacion_tercero_final_pago.findFirst({
      where: { id: pagoId, liquidacion_tercero_final: { deleted_at: null } },
      select: { comprobante_s3_key: true },
    })
    if (!p?.comprobante_s3_key) throw new ErrorPagoCierre('El pago no tiene comprobante', 404)
    return getS3SignedUrl(p.comprobante_s3_key, 15 * 60)
  },
}
