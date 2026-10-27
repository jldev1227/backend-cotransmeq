import { createHmac, randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { getIo } from '../../sockets'
import { EVENTOS_ENCUESTAS } from './encuestas.events'
import {
  encuestaSchema, type EncuestaInput, type Pregunta, type RespuestaInput
} from './encuestas.schema'

export class EncuestaError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message)
  }
}

const activa = { deleted_at: null }

function preguntasDe(valor: unknown): Pregunta[] {
  return Array.isArray(valor) ? valor as Pregunta[] : []
}

function fechaCierre(valor: string | null | undefined): Date | null {
  return valor ? new Date(valor) : null
}

function asegurarAbierta(encuesta: any) {
  if (encuesta.estado !== 'PUBLICADA' || (encuesta.fecha_cierre && encuesta.fecha_cierre <= new Date())) {
    throw new EncuestaError('ENCUESTA_CERRADA', 'Esta encuesta ya no acepta respuestas', 409)
  }
}

function huella(encuestaId: string, tipo: string, valor: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(`encuesta:${encuestaId}:${tipo}:${valor}`).digest('hex')
}

function valorVacio(valor: unknown): boolean {
  return valor == null || valor === '' || (Array.isArray(valor) && valor.length === 0)
}

/** Validar en el servidor evita respuestas inventadas y opciones de otra encuesta. */
export function validarRespuestas(preguntas: Pregunta[], entrada: Record<string, unknown>): Record<string, string | number | boolean | string[]> {
  const ids = new Set(preguntas.map(p => p.id))
  if (Object.keys(entrada).some(id => !ids.has(id))) {
    throw new EncuestaError('PREGUNTA_DESCONOCIDA', 'La encuesta cambió. Recarga el enlace e intenta otra vez')
  }
  const salida: Record<string, string | number | boolean | string[]> = {}
  for (const p of preguntas) {
    const valor = entrada[p.id]
    if (valorVacio(valor)) {
      if (p.requerida) throw new EncuestaError('RESPUESTA_REQUERIDA', `Responde «${p.titulo}»`)
      continue
    }
    if (p.tipo === 'OPCION_UNICA') {
      if (typeof valor !== 'string' || !p.opciones.some(o => o.id === valor)) {
        throw new EncuestaError('OPCION_INVALIDA', `Opción inválida en «${p.titulo}»`)
      }
      salida[p.id] = valor
    } else if (p.tipo === 'OPCION_MULTIPLE') {
      const opciones = new Set(p.opciones.map(o => o.id))
      if (!Array.isArray(valor) || valor.length > opciones.size || new Set(valor).size !== valor.length ||
          valor.some(x => typeof x !== 'string' || !opciones.has(x))) {
        throw new EncuestaError('OPCION_INVALIDA', `Opciones inválidas en «${p.titulo}»`)
      }
      salida[p.id] = valor as string[]
    } else if (p.tipo === 'SI_NO') {
      if (typeof valor !== 'boolean') throw new EncuestaError('RESPUESTA_INVALIDA', `Responde sí o no en «${p.titulo}»`)
      salida[p.id] = valor
    } else if (p.tipo === 'ESCALA' || p.tipo === 'NPS') {
      const min = p.tipo === 'NPS' ? 0 : p.minimo ?? 1
      const max = p.tipo === 'NPS' ? 10 : p.maximo ?? 5
      if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < min || valor > max) {
        throw new EncuestaError('RESPUESTA_INVALIDA', `Valor fuera de escala en «${p.titulo}»`)
      }
      salida[p.id] = valor
    } else if (p.tipo === 'NUMERO') {
      if (typeof valor !== 'number' || !Number.isFinite(valor) || Math.abs(valor) > 1_000_000_000) {
        throw new EncuestaError('RESPUESTA_INVALIDA', `Número inválido en «${p.titulo}»`)
      }
      salida[p.id] = valor
    } else if (p.tipo === 'FECHA') {
      const fecha = typeof valor === 'string' ? new Date(`${valor}T12:00:00Z`) : new Date(NaN)
      if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor) ||
          Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
        throw new EncuestaError('RESPUESTA_INVALIDA', `Fecha inválida en «${p.titulo}»`)
      }
      salida[p.id] = valor
    } else {
      const max = p.tipo === 'TEXTO_LARGO' ? 4000 : 500
      if (typeof valor !== 'string' || valor.trim().length > max) {
        throw new EncuestaError('RESPUESTA_INVALIDA', `Texto inválido en «${p.titulo}»`)
      }
      const texto = valor.trim()
      if (!texto) {
        if (p.requerida) throw new EncuestaError('RESPUESTA_REQUERIDA', `Responde «${p.titulo}»`)
        continue
      }
      if (p.tipo === 'CORREO' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) {
        throw new EncuestaError('RESPUESTA_INVALIDA', `Correo inválido en «${p.titulo}»`)
      }
      salida[p.id] = texto
    }
  }
  return salida
}

async function obtener(id: string) {
  const encuesta = await prisma.encuesta.findFirst({
    where: { id, ...activa },
    include: { _count: { select: { respuestas: { where: { deleted_at: null } } } } }
  })
  if (!encuesta) throw new EncuestaError('ENCUESTA_NO_ENCONTRADA', 'Encuesta no encontrada', 404)
  return encuesta
}

export const EncuestasService = {
  async listar() {
    return prisma.encuesta.findMany({
      where: activa,
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { respuestas: { where: { deleted_at: null } } } } }
    })
  },

  obtener,

  async crear(entrada: EncuestaInput, usuarioId: string | null) {
    const data = encuestaSchema.parse(entrada)
    return prisma.encuesta.create({
      data: {
        token: randomBytes(24).toString('base64url'),
        titulo: data.titulo,
        descripcion: data.descripcion || null,
        mensaje_final: data.mensaje_final || null,
        nombre_modo: data.nombre_modo,
        correo_modo: data.correo_modo,
        registrar_origen: data.registrar_origen,
        politica_origen: data.politica_origen,
        fecha_cierre: fechaCierre(data.fecha_cierre),
        preguntas: data.preguntas as unknown as Prisma.InputJsonValue,
        creado_por_id: usuarioId
      }
    })
  },

  async actualizar(id: string, entrada: EncuestaInput) {
    const encuesta = await obtener(id)
    if (encuesta.estado !== 'BORRADOR') {
      throw new EncuestaError('ENCUESTA_PUBLICADA', 'Duplica la encuesta para cambiar sus preguntas o configuración', 409)
    }
    const data = encuestaSchema.parse(entrada)
    return prisma.encuesta.update({
      where: { id },
      data: {
        titulo: data.titulo,
        descripcion: data.descripcion || null,
        mensaje_final: data.mensaje_final || null,
        nombre_modo: data.nombre_modo,
        correo_modo: data.correo_modo,
        registrar_origen: data.registrar_origen,
        politica_origen: data.politica_origen,
        fecha_cierre: fechaCierre(data.fecha_cierre),
        preguntas: data.preguntas as unknown as Prisma.InputJsonValue
      }
    })
  },

  async publicar(id: string) {
    const encuesta = await obtener(id)
    if (encuesta.estado !== 'BORRADOR') throw new EncuestaError('ESTADO_INVALIDO', 'Solo se publican borradores', 409)
    if (preguntasDe(encuesta.preguntas).length === 0) {
      throw new EncuestaError('SIN_PREGUNTAS', 'Agrega al menos una pregunta antes de publicar')
    }
    if (encuesta.fecha_cierre && encuesta.fecha_cierre <= new Date()) {
      throw new EncuestaError('FECHA_CIERRE', 'La fecha de cierre debe ser futura')
    }
    return prisma.encuesta.update({ where: { id }, data: { estado: 'PUBLICADA', publicado_at: new Date() } })
  },

  async cerrar(id: string) {
    const encuesta = await obtener(id)
    if (encuesta.estado !== 'PUBLICADA') throw new EncuestaError('ESTADO_INVALIDO', 'La encuesta no está publicada', 409)
    return prisma.encuesta.update({ where: { id }, data: { estado: 'CERRADA' } })
  },

  async duplicar(id: string, usuarioId: string | null) {
    const original = await obtener(id)
    return prisma.encuesta.create({
      data: {
        token: randomBytes(24).toString('base64url'),
        titulo: `${original.titulo} (copia)`.slice(0, 180),
        descripcion: original.descripcion,
        mensaje_final: original.mensaje_final,
        nombre_modo: original.nombre_modo,
        correo_modo: original.correo_modo,
        registrar_origen: original.registrar_origen,
        politica_origen: original.politica_origen,
        preguntas: original.preguntas as Prisma.InputJsonValue,
        creado_por_id: usuarioId
      }
    })
  },

  async archivar(id: string) {
    await obtener(id)
    return prisma.encuesta.update({ where: { id }, data: { deleted_at: new Date(), estado: 'CERRADA' } })
  },

  async publica(token: string) {
    const encuesta = await prisma.encuesta.findFirst({ where: { token, ...activa } })
    if (!encuesta) throw new EncuestaError('ENCUESTA_NO_ENCONTRADA', 'Enlace no encontrado', 404)
    return {
      token: encuesta.token,
      titulo: encuesta.titulo,
      descripcion: encuesta.descripcion,
      mensaje_final: encuesta.mensaje_final,
      estado: encuesta.estado,
      abierta: encuesta.estado === 'PUBLICADA' && (!encuesta.fecha_cierre || encuesta.fecha_cierre > new Date()),
      nombre_modo: encuesta.nombre_modo,
      correo_modo: encuesta.correo_modo,
      registrar_origen: encuesta.registrar_origen,
      preguntas: preguntasDe(encuesta.preguntas)
    }
  },

  async responder(token: string, entrada: RespuestaInput, ip: string) {
    const encuesta = await prisma.encuesta.findFirst({ where: { token, ...activa } })
    if (!encuesta) throw new EncuestaError('ENCUESTA_NO_ENCONTRADA', 'Enlace no encontrado', 404)
    asegurarAbierta(encuesta)
    const nombre = entrada.nombre?.trim() || null
    const correo = entrada.correo?.trim().toLowerCase() || null
    if (encuesta.nombre_modo === 'OBLIGATORIO' && !nombre) throw new EncuestaError('NOMBRE_REQUERIDO', 'Escribe tu nombre')
    if (encuesta.correo_modo === 'OBLIGATORIO' && !correo) throw new EncuestaError('CORREO_REQUERIDO', 'Escribe tu correo')
    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new EncuestaError('CORREO_INVALIDO', 'Correo inválido')
    const respuestas = validarRespuestas(preguntasDe(encuesta.preguntas), entrada.respuestas)
    const ipHash = encuesta.registrar_origen ? huella(encuesta.id, 'ip', ip) : null
    const dispositivoHash = encuesta.registrar_origen && entrada.dispositivo
      ? huella(encuesta.id, 'dispositivo', entrada.dispositivo) : null

    const guardada = await prisma.$transaction(async tx => {
      /// El bloqueo serializa envíos simultáneos de la misma huella cuando la
      /// encuesta pide una respuesta por dispositivo. IP sola nunca bloquea:
      /// una oficina entera puede compartir conexión.
      if (encuesta.politica_origen === 'BLOQUEAR_HUELLA' && dispositivoHash) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${encuesta.id + dispositivoHash}))`
      }
      const comparar = encuesta.registrar_origen && encuesta.politica_origen !== 'PERMITIR'
      const [mismaIp, mismoDispositivo] = comparar
        ? await Promise.all([
            ipHash ? tx.encuesta_respuesta.findFirst({ where: { encuesta_id: encuesta.id, ip_hash: ipHash, deleted_at: null }, select: { id: true } }) : null,
            dispositivoHash ? tx.encuesta_respuesta.findFirst({ where: { encuesta_id: encuesta.id, dispositivo_hash: dispositivoHash, deleted_at: null }, select: { id: true } }) : null
          ])
        : [null, null]
      if (encuesta.politica_origen === 'BLOQUEAR_HUELLA' && mismoDispositivo) {
        throw new EncuestaError('HUELLA_REPETIDA', 'Este dispositivo ya respondió esta encuesta', 409)
      }
      return tx.encuesta_respuesta.create({
        data: {
          encuesta_id: encuesta.id,
          nombre: encuesta.nombre_modo === 'NO' ? null : nombre,
          correo: encuesta.correo_modo === 'NO' ? null : correo,
          respuestas: respuestas as Prisma.InputJsonValue,
          ip_hash: ipHash,
          dispositivo_hash: dispositivoHash,
          coincide_ip: !!mismaIp,
          coincide_dispositivo: !!mismoDispositivo
        }
      })
    })
    try { getIo().emit(EVENTOS_ENCUESTAS.respuesta, { encuestaId: encuesta.id, respuestaId: guardada.id, occurredAt: new Date().toISOString() }) } catch { /* API sin socket en desarrollo */ }
    return { id: guardada.id, mensaje: encuesta.mensaje_final || '¡Gracias por responder!' }
  },

  async resultados(id: string, pagina = 1) {
    const encuesta = await obtener(id)
    const preguntas = preguntasDe(encuesta.preguntas)
    const respuestas = await prisma.encuesta_respuesta.findMany({
      where: { encuesta_id: id, deleted_at: null },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, nombre: true, correo: true, respuestas: true, coincide_ip: true,
        coincide_dispositivo: true, created_at: true
      }
    })
    const porDia = new Map<string, number>()
    let coincidenciasIp = 0
    let coincidenciasDispositivo = 0
    for (const r of respuestas) {
      const dia = r.created_at.toISOString().slice(0, 10)
      porDia.set(dia, (porDia.get(dia) || 0) + 1)
      if (r.coincide_ip) coincidenciasIp++
      if (r.coincide_dispositivo) coincidenciasDispositivo++
    }
    const analisis = preguntas.map(p => {
      const valores = respuestas.map(r => (r.respuestas as Record<string, unknown>)[p.id])
        .filter(v => !valorVacio(v))
      const opciones: Array<{ id: string; texto: string; total: number; porcentaje: number }> = []
      if (p.tipo === 'OPCION_UNICA' || p.tipo === 'OPCION_MULTIPLE') {
        for (const o of p.opciones) {
          const total = valores.filter(v => Array.isArray(v) ? v.includes(o.id) : v === o.id).length
          opciones.push({ id: o.id!, texto: o.texto!, total, porcentaje: valores.length ? Math.round(total / valores.length * 1000) / 10 : 0 })
        }
      } else if (p.tipo === 'SI_NO') {
        for (const [id, texto] of [['true', 'Sí'], ['false', 'No']]) {
          const total = valores.filter(v => String(v) === id).length
          opciones.push({ id, texto, total, porcentaje: valores.length ? Math.round(total / valores.length * 1000) / 10 : 0 })
        }
      } else if (p.tipo === 'ESCALA' || p.tipo === 'NPS') {
        const min = p.tipo === 'NPS' ? 0 : p.minimo ?? 1
        const max = p.tipo === 'NPS' ? 10 : p.maximo ?? 5
        for (let n = min; n <= max; n++) {
          const total = valores.filter(v => v === n).length
          opciones.push({ id: String(n), texto: String(n), total, porcentaje: valores.length ? Math.round(total / valores.length * 1000) / 10 : 0 })
        }
      }
      const numeros = valores.filter((v): v is number => typeof v === 'number')
      const promedio = numeros.length ? Math.round(numeros.reduce((a, b) => a + b, 0) / numeros.length * 100) / 100 : null
      const nps = p.tipo === 'NPS' && numeros.length
        ? Math.round((numeros.filter(n => n >= 9).length - numeros.filter(n => n <= 6).length) / numeros.length * 100)
        : null
      return {
        id: p.id, titulo: p.titulo, tipo: p.tipo, respondidas: valores.length,
        opciones, promedio, nps,
        textos: ['TEXTO_CORTO', 'TEXTO_LARGO', 'CORREO', 'FECHA', 'NUMERO'].includes(p.tipo)
          ? valores.slice(0, 12).map(String) : []
      }
    })
    const tamano = 50
    return {
      encuesta, total: respuestas.length, coincidencias_ip: coincidenciasIp,
      coincidencias_dispositivo: coincidenciasDispositivo,
      por_dia: [...porDia].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, total]) => ({ fecha, total })),
      analisis,
      respuestas: respuestas.slice((pagina - 1) * tamano, pagina * tamano),
      pagina, paginas: Math.max(1, Math.ceil(respuestas.length / tamano))
    }
  },

  async todasLasRespuestas(id: string) {
    const encuesta = await obtener(id)
    const respuestas = await prisma.encuesta_respuesta.findMany({
      where: { encuesta_id: id, deleted_at: null }, orderBy: { created_at: 'desc' }
    })
    return { encuesta, respuestas, preguntas: preguntasDe(encuesta.preguntas) }
  }
}
