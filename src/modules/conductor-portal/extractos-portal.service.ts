/**
 * Extractos de contrato (FUEC) y documentos del vehículo en el portal del
 * conductor: lo que un agente de tránsito le pide en vía.
 *
 * Todo sale del conductor del TOKEN. Un id que no es suyo responde 404, igual
 * que uno que no existe, para no confirmar qué ids son válidos.
 *
 * Un conductor figura en un extracto por `fuec_extract_driver.conductor_id`
 * (hasta tres por extracto). El nombre impreso se conserva aunque la ficha se
 * concilie después, así que la pertenencia se decide por el id, nunca por el
 * nombre ni por la cédula impresa.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl } from '../../config/aws'
import { getEmailFrontendUrl } from '../../services/email.service'
import { hoyBogota } from '../dashboard/periodo'
import { estadoEfectivo } from '../extractos/extractos.service'
import { huella } from '../extractos/fuec-firma'
import { FUEC } from '../extractos/fuec.config'
import { CATEGORIAS_DOCUMENTO } from '../vehiculos-documentos/catalogo'
import { VehiculosDocumentosService } from '../vehiculos-documentos/vehiculos-documentos.service'
import { generarPdfExtracto } from './extracto-pdf'
import { nombreArchivoExtracto, type SnapshotDocExtracto } from './pdfExtractoDoc'

export class PortalExtractosError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message)
  }
}

/// El historial completo puede pasar de mil extractos (un conductor de planta
/// en tm tiene 1.018). La app lo guarda entero en el teléfono para abrir sin
/// señal, así que se manda solo lo reciente: lo vigente siempre, y del resto
/// lo último que alguien podría pedirle.
const LIMITE_HISTORIAL = 30

/// Corta: la app la pide al tocar «Abrir» y la usa en el acto. Una URL que
/// se reenvía por WhatsApp no debería seguir abriendo el SOAT al día siguiente.
const URL_DOCUMENTO_TTL_SEGUNDOS = 5 * 60

const MARCA_COPIA_LIBRO = 'Copia del libro histórico · sin firma electrónica'

const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null)
const aFecha = (s: string): Date => new Date(`${s}T00:00:00Z`)

/**
 * A donde lleva el QR. La misma que imprime el dashboard (`window.location.origin`
 * del front + `/public/extracto/<código>`); aquí el origen es la URL pública
 * canónica del front, la que ya usan los enlaces de los correos.
 */
export function urlPublicaExtracto(codigo: string): string {
  return `${getEmailFrontendUrl()}/public/extracto/${codigo}`
}

const incluir = {
  conductores: { orderBy: { orden: 'asc' as const } },
  reemplazado_por: { where: { deleted_at: null }, select: { id: true, numero_completo: true } }
} satisfies Prisma.fuec_extractInclude

type FilaExtracto = Prisma.fuec_extractGetPayload<{ include: typeof incluir }>

/**
 * Lo impreso. Con snapshot firmado se usa tal cual —es lo que valida la página
 * del QR—; sin él (importados viejos) se arma con las columnas, igual que hace
 * el dashboard en `snapshotDe()`, para que los dos PDF coincidan.
 */
function snapshotDe(e: FilaExtracto): SnapshotDocExtracto {
  const s = e.snapshot_json as unknown as SnapshotDocExtracto | null
  if (s && typeof s === 'object' && s.numero) return s
  const r = (e.responsable_json ?? {}) as Record<string, string | null>
  return {
    numero: e.numero_completo,
    consecutivo: e.consecutivo,
    empresa: { razon_social: FUEC.razon_social, nit: FUEC.nit },
    contrato_numero: e.contrato_numero ?? '',
    contratante: { nombre: e.contratante_nombre ?? '', nit: e.contratante_nit },
    objeto_contrato: e.objeto_contrato ?? '',
    origen_destino: e.origen_destino ?? '',
    convenio: e.convenio ?? 'N/A',
    vigencia_desde: ymd(e.vigencia_desde)!,
    vigencia_hasta: ymd(e.vigencia_hasta)!,
    vehiculo: {
      placa: e.vehiculo_placa ?? '',
      modelo: e.modelo,
      marca: e.marca,
      clase: e.clase,
      numero_interno: e.numero_interno,
      tarjeta_operacion: e.tarjeta_operacion
    },
    conductores: e.conductores.map((c) => ({ nombre: c.nombre, cedula: c.identificacion, licencia_vigencia: ymd(c.licencia_vigencia) })),
    responsable: { nombre: r.nombre ?? null, cedula: r.cedula ?? null, telefono: r.telefono ?? null, direccion: r.direccion ?? null }
  }
}

function formatear(e: FilaExtracto, conductorId: string, hoy: string) {
  const s = snapshotDe(e)
  const firmado = !!e.firma_sha512
  return {
    id: e.id,
    consecutivo: e.consecutivo,
    numero: s.numero,
    estado: estadoEfectivo(e, hoy),
    vigencia_desde: s.vigencia_desde,
    vigencia_hasta: s.vigencia_hasta,
    contrato_numero: s.contrato_numero,
    contratante: s.contratante,
    objeto_contrato: s.objeto_contrato,
    origen_destino: s.origen_destino,
    convenio: s.convenio,
    vehiculo: { id: e.vehiculo_id, ...s.vehiculo },
    /// Los mismos datos que van impresos en la hoja que el conductor porta.
    conductores: s.conductores.map((c, i) => ({
      ...c,
      soy_yo: e.conductores[i]?.conductor_id === conductorId
    })),
    responsable: s.responsable,
    codigo_verificacion: firmado ? e.codigo_verificacion : null,
    huella: huella(e.firma_sha512),
    firmado,
    url_publica: firmado && e.codigo_verificacion ? urlPublicaExtracto(e.codigo_verificacion) : null,
    emitido_at: e.emitido_at?.toISOString() ?? e.created_at.toISOString(),
    anulado: e.anulado_at ? { fecha: e.anulado_at.toISOString(), motivo: e.motivo_anulacion } : null,
    reemplazado_por: e.reemplazado_por[0] ? { id: e.reemplazado_por[0].id, numero: e.reemplazado_por[0].numero_completo } : null,
    pdf_nombre: nombreArchivoExtracto(s)
  }
}

export type ExtractoPortal = ReturnType<typeof formatear>

const delConductor = (conductorId: string): Prisma.fuec_extractWhereInput => ({
  deleted_at: null,
  conductores: { some: { conductor_id: conductorId } }
})

/**
 * Vigentes (incluye «por vencer» y los que aún no empiezan) primero, del más
 * reciente al más antiguo; después el historial reciente. El estado se calcula
 * al leer, igual que en el dashboard: VENCIDO y POR_VENCER nunca se escriben.
 */
export async function listarExtractosDelConductor(conductorId: string) {
  const hoy = hoyBogota()
  const base = delConductor(conductorId)
  const vigentes: Prisma.fuec_extractWhereInput = { ...base, anulado_at: null, vigencia_hasta: { gte: aFecha(hoy) } }
  const historial: Prisma.fuec_extractWhereInput = {
    ...base,
    OR: [{ anulado_at: { not: null } }, { vigencia_hasta: { lt: aFecha(hoy) } }]
  }
  const [filasVigentes, filasHistorial, totalHistorial] = await Promise.all([
    prisma.fuec_extract.findMany({ where: vigentes, include: incluir, orderBy: [{ vigencia_desde: 'desc' }, { consecutivo: 'desc' }] }),
    prisma.fuec_extract.findMany({
      where: historial,
      include: incluir,
      orderBy: [{ vigencia_hasta: 'desc' }, { consecutivo: 'desc' }],
      take: LIMITE_HISTORIAL
    }),
    prisma.fuec_extract.count({ where: historial })
  ])
  return {
    hoy,
    extractos: [...filasVigentes, ...filasHistorial].map((e) => formatear(e, conductorId, hoy)),
    historial_total: totalHistorial,
    historial_mostrado: filasHistorial.length
  }
}

async function filaDelConductor(conductorId: string, id: string): Promise<FilaExtracto> {
  const e = await prisma.fuec_extract.findFirst({ where: { ...delConductor(conductorId), id }, include: incluir })
  if (!e) throw new PortalExtractosError('Extracto no encontrado', 404, 'NO_ENCONTRADO')
  return e
}

export async function obtenerExtractoDelConductor(conductorId: string, id: string): Promise<ExtractoPortal> {
  return formatear(await filaDelConductor(conductorId, id), conductorId, hoyBogota())
}

/**
 * El PDF que el conductor imprime o comparte. Un extracto emitido no cambia,
 * así que la app lo guarda y no lo vuelve a pedir; uno anulado también se
 * entrega (es su historial), y la app ya le muestra que está anulado.
 */
export async function pdfExtractoDelConductor(conductorId: string, id: string) {
  const e = await filaDelConductor(conductorId, id)
  const s = snapshotDe(e)
  const firmado = !!e.firma_sha512
  const buffer = await generarPdfExtracto(s, {
    empresa: FUEC,
    codigo_verificacion: firmado ? e.codigo_verificacion : null,
    huella: huella(e.firma_sha512),
    url_publica: firmado && e.codigo_verificacion ? urlPublicaExtracto(e.codigo_verificacion) : null,
    marca: firmado ? null : MARCA_COPIA_LIBRO
  })
  return { buffer, nombre: nombreArchivoExtracto(s) }
}

// ── Documentos del vehículo ────────────────────────────────────────────────

const CATEGORIAS_CONDUCTOR = CATEGORIAS_DOCUMENTO.filter((c) => c.paraConductor)
const CLAVES_CONDUCTOR = new Set(CATEGORIAS_CONDUCTOR.map((c) => c.clave))

type MotivoVehiculo = 'asignado' | 'extracto'

/**
 * Qué vehículos son «del conductor» para enseñarle sus documentos.
 *
 * Dos fuentes, unidas:
 *   · `vehiculos.conductor_id`: el vehículo asignado en la ficha. Es la
 *     relación natural, pero hoy nadie la llena (0 de 352 vehículos en tm y
 *     0 de 180 en cq el 10-oct-2026), así que sola dejaría la pantalla vacía;
 *   · los extractos VIGENTES (o que aún no empiezan) donde figura: el FUEC
 *     dice qué placa está autorizado a manejar ahora mismo, y es justo ese
 *     vehículo cuyo SOAT y tarjeta de operación le piden en el retén.
 *
 * Los extractos vencidos o anulados NO cuentan: darían acceso a los papeles
 * de cada vehículo que alguna vez manejó.
 */
async function vehiculosDelConductor(conductorId: string) {
  const hoy = aFecha(hoyBogota())
  const [asignados, extractos] = await Promise.all([
    prisma.vehiculos.findMany({
      where: { conductor_id: conductorId, deleted_at: null },
      select: { id: true, placa: true, marca: true, linea: true, modelo: true, numero_interno: true }
    }),
    prisma.fuec_extract.findMany({
      where: { ...delConductor(conductorId), anulado_at: null, vigencia_hasta: { gte: hoy }, vehiculo_id: { not: null } },
      select: {
        vehiculo_id: true,
        numero_completo: true,
        vigencia_hasta: true,
        vehiculo: { select: { id: true, placa: true, marca: true, linea: true, modelo: true, numero_interno: true, deleted_at: true } }
      },
      orderBy: { consecutivo: 'desc' }
    })
  ])
  const porId = new Map<
    string,
    {
      id: string
      placa: string
      marca: string | null
      linea: string | null
      modelo: string | null
      numero_interno: string | null
      motivo: MotivoVehiculo
      extracto: { numero: string; vigencia_hasta: string } | null
    }
  >()
  for (const v of asignados) porId.set(v.id, { ...v, motivo: 'asignado', extracto: null })
  for (const e of extractos) {
    const v = e.vehiculo
    if (!v || v.deleted_at) continue
    const previo = porId.get(v.id)
    const extracto = { numero: e.numero_completo, vigencia_hasta: ymd(e.vigencia_hasta)! }
    if (previo) {
      previo.extracto ??= extracto
      continue
    }
    const { deleted_at: _borrado, ...datos } = v
    porId.set(v.id, { ...datos, motivo: 'extracto', extracto })
  }
  return [...porId.values()]
}

export async function documentosVehiculosDelConductor(conductorId: string) {
  const vehiculos = await vehiculosDelConductor(conductorId)
  const conDocumentos = await Promise.all(
    vehiculos.map(async (v) => {
      const { categorias, hoy } = await VehiculosDocumentosService.listar(v.id)
      const documentos = categorias
        .filter((c) => CLAVES_CONDUCTOR.has(c.clave))
        .map((c) => ({
          clave: c.clave,
          etiqueta: c.etiqueta,
          vence: c.vence,
          estado: c.estado,
          dias: c.dias,
          /// Sin `historial` ni metadatos internos: al conductor le sirve el
          /// documento actual y su vigencia.
          actual: c.actual
            ? {
                id: c.actual.id,
                nombre: c.actual.nombre,
                mimetype: c.actual.mimetype,
                size: c.actual.size,
                tiene_archivo: c.actual.tiene_archivo,
                fecha_vencimiento: c.actual.fecha_vencimiento,
                fecha_expedicion: c.actual.fecha_expedicion,
                numero: c.actual.numero,
                emisor: c.actual.emisor
              }
            : null
        }))
      return { ...v, hoy, documentos }
    })
  )
  return { vehiculos: conDocumentos }
}

/**
 * URL firmada para abrir UN documento. Solo el ACTUAL de una categoría que el
 * catálogo marca para el conductor, y solo de un vehículo que hoy es suyo:
 * las versiones reemplazadas y los papeles internos (contratos, RUT del
 * propietario) no salen por aquí aunque se adivine su id.
 */
export async function urlDocumentoDelConductor(conductorId: string, vehiculoId: string, documentoId: string) {
  const vehiculos = await vehiculosDelConductor(conductorId)
  if (!vehiculos.some((v) => v.id === vehiculoId)) {
    throw new PortalExtractosError('Documento no encontrado', 404, 'NO_ENCONTRADO')
  }
  const { categorias } = await VehiculosDocumentosService.listar(vehiculoId)
  const actual = categorias.find((c) => CLAVES_CONDUCTOR.has(c.clave) && c.actual?.id === documentoId)?.actual
  if (!actual) throw new PortalExtractosError('Documento no encontrado', 404, 'NO_ENCONTRADO')
  if (!actual.tiene_archivo) throw new PortalExtractosError('Este documento no tiene archivo cargado', 404, 'SIN_ARCHIVO')

  const fila = await prisma.documento.findFirst({
    where: { id: documentoId, vehiculo_id: vehiculoId, deleted_at: null },
    select: { s3_key: true }
  })
  if (!fila?.s3_key) throw new PortalExtractosError('Este documento no tiene archivo cargado', 404, 'SIN_ARCHIVO')
  const url = await getS3SignedUrl(fila.s3_key, URL_DOCUMENTO_TTL_SEGUNDOS)
  return {
    url,
    expira_at: new Date(Date.now() + URL_DOCUMENTO_TTL_SEGUNDOS * 1000).toISOString(),
    nombre: actual.nombre,
    mimetype: actual.mimetype
  }
}
