import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'

export type CapPersona = { tipo: 'administrativo' | 'conductor'; id: string; nombre: string }

export class CapError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'CapError'
  }
}

const ESTRUCTURA = {
  modulos: { orderBy: { orden: 'asc' as const }, include: { lecciones: { orderBy: { orden: 'asc' as const } } } },
  preguntas: { orderBy: { orden: 'asc' as const } }
}
const TIPOS_LECCION = new Set(['lectura', 'video', 'audio', 'pdf', 'pptx', 'iframe', 'h5p', 'scorm'])
const MODELO_FACIAL = 'capacitaciones-face-v2'
const UMBRAL_FACIAL = 0.82
const VENTANA_VERIFICACION_MS = 10 * 60 * 1000

function texto(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new CapError('Identificador inválido.')
  }
  return value
}

function urlContenido(value: unknown): string {
  const raw = texto(value, 2000)
  if (!raw) throw new CapError('La URL del contenido es obligatoria.')
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new CapError('La URL del contenido no es válida.') }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new CapError('El contenido debe usar una URL HTTPS.')
  }
  return parsed.toString()
}

function contenidoLeccion(tipo: string, value: unknown): Prisma.InputJsonValue {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  if (typeof input.archivoId === 'string' && input.archivoId) {
    return { archivoId: uuid(input.archivoId), descripcion: texto(input.descripcion, 1000),
      ...(tipo === 'video' && input.subtitulosArchivoId ? { subtitulosArchivoId: uuid(input.subtitulosArchivoId) } : {}),
      ...(tipo === 'video' && input.subtitulosUrl ? { subtitulosUrl: urlContenido(input.subtitulosUrl) } : {}) }
  }
  if (tipo === 'lectura') {
    const lectura = texto(input.texto, 100_000)
    if (!lectura) throw new CapError('Escribe el contenido de lectura.')
    return { texto: lectura }
  }
  return { url: urlContenido(input.url), descripcion: texto(input.descripcion, 1000),
    ...(tipo === 'video' && input.subtitulosArchivoId ? { subtitulosArchivoId: uuid(input.subtitulosArchivoId) } : {}),
    ...(tipo === 'video' && input.subtitulosUrl ? { subtitulosUrl: urlContenido(input.subtitulosUrl) } : {}) }
}

function publico(curso: { preguntas: Array<{ id: string; enunciado: string; opciones: Prisma.JsonValue; orden: number }> } & Record<string, unknown>) {
  return {
    ...curso,
    preguntas: curso.preguntas.map(({ id, enunciado, opciones, orden }) => ({ id, enunciado, opciones, orden }))
  }
}

export async function listarCapacitaciones(persona: CapPersona, gestionar = false) {
  if (gestionar) {
    return prisma.capCurso.findMany({
      include: { _count: { select: { modulos: true, preguntas: true, asignaciones: true } } },
      orderBy: { createdAt: 'desc' }
    })
  }
  return prisma.capAsignacion.findMany({
    where: { personaTipo: persona.tipo, personaId: persona.id, curso: { estado: 'publicado' } },
    include: {
      curso: { include: { _count: { select: { modulos: true, preguntas: true } } } },
      certificado: true
    },
    orderBy: { asignadoAt: 'desc' }
  })
}

export async function obtenerCapacitacion(id: string, persona: CapPersona, gestionar = false) {
  const curso = await prisma.capCurso.findUnique({ where: { id: uuid(id) }, include: ESTRUCTURA })
  if (!curso) throw new CapError('Capacitación no encontrada.', 404)
  if (gestionar) {
    const asignaciones = await prisma.capAsignacion.findMany({
      where: { cursoId: id },
      include: { certificado: true },
      orderBy: { asignadoAt: 'desc' }
    })
    return { curso, asignaciones, puedeGestionar: true }
  }
  if (curso.estado !== 'publicado') throw new CapError('Capacitación no disponible.', 404)
  const asignacion = await prisma.capAsignacion.findUnique({
    where: { cursoId_personaTipo_personaId: { cursoId: id, personaTipo: persona.tipo, personaId: persona.id } },
    include: { progresos: true, intentos: { orderBy: { createdAt: 'desc' }, take: 5 }, certificado: true }
  })
  if (!asignacion) throw new CapError('Esta capacitación no está asignada a tu cuenta.', 403)
  return { curso: publico(curso), asignacion, puedeGestionar: false }
}

export async function guardarCurso(input: Record<string, unknown>, autorId: string, id?: string) {
  const titulo = texto(input.titulo, 180)
  if (titulo.length < 3) throw new CapError('El título debe tener al menos 3 caracteres.')
  if (id) uuid(id)
  const codigo = input.codigo == null ? null : texto(input.codigo, 50).toUpperCase()
  const slug = input.slug == null ? null : texto(input.slug, 200).toLowerCase()
  if (codigo && !/^[A-Z0-9_-]{2,50}$/.test(codigo)) throw new CapError('El código interno debe tener entre 2 y 50 caracteres válidos.')
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new CapError('El slug debe usar minúsculas, números y guiones.')
  const duracionHoras = Number(input.duracionHoras ?? 0)
  if (!Number.isInteger(duracionHoras) || duracionHoras < 0 || duracionHoras > 10_000) {
    throw new CapError('La duración estimada no es válida.')
  }
  if (codigo) {
    const existente = await prisma.capCurso.findFirst({ where: { codigo, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })
    if (existente) throw new CapError('Ya existe una capacitación con ese código interno.', 409)
  }
  if (slug) {
    const existente = await prisma.capCurso.findFirst({ where: { slug, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })
    if (existente) throw new CapError('Ya existe una capacitación con ese slug.', 409)
  }
  let configuracion: Prisma.InputJsonValue | undefined
  if (input.configuracion !== undefined) {
    if (!input.configuracion || typeof input.configuracion !== 'object' || Array.isArray(input.configuracion)) {
      throw new CapError('La configuración del curso debe ser un objeto.')
    }
    const serialized = JSON.stringify(input.configuracion)
    if (serialized.length > 64_000) throw new CapError('La configuración del curso es demasiado grande.')
    configuracion = JSON.parse(serialized) as Prisma.InputJsonValue
  }
  const estado = input.estado === 'publicado' ? 'publicado' : 'borrador'
  const puntaje = Number(input.puntajeAprobacion ?? 80)
  if (!Number.isInteger(puntaje) || puntaje < 1 || puntaje > 100) throw new CapError('El puntaje de aprobación debe estar entre 1 y 100.')
  const vigencia = input.vigenciaDias == null || input.vigenciaDias === '' ? null : Number(input.vigenciaDias)
  if (vigencia !== null && (!Number.isInteger(vigencia) || vigencia < 1 || vigencia > 3650)) {
    throw new CapError('La vigencia debe estar entre 1 y 3650 días.')
  }
  const portadaUrl = input.portadaUrl ? urlContenido(input.portadaUrl) : null
  const data = {
    ...(input.codigo !== undefined ? { codigo } : {}),
    ...(input.slug !== undefined ? { slug } : {}),
    titulo,
    descripcion: texto(input.descripcion, 10_000) || null,
    portadaUrl,
    ...(input.duracionHoras !== undefined ? { duracionHoras } : {}),
    ...(configuracion !== undefined ? { configuracion } : {}),
    estado,
    puntajeAprobacion: puntaje,
    requiereBiometria: input.requiereBiometria === true,
    vigenciaDias: vigencia,
    ...(estado === 'publicado' ? { publicadoAt: new Date() } : {})
  }
  if (!id) {
    if (estado === 'publicado') throw new CapError('Crea módulos y lecciones antes de publicar.')
    return prisma.capCurso.create({ data: { ...data, creadoPor: autorId } })
  }
  const previo = await prisma.capCurso.findUnique({ where: { id }, include: { modulos: { include: { lecciones: true } } } })
  if (!previo) throw new CapError('Capacitación no encontrada.', 404)
  if (estado === 'publicado' && !previo.modulos.some((m) => m.lecciones.length > 0)) {
    throw new CapError('Agrega al menos una lección antes de publicar.')
  }
  return prisma.capCurso.update({ where: { id }, data })
}

export async function guardarModulo(cursoId: string, input: Record<string, unknown>, id?: string) {
  const titulo = texto(input.titulo, 180)
  if (!titulo) throw new CapError('El título del módulo es obligatorio.')
  const orden = Number(input.orden ?? 0)
  if (!Number.isInteger(orden) || orden < 0) throw new CapError('El orden no es válido.')
  if (id) {
    const modulo = await prisma.capModulo.findFirst({ where: { id: uuid(id), cursoId: uuid(cursoId) } })
    if (!modulo) throw new CapError('Módulo no encontrado.', 404)
    return prisma.capModulo.update({ where: { id }, data: { titulo, orden } })
  }
  const curso = await prisma.capCurso.findUnique({ where: { id: uuid(cursoId) } })
  if (!curso) throw new CapError('Capacitación no encontrada.', 404)
  return prisma.capModulo.create({ data: { cursoId, titulo, orden } })
}

export async function guardarLeccion(moduloId: string, input: Record<string, unknown>, id?: string) {
  const modulo = await prisma.capModulo.findUnique({ where: { id: uuid(moduloId) } })
  if (!modulo) throw new CapError('Módulo no encontrado.', 404)
  const titulo = texto(input.titulo, 180)
  const tipo = texto(input.tipo, 30)
  if (!titulo || !TIPOS_LECCION.has(tipo)) throw new CapError('Título o tipo de lección inválido.')
  const cursoConfig = await prisma.capCurso.findUnique({ where: { id: modulo.cursoId }, select: { configuracion: true } })
  const modos = (cursoConfig?.configuracion as Record<string, any> | null)?.entrega?.modalidades
  const modalidadPorTipo: Record<string, string> = {
    lectura: 'lectura', pdf: 'lectura', pptx: 'lectura', video: 'video', audio: 'audio',
    h5p: 'interactivo', scorm: 'interactivo', iframe: 'interactivo'
  }
  if (Array.isArray(modos) && modos.length && !modos.includes(modalidadPorTipo[tipo])) {
    throw new CapError('Este formato no está habilitado en las modalidades de entrega del curso.', 409)
  }
  const orden = Number(input.orden ?? 0)
  const duracionSeg = Number(input.duracionSeg ?? 0)
  if (!Number.isInteger(orden) || orden < 0 || !Number.isInteger(duracionSeg) || duracionSeg < 0) {
    throw new CapError('El orden o la duración no son válidos.')
  }
  const contenidoInput = input.contenido && typeof input.contenido === 'object'
    ? input.contenido as Record<string, unknown> : {}
  if (contenidoInput.archivoId) {
    const archivo = await prisma.capArchivo.findFirst({
      where: { id: uuid(contenidoInput.archivoId), cursoId: modulo.cursoId, estado: 'listo' }
    })
    const esperado = tipo === 'lectura' ? 'readme' : tipo
    if (!archivo || archivo.tipo !== esperado) throw new CapError('El archivo no pertenece al curso o al tipo de lección.', 409)
  }
  if (contenidoInput.subtitulosArchivoId) {
    const subtitulos = await prisma.capArchivo.findFirst({
      where: { id: uuid(contenidoInput.subtitulosArchivoId), cursoId: modulo.cursoId, estado: 'listo', tipo: 'subtitulos' }
    })
    if (!subtitulos) throw new CapError('Los subtítulos no pertenecen al curso.', 409)
  }
  const data = {
    titulo, tipo, orden, duracionSeg,
    obligatoria: input.obligatoria !== false,
    contenido: contenidoLeccion(tipo, input.contenido)
  }
  if (id) {
    const leccion = await prisma.capLeccion.findFirst({ where: { id: uuid(id), moduloId } })
    if (!leccion) throw new CapError('Lección no encontrada.', 404)
    return prisma.capLeccion.update({ where: { id }, data })
  }
  return prisma.capLeccion.create({ data: { moduloId, ...data } })
}

export async function eliminarModulo(id: string) {
  const modulo = await prisma.capModulo.findUnique({ where: { id: uuid(id) } })
  if (!modulo) throw new CapError('Módulo no encontrado.', 404)
  await prisma.capModulo.delete({ where: { id } })
}

export async function eliminarLeccion(id: string) {
  const leccion = await prisma.capLeccion.findUnique({ where: { id: uuid(id) } })
  if (!leccion) throw new CapError('Lección no encontrada.', 404)
  await prisma.capLeccion.delete({ where: { id } })
}

export async function guardarPreguntas(cursoId: string, input: unknown) {
  uuid(cursoId)
  if (!Array.isArray(input) || input.length > 100) throw new CapError('Envía hasta 100 preguntas.')
  const preguntas = input.map((raw, orden) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const enunciado = texto(item.enunciado, 2000)
    const opciones = Array.isArray(item.opciones) ? item.opciones.map((x) => texto(x, 500)) : []
    const respuestaIndice = Number(item.respuestaIndice)
    if (!enunciado || opciones.length < 2 || opciones.length > 8 || opciones.some((x) => !x) ||
      !Number.isInteger(respuestaIndice) || respuestaIndice < 0 || respuestaIndice >= opciones.length) {
      throw new CapError('Cada pregunta requiere enunciado, opciones y respuesta correcta.')
    }
    return { cursoId, enunciado, opciones, respuestaIndice, orden }
  })
  const curso = await prisma.capCurso.findUnique({ where: { id: cursoId } })
  if (!curso) throw new CapError('Capacitación no encontrada.', 404)
  await prisma.$transaction(async (tx) => {
    await tx.capPregunta.deleteMany({ where: { cursoId } })
    if (preguntas.length) await tx.capPregunta.createMany({ data: preguntas })
  })
  return prisma.capPregunta.findMany({ where: { cursoId }, orderBy: { orden: 'asc' } })
}

export async function listarPersonasCapacitacion() {
  const [staff, drivers] = await Promise.all([
    prisma.usuarios.findMany({ where: { activo: true }, select: { id: true, nombre: true, correo: true, area: true }, orderBy: { nombre: 'asc' } }),
    prisma.conductores.findMany({
      where: { estado: 'activo', oculto: false, deleted_at: null },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
      orderBy: { nombre: 'asc' }
    })
  ])
  return [
    ...staff.map((x) => ({ tipo: 'administrativo', id: x.id, nombre: x.nombre, detalle: Array.isArray(x.area) ? x.area.join(', ') : '' })),
    ...drivers.map((x) => ({ tipo: 'conductor', id: x.id, nombre: (x.nombre + ' ' + x.apellido).trim(), detalle: (x.numero_identificacion ?? '').slice(-4) }))
  ]
}

export async function asignarCapacitacion(cursoId: string, input: unknown) {
  uuid(cursoId)
  const curso = await prisma.capCurso.findUnique({ where: { id: cursoId } })
  if (!curso) throw new CapError('Capacitación no encontrada.', 404)
  if (!Array.isArray(input) || input.length < 1 || input.length > 200) throw new CapError('Selecciona entre 1 y 200 personas.')
  const personas = input.map((x) => {
    if (!x || typeof x !== 'object') throw new CapError('Persona inválida.')
    const item = x as Record<string, unknown>
    if (item.tipo !== 'administrativo' && item.tipo !== 'conductor') throw new CapError('Tipo de personal inválido.')
    return { personaTipo: item.tipo, personaId: uuid(item.id) }
  })
  const staffIds = personas.filter((x) => x.personaTipo === 'administrativo').map((x) => x.personaId)
  const driverIds = personas.filter((x) => x.personaTipo === 'conductor').map((x) => x.personaId)
  const [staff, drivers] = await Promise.all([
    prisma.usuarios.findMany({ where: { id: { in: staffIds }, activo: true }, select: { id: true } }),
    prisma.conductores.findMany({ where: { id: { in: driverIds }, estado: 'activo', oculto: false, deleted_at: null }, select: { id: true } })
  ])
  const validos = new Set([...staff.map((x) => 'administrativo:' + x.id), ...drivers.map((x) => 'conductor:' + x.id)])
  if (personas.some((x) => !validos.has(x.personaTipo + ':' + x.personaId))) throw new CapError('Hay personas inactivas o inexistentes.')
  return prisma.capAsignacion.createMany({
    data: personas.map((x) => ({ cursoId, ...x })),
    skipDuplicates: true
  })
}

async function asignacionDe(cursoId: string, persona: CapPersona) {
  const asignacion = await prisma.capAsignacion.findUnique({
    where: { cursoId_personaTipo_personaId: { cursoId: uuid(cursoId), personaTipo: persona.tipo, personaId: persona.id } },
    include: { curso: true }
  })
  if (!asignacion || asignacion.curso.estado !== 'publicado') throw new CapError('Capacitación no asignada.', 403)
  const configuracion = asignacion.curso.configuracion as Record<string, any> | null
  const ventanaDias = Number(configuracion?.pedagogia?.ventanaAccesoDias)
  if (Number.isInteger(ventanaDias) && ventanaDias > 0 &&
    Date.now() > asignacion.asignadoAt.getTime() + ventanaDias * 24 * 60 * 60 * 1000) {
    throw new CapError('La ventana de acceso a esta capacitación terminó.', 403)
  }
  return asignacion
}

async function estadoLecciones(asignacionId: string, cursoId: string) {
  const obligatorias = await prisma.capLeccion.findMany({
    where: { modulo: { cursoId }, obligatoria: true },
    select: { id: true }
  })
  const completadas = await prisma.capProgreso.count({
    where: { asignacionId, leccionId: { in: obligatorias.map((x) => x.id) }, completadoAt: { not: null } }
  })
  return { total: obligatorias.length, completadas, listo: obligatorias.length > 0 && completadas === obligatorias.length }
}

async function emitirCertificado(asignacionId: string, cursoId: string, nombre: string) {
  const curso = await prisma.capCurso.findUnique({ where: { id: cursoId } })
  if (!curso) throw new CapError('Capacitación no encontrada.', 404)
  const configuracion = curso.configuracion as Record<string, any> | null
  const emitir = configuracion?.certificacion?.activa !== false
  const vigenteHasta = curso.vigenciaDias
    ? new Date(Date.now() + curso.vigenciaDias * 24 * 60 * 60 * 1000) : null
  return prisma.$transaction(async (tx) => {
    const certificado = emitir ? await tx.capCertificado.upsert({
      where: { asignacionId },
      create: { asignacionId, codigo: 'CAP-' + randomBytes(8).toString('hex').toUpperCase(), nombre, vigenteHasta },
      update: {}
    }) : null
    await tx.capAsignacion.update({ where: { id: asignacionId }, data: { estado: 'aprobado', completadoAt: new Date() } })
    return certificado
  })
}

export async function guardarProgreso(cursoId: string, leccionId: string, persona: CapPersona, input: Record<string, unknown>) {
  const asignacion = await asignacionDe(cursoId, persona)
  const leccion = await prisma.capLeccion.findFirst({ where: { id: uuid(leccionId), modulo: { cursoId } } })
  if (!leccion) throw new CapError('Lección no encontrada.', 404)
  const porcentaje = Number(input.porcentaje)
  const segundos = Number(input.segundosVistos ?? 0)
  if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100 ||
    !Number.isFinite(segundos) || segundos < 0 || segundos > 86_400) throw new CapError('Progreso inválido.')
  const anterior = await prisma.capProgreso.findUnique({
    where: { asignacionId_leccionId: { asignacionId: asignacion.id, leccionId } }
  })
  const nuevoPorcentaje = Math.max(anterior?.porcentaje ?? 0, Math.round(porcentaje))
  const nuevosSegundos = Math.max(anterior?.segundosVistos ?? 0, Math.round(segundos))
  const completado = nuevoPorcentaje >= 100 &&
    (!['video', 'audio'].includes(leccion.tipo) || leccion.duracionSeg === 0 || nuevosSegundos >= leccion.duracionSeg * 0.8)
  const progreso = await prisma.capProgreso.upsert({
    where: { asignacionId_leccionId: { asignacionId: asignacion.id, leccionId } },
    create: { asignacionId: asignacion.id, leccionId, porcentaje: nuevoPorcentaje, segundosVistos: nuevosSegundos, completadoAt: completado ? new Date() : null },
    update: { porcentaje: nuevoPorcentaje, segundosVistos: nuevosSegundos, ...(completado ? { completadoAt: anterior?.completadoAt ?? new Date() } : {}) }
  })
  if (asignacion.estado === 'pendiente') await prisma.capAsignacion.update({ where: { id: asignacion.id }, data: { estado: 'en_curso' } })
  const estado = await estadoLecciones(asignacion.id, cursoId)
  const preguntas = await prisma.capPregunta.count({ where: { cursoId } })
  if (estado.listo && preguntas === 0 && (!asignacion.curso.requiereBiometria ||
    (asignacion.biometriaVerificadaAt && Date.now() - asignacion.biometriaVerificadaAt.getTime() < VENTANA_VERIFICACION_MS))) {
    await emitirCertificado(asignacion.id, cursoId, persona.nombre)
  }
  return { progreso, lecciones: estado, requiereEvaluacion: preguntas > 0 }
}

export async function presentarEvaluacion(cursoId: string, persona: CapPersona, input: unknown) {
  const asignacion = await asignacionDe(cursoId, persona)
  if (asignacion.estado === 'aprobado') throw new CapError('Ya completaste esta capacitación.', 409)
  const lecciones = await estadoLecciones(asignacion.id, cursoId)
  if (!lecciones.listo) throw new CapError('Completa las lecciones obligatorias antes de evaluar.', 409)
  if (asignacion.curso.requiereBiometria &&
    (!asignacion.biometriaVerificadaAt || Date.now() - asignacion.biometriaVerificadaAt.getTime() > VENTANA_VERIFICACION_MS)) {
    throw new CapError('Verifica tu identidad facial antes de presentar la evaluación.', 403)
  }
  const evaluacion = (asignacion.curso.configuracion as Record<string, any> | null)?.evaluacion
  const maxIntentos = Number(evaluacion?.intentosMaximos ?? 0)
  const cooldownHoras = Number(evaluacion?.cooldownHoras ?? 0)
  const [intentos, ultimoIntento] = await Promise.all([
    prisma.capIntento.count({ where: { asignacionId: asignacion.id } }),
    prisma.capIntento.findFirst({ where: { asignacionId: asignacion.id }, orderBy: { createdAt: 'desc' } })
  ])
  if (maxIntentos > 0 && intentos >= maxIntentos) throw new CapError('Alcanzaste el máximo de intentos para esta evaluación.', 409)
  if (ultimoIntento && !ultimoIntento.aprobado && cooldownHoras > 0 &&
    Date.now() < ultimoIntento.createdAt.getTime() + cooldownHoras * 60 * 60 * 1000) {
    const disponible = new Date(ultimoIntento.createdAt.getTime() + cooldownHoras * 60 * 60 * 1000)
    throw new CapError('Podrás volver a presentar la evaluación después del ' + disponible.toLocaleString('es-CO') + '.', 409)
  }
  const preguntas = await prisma.capPregunta.findMany({ where: { cursoId }, orderBy: { orden: 'asc' } })
  if (!preguntas.length) throw new CapError('Esta capacitación no tiene evaluación.', 409)
  if (!Array.isArray(input) || input.length !== preguntas.length) throw new CapError('Responde todas las preguntas.')
  const respuestas = input.map(Number)
  if (respuestas.some((x, i) => !Number.isInteger(x) || x < 0 || x >= (preguntas[i].opciones as string[]).length)) {
    throw new CapError('Hay respuestas inválidas.')
  }
  const aciertos = preguntas.filter((x, i) => x.respuestaIndice === respuestas[i]).length
  const puntaje = Math.round(aciertos * 100 / preguntas.length)
  const aprobado = puntaje >= asignacion.curso.puntajeAprobacion
  const intento = await prisma.capIntento.create({
    data: { asignacionId: asignacion.id, respuestas, puntaje, aprobado }
  })
  const certificado = aprobado ? await emitirCertificado(asignacion.id, cursoId, persona.nombre) : null
  return { intento: { id: intento.id, puntaje, aprobado, createdAt: intento.createdAt }, certificado }
}

function vector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 128 || !value.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new CapError('La captura facial no tiene el formato esperado.')
  }
  const norma = Math.hypot(...value)
  if (norma < 0.0001) throw new CapError('La captura facial no es válida.')
  return value.map((x) => x / norma)
}

function biometricKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', env.JWT_SECRET, 'capacitaciones-v1', 'face-template', 32))
}

export async function estadoBiometria(persona: CapPersona) {
  const plantilla = await prisma.capBiometria.findUnique({
    where: { personaTipo_personaId: { personaTipo: persona.tipo, personaId: persona.id } }
  })
  return plantilla
    ? { enrolled: true, model: plantilla.modelo, quality: plantilla.calidad, enrolledAt: plantilla.updatedAt }
    : { enrolled: false, model: null, quality: null, enrolledAt: null }
}

export async function enrolarBiometria(persona: CapPersona, input: Record<string, unknown>) {
  const embedding = vector(input.embedding)
  const modelo = texto(input.model, 80)
  const calidad = Number(input.quality)
  const challenges = Array.isArray(input.challenges) ? input.challenges : []
  if (modelo !== MODELO_FACIAL || !Number.isFinite(calidad) || calidad < 0.2 || calidad > 1 ||
    challenges.length < 2 || !challenges.includes('center')) {
    throw new CapError('La captura requiere encuadre y pruebas de vida válidas.')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', biometricKey(), iv)
  cipher.setAAD(Buffer.from(persona.tipo + ':' + persona.id))
  const cifrado = Buffer.concat([cipher.update(JSON.stringify(embedding), 'utf8'), cipher.final()]).toString('base64')
  const authTag = cipher.getAuthTag().toString('base64')
  await prisma.capBiometria.upsert({
    where: { personaTipo_personaId: { personaTipo: persona.tipo, personaId: persona.id } },
    create: { personaTipo: persona.tipo, personaId: persona.id, cifrado, iv: iv.toString('base64'), authTag, modelo, calidad },
    update: { cifrado, iv: iv.toString('base64'), authTag, modelo, calidad }
  })
  return { enrolled: true, model: modelo, quality: calidad }
}

export async function verificarBiometria(persona: CapPersona, cursoId: string, input: Record<string, unknown>) {
  const asignacion = await asignacionDe(cursoId, persona)
  const plantilla = await prisma.capBiometria.findUnique({
    where: { personaTipo_personaId: { personaTipo: persona.tipo, personaId: persona.id } }
  })
  if (!plantilla) throw new CapError('Registra tu identidad facial antes de verificarla.', 409)
  if (plantilla.modelo !== MODELO_FACIAL || texto(input.model, 80) !== MODELO_FACIAL) {
    throw new CapError('Es necesario actualizar el registro facial.', 409)
  }
  const decipher = createDecipheriv('aes-256-gcm', biometricKey(), Buffer.from(plantilla.iv, 'base64'))
  decipher.setAAD(Buffer.from(persona.tipo + ':' + persona.id))
  decipher.setAuthTag(Buffer.from(plantilla.authTag, 'base64'))
  const almacenado = JSON.parse(Buffer.concat([decipher.update(Buffer.from(plantilla.cifrado, 'base64')), decipher.final()]).toString('utf8')) as number[]
  const actual = vector(input.embedding)
  const similitud = almacenado.reduce((sum, x, i) => sum + x * actual[i], 0)
  const matched = similitud >= UMBRAL_FACIAL
  if (matched) {
    await prisma.capAsignacion.update({ where: { id: asignacion.id }, data: { biometriaVerificadaAt: new Date() } })
    const [lecciones, preguntas] = await Promise.all([
      estadoLecciones(asignacion.id, cursoId), prisma.capPregunta.count({ where: { cursoId } })
    ])
    if (lecciones.listo && preguntas === 0) await emitirCertificado(asignacion.id, cursoId, persona.nombre)
  }
  return { matched, similarity: Math.round(similitud * 1000) / 1000, threshold: UMBRAL_FACIAL }
}

export async function borrarBiometria(persona: CapPersona) {
  await prisma.capBiometria.deleteMany({ where: { personaTipo: persona.tipo, personaId: persona.id } })
  await prisma.capAsignacion.updateMany({
    where: { personaTipo: persona.tipo, personaId: persona.id },
    data: { biometriaVerificadaAt: null }
  })
  return { enrolled: false }
}

export async function obtenerCertificado(cursoId: string, persona: CapPersona) {
  const asignacion = await asignacionDe(cursoId, persona)
  const certificado = await prisma.capCertificado.findUnique({
    where: { asignacionId: asignacion.id },
    include: { asignacion: { include: { curso: true } } }
  })
  if (!certificado) throw new CapError('Completa la capacitación para obtener el certificado.', 404)
  return certificado
}

export async function verificarCertificado(codigo: string) {
  const certificado = await prisma.capCertificado.findUnique({
    where: { codigo: texto(codigo, 36) },
    include: { asignacion: { include: { curso: true } } }
  })
  if (!certificado) throw new CapError('Certificado no encontrado.', 404)
  return {
    codigo: certificado.codigo,
    nombre: certificado.nombre,
    curso: certificado.asignacion.curso.titulo,
    emitidoAt: certificado.emitidoAt,
    vigenteHasta: certificado.vigenteHasta,
    vigente: !certificado.vigenteHasta || certificado.vigenteHasta > new Date()
  }
}
