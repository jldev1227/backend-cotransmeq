/**
 * Ciclo de vida del estado de una liquidación de nómina.
 *
 * Hasta ahora `liquidaciones.estado` era un enum de dos valores
 * (`Pendiente` / `Liquidado`) sin versión, sin historial y sin reversión: no
 * se podía saber quién liquidó, ni cuándo, ni deshacerlo. Esto lo sustituye
 * por la misma máquina que usan los cierres de terceros
 * (`liquidaciones-terceros-descuentos/cierre-estado.service.ts`), con sus
 * cinco piezas:
 *
 *   1. Matriz de transiciones extraída, para que la barra del canvas pinte
 *      solo los botones que el servidor va a aceptar.
 *   2. Doble guard: de ENTRADA a los estados que congelan el documento y de
 *      SALIDA de ellos. Con solo el de salida, aprobar lo podría hacer
 *      cualquiera y la cadena de aprobación no significa nada.
 *   3. Compare-and-swap sobre `version`. El libro de un periodo lo abren
 *      varias personas; sin CAS, dos clics simultáneos se resuelven por
 *      orden de llegada.
 *   4. Historial dentro de la MISMA transacción que el cambio.
 *   5. El aviso por socket va FUERA del commit — anunciar dentro sería
 *      anunciar algo que todavía puede hacer rollback.
 *
 * `estado` (el enum viejo) se mantiene sincronizado para no romper lo que ya
 * lo lee: pasa a `Liquidado` en cuanto el flujo llega a LIQUIDADA.
 */
import { prisma } from '../../config/prisma';

export type EstadoNomina = 'BORRADOR' | 'LIQUIDADA' | 'APROBADA' | 'PAGADA' | 'ANULADA';

export const ESTADOS_VALIDOS: EstadoNomina[] = [
  'BORRADOR',
  'LIQUIDADA',
  'APROBADA',
  'PAGADA',
  'ANULADA',
];

export const TRANSICIONES: Record<string, EstadoNomina[]> = {
  BORRADOR: ['LIQUIDADA', 'ANULADA'],
  LIQUIDADA: ['APROBADA', 'BORRADOR', 'ANULADA'],
  APROBADA: ['PAGADA', 'LIQUIDADA', 'ANULADA'],
  PAGADA: ['ANULADA'],
  ANULADA: [],
};

/**
 * Estados a los que solo puede llevar Administración: son los que congelan
 * el desprendible de cara a contabilidad y al conductor.
 */
export const ESTADOS_QUE_EXIGEN_ADMIN: EstadoNomina[] = ['APROBADA', 'PAGADA'];

/** Estados en los que el canvas deja la hoja en solo lectura. */
export const ESTADOS_BLOQUEADOS: string[] = ['APROBADA', 'PAGADA', 'ANULADA'];

/** Estados que exigen escribir un motivo. */
export const ESTADOS_QUE_EXIGEN_MOTIVO: EstadoNomina[] = ['ANULADA'];

/** A partir de aquí el enum viejo pasa a `Liquidado`. */
const ESTADOS_YA_LIQUIDADOS: string[] = ['LIQUIDADA', 'APROBADA', 'PAGADA'];

export interface Actor {
  id: string | null;
  name?: string | null;
  areas?: string[] | string | null;
}

export class ErrorEstadoNomina extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | 'ESTADO_INVALIDO'
      | 'TRANSICION_INVALIDA'
      | 'SIN_PERMISO'
      | 'VERSION_CONFLICT'
      | 'NO_ENCONTRADO'
      | 'FALTA_MOTIVO',
    readonly detalle?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function esAdmin(actor: Actor | null | undefined): boolean {
  const raw = actor?.areas;
  const areas = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  return areas.some((a) => String(a).toUpperCase() === 'ADMINISTRACION');
}

/**
 * Lo que este actor puede hacer desde `estadoActual`.
 *
 * Refleja los DOS guards de `cambiar()`. Si solo reflejara uno, la barra
 * ofrecería acciones que el servidor rechaza después.
 *
 * Espejo de `ingreso-svelte/src/lib/editor/builders/nomina-estado.ts`.
 */
export function transicionesPermitidas(
  estadoActual: string,
  actor: Actor | null | undefined,
): EstadoNomina[] {
  const admin = esAdmin(actor);
  const posibles = TRANSICIONES[estadoActual] ?? [];
  // Guard de SALIDA: sacar algo de APROBADA o PAGADA es de Administración.
  if (ESTADOS_BLOQUEADOS.includes(estadoActual) && !admin) return [];
  // Guard de ENTRADA.
  return admin ? posibles : posibles.filter((e) => !ESTADOS_QUE_EXIGEN_ADMIN.includes(e));
}

export interface ResultadoCambioEstado {
  id: string;
  conductor_id: string | null;
  estado: EstadoNomina;
  estado_anterior: string;
  version: number;
  motivo: string | null;
}

export const NominaEstadoService = {
  /** Cambia el estado de UNA liquidación. */
  async cambiar(params: {
    id: string;
    estado: string;
    motivo?: string | null;
    base_version?: number | null;
    actor: Actor;
  }): Promise<ResultadoCambioEstado> {
    const { id, estado, motivo, base_version, actor } = params;

    if (!ESTADOS_VALIDOS.includes(estado as EstadoNomina)) {
      throw new ErrorEstadoNomina(
        `Estado inválido: ${estado}. Válidos: ${ESTADOS_VALIDOS.join(', ')}`,
        400,
        'ESTADO_INVALIDO',
      );
    }

    const actual = await prisma.liquidaciones.findUnique({
      where: { id },
      select: { id: true, estado_flujo: true, version: true, conductor_id: true },
    });
    if (!actual) {
      throw new ErrorEstadoNomina('Liquidación de nómina no encontrada', 404, 'NO_ENCONTRADO');
    }

    const estadoActual = actual.estado_flujo || 'BORRADOR';

    if (!(TRANSICIONES[estadoActual] ?? []).includes(estado as EstadoNomina)) {
      throw new ErrorEstadoNomina(
        `Transición no válida de ${estadoActual} a ${estado}. Permitidas: ${
          TRANSICIONES[estadoActual]?.join(', ') || 'ninguna'
        }`,
        409,
        'TRANSICION_INVALIDA',
        { estado_actual: estadoActual },
      );
    }

    if (ESTADOS_QUE_EXIGEN_ADMIN.includes(estado as EstadoNomina) && !esAdmin(actor)) {
      throw new ErrorEstadoNomina(
        `Solo Administración puede pasar una liquidación a ${estado}.`,
        403,
        'SIN_PERMISO',
      );
    }
    if (ESTADOS_BLOQUEADOS.includes(estadoActual) && !esAdmin(actor)) {
      throw new ErrorEstadoNomina(
        `La liquidación está en ${estadoActual}. Solo Administración puede cambiar su estado.`,
        403,
        'SIN_PERMISO',
      );
    }
    if (ESTADOS_QUE_EXIGEN_MOTIVO.includes(estado as EstadoNomina) && !motivo?.trim()) {
      throw new ErrorEstadoNomina('Se requiere motivo para anular', 400, 'FALTA_MOTIVO');
    }

    return prisma.$transaction(async (tx) => {
      const gano = await tx.liquidaciones.updateMany({
        where: {
          id,
          estado_flujo: estadoActual,
          ...(base_version != null ? { version: base_version } : {}),
        },
        data: {
          estado_flujo: estado,
          // El enum viejo sigue el flujo para no romper a quien lo lee.
          estado: ESTADOS_YA_LIQUIDADOS.includes(estado) ? 'Liquidado' : 'Pendiente',
          motivo_anulacion: estado === 'ANULADA' ? motivo?.trim() ?? null : null,
          actualizado_por_id: actor.id || null,
          ...(estado === 'LIQUIDADA' ? { liquidado_por_id: actor.id || null } : {}),
          version: { increment: 1 },
          updated_at: new Date(),
        },
      });

      if (gano.count === 0) {
        const server = await tx.liquidaciones.findUnique({
          where: { id },
          select: { estado_flujo: true, version: true },
        });
        throw new ErrorEstadoNomina(
          'Otro usuario cambió el estado mientras tanto',
          409,
          'VERSION_CONFLICT',
          { estado_servidor: server?.estado_flujo, version_servidor: server?.version },
        );
      }

      await tx.historial_estado_liquidacion_nomina.create({
        data: {
          liquidacion_id: id,
          estado_anterior: estadoActual,
          estado_nuevo: estado,
          usuario_id: actor.id || null,
          motivo: motivo?.trim() || null,
        },
      });

      return {
        id,
        conductor_id: actual.conductor_id,
        estado: estado as EstadoNomina,
        estado_anterior: estadoActual,
        version: actual.version + 1,
        motivo: motivo?.trim() || null,
      };
    });
  },

  /**
   * Cambia el estado de varias liquidaciones a la vez.
   *
   * **No es una transacción única, y es a propósito.** Con 30 conductores, un
   * fallo en el último revertiría los 29 anteriores y el usuario no sabría
   * cuál falló ni por qué. Se devuelve el parte: qué cambió y qué no.
   */
  async cambiarLote(params: {
    ids: string[];
    estado: string;
    motivo?: string | null;
    actor: Actor;
  }): Promise<{
    total: number;
    cambiados: ResultadoCambioEstado[];
    fallidos: { id: string; error: string; code?: string }[];
  }> {
    const cambiados: ResultadoCambioEstado[] = [];
    const fallidos: { id: string; error: string; code?: string }[] = [];

    for (const id of params.ids) {
      try {
        cambiados.push(
          await this.cambiar({
            id,
            estado: params.estado,
            motivo: params.motivo,
            actor: params.actor,
          }),
        );
      } catch (e) {
        const err = e as ErrorEstadoNomina;
        fallidos.push({ id, error: err.message ?? 'Error desconocido', code: err.code });
      }
    }

    return { total: params.ids.length, cambiados, fallidos };
  },

  /** Historial de una liquidación, del cambio más reciente al más antiguo. */
  async historial(liquidacionId: string) {
    return prisma.historial_estado_liquidacion_nomina.findMany({
      where: { liquidacion_id: liquidacionId },
      orderBy: { created_at: 'desc' },
      take: 100,
      include: { usuario: { select: { id: true, nombre: true, correo: true } } },
    });
  },
};
