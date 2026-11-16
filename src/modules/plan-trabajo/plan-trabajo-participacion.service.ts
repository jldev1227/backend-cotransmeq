import { prisma } from "../../config/prisma";
import { PlanTrabajoError } from "./plan-trabajo.service";

type Destinatario = { tipo: "ADMIN" | "CONDUCTOR"; id: string };

/** La migración se aplica en despliegue; los servidores de desarrollo pueden usar una base aún sin migrar. */
export async function participacionesDisponibles(): Promise<boolean> {
  const filas = await prisma.$queryRawUnsafe<Array<{ tabla: string | null }>>(
    "SELECT to_regclass('plan_trabajo_participacion')::text AS tabla"
  );
  return Boolean(filas[0]?.tabla);
}

function diaBogota(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(fecha);
}

function inicioDeMedicion(corte: Date, asignadaAt?: Date): number {
  const primerDia = 1;
  if (!asignadaAt) return primerDia;
  const asignada = diaBogota(asignadaAt);
  const mes = corte.toISOString().slice(0, 7);
  if (asignada.slice(0, 7) < mes) return primerDia;
  if (asignada.slice(0, 7) > mes) return Number(corte.toISOString().slice(8, 10)) + 1;
  return Number(asignada.slice(8, 10));
}

/** Cada envío confirmado ocupa un intervalo desde la asignación; varios en el mismo intervalo no inflan la cuota. */
function ventana(fecha: Date, corte: Date, cuota: number, asignadaAt?: Date): number | null {
  const literal = diaBogota(fecha);
  const dia = Number(literal.slice(8, 10));
  const ultimo = Number(corte.toISOString().slice(8, 10));
  const primero = inicioDeMedicion(corte, asignadaAt);
  if (literal.slice(0, 7) !== corte.toISOString().slice(0, 7) || dia < primero || dia > ultimo) return null;
  return Math.min(cuota - 1, Math.floor((dia - primero) * cuota / (ultimo - primero + 1)));
}

export function cortesDeParticipacion(corte: Date, cuota: number, asignadaAt?: Date): Date[] {
  const ultimo = Number(corte.toISOString().slice(8, 10));
  const primero = inicioDeMedicion(corte, asignadaAt);
  if (primero > ultimo) return [];
  const dias = ultimo - primero + 1;
  return Array.from({ length: cuota }, (_, indice) =>
    new Date(Date.UTC(corte.getUTCFullYear(), corte.getUTCMonth(), primero - 1 + Math.ceil((indice + 1) * dias / cuota)))
  );
}

export async function progresoParticipacion(id: string) {
  if (!await participacionesDisponibles())
    throw new PlanTrabajoError("El progreso individual aún no está habilitado en esta base.", 503);
  const participacion = await prisma.plan_trabajo_participacion.findUnique({
    where: { id }, include: { ocurrencia: { include: { actividad: true } } }
  });
  if (!participacion || !participacion.activa) throw new PlanTrabajoError("No se encontró la tarea asignada.", 404);
  const corte = participacion.ocurrencia.fecha_vencimiento;
  const asignacion = await prisma.plan_trabajo_asignacion.findFirst({
    where: { ocurrencia_id: participacion.ocurrencia_id,
      destinatario_tipo: participacion.destinatario_tipo, destinatario_id: participacion.destinatario_id },
    orderBy: { created_at: "asc" }, select: { created_at: true }
  });
  const asignadaAt = asignacion?.created_at ?? participacion.created_at;
  const [evidencias, envios] = await Promise.all([
    prisma.plan_trabajo_evidencia.findMany({
      where: { objetivo_tipo: "OCURRENCIA", objetivo_id: participacion.ocurrencia_id,
        subido_por_tipo: participacion.destinatario_tipo, subido_por_id: participacion.destinatario_id,
        created_at: { gte: asignadaAt } },
      select: { id: true, created_at: true, nombre_archivo: true }
    }),
    participacion.form_assignment_id
      ? prisma.form_submission.findMany({
          where: { assignment_id: participacion.form_assignment_id, status: "SUBMITTED",
            deleted_at: null, submitted_at: { gte: asignadaAt },
            ...(participacion.destinatario_tipo === "ADMIN"
              ? { usuario_id: participacion.destinatario_id }
              : { conductor_id: participacion.destinatario_id }) },
          select: { id: true, submitted_at: true }
        })
      : Promise.resolve([])
  ]);
  const ventanas = new Set<number>();
  if (!participacion.form_assignment_id) {
    for (const evidencia of evidencias) {
      const indice = ventana(evidencia.created_at, corte, participacion.cuota, asignadaAt);
      if (indice !== null) ventanas.add(indice);
    }
  }
  for (const envio of envios) {
    if (!envio.submitted_at) continue;
    const indice = ventana(envio.submitted_at, corte, participacion.cuota, asignadaAt);
    if (indice !== null) ventanas.add(indice);
  }
  const realizados = participacion.completada_at
    ? participacion.cuota
    : ventanas.size;
  return {
    ...participacion,
    realizados,
    ventanas: [...ventanas].sort((a, b) => a - b),
    cortes: cortesDeParticipacion(corte, participacion.cuota, asignadaAt),
    evidencias
  };
}

export async function participacionesOcurrencia(ocurrenciaId: string) {
  if (!await participacionesDisponibles()) return [];
  const filas = await prisma.plan_trabajo_participacion.findMany({
    where: { ocurrencia_id: ocurrenciaId, activa: true }, orderBy: { created_at: "asc" }
  });
  return Promise.all(filas.map((fila) => progresoParticipacion(fila.id)));
}

export async function misParticipaciones(destinatario: Destinatario) {
  if (!await participacionesDisponibles()) return [];
  const filas = await prisma.plan_trabajo_participacion.findMany({
    where: { destinatario_tipo: destinatario.tipo, destinatario_id: destinatario.id, activa: true,
      ocurrencia: { actividad: { plan: { estado: { in: ["ACTIVO", "APROBADO"] } } } } },
    orderBy: { created_at: "desc" }
  });
  return Promise.all(filas.map((fila) => progresoParticipacion(fila.id)));
}

export async function sincronizarParticipaciones(ocurrenciaId: string) {
  if (!await participacionesDisponibles()) return;
  const ocurrencia = await prisma.plan_trabajo_ocurrencia.findUnique({
    where: { id: ocurrenciaId }, select: { estado: true, completada_at: true }
  });
  const asignaciones = await prisma.plan_trabajo_asignacion.findMany({
    where: { ocurrencia_id: ocurrenciaId }, select: { destinatario_tipo: true, destinatario_id: true }
  });
  const claves = new Set(asignaciones.map((a) => `${a.destinatario_tipo}:${a.destinatario_id}`));
  const existentes = await prisma.plan_trabajo_participacion.findMany({ where: { ocurrencia_id: ocurrenciaId } });
  await prisma.$transaction(async (tx) => {
    for (const fila of existentes) {
      await tx.plan_trabajo_participacion.update({
        where: { id: fila.id }, data: { activa: claves.has(`${fila.destinatario_tipo}:${fila.destinatario_id}`) }
      });
    }
    for (const asignacion of asignaciones) {
      await tx.plan_trabajo_participacion.upsert({
        where: { ocurrencia_id_destinatario_tipo_destinatario_id: {
          ocurrencia_id: ocurrenciaId, destinatario_tipo: asignacion.destinatario_tipo, destinatario_id: asignacion.destinatario_id
        } },
        create: { ocurrencia_id: ocurrenciaId, destinatario_tipo: asignacion.destinatario_tipo,
          destinatario_id: asignacion.destinatario_id, activa: true,
          completada_at: ocurrencia?.estado === "COMPLETADA" ? ocurrencia.completada_at : null },
        update: { activa: true }
      });
    }
  });
}

/** Reconcilia responsables por cargo al activar o cambiar el mapa de áreas. */
export async function sincronizarParticipacionesPlan(planId: string) {
  if (!await participacionesDisponibles()) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      INSERT INTO plan_trabajo_participacion
        (id, ocurrencia_id, destinatario_tipo, destinatario_id, completada_at)
      SELECT DISTINCT ON (a.ocurrencia_id, a.destinatario_tipo, a.destinatario_id)
        gen_random_uuid(), a.ocurrencia_id, a.destinatario_tipo, a.destinatario_id,
        CASE WHEN o.estado = 'COMPLETADA' THEN o.completada_at ELSE NULL END
      FROM plan_trabajo_asignacion a
      JOIN plan_trabajo_ocurrencia o ON o.id = a.ocurrencia_id
      JOIN plan_trabajo_actividad ac ON ac.id = o.actividad_id
      WHERE ac.plan_id = $1::uuid
      ORDER BY a.ocurrencia_id, a.destinatario_tipo, a.destinatario_id
      ON CONFLICT (ocurrencia_id, destinatario_tipo, destinatario_id)
        DO UPDATE SET activa = TRUE
    `, planId);
    await tx.$executeRawUnsafe(`
      UPDATE plan_trabajo_participacion p SET activa = FALSE
      FROM plan_trabajo_ocurrencia o
      JOIN plan_trabajo_actividad ac ON ac.id = o.actividad_id
      WHERE p.ocurrencia_id = o.id AND ac.plan_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1 FROM plan_trabajo_asignacion a
          WHERE a.ocurrencia_id = p.ocurrencia_id
            AND a.destinatario_tipo = p.destinatario_tipo
            AND a.destinatario_id = p.destinatario_id
        )
    `, planId);
  });
}

export async function configurarParticipacion(id: string, cuota: number, formAssignmentId: string | null) {
  if (!Number.isInteger(cuota) || cuota < 1 || cuota > 31)
    throw new PlanTrabajoError("La cuota debe estar entre 1 y 31.");
  if (formAssignmentId) {
    const form = await prisma.form_assignment.findFirst({
      where: { id: formAssignmentId, status: "ACTIVE", deleted_at: null },
      select: { id: true, frequency: true, limit_policy: true }
    });
    if (!form) throw new PlanTrabajoError("El formulario asignado no está activo.");
    if (cuota > 1 && (form.frequency === "ONCE" ||
      (form.frequency === "MONTHLY" && form.limit_policy === "ONE_PER_PERIOD")))
      throw new PlanTrabajoError("La política del formulario solo permite un envío al mes; ajusta su frecuencia o límite antes de vincularlo.");
  }
  const participacion = await prisma.plan_trabajo_participacion.findUnique({ where: { id } });
  if (!participacion || !participacion.activa) throw new PlanTrabajoError("No se encontró la tarea asignada.", 404);
  if (formAssignmentId) {
    const ocurrencia = await prisma.plan_trabajo_ocurrencia.findUniqueOrThrow({
      where: { id: participacion.ocurrencia_id }, select: { fecha_vencimiento: true }
    });
    const corte = ocurrencia.fecha_vencimiento;
    const inicio = new Date(Date.UTC(corte.getUTCFullYear(), corte.getUTCMonth(), 1));
    const fin = new Date(Date.UTC(corte.getUTCFullYear(), corte.getUTCMonth() + 1, 0));
    const otra = await prisma.plan_trabajo_participacion.findFirst({
      where: { id: { not: id }, activa: true, form_assignment_id: formAssignmentId,
        destinatario_tipo: participacion.destinatario_tipo, destinatario_id: participacion.destinatario_id,
        ocurrencia: { fecha_vencimiento: { gte: inicio, lte: fin } } },
      select: { id: true }
    });
    if (otra) throw new PlanTrabajoError("Este formulario ya mide otra tarea de la misma persona en el mes.");
    const targetType = participacion.destinatario_tipo === "ADMIN" ? "USER" : "CONDUCTOR";
    const existe = await prisma.form_assignment_target.findFirst({
      where: { assignment_id: formAssignmentId, target_type: targetType,
        ...(targetType === "USER" ? { usuario_id: participacion.destinatario_id } : { conductor_id: participacion.destinatario_id }) }
    });
    if (!existe) await prisma.form_assignment_target.create({
      data: { assignment_id: formAssignmentId, target_type: targetType,
        ...(targetType === "USER" ? { usuario_id: participacion.destinatario_id } : { conductor_id: participacion.destinatario_id }) }
    });
  }
  const actualizada = await prisma.plan_trabajo_participacion.update({
    where: { id }, data: { cuota, form_assignment_id: formAssignmentId, completada_at: null }
  });
  if (participacion.completada_at)
    await prisma.plan_trabajo_ocurrencia.update({
      where: { id: participacion.ocurrencia_id },
      data: { estado: "PENDIENTE", completada_at: null, completada_por_tipo: null, completada_por_id: null }
    });
  return actualizada;
}

export async function completarParticipacion(id: string, destinatario: Destinatario) {
  const progreso = await progresoParticipacion(id);
  if (progreso.destinatario_tipo !== destinatario.tipo || progreso.destinatario_id !== destinatario.id)
    throw new PlanTrabajoError("No tienes asignada esta tarea.", 403);
  if (progreso.completada_at) return progreso;
  if (progreso.form_assignment_id)
    throw new PlanTrabajoError("Esta actividad se completa automáticamente al confirmar todos los envíos del formulario.");
  if (progreso.cuota > 1 || progreso.form_assignment_id || progreso.ocurrencia.actividad.requiere_evidencia) {
    if (progreso.realizados < progreso.cuota)
      throw new PlanTrabajoError(`Faltan ${progreso.cuota - progreso.realizados} registros válidos para completar la tarea.`);
  }
  await prisma.plan_trabajo_participacion.update({
    where: { id }, data: { completada_at: new Date() }
  });
  const todas = await participacionesOcurrencia(progreso.ocurrencia_id);
  if (todas.length && todas.every((fila) => fila.completada_at))
    await prisma.plan_trabajo_ocurrencia.update({
      where: { id: progreso.ocurrencia_id },
      data: { estado: "COMPLETADA", completada_at: new Date(),
        completada_por_tipo: destinatario.tipo, completada_por_id: destinatario.id }
    });
  return progresoParticipacion(id);
}

/** Un envío confirmado suma progreso y completa la participación al llegar a la cuota. */
export async function sincronizarProgresoFormulario(
  formAssignmentId: string,
  destinatario: Destinatario,
) {
  if (!await participacionesDisponibles()) return [];
  const filas = await prisma.plan_trabajo_participacion.findMany({
    where: { form_assignment_id: formAssignmentId, activa: true,
      destinatario_tipo: destinatario.tipo, destinatario_id: destinatario.id },
    select: { id: true, ocurrencia_id: true }
  });
  const actualizadas = [];
  for (const fila of filas) {
    const progreso = await progresoParticipacion(fila.id);
    if (progreso.completada_at || progreso.realizados < progreso.cuota) continue;
    await prisma.plan_trabajo_participacion.updateMany({
      where: { id: fila.id, completada_at: null }, data: { completada_at: new Date() }
    });
    const todas = await participacionesOcurrencia(fila.ocurrencia_id);
    if (todas.length && todas.every((participacion) => participacion.completada_at))
      await prisma.plan_trabajo_ocurrencia.update({
        where: { id: fila.ocurrencia_id },
        data: { estado: "COMPLETADA", completada_at: new Date(),
          completada_por_tipo: destinatario.tipo, completada_por_id: destinatario.id }
      });
    actualizadas.push(await progresoParticipacion(fila.id));
  }
  return actualizadas;
}
