import { prisma } from '../../config/prisma'
import { FastifyRequest } from 'fastify'
import crypto from 'crypto'

const MASTER_KEY_HEX = process.env.LIQ_CHAT_SECRET || crypto.randomBytes(32).toString('hex')
const MASTER_KEY = Buffer.from(MASTER_KEY_HEX, 'hex')

function deriveKey(liquidacionId: string): Buffer {
  const salt = Buffer.from(liquidacionId, 'utf8')
  const info = Buffer.from('liq-chat-v1', 'utf8')
  return hkdf(MASTER_KEY, salt, info, 32)
}

function hkdf(key: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  const hmac = crypto.createHmac('sha256', salt)
  hmac.update(key)
  hmac.update(info)
  const prk = hmac.digest()
  const okm = Buffer.alloc(length)
  let t = Buffer.alloc(0)
  let i = 1
  let offset = 0
  while (offset < length) {
    const hmac2 = crypto.createHmac('sha256', prk)
    hmac2.update(t)
    hmac2.update(info)
    hmac2.update(Buffer.from([i]))
    t = hmac2.digest()
    t.copy(okm, offset)
    offset += t.length
    i++
  }
  return okm
}

export function encryptMessage(liquidacionId: string, plainText: string): { ciphertext: string; nonce: string } {
  const key = deriveKey(liquidacionId)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(liquidacionId, 'utf8'))
  let encrypted = cipher.update(plainText, 'utf8')
  encrypted = Buffer.concat([encrypted, cipher.final()])
  const authTag = cipher.getAuthTag()
  const ciphertext = Buffer.concat([encrypted, authTag]).toString('base64')
  return { ciphertext, nonce: iv.toString('base64') }
}

export function decryptMessage(liquidacionId: string, ciphertext: string, nonce: string): string {
  const key = deriveKey(liquidacionId)
  const iv = Buffer.from(nonce, 'base64')
  const data = Buffer.from(ciphertext, 'base64')
  const authTag = data.slice(-16)
  const encrypted = data.slice(0, -16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(Buffer.from(liquidacionId, 'utf8'))
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encrypted)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  return decrypted.toString('utf8')
}

interface AuthUser {
  id: string
  nombre: string
  correo: string
}

function getUser(req: FastifyRequest): AuthUser {
  return (req as any).user
}

export const LiquidacionesChatService = {
  async listarMensajes(liquidacionId: string, before?: string, limit = 50) {
    const where: any = {
      liquidacion_tercero_id: liquidacionId,
      deleted_at: null,
    }
    if (before) {
      where.created_at = { lt: new Date(before) }
    }

    const mensajes = await prisma.liquidacion_chat_mensaje.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        usuario: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    })

    mensajes.reverse()

    const total = await prisma.liquidacion_chat_mensaje.count({ where })
    const mensajesDecifrados = mensajes.map((m) => {
      let contenidoPlano = ''
      try {
        contenidoPlano = decryptMessage(liquidacionId, m.contenido_cifrado, m.nonce)
      } catch (e) {
        contenidoPlano = m.contenido_cifrado
      }
      return {
        id: m.id,
        liquidacion_tercero_id: m.liquidacion_tercero_id,
        usuario_id: m.usuario_id,
        usuario_nombre: m.usuario?.nombre || '',
        contenido: contenidoPlano,
        nonce: m.nonce,
        tipo: m.tipo,
        recordatorio_id: m.recordatorio_id,
        created_at: m.created_at,
      }
    })
    return { mensajes: mensajesDecifrados, hasMore: total > limit }
  },

  async enviarMensaje(liquidacionId: string, userId: string, contenido: string, tipo: string, recordatorioId?: string) {
    const { ciphertext, nonce } = encryptMessage(liquidacionId, contenido)

    const mensaje = await prisma.liquidacion_chat_mensaje.create({
      data: {
        liquidacion_tercero_id: liquidacionId,
        usuario_id: userId,
        contenido_cifrado: ciphertext,
        nonce,
        tipo,
        recordatorio_id: recordatorioId || null,
      },
      include: {
        usuario: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    })

    return {
      id: mensaje.id,
      liquidacion_tercero_id: mensaje.liquidacion_tercero_id,
      usuario_id: mensaje.usuario_id,
      usuario_nombre: mensaje.usuario?.nombre || '',
      usuario: mensaje.usuario,
      contenido,
      nonce: mensaje.nonce,
      tipo: mensaje.tipo,
      recordatorio_id: mensaje.recordatorio_id,
      created_at: mensaje.created_at,
    }
  },

  async eliminarMensaje(messageId: string, userId: string) {
    const msg = await prisma.liquidacion_chat_mensaje.findUnique({
      where: { id: messageId },
    })

    if (!msg || msg.usuario_id !== userId) {
      throw new Error('No autorizado')
    }

    await prisma.liquidacion_chat_mensaje.update({
      where: { id: messageId },
      data: { deleted_at: new Date() },
    })
  },

  async listarRecordatorios(liquidacionId: string) {
    return prisma.liquidacion_recordatorio.findMany({
      where: {
        liquidacion_origen_id: liquidacionId,
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
      include: {
        creado_por: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    })
  },

  async crearRecordatorio(
    liquidacionId: string,
    userId: string,
    data: {
      placa: string
      mes: number
      anio: number
      descripcion: string
      monto?: number
      prioridad: string
      aplica_en?: string
    },
  ) {
    const { ciphertext, nonce } = encryptMessage(liquidacionId, data.descripcion)

    const recordatorio = await prisma.liquidacion_recordatorio.create({
      data: {
        liquidacion_origen_id: liquidacionId,
        placa: data.placa,
        mes: data.mes,
        anio: data.anio,
        descripcion_cifrada: ciphertext,
        descripcion_nonce: nonce,
        monto: data.monto ? String(data.monto) : null,
        prioridad: data.prioridad,
        creado_por_usuario_id: userId,
        aplica_en: data.aplica_en ? new Date(data.aplica_en) : null,
      },
      include: {
        creado_por: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    })

    return recordatorio
  },

  async cambiarEstadoRecordatorio(recordatorioId: string, estado: string, liquidacionAplicadaId?: string) {
    return prisma.liquidacion_recordatorio.update({
      where: { id: recordatorioId },
      data: {
        estado,
        aplicado_en_liquidacion_id: liquidacionAplicadaId || null,
      },
      include: {
        creado_por: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    })
  },

  async pendientesPorPlaca(placa: string, mes: number, anio: number) {
    const recordatorios = await prisma.liquidacion_recordatorio.findMany({
      where: {
        placa,
        mes,
        anio,
        estado: 'PENDIENTE',
        deleted_at: null,
      },
      include: {
        creado_por: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    })

    return recordatorios.map((r) => ({
      ...r,
      monto: r.monto ? parseFloat(r.monto as any) : null,
    }))
  },
}
