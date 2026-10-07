import { prisma } from '../../config/prisma'
import { AREAS, getAccessibleModules, normalizarRutasOverride, type Area } from '../../config/permissions'
import { getOnlineUserIds } from '../../sockets'
import type { Herramienta } from './asistente.types'
import { conYSinTildes, enteroEntre, fechaCorta, textoOpcional } from './asistente.utils'

/**
 * Usuarios y equipo (pantalla «Equipo») en el asistente y el MCP. Solo lectura: crear, invitar,
 * activar o cambiar permisos se hace en la pantalla.
 *
 * Mismo permiso que la ruta: módulo `usuarios` (administración). Nunca se devuelven contraseñas,
 * tokens, hashes de sesión ni la IP de las sesiones; de una sesión basta el dispositivo y cuándo
 * se usó por última vez.
 */

const MODULO = 'usuarios'
const LIMITE_MAXIMO = 100
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const ENLACE = '/dashboard/usuarios'

const ETIQUETA_AREA: Record<string, string> = {
  administracion: 'Administración',
  operaciones: 'Operaciones',
  contabilidad: 'Contabilidad',
  facturacion: 'Facturación',
  talento_humano: 'Talento humano',
  hseq: 'HSEQ',
  mantenimiento: 'Mantenimiento'
}

const areas = (lista: string[] | null | undefined) => (lista ?? []).map((a) => ETIQUETA_AREA[a] ?? a)

/** «Hace 3 h», «hace 2 días»: para el modelo es más útil que una fecha suelta. */
function hace(fecha: Date | null | undefined): string | undefined {
  if (!fecha) return undefined
  const min = Math.round((Date.now() - fecha.getTime()) / 60_000)
  if (min < 1) return 'hace menos de un minuto'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

/** El área que escribió el usuario («talento humano», «HSEQ») a la clave guardada. */
function areaDesdeTexto(texto: string | undefined): Area | undefined {
  if (!texto) return undefined
  const t = texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
  return (AREAS as readonly string[]).find((a) => a === t || a.startsWith(t)) as Area | undefined
}

/** Dispositivo legible a partir del user agent, sin exponerlo entero. */
function dispositivo(userAgent: string | null): string {
  if (!userAgent) return 'Desconocido'
  if (userAgent.startsWith('App móvil')) return 'App móvil'
  const so = /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Mac OS/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : ''
  const nav = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : ''
  return [nav, so].filter(Boolean).join(' · ') || 'Navegador'
}

export const buscarUsuarios: Herramienta = {
  nombre: 'buscar_usuarios',
  descripcion:
    'Busca usuarios de la plataforma (el equipo administrativo, no conductores) por nombre, correo o cargo, y filtra por área (administración, operaciones, contabilidad, facturación, talento humano, HSEQ, mantenimiento), rol, activos o inactivos y quién está conectado ahora. Devuelve nombre, correo, teléfono, cargo, áreas, rol, si está activo, último acceso, si está en línea y sus sesiones abiertas, además del total por área. Para permisos, sesiones y enlaces de la app de una persona usa detalle_usuario.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Nombre, correo o cargo' },
      area: { type: 'string', description: 'Área: administracion, operaciones, contabilidad, facturacion, talento_humano, hseq, mantenimiento' },
      rol: { type: 'string', enum: ['admin', 'usuario'] },
      activos: { type: 'boolean', description: 'true solo activos, false solo inactivos; omitido trae todos' },
      en_linea: { type: 'boolean', description: 'true para ver solo quién está conectado ahora' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO }
    },
    additionalProperties: false
  },
  etiqueta: 'Consultando el equipo',
  requiere: MODULO,
  async ejecutar(args) {
    const texto = textoOpcional(args.texto, 120)
    const area = areaDesdeTexto(textoOpcional(args.area, 40))
    const enLinea = new Set(getOnlineUserIds())
    const where: any = {}
    if (texto) {
      where.OR = conYSinTildes(texto).flatMap((t) => [
        { nombre: { contains: t, mode: 'insensitive' } },
        { correo: { contains: t, mode: 'insensitive' } },
        { cargo: { contains: t, mode: 'insensitive' } }
      ])
    }
    if (area) where.area = { has: area }
    if (args.rol === 'admin' || args.rol === 'usuario') where.role = args.rol
    if (typeof args.activos === 'boolean') where.activo = args.activos
    if (args.en_linea === true) where.id = { in: [...enLinea] }

    const filas = await prisma.usuarios.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        correo: true,
        telefono: true,
        cargo: true,
        area: true,
        role: true,
        activo: true,
        es_invitado: true,
        ultimo_acceso: true,
        _count: { select: { sesiones: { where: { is_active: true, token_expiry: { gt: new Date() } } } } }
      },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      take: enteroEntre(args.limite, 1, LIMITE_MAXIMO, 30)
    })
    const total = await prisma.usuarios.count({ where })
    const porArea = await prisma.$queryRaw<{ area: string; total: bigint }[]>`
      SELECT unnest(areas) AS area, COUNT(*)::bigint AS total FROM users WHERE activo GROUP BY 1 ORDER BY 2 DESC`

    return {
      total,
      mostrados: filas.length,
      conectados_ahora: enLinea.size,
      activos_por_area: Object.fromEntries(porArea.map((r) => [ETIQUETA_AREA[r.area] ?? r.area, Number(r.total)])),
      usuarios: filas.map((u) => ({
        id: u.id,
        nombre: u.nombre,
        correo: u.correo,
        telefono: u.telefono,
        cargo: u.cargo,
        areas: areas(u.area),
        rol: u.role === 'admin' ? 'Administrador' : 'Usuario',
        activo: u.activo !== false,
        llego_por_invitacion: u.es_invitado || undefined,
        en_linea: enLinea.has(u.id),
        ultimo_acceso: u.ultimo_acceso ? `${fechaCorta(u.ultimo_acceso)} (${hace(u.ultimo_acceso)})` : 'nunca',
        sesiones_abiertas: u._count.sesiones,
        enlace: ENLACE
      }))
    }
  }
}

export const detalleUsuario: Herramienta = {
  nombre: 'detalle_usuario',
  descripcion:
    'Trae un usuario del equipo por id, correo o nombre: datos de contacto, cargo, áreas, rol, estado, a qué pantallas tiene acceso y con qué nivel (completo, lectura o limitado, incluidos los recortes individuales), sus sesiones abiertas (dispositivo y última actividad), si tiene un enlace vigente a la app móvil y las invitaciones que ha enviado. Si el nombre coincide con varios, devuelve las opciones para elegir.',
  parametros: {
    type: 'object',
    properties: {
      usuario: { type: 'string', description: 'Id, correo o nombre del usuario' }
    },
    required: ['usuario'],
    additionalProperties: false
  },
  etiqueta: 'Revisando el usuario',
  requiere: MODULO,
  async ejecutar(args) {
    const q = textoOpcional(args.usuario, 160)
    if (!q) return { error: 'Indica el id, el correo o el nombre del usuario' }
    const id = q.match(UUID)?.[0]
    const candidatos = id
      ? await prisma.usuarios.findMany({ where: { id }, select: { id: true, nombre: true, correo: true } })
      : q.includes('@')
        ? await prisma.usuarios.findMany({ where: { correo: { equals: q, mode: 'insensitive' } }, select: { id: true, nombre: true, correo: true } })
        : await prisma.usuarios.findMany({
            where: { OR: conYSinTildes(q).map((t) => ({ nombre: { contains: t, mode: 'insensitive' as const } })) },
            select: { id: true, nombre: true, correo: true },
            take: 8
          })
    if (!candidatos.length) return { error: `No hay ningún usuario que coincida con «${q}»` }
    if (candidatos.length > 1) {
      return { varios: true, nota: 'Pregunta al usuario cuál es', opciones: candidatos.map((c) => ({ id: c.id, nombre: c.nombre, correo: c.correo })) }
    }

    const ahora = new Date()
    const u = await prisma.usuarios.findUnique({
      where: { id: candidatos[0].id },
      select: {
        id: true,
        nombre: true,
        correo: true,
        telefono: true,
        cargo: true,
        area: true,
        role: true,
        activo: true,
        es_invitado: true,
        ultimo_acceso: true,
        created_at: true,
        firma_url: true,
        permisos_rutas: true,
        sesiones: {
          where: { is_active: true, token_expiry: { gt: ahora } },
          select: { user_agent: true, last_activity: true, created_at: true, token_expiry: true },
          orderBy: { last_activity: 'desc' },
          take: 10
        },
        enlaces_app: {
          where: { revoked_at: null, expires_at: { gt: ahora } },
          select: { created_at: true, expires_at: true, usos: true, ultimo_uso_at: true },
          take: 1
        },
        invitaciones_enviadas: {
          select: { correo: true, estado: true, created_at: true },
          orderBy: { created_at: 'desc' },
          take: 10
        }
      }
    })
    if (!u) return { error: 'El usuario ya no existe' }

    const recortes = normalizarRutasOverride(u.permisos_rutas)
    const accesos = getAccessibleModules(u.role, (u.area ?? []) as Area[], recortes)
    const NIVEL = { full: 'completo', read: 'lectura', limited: 'limitado' } as const
    const enlace = u.enlaces_app[0]

    return {
      id: u.id,
      nombre: u.nombre,
      correo: u.correo,
      telefono: u.telefono,
      cargo: u.cargo,
      areas: areas(u.area),
      rol: u.role === 'admin' ? 'Administrador (acceso completo a todo)' : 'Usuario',
      activo: u.activo !== false,
      llego_por_invitacion: u.es_invitado,
      tiene_firma: Boolean(u.firma_url),
      creado: fechaCorta(u.created_at),
      ultimo_acceso: u.ultimo_acceso ? `${fechaCorta(u.ultimo_acceso)} (${hace(u.ultimo_acceso)})` : 'nunca',
      en_linea: getOnlineUserIds().includes(u.id),
      accesos: Object.fromEntries(Object.entries(accesos).map(([modulo, nivel]) => [modulo, NIVEL[nivel] ?? nivel])),
      tiene_recortes_individuales: Boolean(recortes && Object.keys(recortes).length),
      sesiones_abiertas: u.sesiones.map((s) => ({
        dispositivo: dispositivo(s.user_agent),
        ultima_actividad: `${fechaCorta(s.last_activity)} (${hace(s.last_activity)})`,
        iniciada: fechaCorta(s.created_at),
        vence: fechaCorta(s.token_expiry)
      })),
      enlace_app_movil: enlace
        ? { vence: fechaCorta(enlace.expires_at), usado: enlace.usos, ultimo_uso: fechaCorta(enlace.ultimo_uso_at) ?? 'nunca' }
        : 'sin enlace vigente',
      invitaciones_enviadas: u.invitaciones_enviadas.map((i) => ({ correo: i.correo, estado: i.estado, enviada: fechaCorta(i.created_at) })),
      enlace: ENLACE
    }
  }
}

export const invitacionesEquipo: Herramienta = {
  nombre: 'invitaciones_equipo',
  descripcion:
    'Lista las invitaciones para entrar al equipo: a qué correo, con qué área y cargo, quién invitó, cuándo, cuándo vence y en qué estado está (pendiente, aceptada, revocada o vencida). Por defecto trae las pendientes.',
  parametros: {
    type: 'object',
    properties: {
      estado: { type: 'string', enum: ['pendiente', 'aceptada', 'revocada', 'vencida', 'todas'] },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO }
    },
    additionalProperties: false
  },
  etiqueta: 'Revisando invitaciones',
  requiere: MODULO,
  async ejecutar(args) {
    const ahora = new Date()
    const estado = typeof args.estado === 'string' ? args.estado : 'pendiente'
    /// «Vencida» no se guarda: es una pendiente cuyo plazo ya pasó.
    const where: any =
      estado === 'todas'
        ? {}
        : estado === 'vencida'
          ? { estado: 'pendiente', expires_at: { lte: ahora } }
          : estado === 'pendiente'
            ? { estado: 'pendiente', expires_at: { gt: ahora } }
            : { estado }
    const filas = await prisma.invitaciones_usuario.findMany({
      where,
      select: {
        correo: true,
        area: true,
        cargo: true,
        estado: true,
        created_at: true,
        expires_at: true,
        invitado_por: { select: { nombre: true } }
      },
      orderBy: { created_at: 'desc' },
      take: enteroEntre(args.limite, 1, LIMITE_MAXIMO, 20)
    })
    return {
      filtro: estado,
      total: filas.length,
      invitaciones: filas.map((i) => ({
        correo: i.correo,
        areas: areas(i.area),
        cargo: i.cargo,
        estado: i.estado === 'pendiente' && i.expires_at <= ahora ? 'vencida' : i.estado,
        invito: i.invitado_por?.nombre,
        enviada: fechaCorta(i.created_at),
        vence: fechaCorta(i.expires_at)
      })),
      enlace: ENLACE
    }
  }
}

export const HERRAMIENTAS_USUARIOS: readonly Herramienta[] = [buscarUsuarios, detalleUsuario, invitacionesEquipo]
