import { randomUUID } from "crypto";
import { prisma } from "../../config/prisma";

const VIDA_RESERVA_MS = 10 * 60 * 1000;
const USUARIO_LEGADO = "00000000-0000-0000-0000-000000000000";

function prefijoValido(prefijo: string): string {
  const valor = prefijo.trim();
  if (!/^[A-Za-z0-9]{1,5}$/.test(valor)) {
    throw new Error("El prefijo de planilla debe tener entre 1 y 5 caracteres alfanuméricos.");
  }
  return valor;
}

function formatear(prefijo: string, numero: bigint): string {
  return prefijo + "-" + numero.toString().padStart(4, "0");
}

/**
 * El siguiente número sale del máximo GUARDADO y de las reservas vivas, no de
 * un contador histórico. El lock serializa formularios en varias instancias.
 */
export async function reservarNumeroPlanilla(
  prefijo: string,
  reservaId?: string,
  usuarioId?: string,
): Promise<string> {
  const rawPrefix = prefijoValido(prefijo);
  const id = reservaId ?? randomUUID();
  const propietario = usuarioId ?? USUARIO_LEGADO;
  const regexCompleto = "^" + rawPrefix + "-[0-9]+$";
  const regexPrefijo = "^" + rawPrefix + "-";

  return prisma.$transaction(async (tx) => {
    const claveLock = "recargos-planilla-consecutivo:" + rawPrefix;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${claveLock}, 0::bigint))::text AS locked`;

    // Un formulario cerrado libera de inmediato; esta caducidad cubre cierres
    // bruscos, procesos caídos y pestañas antiguas sin protocolo de salida.
    const corte = new Date(Date.now() - VIDA_RESERVA_MS);
    await tx.recargos_planillas_reservas.deleteMany({
      where: { prefijo: rawPrefix, updated_at: { lt: corte } },
    });

    const reserva = await tx.recargos_planillas_reservas.findUnique({ where: { id } });
    let numeroPropioDisponible = false;
    if (reserva) {
      if (reserva.usuario_id !== propietario || reserva.prefijo !== rawPrefix) {
        throw new Error("La reserva de planilla no pertenece a este formulario.");
      }
      const numeroActual = formatear(rawPrefix, reserva.numero);
      const [usado] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM recargos_planillas
        WHERE lower(btrim(numero_planilla)) = ${numeroActual.toLowerCase()}
        LIMIT 1
      `;
      numeroPropioDisponible = !usado;
    }

    const [guardado] = await tx.$queryRaw<Array<{ maximo: bigint | null }>>`
      SELECT MAX(regexp_replace(numero_planilla, ${regexPrefijo}, '')::bigint) AS maximo
      FROM recargos_planillas
      WHERE numero_planilla ~ ${regexCompleto}
    `;
    const maximo = guardado?.maximo ?? 0n;
    const activas = await tx.recargos_planillas_reservas.findMany({
      where: { prefijo: rawPrefix, id: { not: id }, numero: { gt: maximo } },
      select: { numero: true },
    });
    const ocupados = new Set(activas.map((actual) => actual.numero.toString()));
    let siguiente = maximo + 1n;
    while (ocupados.has(siguiente.toString())) siguiente += 1n;

    // Al regenerar, tomar un hueco anterior liberado por otro formulario.
    // Si no lo hay, conservar la reserva propia y no avanzar falsamente la cola.
    if (reserva && numeroPropioDisponible && reserva.numero <= siguiente) {
      await tx.recargos_planillas_reservas.update({
        where: { id },
        data: { updated_at: new Date() },
      });
      return formatear(rawPrefix, reserva.numero);
    }

    await tx.recargos_planillas_reservas.upsert({
      where: { id },
      create: { id, usuario_id: propietario, prefijo: rawPrefix, numero: siguiente },
      update: { numero: siguiente, updated_at: new Date() },
    });
    return formatear(rawPrefix, siguiente);
  });
}

/** Libera solo la reserva de su dueño; un número ya guardado no se borra. */
export async function liberarNumeroPlanilla(reservaId: string, usuarioId: string): Promise<void> {
  const reserva = await prisma.recargos_planillas_reservas.findUnique({ where: { id: reservaId } });
  if (!reserva) return;
  if (reserva.usuario_id !== usuarioId) {
    throw new Error("La reserva de planilla no pertenece a este formulario.");
  }
  await prisma.$transaction(async (tx) => {
    const claveLock = "recargos-planilla-consecutivo:" + reserva.prefijo;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${claveLock}, 0::bigint))::text AS locked`;
    await tx.recargos_planillas_reservas.deleteMany({ where: { id: reservaId, usuario_id: usuarioId } });
  });
}

/** Mantiene activa una reserva cuyo formulario sigue unido a la sala. */
export async function renovarNumeroPlanilla(reservaId: string, usuarioId: string): Promise<void> {
  await prisma.recargos_planillas_reservas.updateMany({
    where: { id: reservaId, usuario_id: usuarioId },
    data: { updated_at: new Date() },
  });
}
