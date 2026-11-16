import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma";
import { getS3SignedUrl, uploadToS3 } from "../../config/aws";
import { enviarPushConductor } from "../conductor-portal/conductor-push.service";
import { emitNotificacion } from "../../sockets";
import { AREAS, AREA_LABELS, esAreaValida } from "../../config/permissions";
import { misParticipaciones, participacionesDisponibles, participacionesOcurrencia, sincronizarParticipaciones, sincronizarParticipacionesPlan } from "./plan-trabajo-participacion.service";

const ESTADOS_ABIERTOS = ["PENDIENTE"];
const ROLES = ["RESPONSABLE", "COLABORADOR", "SUPLENTE"] as const;
const TIPOS_EVIDENCIA = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MAX_EVIDENCIA_BYTES = 8 * 1024 * 1024;

function ultimoDia(anio: number, mes: number) {
  return new Date(Date.UTC(anio, mes, 0));
}

function normalizarNombreArchivo(nombre: string) {
  const base = nombre
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .slice(-180);
  return base || "evidencia";
}

export class PlanTrabajoError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "PlanTrabajoError";
  }
}

export async function obtenerPlan(planId?: string) {
  if (planId) {
    const plan = await prisma.plan_trabajo_anual.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new PlanTrabajoError("No se encontró el plan anual.", 404);
    return plan;
  }
  const plan = await prisma.plan_trabajo_anual.findFirst({
    orderBy: [{ anio: "desc" }, { created_at: "desc" }],
  });
  if (!plan)
    throw new PlanTrabajoError("Todavía no hay un plan anual cargado.", 404);
  return plan;
}

export async function obtenerGestion(planId: string) {
  const plan = await prisma.plan_trabajo_anual.findUnique({
    where: { id: planId },
    include: {
      cargos: true,
      areas_cargo: true,
      actividades: {
        orderBy: { numero_fuente: "asc" },
        include: {
          ocurrencias: {
            orderBy: { mes: "asc" },
            include: { asignaciones: true },
          },
        },
      },
    },
  });
  if (!plan) throw new PlanTrabajoError("No se encontró el plan anual.", 404);

  const [usuarios, conductores, responsablesArea] = await Promise.all([
    prisma.usuarios.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, correo: true, cargo: true, area: true },
      orderBy: { nombre: "asc" },
    }),
    prisma.conductores.findMany({
      where: { estado: { in: ["activo", "disponible", "programado", "servicio", "descanso"] }, oculto: false, deleted_at: null },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        numero_identificacion: true,
      },
      orderBy: [{ nombre: "asc" }, { apellido: "asc" }],
    }),
    prisma.usuario_area_responsable.findMany({
      include: {
        usuario: {
          select: {
            id: true,
            nombre: true,
            correo: true,
            cargo: true,
            activo: true,
            area: true,
          },
        },
      },
    }),
  ]);
  const responsablePorArea = new Map(
    responsablesArea.map((item) => [item.area, item.usuario]),
  );
  const areas = AREAS.map((area) => ({
    area,
    etiqueta: AREA_LABELS[area],
    responsable: responsablePorArea.get(area) ?? null,
  }));
  const cargos = Array.from(
    new Set(
      plan.actividades.map((a) => a.responsable_cargos?.trim()).filter(Boolean),
    ),
  ).map((cargo) => {
    const area =
      plan.areas_cargo.find((vinculo) => vinculo.cargo === cargo)?.area ?? null;
    return {
      cargo,
      area,
      responsable: area ? (responsablePorArea.get(area) ?? null) : null,
      asignaciones: plan.cargos.filter(
        (c) => c.cargo === cargo && c.rol !== "RESPONSABLE",
      ),
    };
  });
  const evidencias = await prisma.plan_trabajo_evidencia.findMany({
    where: {
      objetivo_tipo: "OCURRENCIA",
      objetivo_id: {
        in: plan.actividades.flatMap((a) => a.ocurrencias.map((o) => o.id)),
      },
    },
    orderBy: { created_at: "desc" },
  });
  const participaciones = await participacionesDisponibles()
    ? await prisma.plan_trabajo_participacion.findMany({
        where: { ocurrencia_id: { in: plan.actividades.flatMap((a) => a.ocurrencias.map((o) => o.id)) }, activa: true }
      })
    : [];
  return { plan, cargos, areas, usuarios, conductores, evidencias, participaciones };
}

export async function configurarCargo(
  planId: string,
  cargo: string,
  area: string | null,
  entradas: Array<{ usuario_id: string; rol: string }>,
) {
  await configurarCargos(planId, [{ cargo, area, asignaciones: entradas }]);
}

export async function configurarCargos(
  planId: string,
  configuraciones: Array<{
    cargo: string;
    area: string | null;
    asignaciones: Array<{ usuario_id: string; rol: string }>;
  }>,
) {
  const plan = await obtenerPlan(planId);
  if (!Array.isArray(configuraciones) || !configuraciones.length)
    throw new PlanTrabajoError("No hay cambios de cargos para guardar.");
  if (
    configuraciones.some(
      (configuracion) =>
        !configuracion ||
        typeof configuracion.cargo !== "string" ||
        !Array.isArray(configuracion.asignaciones) ||
        configuracion.asignaciones.some(
          (entrada) =>
            !entrada ||
            typeof entrada.usuario_id !== "string" ||
            typeof entrada.rol !== "string",
        ),
    )
  ) {
    throw new PlanTrabajoError(
      "La configuración de uno o más cargos no es válida.",
    );
  }
  const normalizadas = configuraciones.map((configuracion) => ({
    ...configuracion,
    cargo: configuracion.cargo.trim(),
  }));
  const cargos = normalizadas.map((configuracion) => configuracion.cargo);
  if (cargos.some((cargo) => !cargo))
		throw new PlanTrabajoError("Indica el cargo o grupo de cargos que aparece en el plan.");
  if (new Set(cargos).size !== cargos.length)
    throw new PlanTrabajoError(
      "Cada cargo solo puede aparecer una vez en el lote.",
    );
  if (normalizadas.some(({ area }) => plan.estado === "ACTIVO" && !area)) {
    throw new PlanTrabajoError(
      "Un plan activo debe conservar un área para cada cargo relacionado.",
    );
  }
  if (normalizadas.some(({ area }) => area !== null && !esAreaValida(area)))
    throw new PlanTrabajoError("Selecciona un área válida para cada cargo.");
  if (
    normalizadas.some(({ asignaciones }) =>
      asignaciones.some(
        (entrada) => !["COLABORADOR", "SUPLENTE"].includes(entrada.rol),
      ),
    )
  ) {
    throw new PlanTrabajoError(
      "Solo puedes añadir colaboradores o suplentes al cargo.",
    );
  }
  const actividadesPlan = await prisma.plan_trabajo_actividad.findMany({
    where: { plan_id: plan.id, responsable_cargos: { in: cargos } },
    select: { responsable_cargos: true },
    distinct: ["responsable_cargos"],
  });
  const cargosValidos = new Set(
    actividadesPlan.map((actividad) => actividad.responsable_cargos?.trim()),
  );
  if (cargos.some((cargo) => !cargosValidos.has(cargo)))
    throw new PlanTrabajoError("Uno o más cargos no pertenecen a este plan.");

  const todasLasAsignaciones = normalizadas.flatMap((configuracion) =>
    configuracion.asignaciones.map((entrada) => ({
      ...entrada,
      cargo: configuracion.cargo,
    })),
  );
  const ids = Array.from(
    new Set(todasLasAsignaciones.map((entrada) => entrada.usuario_id)),
  );
  const usuarios = await prisma.usuarios.findMany({
    where: { id: { in: ids }, activo: true },
    select: { id: true },
  });
  if (usuarios.length !== ids.length)
    throw new PlanTrabajoError("Uno o más usuarios ya no están activos.");

  const areas = Array.from(
    new Set(
      normalizadas
        .map(({ area }) => area)
        .filter((area): area is string => Boolean(area)),
    ),
  );
  const responsablesArea = await prisma.usuario_area_responsable.findMany({
    where: { area: { in: areas } },
    include: {
      usuario: { select: { id: true, activo: true, area: true } },
    },
  });
  const responsablePorArea = new Map(
    responsablesArea.map((responsable) => [responsable.area, responsable]),
  );
  if (
    plan.estado === "ACTIVO" &&
    normalizadas.some(({ area }) => {
      if (!area) return false;
      const responsable = responsablePorArea.get(area);
      return (
        !responsable?.usuario.activo || !responsable.usuario.area.includes(area)
      );
    })
  ) {
    throw new PlanTrabajoError(
      "Asigna primero un responsable activo a cada área desde Personal.",
    );
  }

  const asignacionesPorCargo = new Map(
    normalizadas.map((configuracion) => [
      configuracion.cargo,
      configuracion.asignaciones,
    ]),
  );
  const areaPorCargo = new Map(
    normalizadas.map((configuracion) => [
      configuracion.cargo,
      configuracion.area,
    ]),
  );
  await prisma.$transaction(async (tx) => {
    await tx.plan_trabajo_cargo_usuario.deleteMany({
      where: { plan_id: plan.id, cargo: { in: cargos } },
    });
    if (todasLasAsignaciones.length) {
      await tx.plan_trabajo_cargo_usuario.createMany({
        data: todasLasAsignaciones.map((entrada) => ({
          plan_id: plan.id,
          cargo: entrada.cargo,
          usuario_id: entrada.usuario_id,
          rol: entrada.rol,
        })),
      });
    }
    for (const configuracion of normalizadas) {
      if (configuracion.area) {
        await tx.plan_trabajo_cargo_area.upsert({
          where: {
            plan_id_cargo: { plan_id: plan.id, cargo: configuracion.cargo },
          },
          update: { area: configuracion.area },
          create: {
            plan_id: plan.id,
            cargo: configuracion.cargo,
            area: configuracion.area,
          },
        });
      } else {
        await tx.plan_trabajo_cargo_area.deleteMany({
          where: { plan_id: plan.id, cargo: configuracion.cargo },
        });
      }
    }

    const actividades = await tx.plan_trabajo_actividad.findMany({
      where: { plan_id: plan.id, responsable_cargos: { in: cargos } },
      select: { id: true, responsable_cargos: true },
    });
    const cargoPorActividad = new Map(
      actividades.map((actividad) => [
        actividad.id,
        actividad.responsable_cargos?.trim() ?? "",
      ]),
    );
    const ocurrencias = await tx.plan_trabajo_ocurrencia.findMany({
      where: {
        actividad_id: { in: actividades.map((actividad) => actividad.id) },
        estado: { in: ESTADOS_ABIERTOS },
      },
      select: { id: true, actividad_id: true },
    });
    const idsOcurrencias = ocurrencias.map((ocurrencia) => ocurrencia.id);
    if (idsOcurrencias.length) {
      await tx.plan_trabajo_asignacion.deleteMany({
        where: {
          origen_cargo: { in: cargos },
          ocurrencia_id: { in: idsOcurrencias },
        },
      });
      const nuevas = ocurrencias.flatMap((ocurrencia) => {
        const cargo = cargoPorActividad.get(ocurrencia.actividad_id) ?? "";
        const area = areaPorCargo.get(cargo);
        const responsableArea = area ? responsablePorArea.get(area) : null;
        const asignaciones = asignacionesPorCargo.get(cargo) ?? [];
        return [
          ...(area && responsableArea
            ? [
                {
                  ocurrencia_id: ocurrencia.id,
                  destinatario_tipo: "ADMIN",
                  destinatario_id: responsableArea.usuario_id,
                  rol: "RESPONSABLE",
                  origen_cargo: cargo,
                },
              ]
            : []),
          ...asignaciones.map((entrada) => ({
            ocurrencia_id: ocurrencia.id,
            destinatario_tipo: "ADMIN",
            destinatario_id: entrada.usuario_id,
            rol: entrada.rol,
            origen_cargo: cargo,
          })),
        ];
      });
      if (nuevas.length)
        await tx.plan_trabajo_asignacion.createMany({
          data: nuevas,
          skipDuplicates: true,
        });
    }
    if (plan.estado === "ACTIVO" && idsOcurrencias.length) {
      const ahora = new Date();
      await tx.plan_trabajo_ocurrencia.updateMany({
        where: {
          id: { in: idsOcurrencias },
          fecha_vencimiento: { lt: ahora },
        },
        data: { recordatorios_desde: ahora },
      });
    }
  });
  await sincronizarParticipacionesPlan(plan.id);
}

export async function activarPlan(planId: string, usuarioId: string) {
  const plan = await obtenerPlan(planId);
  const [responsables, areasCargo] = await Promise.all([
    prisma.plan_trabajo_actividad.findMany({
      where: { plan_id: plan.id, responsable_cargos: { not: null } },
      select: { responsable_cargos: true },
      distinct: ["responsable_cargos"],
    }),
    prisma.plan_trabajo_cargo_area.findMany({
      where: { plan_id: plan.id },
    }),
  ]);
  const areaPorCargo = new Map(
    areasCargo.map((vinculo) => [vinculo.cargo, vinculo.area]),
  );
  const sinAsignar = responsables
    .map((r) => r.responsable_cargos?.trim())
    .filter((cargo): cargo is string =>
      Boolean(cargo && !areaPorCargo.has(cargo)),
    );
  if (sinAsignar.length) {
    throw new PlanTrabajoError(
      `Falta relacionar ${sinAsignar.length} cargos con un área en la configuración del plan.`,
      409,
    );
  }
  const responsablesArea = await prisma.usuario_area_responsable.findMany({
    where: { area: { in: [...AREAS] } },
    include: { usuario: { select: { id: true, activo: true, area: true } } },
  });
  const responsablePorArea = new Map(
    responsablesArea.map((v) => [v.area, v.usuario]),
  );
  const areasSinResponsable = AREAS.filter((area) => {
    const responsable = responsablePorArea.get(area);
    return !responsable?.activo || !responsable.area.includes(area);
  });
  if (areasSinResponsable.length) {
    throw new PlanTrabajoError(
      `Asigna un responsable activo en ${areasSinResponsable.length} áreas desde Personal antes de activar.`,
      409,
    );
  }
  const colaboradores = await prisma.plan_trabajo_cargo_usuario.findMany({
    where: { plan_id: plan.id },
    select: { usuario_id: true },
  });
  const usuariosActivos = await prisma.usuarios.findMany({
    where: { id: { in: colaboradores.map((v) => v.usuario_id) }, activo: true },
    select: { id: true },
  });
  if (
    usuariosActivos.length !==
    new Set(colaboradores.map((v) => v.usuario_id)).size
  ) {
    throw new PlanTrabajoError(
      "Hay colaboradores o suplentes inactivos; actualiza las asignaciones antes de activar.",
      409,
    );
  }
  const ahora = new Date();
  await prisma.$transaction(async (tx) => {
    const actividades = await tx.plan_trabajo_actividad.findMany({
      where: { plan_id: plan.id },
      select: { id: true, responsable_cargos: true },
    });
    const cargos = await tx.plan_trabajo_cargo_usuario.findMany({
      where: { plan_id: plan.id },
    });
    const areasPorCargo = await tx.plan_trabajo_cargo_area.findMany({
      where: { plan_id: plan.id },
    });
    const areasPorId = new Map(
      responsablesArea.map((item) => [item.area, item.usuario_id]),
    );
    const areaPorNombreCargo = new Map(
      areasPorCargo.map((item) => [item.cargo, item.area]),
    );
    const ocurrencias = await tx.plan_trabajo_ocurrencia.findMany({
      where: {
        actividad_id: { in: actividades.map((a) => a.id) },
        estado: "PENDIENTE",
      },
      select: { id: true, actividad_id: true },
    });
    const porCargo = new Map<string, typeof cargos>();
    for (const item of cargos)
      porCargo.set(item.cargo, [...(porCargo.get(item.cargo) ?? []), item]);
    const asignaciones = ocurrencias.flatMap((o) => {
      const cargo = actividades.find(
        (a) => a.id === o.actividad_id,
      )?.responsable_cargos;
      if (!cargo) return [];
      const area = areaPorNombreCargo.get(cargo);
      const responsableId = area ? areasPorId.get(area) : null;
      return [
        ...(responsableId
          ? [
              {
                ocurrencia_id: o.id,
                destinatario_tipo: "ADMIN",
                destinatario_id: responsableId,
                rol: "RESPONSABLE",
                origen_cargo: cargo,
              },
            ]
          : []),
        ...(porCargo.get(cargo) ?? [])
          .filter((c) => c.rol !== "RESPONSABLE")
          .map((c) => ({
            ocurrencia_id: o.id,
            destinatario_tipo: "ADMIN",
            destinatario_id: c.usuario_id,
            rol: c.rol,
            origen_cargo: cargo,
          })),
      ];
    });
    if (asignaciones.length)
      await tx.plan_trabajo_asignacion.createMany({
        data: asignaciones,
        skipDuplicates: true,
      });
    await tx.plan_trabajo_ocurrencia.updateMany({
      where: {
        id: { in: ocurrencias.map((o) => o.id) },
        fecha_vencimiento: { lt: ahora },
      },
      data: { recordatorios_desde: ahora },
    });
    await tx.plan_trabajo_anual.update({
      where: { id: plan.id },
      data: {
        estado: "ACTIVO",
        recordatorios_activos: true,
        activado_at: ahora,
        creado_por_id: usuarioId,
      },
    });
  });
  await sincronizarParticipacionesPlan(plan.id);
  return obtenerPlan(plan.id);
}

export async function asignarConductores(
  ocurrenciaId: string,
  entradas: Array<{ conductor_id: string; rol: string }>,
) {
  const ocurrencia = await prisma.plan_trabajo_ocurrencia.findUnique({
    where: { id: ocurrenciaId },
    include: { actividad: { include: { plan: true } } },
  });
  if (!ocurrencia)
    throw new PlanTrabajoError("No se encontró la ocurrencia.", 404);
  if (entradas.some((e) => !ROLES.includes(e.rol as any)))
    throw new PlanTrabajoError(
      "El rol debe ser responsable, colaborador o suplente.",
    );
  const asignacionesSolicitadas = Array.from(
    new Map(entradas.map((e) => [`${e.conductor_id}:${e.rol}`, e])).values(),
  );
  const ids = Array.from(
    new Set(asignacionesSolicitadas.map((e) => e.conductor_id)),
  );
  const conductores = await prisma.conductores.findMany({
    where: {
      id: { in: ids },
      estado: { in: ["activo", "disponible", "programado", "servicio", "descanso"] },
      oculto: false,
      deleted_at: null,
    },
    select: { id: true, nombre: true, apellido: true },
  });
  if (conductores.length !== ids.length)
    throw new PlanTrabajoError("Uno o más conductores ya no están activos.");
  const existentes = await prisma.plan_trabajo_asignacion.findMany({
    where: { ocurrencia_id: ocurrencia.id, destinatario_tipo: "CONDUCTOR" },
    select: { destinatario_id: true, rol: true },
  });
  const anteriores = new Set(
    existentes.map((e) => `${e.destinatario_id}:${e.rol}`),
  );
  const conductoresAnteriores = new Set(
    existentes.map((e) => e.destinatario_id),
  );
  await prisma.$transaction(async (tx) => {
    await tx.plan_trabajo_asignacion.deleteMany({
      where: { ocurrencia_id: ocurrencia.id, destinatario_tipo: "CONDUCTOR" },
    });
    if (asignacionesSolicitadas.length) {
      await tx.plan_trabajo_asignacion.createMany({
        data: asignacionesSolicitadas.map((e) => ({
          ocurrencia_id: ocurrencia.id,
          destinatario_tipo: "CONDUCTOR",
          destinatario_id: e.conductor_id,
          rol: e.rol,
        })),
      });
    }
  });
  const nuevasAsignaciones = asignacionesSolicitadas.filter(
    (e) => !anteriores.has(`${e.conductor_id}:${e.rol}`),
  );
  const nuevos = conductores.filter(
    (c) =>
      !conductoresAnteriores.has(c.id) &&
      nuevasAsignaciones.some((e) => e.conductor_id === c.id),
  );
  await sincronizarParticipaciones(ocurrencia.id);
  for (const conductor of nuevos) {
    const notificacion = await prisma.conductor_notification.create({
      data: {
        conductor_id: conductor.id,
        tipo: "PLAN_TRABAJO_ASIGNADA",
        titulo: "Nueva actividad HSEQ/PESV",
        cuerpo: ocurrencia.actividad.actividad.slice(0, 500),
        datos: {
          ruta: `/public/portal/actividades?ocurrenciaId=${ocurrencia.id}`,
          route: `/public/portal/actividades?ocurrenciaId=${ocurrencia.id}`,
          mobile_route: `/actividades?id=${ocurrencia.id}`,
          ocurrencia_id: ocurrencia.id,
          plan_id: ocurrencia.actividad.plan_id,
        },
      },
    });
    await enviarPushConductor({
      conductorId: conductor.id,
      notificacionId: notificacion.id,
      titulo: notificacion.titulo,
      cuerpo: notificacion.cuerpo,
      datos: notificacion.datos as Record<string, unknown>,
      canal: "actividades",
    });
  }
  return {
    asignados: ids.length,
    asignaciones: asignacionesSolicitadas.length,
    notificados: nuevos.length,
  };
}

export async function asignarDestinatarios(
  ocurrenciaId: string,
  entradas: Array<{
    destinatario_tipo: string;
    destinatario_id: string;
    rol: string;
  }>,
) {
  const ocurrencia = await prisma.plan_trabajo_ocurrencia.findUnique({
    where: { id: ocurrenciaId },
    include: { actividad: { include: { plan: true } } },
  });
  if (!ocurrencia)
    throw new PlanTrabajoError("No se encontró la ocurrencia.", 404);
  if (
    entradas.some(
      (entrada) =>
        !entrada ||
        !["ADMIN", "CONDUCTOR"].includes(entrada.destinatario_tipo) ||
        !ROLES.includes(entrada.rol as any) ||
        typeof entrada.destinatario_id !== "string" ||
        !entrada.destinatario_id,
    )
  )
    throw new PlanTrabajoError("Una o más asignaciones no son válidas.");

  const asignaciones = Array.from(
    new Map(
      entradas.map((entrada) => [
        `${entrada.destinatario_tipo}:${entrada.destinatario_id}:${entrada.rol}`,
        entrada,
      ]),
    ).values(),
  );
  const idsAdministrativos = Array.from(
    new Set(
      asignaciones
        .filter((entrada) => entrada.destinatario_tipo === "ADMIN")
        .map((entrada) => entrada.destinatario_id),
    ),
  );
  const idsConductores = Array.from(
    new Set(
      asignaciones
        .filter((entrada) => entrada.destinatario_tipo === "CONDUCTOR")
        .map((entrada) => entrada.destinatario_id),
    ),
  );
  const [usuarios, conductores, anteriores] = await Promise.all([
    idsAdministrativos.length
      ? prisma.usuarios.findMany({
          where: { id: { in: idsAdministrativos }, activo: true },
          select: { id: true },
        })
      : Promise.resolve([]),
    idsConductores.length
      ? prisma.conductores.findMany({
          where: {
            id: { in: idsConductores },
            estado: { in: ["activo", "disponible", "programado", "servicio", "descanso"] },
            oculto: false,
            deleted_at: null,
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    prisma.plan_trabajo_asignacion.findMany({
      where: {
        ocurrencia_id: ocurrencia.id,
        destinatario_tipo: { in: ["ADMIN", "CONDUCTOR"] },
      },
      select: { destinatario_tipo: true, destinatario_id: true, origen_cargo: true },
    }),
  ]);
  if (usuarios.length !== idsAdministrativos.length)
    throw new PlanTrabajoError("Una o más personas del equipo ya no están activas.");
  if (conductores.length !== idsConductores.length)
    throw new PlanTrabajoError("Uno o más conductores ya no están activos.");

  const existentesPorClave = new Map(
    anteriores.map((entrada) => [
      `${entrada.destinatario_tipo}:${entrada.destinatario_id}`,
      entrada,
    ]),
  );
  const destinatariosAnteriores = new Set(existentesPorClave.keys());
  await prisma.$transaction(async (tx) => {
    await tx.plan_trabajo_asignacion.deleteMany({
      where: {
        ocurrencia_id: ocurrencia.id,
        destinatario_tipo: { in: ["ADMIN", "CONDUCTOR"] },
      },
    });
    if (asignaciones.length) {
      await tx.plan_trabajo_asignacion.createMany({
        data: asignaciones.map((entrada) => ({
          ocurrencia_id: ocurrencia.id,
          destinatario_tipo: entrada.destinatario_tipo,
          destinatario_id: entrada.destinatario_id,
          rol: entrada.rol,
          origen_cargo:
            existentesPorClave.get(
              `${entrada.destinatario_tipo}:${entrada.destinatario_id}`,
            )?.origen_cargo ?? null,
        })),
      });
    }
  });

  const nuevos = new Map<string, (typeof asignaciones)[number]>();
  await sincronizarParticipaciones(ocurrencia.id);
  for (const entrada of asignaciones) {
    const clave = `${entrada.destinatario_tipo}:${entrada.destinatario_id}`;
    if (!destinatariosAnteriores.has(clave)) nuevos.set(clave, entrada);
  }
  if (ocurrencia.estado !== "PENDIENTE") {
    return {
      asignados: idsAdministrativos.length + idsConductores.length,
      asignaciones: asignaciones.length,
      administradoresNotificados: 0,
      conductoresNotificados: 0,
      notificados: 0,
    };
  }
  let administradoresNotificados = 0;
  let conductoresNotificados = 0;
  for (const entrada of nuevos.values()) {
    const etiquetaRol =
      entrada.rol === "RESPONSABLE"
        ? "responsable"
        : entrada.rol === "COLABORADOR"
          ? "colaborador"
          : "suplente";
    if (entrada.destinatario_tipo === "ADMIN") {
      const notificacion = await prisma.notificacion.create({
        data: {
          usuario_id: entrada.destinatario_id,
          tipo: "ACTIVIDAD_PESV_ASIGNADA",
          titulo: "Nueva tarea HSEQ/PESV asignada",
          mensaje: `Se te asignó como ${etiquetaRol}: ${ocurrencia.actividad.actividad.slice(0, 420)}`,
          referencia_id: ocurrencia.id,
          referencia_tipo: `PLAN:${ocurrencia.actividad.plan_id}`,
        },
      });
      emitNotificacion(notificacion);
      const push = await import("../notificaciones/web-push.service").catch(
        () => null,
      );
      await push?.enviarWebPush(notificacion).catch(() => undefined);
      administradoresNotificados++;
      continue;
    }

    const notificacion = await prisma.conductor_notification.create({
      data: {
        conductor_id: entrada.destinatario_id,
        tipo: "PLAN_TRABAJO_ASIGNADA",
        titulo: "Nueva actividad HSEQ/PESV",
        cuerpo: ocurrencia.actividad.actividad.slice(0, 500),
        datos: {
          ruta: `/public/portal/actividades?ocurrenciaId=${ocurrencia.id}`,
          route: `/public/portal/actividades?ocurrenciaId=${ocurrencia.id}`,
          mobile_route: `/actividades?id=${ocurrencia.id}`,
          ocurrencia_id: ocurrencia.id,
          plan_id: ocurrencia.actividad.plan_id,
        },
      },
    });
    await enviarPushConductor({
      conductorId: entrada.destinatario_id,
      notificacionId: notificacion.id,
      titulo: notificacion.titulo,
      cuerpo: notificacion.cuerpo,
      datos: notificacion.datos as Record<string, unknown>,
      canal: "actividades",
    });
    conductoresNotificados++;
  }

  return {
    asignados: idsAdministrativos.length + idsConductores.length,
    asignaciones: asignaciones.length,
    administradoresNotificados,
    conductoresNotificados,
    notificados: administradoresNotificados + conductoresNotificados,
  };
}

export async function actualizarOcurrencia(params: {
  id: string;
  estado: "COMPLETADA" | "NO_APLICA";
  actorTipo: "ADMIN" | "CONDUCTOR";
  actorId: string;
  motivo?: string;
}) {
  const ocurrencia = await prisma.plan_trabajo_ocurrencia.findUnique({
    where: { id: params.id },
    include: { actividad: true },
  });
  if (!ocurrencia)
    throw new PlanTrabajoError("No se encontró la ocurrencia.", 404);
  if (params.estado === "NO_APLICA" && !params.motivo?.trim())
    throw new PlanTrabajoError("Debes justificar por qué no aplica.");
  if (params.estado === "COMPLETADA" &&
    await participacionesDisponibles() &&
    await prisma.plan_trabajo_participacion.count({
    where: { ocurrencia_id: params.id, activa: true }
  }))
    throw new PlanTrabajoError("Cada persona asignada debe completar su propia cuota.");
  if (
    params.estado === "COMPLETADA" &&
    ocurrencia.actividad.requiere_evidencia
  ) {
    const cantidad = await prisma.plan_trabajo_evidencia.count({
      where: { objetivo_tipo: "OCURRENCIA", objetivo_id: ocurrencia.id },
    });
    if (!cantidad)
      throw new PlanTrabajoError(
        "Adjunta al menos un soporte antes de cerrar esta actividad.",
      );
  }
  const ahora = new Date();
  return prisma.plan_trabajo_ocurrencia.update({
    where: { id: ocurrencia.id },
    data: {
      estado: params.estado,
      completada_at: params.estado === "COMPLETADA" ? ahora : null,
      completada_por_tipo:
        params.estado === "COMPLETADA" ? params.actorTipo : null,
      completada_por_id: params.estado === "COMPLETADA" ? params.actorId : null,
      no_aplica_motivo:
        params.estado === "NO_APLICA" ? params.motivo?.trim() : null,
      no_aplica_aprobada_por:
        params.estado === "NO_APLICA" ? params.actorId : null,
      no_aplica_aprobada_at: params.estado === "NO_APLICA" ? ahora : null,
    },
  });
}

export async function listarActividadesConductor(conductorId: string) {
  if (!await participacionesDisponibles())
    return listarActividadesConductorAnterior(conductorId);
  const participaciones = await misParticipaciones({ tipo: "CONDUCTOR", id: conductorId });
  return Promise.all(participaciones.map(async (p) => {
    const asignaciones = await prisma.plan_trabajo_asignacion.findMany({
      where: { ocurrencia_id: p.ocurrencia_id, destinatario_tipo: "CONDUCTOR", destinatario_id: conductorId },
      select: { rol: true }
    });
    const o = p.ocurrencia;
    return {
      id: p.id,
      ocurrencia_id: p.ocurrencia_id,
      mes: o.mes,
      fecha_vencimiento: o.fecha_vencimiento,
      estado: p.completada_at ? "COMPLETADA" :
        o.fecha_vencimiento < new Date(new Date().toISOString().slice(0, 10)) ? "ATRASADA" : "PENDIENTE",
      requiere_evidencia: o.actividad.requiere_evidencia,
      actividad: o.actividad.actividad,
      unidad_programa: o.actividad.unidad_programa,
      alcance: o.actividad.alcance,
      metodo_seguimiento: o.actividad.metodo_seguimiento,
      plan: o.actividad.plan_id,
      roles: [...new Set(asignaciones.map((a) => a.rol))],
      cuota: p.cuota,
      realizados: p.realizados,
      ventanas: p.ventanas,
      cortes: p.cortes,
      form_assignment_id: p.form_assignment_id,
      evidencias: p.evidencias.map((e) => ({ id: e.id, nombre_archivo: e.nombre_archivo, created_at: e.created_at }))
    };
  }));
}



async function listarActividadesConductorAnterior(conductorId: string) {
  const asignaciones = await prisma.plan_trabajo_asignacion.findMany({
    where: { destinatario_tipo: "CONDUCTOR", destinatario_id: conductorId },
    include: {
      ocurrencia: { include: { actividad: { include: { plan: true } } } },
    },
    orderBy: { created_at: "desc" },
  });
  const ocurrencias = asignaciones
    .map((a) => a.ocurrencia)
    .filter((o) => ["ACTIVO", "APROBADO"].includes(o.actividad.plan.estado));
  const evidencias = await prisma.plan_trabajo_evidencia.findMany({
    where: {
      objetivo_tipo: "OCURRENCIA",
      objetivo_id: { in: ocurrencias.map((o) => o.id) },
    },
    orderBy: { created_at: "desc" },
  });
  return ocurrencias.map((o) => ({
    id: o.id,
    mes: o.mes,
    fecha_vencimiento: o.fecha_vencimiento,
    estado:
      o.estado === "PENDIENTE" &&
      o.fecha_vencimiento < new Date(new Date().toISOString().slice(0, 10))
        ? "ATRASADA"
        : o.estado,
    requiere_evidencia: o.actividad.requiere_evidencia,
    actividad: o.actividad.actividad,
    unidad_programa: o.actividad.unidad_programa,
    alcance: o.actividad.alcance,
    metodo_seguimiento: o.actividad.metodo_seguimiento,
    plan: o.actividad.plan.nombre,
    roles: Array.from(
      new Set(
        asignaciones.filter((a) => a.ocurrencia_id === o.id).map((a) => a.rol),
      ),
    ),
    evidencias: evidencias
      .filter((e) => e.objetivo_id === o.id)
      .map(({ id, nombre_archivo, mime_type, created_at }) => ({
        id,
        nombre_archivo,
        mime_type,
        created_at,
      })),
  }));
}

export async function subirEvidencia(params: {
  objetivoTipo: "OCURRENCIA" | "INDICADOR";
  objetivoId: string;
  actorTipo: "ADMIN" | "CONDUCTOR";
  actorId: string;
  nombre: string;
  mime: string;
  buffer: Buffer;
}) {
  if (params.buffer.length < 1 || params.buffer.length > MAX_EVIDENCIA_BYTES)
    throw new PlanTrabajoError("El archivo debe pesar máximo 8 MB.");
  if (!TIPOS_EVIDENCIA.has(params.mime))
    throw new PlanTrabajoError(
      "Tipo de archivo no permitido. Usa PDF, imagen, texto o documento de Office.",
    );
  if (params.objetivoTipo === "OCURRENCIA") {
    const occurrence = await prisma.plan_trabajo_ocurrencia.findUnique({
      where: { id: params.objetivoId },
      select: { id: true },
    });
    if (!occurrence)
      throw new PlanTrabajoError("No se encontró la ocurrencia.", 404);
  } else {
    const indicator = await prisma.plan_trabajo_indicador_manual.findUnique({
      where: { id: params.objetivoId },
      select: { id: true },
    });
    if (!indicator)
      throw new PlanTrabajoError("No se encontró el indicador.", 404);
  }
  const s3Key = `plan-trabajo/${params.objetivoTipo.toLowerCase()}/${params.objetivoId}/${randomUUID()}-${normalizarNombreArchivo(params.nombre)}`;
  await uploadToS3(s3Key, params.buffer, params.mime);
  try {
    const evidencia = await prisma.plan_trabajo_evidencia.create({
      data: {
        objetivo_tipo: params.objetivoTipo,
        objetivo_id: params.objetivoId,
        s3_key: s3Key,
        nombre_archivo: normalizarNombreArchivo(params.nombre),
        mime_type: params.mime,
        tamano_bytes: params.buffer.length,
        subido_por_tipo: params.actorTipo,
        subido_por_id: params.actorId,
      },
    });
    return { ...evidencia, url: await getS3SignedUrl(s3Key, 3600) };
  } catch (error) {
    throw error;
  }
}

export async function urlEvidencia(evidenciaId: string) {
  const evidencia = await prisma.plan_trabajo_evidencia.findUnique({
    where: { id: evidenciaId },
  });
  if (!evidencia) throw new PlanTrabajoError("No se encontró el soporte.", 404);
  return {
    url: await getS3SignedUrl(evidencia.s3_key, 3600),
    nombre_archivo: evidencia.nombre_archivo,
  };
}

function porcentaje(numerador: number, denominador: number) {
  return denominador
    ? Math.round((numerador / denominador) * 10000) / 100
    : null;
}

function resultadoIndicador(
  numero: number,
  valor: number | null,
  meta: number,
  extra: Record<string, unknown> = {},
) {
  return {
    numero,
    valor,
    meta,
    cumple: valor === null ? null : valor >= meta,
    ...extra,
  };
}

export async function obtenerIndicadores(planId: string, trimestre?: number) {
  const plan = await obtenerPlan(planId);
  const [manuales, configuraciones, ocurrencias, acciones] = await Promise.all([
    prisma.plan_trabajo_indicador_manual.findMany({
      where: { plan_id: plan.id, periodo: String(plan.anio) },
    }),
    prisma.plan_trabajo_indicador_config.findMany({
      where: { plan_id: plan.id },
      orderBy: { numero_indicador: "asc" },
    }),
    prisma.plan_trabajo_ocurrencia.findMany({
      where: { actividad: { plan_id: plan.id } },
      include: { actividad: { select: { es_pesv: true } } },
    }),
    prisma.acciones_correctivas_preventivas.findMany({
      where: {
        deleted_at: null,
        fecha_identificacion_hallazgo: {
          gte: new Date(
            Date.UTC(plan.anio, trimestre ? (trimestre - 1) * 3 : 0, 1),
          ),
          lt: new Date(Date.UTC(plan.anio, trimestre ? trimestre * 3 : 12, 1)),
        },
        OR: [
          { origen_pesv: true },
          {
            proceso_origen_hallazgo: { contains: "HSEQ", mode: "insensitive" },
          },
          {
            proceso_origen_hallazgo: { contains: "PESV", mode: "insensitive" },
          },
        ],
      },
      select: {
        tipo_hallazgo_detectado: true,
        evaluacion_cierre_eficaz: true,
        fecha_cierre_definitivo: true,
        aplica_reapertura: true,
      },
    }),
  ]);
  const manual = (numero: number) =>
    manuales.find((m) => m.numero_indicador === numero);
  const configuracion = (numero: number) =>
    configuraciones.find((c) => c.numero_indicador === numero);
  const manualIds = manuales.map((m) => m.id);
  const evidenciasManuales = manualIds.length
    ? await prisma.plan_trabajo_evidencia.findMany({
        where: { objetivo_tipo: "INDICADOR", objetivo_id: { in: manualIds } },
        orderBy: { created_at: "desc" },
      })
    : [];
  const resultado = (
    numero: number,
    valor: number | null,
    metaDefecto: number,
    extra: Record<string, unknown> = {},
  ) => {
    const config = configuracion(numero);
    return resultadoIndicador(
      numero,
      valor,
      config ? config.meta_principal * 100 : metaDefecto,
      {
        nombre: config?.nombre ?? `Indicador ${numero}`,
        fuente: [1, 2].includes(numero) ? "MANUAL" : "OCURRENCIAS",
        formula_fuente: config?.formula_fuente ?? null,
        bandas_referencia: config?.bandas_referencia ?? {},
        unidad: config?.unidad ?? "Porcentaje",
        frecuencia: config?.frecuencia ?? null,
        vigencia: config?.vigencia ?? null,
        ...extra,
      },
    );
  };
  const planeadas = ocurrencias.filter((o) => o.estado !== "NO_APLICA");
  const ejecutadas = planeadas.filter((o) => o.estado === "COMPLETADA");
  const cronograma = planeadas.filter(
    (o) =>
      trimestre === undefined ||
      (o.mes >= (trimestre - 1) * 3 + 1 && o.mes <= trimestre * 3),
  );
  const aTiempo = cronograma.filter(
    (o) =>
      o.estado === "COMPLETADA" &&
      (o.ejecutada_en_mes_fuente ||
        Boolean(
          o.completada_at &&
          o.completada_at <=
            new Date(
              `${o.fecha_vencimiento.toISOString().slice(0, 10)}T23:59:59.999Z`,
            ),
        )),
  );
  const nc = acciones.filter((a) =>
    /\bNC\b/i.test(a.tipo_hallazgo_detectado ?? ""),
  );
  const ncEficaces = nc.filter(
    (a) =>
      a.evaluacion_cierre_eficaz === "EFICAZ" &&
      a.fecha_cierre_definitivo &&
      !a.aplica_reapertura,
  );
  const kpis = [
    resultado(
      1,
      manual(1)
        ? manual(1)!.cumple &&
          evidenciasManuales.some((e) => e.objetivo_id === manual(1)!.id)
          ? 100
          : 0
        : null,
      100,
      {
        id: manual(1)?.id ?? null,
        observacion: manual(1)?.observacion ?? null,
        documento_cumple: manual(1)?.cumple ?? false,
        evidencias: evidenciasManuales
          .filter((e) => e.objetivo_id === manual(1)?.id)
          .map(({ id, nombre_archivo, mime_type, created_at }) => ({
            id,
            nombre_archivo,
            mime_type,
            created_at,
          })),
      },
    ),
    resultado(
      2,
      manual(2)
        ? manual(2)!.cumple &&
          evidenciasManuales.some((e) => e.objetivo_id === manual(2)!.id)
          ? 100
          : 0
        : null,
      100,
      {
        id: manual(2)?.id ?? null,
        observacion: manual(2)?.observacion ?? null,
        documento_cumple: manual(2)?.cumple ?? false,
        evidencias: evidenciasManuales
          .filter((e) => e.objetivo_id === manual(2)?.id)
          .map(({ id, nombre_archivo, mime_type, created_at }) => ({
            id,
            nombre_archivo,
            mime_type,
            created_at,
          })),
      },
    ),
    resultado(3, porcentaje(ejecutadas.length, planeadas.length), 85, {
      ejecutadas: ejecutadas.length,
      programadas: planeadas.length,
      periodo: "Anual",
    }),
    resultado(4, porcentaje(aTiempo.length, cronograma.length), 85, {
      ejecutadas_a_tiempo: aTiempo.length,
      programadas: cronograma.length,
      periodo: trimestre ? `T${trimestre}` : "Anual",
    }),
    resultado(5, porcentaje(ncEficaces.length, nc.length), 85, {
      cerradas_eficazmente: ncEficaces.length,
      detectadas: nc.length,
      periodo: trimestre ? `T${trimestre}` : "Anual",
    }),
  ];
  const ocurrenciasPesv = planeadas.filter(
    (o) =>
      o.actividad.es_pesv &&
      (trimestre === undefined || Math.ceil(o.mes / 3) === trimestre),
  );
  const ejecutadasPesv = ocurrenciasPesv.filter(
    (o) => o.estado === "COMPLETADA",
  );
  kpis.push(
    resultado(
      6,
      porcentaje(ejecutadasPesv.length, ocurrenciasPesv.length),
      85,
      {
        periodo: trimestre ? `T${trimestre}` : "Anual",
        ejecutadas: ejecutadasPesv.length,
        programadas: ocurrenciasPesv.length,
      },
    ),
  );
  return kpis;
}

export async function guardarIndicadorManual(params: {
  planId: string;
  numero: number;
  cumple: boolean;
  observacion?: string;
  usuarioId: string;
}) {
  if (![1, 2].includes(params.numero))
    throw new PlanTrabajoError(
      "Solo los indicadores 1 y 2 tienen registro manual.",
    );
  return prisma.plan_trabajo_indicador_manual.upsert({
    where: {
      plan_id_numero_indicador_periodo: {
        plan_id: params.planId,
        numero_indicador: params.numero,
        periodo: String((await obtenerPlan(params.planId)).anio),
      },
    },
    create: {
      plan_id: params.planId,
      numero_indicador: params.numero,
      periodo: String((await obtenerPlan(params.planId)).anio),
      cumple: params.cumple,
      observacion: params.observacion,
      actualizado_por_id: params.usuarioId,
    },
    update: {
      cumple: params.cumple,
      observacion: params.observacion,
      actualizado_por_id: params.usuarioId,
    },
  });
}

export async function actualizarBandasIndicador(
  planId: string,
  numero: number,
  bandas: { adecuado: string; riesgo: string; critico: string },
) {
  if (!Number.isInteger(numero) || numero < 1 || numero > 6)
    throw new PlanTrabajoError("El indicador debe estar entre 1 y 6.");
  for (const valor of Object.values(bandas)) {
    if (typeof valor !== "string" || valor.length > 255)
      throw new PlanTrabajoError(
        "Cada banda debe ser texto de máximo 255 caracteres.",
      );
  }
  const config = await prisma.plan_trabajo_indicador_config.findUnique({
    where: {
      plan_id_numero_indicador: { plan_id: planId, numero_indicador: numero },
    },
  });
  if (!config)
    throw new PlanTrabajoError(
      "No se encontró la configuración de este indicador.",
      404,
    );
  return prisma.plan_trabajo_indicador_config.update({
    where: { id: config.id },
    data: { bandas_referencia: bandas },
  });
}

export async function clonarPlan(planId: string, nuevoAnio: number) {
  if (!Number.isInteger(nuevoAnio) || nuevoAnio < 2020 || nuevoAnio > 2100)
    throw new PlanTrabajoError("El año no es válido.");
  const actual = await prisma.plan_trabajo_anual.findUnique({
    where: { id: planId },
    include: {
      actividades: { include: { ocurrencias: true } },
      cargos: true,
      areas_cargo: true,
      configuracion_indicadores: true,
    },
  });
  if (!actual) throw new PlanTrabajoError("No se encontró el plan anual.", 404);
  const existente = await prisma.plan_trabajo_anual.findUnique({
    where: { codigo_anio: { codigo: actual.codigo, anio: nuevoAnio } },
  });
  if (existente) return existente;
  return prisma.$transaction(async (tx) => {
    const plan = await tx.plan_trabajo_anual.create({
      data: {
        codigo: actual.codigo,
        nombre: actual.nombre.replace(/\b\d{4}\b/g, String(nuevoAnio)),
        anio: nuevoAnio,
        estado: "BORRADOR",
        recordatorios_activos: false,
      },
    });
    for (const actividad of actual.actividades) {
      const nueva = await tx.plan_trabajo_actividad.create({
        data: {
          plan_id: plan.id,
          numero_fuente: actividad.numero_fuente,
          fila_fuente: actividad.fila_fuente,
          unidad_programa: actividad.unidad_programa,
          actividad: actividad.actividad,
          recursos: actividad.recursos,
          responsable_cargos: actividad.responsable_cargos,
          alcance: actividad.alcance,
          metodo_seguimiento: actividad.metodo_seguimiento,
          frecuencia_fuente: actividad.frecuencia_fuente,
          es_pesv: actividad.es_pesv,
          paso_pesv: actividad.paso_pesv,
          requiere_evidencia: actividad.requiere_evidencia,
          datos_fuente: actividad.datos_fuente as any,
        },
      });
      for (const occurrence of actividad.ocurrencias) {
        await tx.plan_trabajo_ocurrencia.create({
          data: {
            actividad_id: nueva.id,
            mes: occurrence.mes,
            fecha_vencimiento: ultimoDia(nuevoAnio, occurrence.mes),
            estado: "PENDIENTE",
          },
        });
      }
    }
    const cargosOpcionales = actual.cargos.filter(
      (c) => c.rol !== "RESPONSABLE",
    );
    if (cargosOpcionales.length)
      await tx.plan_trabajo_cargo_usuario.createMany({
        data: cargosOpcionales.map((c) => ({
          plan_id: plan.id,
          cargo: c.cargo,
          usuario_id: c.usuario_id,
          rol: c.rol,
        })),
      });
    if (actual.areas_cargo.length)
      await tx.plan_trabajo_cargo_area.createMany({
        data: actual.areas_cargo.map((vinculo) => ({
          plan_id: plan.id,
          cargo: vinculo.cargo,
          area: vinculo.area,
        })),
      });
    if (actual.configuracion_indicadores.length)
      await tx.plan_trabajo_indicador_config.createMany({
        data: actual.configuracion_indicadores.map((c) => ({
          plan_id: plan.id,
          numero_indicador: c.numero_indicador,
          nombre: c.nombre,
          formula_fuente: c.formula_fuente,
          meta_principal: c.meta_principal,
          bandas_referencia: c.bandas_referencia as any,
          unidad: c.unidad,
          frecuencia: c.frecuencia,
          vigencia: c.vigencia,
          datos_fuente: c.datos_fuente as any,
        })),
      });
    return plan;
  });
}

export function reglaDeRecordatorio(vence: Date, hoy: Date, activado: Date) {
  const fecha = (d: Date) => d.toISOString().slice(0, 10);
  const base = fecha(vence);
  const actual = fecha(hoy);
  const diferencia = Math.round(
    (Date.parse(`${base}T00:00:00Z`) - Date.parse(`${actual}T00:00:00Z`)) /
      86_400_000,
  );
  if (diferencia === 7) return "ANTES_7";
  if (diferencia === 1) return "ANTES_1";
  if (diferencia === 0) return "VENCE_HOY";
  if (diferencia > 0) return null;
  const inicio = fecha(activado) > base ? fecha(activado) : base;
  const start = Date.parse(`${inicio}T00:00:00Z`);
  const end = Date.parse(`${actual}T00:00:00Z`);
  if (start >= end) return null;
  let habiles = 0;
  for (let cursor = start + 86_400_000; cursor <= end; cursor += 86_400_000) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) habiles++;
  }
  return habiles > 0 && habiles % 3 === 0 ? `ATRASO_${actual}` : null;
}

export async function ejecutarRecordatoriosPlan() {
  const individual = await participacionesDisponibles();
  const hoyTexto = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
  }).format(new Date());
  const hoy = new Date(`${hoyTexto}T12:00:00Z`);
  const planes = await prisma.plan_trabajo_anual.findMany({
    where: { estado: "ACTIVO", recordatorios_activos: true },
  });
  let enviados = 0;
  for (const plan of planes) {
    const ocurrencias = await prisma.plan_trabajo_ocurrencia.findMany({
      where: { actividad: { plan_id: plan.id }, estado: "PENDIENTE" },
      include: { actividad: true, asignaciones: true },
    });
    for (const ocurrencia of ocurrencias) {
      if (!individual) {
        const regla = reglaDeRecordatorio(ocurrencia.fecha_vencimiento, hoy,
          ocurrencia.recordatorios_desde ?? plan.activado_at ?? plan.created_at);
        if (!regla) continue;
        for (const asignacion of ocurrencia.asignaciones) {
          if (await enviarRecordatorio(ocurrencia.id, ocurrencia.actividad.plan_id,
            asignacion.destinatario_tipo, asignacion.destinatario_id,
            regla, ocurrencia.actividad.actividad, ocurrencia.fecha_vencimiento)) enviados++;
        }
        continue;
      }
      const participaciones = await participacionesOcurrencia(ocurrencia.id);
      for (const participacion of participaciones) {
        if (participacion.completada_at) continue;
        for (const [indice, corte] of participacion.cortes.entries()) {
          if (participacion.ventanas.includes(indice)) continue;
          const base = reglaDeRecordatorio(corte, hoy,
            ocurrencia.recordatorios_desde ?? plan.activado_at ?? plan.created_at);
          if (!base) continue;
          const regla = `${indice + 1}_${base}`;
          const claimed = await enviarRecordatorio(
            ocurrencia.id, ocurrencia.actividad.plan_id,
            participacion.destinatario_tipo, participacion.destinatario_id,
            regla, ocurrencia.actividad.actividad, corte,
          );
          if (claimed) enviados++;
        }
      }
    }
  }
  return { enviados };
}

async function enviarRecordatorio(
  ocurrenciaId: string,
  planId: string,
  tipo: string,
  destinatarioId: string,
  regla: string,
  tituloActividad: string,
  vence: Date,
) {
  if (tipo === "ADMIN") {
    const usuario = await prisma.usuarios.findFirst({
      where: { id: destinatarioId, activo: true },
      select: { id: true },
    });
    if (!usuario) return false;
  } else if (tipo === "CONDUCTOR") {
    const conductor = await prisma.conductores.findFirst({
      where: {
        id: destinatarioId,
        estado: { in: ["activo", "disponible", "programado", "servicio", "descanso"] },
        oculto: false,
        deleted_at: null,
      },
      select: { id: true },
    });
    if (!conductor) return false;
  }
  const titulo = regla.includes("ATRASO_")
    ? "Actividad HSEQ/PESV atrasada"
    : "Recordatorio de actividad HSEQ/PESV";
  const fechaVence = vence.toLocaleDateString("es-CO", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const cuerpo = `${tituloActividad.slice(0, 310)} · vence el ${fechaVence}`;
  try {
    if (tipo === "ADMIN") {
      const notificacion = await prisma.$transaction(async (tx) => {
        await tx.plan_trabajo_recordatorio.create({
          data: {
            ocurrencia_id: ocurrenciaId,
            destinatario_tipo: tipo,
            destinatario_id: destinatarioId,
            regla,
          },
        });
        return tx.notificacion.create({
          data: {
            usuario_id: destinatarioId,
            tipo: "PLAN_TRABAJO_RECORDATORIO",
            titulo,
            mensaje: cuerpo,
            referencia_id: ocurrenciaId,
            referencia_tipo: `PLAN:${planId}`,
          },
        });
      });
      emitNotificacion(notificacion);
      const push = await import("../notificaciones/web-push.service").catch(
        () => null,
      );
      await push?.enviarWebPush(notificacion).catch(() => undefined);
      return true;
    }
    if (tipo === "CONDUCTOR") {
      const notificacion = await prisma.$transaction(async (tx) => {
        await tx.plan_trabajo_recordatorio.create({
          data: {
            ocurrencia_id: ocurrenciaId,
            destinatario_tipo: tipo,
            destinatario_id: destinatarioId,
            regla,
          },
        });
        return tx.conductor_notification.create({
          data: {
            conductor_id: destinatarioId,
            tipo: "PLAN_TRABAJO_RECORDATORIO",
            titulo,
            cuerpo,
            datos: {
              ruta: `/public/portal/actividades?ocurrenciaId=${ocurrenciaId}`,
              route: `/public/portal/actividades?ocurrenciaId=${ocurrenciaId}`,
              mobile_route: `/actividades?id=${ocurrenciaId}`,
              ocurrencia_id: ocurrenciaId,
              plan_id: planId,
            },
          },
        });
      });
      await enviarPushConductor({
        conductorId: destinatarioId,
        notificacionId: notificacion.id,
        titulo,
        cuerpo,
        datos: notificacion.datos as Record<string, unknown>,
        canal: "actividades",
      });
      return true;
    }
  } catch (error: any) {
    if (error?.code === "P2002") return false;
    throw error;
  }
  return false;
}

export async function evidenciaConductorPermitida(
  evidenciaId: string,
  conductorId: string,
) {
  const evidencia = await prisma.plan_trabajo_evidencia.findUnique({
    where: { id: evidenciaId },
  });
  if (!evidencia || evidencia.objetivo_tipo !== "OCURRENCIA") return null;
  const asignacion = await prisma.plan_trabajo_asignacion.findFirst({
    where: {
      ocurrencia_id: evidencia.objetivo_id,
      destinatario_tipo: "CONDUCTOR",
      destinatario_id: conductorId,
    },
    select: { id: true },
  });
  return asignacion
    ? {
        url: await getS3SignedUrl(evidencia.s3_key, 3600),
        nombre_archivo: evidencia.nombre_archivo,
      }
    : null;
}
