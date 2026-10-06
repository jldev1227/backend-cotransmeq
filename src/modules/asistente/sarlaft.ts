import { prisma } from '../../config/prisma'
import { FormulariosSarlaftService } from '../formularios-sarlaft/formularios-sarlaft.service'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaCorta, fechaOpcional, textoOpcional } from './asistente.utils'

/**
 * Formularios SARLAFT / PTEE (conocimiento de clientes, proveedores,
 * accionistas y personal) en el asistente y el MCP. Solo lectura: evaluar un
 * formulario y emitir los documentos se hace en la pantalla.
 *
 * El detalle devuelve las respuestas tal como se guardaron (JSON del formato)
 * pero NUNCA la IP, el user agent, las claves de S3 ni los hashes.
 */

const MODULO = 'sarlaft'
const LIMITE_MAXIMO = 50
const TIPOS = ['cliente_proveedor', 'accionistas', 'personal', 'autorizacion_propietario', 'declaracion_empresa_transporte'] as const
const ESTADOS = ['recibido', 'aprobado', 'condicionado', 'rechazado'] as const
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const enlace = (id: string) => `/dashboard/sarlaft/${id}`

export const buscarSarlaft: Herramienta = {
  nombre: 'buscar_sarlaft',
  descripcion:
    'Busca formularios SARLAFT / PTEE recibidos por radicado, nombre, documento o correo de quien lo diligenció, tipo (cliente o proveedor, accionistas, personal, autorización de propietario, declaración de empresa de transporte), estado de evaluación o fecha de envío. Devuelve radicado, tipo, quién, fecha, estado, evaluador y enlace. Para las respuestas completas usa detalle_sarlaft.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Radicado, nombre, documento o correo' },
      tipo: { type: 'string', enum: [...TIPOS] },
      estado: { type: 'string', description: 'recibido (sin evaluar), aprobado, condicionado, rechazado…' },
      desde: { type: 'string', description: 'Fecha de envío desde, YYYY-MM-DD' },
      hasta: { type: 'string', description: 'Hasta, YYYY-MM-DD incluida' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando formularios SARLAFT',
  requiere: MODULO,
  salidaMaxima: { lista: LIMITE_MAXIMO },
  async ejecutar(args) {
    const tipo = typeof args.tipo === 'string' && (TIPOS as readonly string[]).includes(args.tipo) ? (args.tipo as (typeof TIPOS)[number]) : null
    const estado = textoOpcional(args.estado, 30)?.toLowerCase().replace(/\s+/g, '_') ?? null
    const hasta = fechaOpcional(args.hasta)
    const r = await FormulariosSarlaftService.listarAdmin({
      page: 1,
      limit: enteroEntre(args.limite, 1, LIMITE_MAXIMO, 15),
      search: textoOpcional(args.texto, 120),
      tipo_formulario: tipo,
      estado,
      fecha_desde: fechaOpcional(args.desde) ?? null,
      fecha_hasta: hasta ? `${hasta}T23:59:59.999-05:00` : null,
    })
    return {
      total: r.pagination.total,
      mostrados: r.items.length,
      estados_posibles: ESTADOS,
      formularios: r.items.map((f) => ({
        radicado: f.radicado,
        formato: f.codigo_formulario,
        tipo: f.tipo_formulario.replace(/_/g, ' '),
        nombre: f.nombre_completo,
        documento: `${f.tipo_documento} ${f.numero_documento}`,
        correo: f.correo,
        telefono: f.telefono,
        enviado: fechaCorta(f.fecha_envio),
        estado: f.estado.replace(/_/g, ' '),
        documentos_adjuntos: f.documentos_count,
        evaluado_por: f.evaluado_por?.nombre,
        enlace: enlace(f.id),
      })),
    }
  },
}

export const detalleSarlaft: Herramienta = {
  nombre: 'detalle_sarlaft',
  descripcion:
    'Trae un formulario SARLAFT / PTEE completo por radicado, id o enlace: datos de quien lo diligenció, todas sus respuestas (por sección y pregunta), documentos adjuntos (nombre y tipo), evaluación (concepto, observaciones, evaluador) y versiones del documento generado.',
  parametros: {
    type: 'object',
    properties: { formulario: { type: 'string', description: 'Radicado (p. ej. SLFT-2026-0012), id o enlace' } },
    required: ['formulario'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo el formulario SARLAFT',
  requiere: MODULO,
  salidaMaxima: { lista: 80, caracteres: 45000 },
  async ejecutar(args) {
    const texto = textoOpcional(args.formulario, 200)
    if (!texto) return { error: 'Indica el radicado' }
    const id = texto.match(UUID)?.[0]?.toLowerCase()
    const fila = id
      ? await prisma.formulario_sarlaft_ptee.findUnique({ where: { id }, select: { id: true } })
      : await prisma.formulario_sarlaft_ptee.findFirst({ where: { radicado: { equals: texto, mode: 'insensitive' } }, select: { id: true } })
    if (!fila) return { error: `No existe un formulario SARLAFT «${texto}»` }
    const d = await FormulariosSarlaftService.obtenerDetalle(fila.id)
    if (!d) return { error: 'El formulario ya no existe' }

    /// Preguntas con etiqueta: la definición del formato trae secciones y
    /// campos; se cruza con el JSON de respuestas para que el modelo lea
    /// «¿Es PEP?: No» y no claves técnicas.
    const definicion = d.definicion as { secciones?: { seccion?: string; preguntas?: { id: string; pregunta: string; tipo_respuesta?: string }[] }[] } | null | undefined
    const respuestas = (d.respuestas ?? {}) as Record<string, unknown>
    const usadas = new Set<string>()
    const secciones = (definicion?.secciones ?? []).map((s) => ({
      seccion: s.seccion,
      respuestas: (s.preguntas ?? [])
        .filter((p) => p.tipo_respuesta !== 'declaracion_informativa')
        .map((p) => {
          usadas.add(p.id)
          return { pregunta: p.pregunta, respuesta: respuestas[p.id] }
        })
        .filter((x) => x.respuesta !== undefined && x.respuesta !== null && x.respuesta !== ''),
    }))
    const sueltas = Object.fromEntries(Object.entries(respuestas).filter(([k, v]) => !usadas.has(k) && v !== null && v !== ''))

    return {
      radicado: d.radicado,
      formato: `${d.codigo_formulario} v${d.version}`,
      tipo: d.tipo_formulario.replace(/_/g, ' '),
      nombre: d.nombre_completo,
      documento: `${d.tipo_documento} ${d.numero_documento}`,
      correo: d.correo,
      telefono: d.telefono,
      enviado: fechaCorta(d.fecha_envio),
      diligenciado: fechaCorta(d.fecha_diligenciamiento),
      estado: d.estado.replace(/_/g, ' '),
      evaluacion: d.evaluado_at
        ? { concepto: d.evaluacion_concepto, observaciones: d.evaluacion_observaciones, fecha: fechaCorta(d.evaluado_at), evaluador: d.evaluado_por?.nombre }
        : 'sin evaluar',
      respuestas_por_seccion: secciones.filter((s) => s.respuestas.length > 0),
      ...(Object.keys(sueltas).length ? { otras_respuestas: sueltas } : {}),
      documentos_adjuntos: d.documentos.map((x) => ({ tipo: x.tipo_documento, archivo: x.nombre_archivo, fecha: fechaCorta(x.created_at) })),
      documentos_generados: d.documentos_generados.map((g) => ({
        clase: g.clase,
        version: g.version_documento,
        estado: g.estado_documental,
        fecha: fechaCorta(g.created_at),
        generado_por: g.generado_por?.nombre,
        entregas: g.entregas.map((e) => ({ canal: e.canal, destinatario: e.destinatario, estado: e.estado, fecha: fechaCorta(e.created_at) })),
      })),
      enlace: enlace(d.id),
    }
  },
}

export const HERRAMIENTAS_SARLAFT: readonly Herramienta[] = [buscarSarlaft, detalleSarlaft]
