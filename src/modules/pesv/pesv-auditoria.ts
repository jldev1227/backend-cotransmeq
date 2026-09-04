/**
 * Bitácora del módulo.
 *
 * Append-only y sin `deleted_at`: es la trazabilidad. Retirar una línea de aquí
 * sería retirar precisamente lo que un auditor viene a mirar.
 *
 * `registrarAuditoria` **nunca lanza**. Un fallo escribiendo la bitácora no
 * puede tumbar la operación que la produjo: si aprobar una evidencia fallara
 * porque el log está caído, el usuario reintentaría y acabaríamos con dos
 * aprobaciones. Se registra el problema en consola y se sigue.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import type { ActorPesv } from './pesv-ciclos.service'

export type EntidadAuditable =
  | 'CICLO'
  | 'REQUISITO'
  | 'EVIDENCIA'
  | 'META'
  | 'RIESGO'
  | 'PROGRAMA'
  | 'SINIESTRO'
  | 'VELOCIDAD'
  | 'MANTENIMIENTO'
  | 'FORMACION'
  | 'CONTRATO'
  | 'FUEC'
  | 'IMPORTACION'
  | 'DOCUMENTO'
  | 'POLITICA_JORNADA'

export interface EntradaAuditoria {
  entidad: EntidadAuditable
  entidadId: string | null
  accion: string
  actor: Pick<ActorPesv, 'id' | 'nombre'> | null
  detalle: Prisma.InputJsonValue
}

export async function registrarAuditoria(entrada: EntradaAuditoria): Promise<void> {
  try {
    await prisma.pesv_audit_log.create({
      data: {
        entidad: entrada.entidad,
        entidad_id: entrada.entidadId,
        accion: entrada.accion,
        usuario_id: entrada.actor?.id ?? null,
        /// El nombre se copia y no se resuelve por la FK al leer: si el usuario
        /// se da de baja, la bitácora tiene que seguir diciendo quién aprobó.
        usuario_nombre: entrada.actor?.nombre ?? null,
        detalle_json: entrada.detalle,
      },
    })
  } catch (error) {
    console.error('[pesv:auditoria] no se pudo registrar la entrada', {
      entidad: entrada.entidad,
      accion: entrada.accion,
      error,
    })
  }
}

export interface FiltrosAuditoria {
  entidad?: EntidadAuditable
  entidadId?: string
  usuarioId?: string
  desde?: Date
  hasta?: Date
  limite?: number
}

export async function listarAuditoria(filtros: FiltrosAuditoria = {}) {
  return prisma.pesv_audit_log.findMany({
    where: {
      ...(filtros.entidad ? { entidad: filtros.entidad } : {}),
      ...(filtros.entidadId ? { entidad_id: filtros.entidadId } : {}),
      ...(filtros.usuarioId ? { usuario_id: filtros.usuarioId } : {}),
      ...(filtros.desde || filtros.hasta
        ? {
            created_at: {
              ...(filtros.desde ? { gte: filtros.desde } : {}),
              ...(filtros.hasta ? { lte: filtros.hasta } : {}),
            },
          }
        : {}),
    },
    orderBy: { created_at: 'desc' },
    take: Math.min(filtros.limite ?? 200, 1000),
  })
}
