// @ts-nocheck
import { prisma } from "../../config/prisma";
import argon2 from "argon2";
import crypto from "crypto";
import {
  AREAS,
  AREA_LABELS,
  esAreaValida,
  type AccessLevel,
  type Area,
} from "../../config/permissions";
import { invalidarPermisosRutas } from "../../services/permisos-rutas.service";
import { olvidarSesionesEnCache } from "../../middlewares/cache-sesiones";
import { SesionesService } from "../sesiones/sesiones.service";

/**
 * Campos que se devuelven de un usuario. Nunca incluye `password`.
 *
 * Estaba copiado y pegado en cuatro consultas y `permisos_rutas` se habría
 * quedado fuera de alguna: la ficha lo traería y el listado no, y la pantalla
 * de permisos mostraría vacío lo que en realidad está restringido.
 */
const USUARIO_SELECT = {
  id: true,
  nombre: true,
  correo: true,
  telefono: true,
  role: true,
  cargo: true,
  area: true,
  activo: true,
  firma_url: true,
  permisos: true,
  permisos_rutas: true,
  es_invitado: true,
  ultimo_acceso: true,
  created_at: true,
  updated_at: true,
} as const;

// Permisos por defecto para nuevos usuarios (todo deshabilitado)
export const PERMISOS_DEFAULT: Record<string, boolean> = {
  flota: false,
  conductores: false,
  servicios: false,
  recargos: false,
  clientes: false,
  asistencias: false,
  "acciones-correctivas": false,
  evaluaciones: false,
  nomina: false,
  usuarios: false,
  // Permiso individual (no por área): otorga o revoca un administrador
  // desde la página de Usuarios → "Permiso de bonos — planilla de días laborados".
  "bonos-planilla": false,
};

// Permisos de admin (todo habilitado)
export const PERMISOS_ADMIN: Record<string, boolean> = {
  flota: true,
  conductores: true,
  servicios: true,
  recargos: true,
  clientes: true,
  asistencias: true,
  "acciones-correctivas": true,
  evaluaciones: true,
  nomina: true,
  usuarios: true,
  "bonos-planilla": true,
};

/** Error de negocio del alta de usuarios, con código para mapear a HTTP. */
export class UsuarioError extends Error {
  constructor(
    public codigo: "CORREO_DUPLICADO",
    message: string,
  ) {
    super(message);
    this.name = "UsuarioError";
  }
}

export class ResponsableAreaError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ResponsableAreaError";
  }
}

export interface CrearUsuarioInput {
  nombre: string;
  correo: string;
  password: string;
  telefono?: string | null;
  cargo?: string | null;
  area?: string[];
  permisos_rutas?: Record<string, AccessLevel> | null;
}

export const UsuariosService = {
  async listarResponsablesArea() {
    const asignaciones = await prisma.usuario_area_responsable.findMany({
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
    });
    const porArea = new Map(
      asignaciones.map((asignacion) => [asignacion.area, asignacion.usuario]),
    );
    return AREAS.map((area) => ({
      area,
      etiqueta: AREA_LABELS[area],
      responsable: porArea.get(area) ?? null,
    }));
  },

  async actualizarResponsableArea(area: string, usuarioId: string) {
    if (!esAreaValida(area))
      throw new ResponsableAreaError("El área seleccionada no existe.");
    const usuario = await prisma.usuarios.findFirst({
      where: { id: usuarioId, activo: true, area: { has: area } },
      select: {
        id: true,
        nombre: true,
        correo: true,
        cargo: true,
        activo: true,
        area: true,
      },
    });
    if (!usuario)
      throw new ResponsableAreaError(
        "Elige una persona activa que pertenezca a esta área.",
      );

    const responsableActual = await prisma.usuario_area_responsable.findUnique({
      where: { area },
      select: { usuario_id: true },
    });
    if (responsableActual?.usuario_id === usuario.id) {
      return {
        area: area as Area,
        etiqueta: AREA_LABELS[area],
        responsable: usuario,
      };
    }

    const ahora = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.usuario_area_responsable.upsert({
        where: { area },
        update: { usuario_id: usuario.id, updated_at: ahora },
        create: { area, usuario_id: usuario.id, updated_at: ahora },
      });

      const cargos = await tx.plan_trabajo_cargo_area.findMany({
        where: { area },
        select: { cargo: true, plan_id: true },
      });
      for (const vinculacion of cargos) {
        const actividades = await tx.plan_trabajo_actividad.findMany({
          where: {
            plan_id: vinculacion.plan_id,
            responsable_cargos: vinculacion.cargo,
          },
          select: {
            ocurrencias: {
              where: { estado: "PENDIENTE" },
              select: { id: true },
            },
          },
        });
        const ocurrenciaIds = actividades.flatMap((actividad) =>
          actividad.ocurrencias.map((ocurrencia) => ocurrencia.id),
        );
        if (!ocurrenciaIds.length) continue;

        await tx.plan_trabajo_asignacion.deleteMany({
          where: {
            ocurrencia_id: { in: ocurrenciaIds },
            destinatario_tipo: "ADMIN",
            rol: "RESPONSABLE",
            origen_cargo: vinculacion.cargo,
          },
        });
        await tx.plan_trabajo_asignacion.createMany({
          data: ocurrenciaIds.map((ocurrencia_id) => ({
            ocurrencia_id,
            destinatario_tipo: "ADMIN",
            destinatario_id: usuario.id,
            rol: "RESPONSABLE",
            origen_cargo: vinculacion.cargo,
          })),
          skipDuplicates: true,
        });
        await tx.plan_trabajo_ocurrencia.updateMany({
          where: {
            id: { in: ocurrenciaIds },
            fecha_vencimiento: {
              lt: new Date(ahora.toISOString().slice(0, 10)),
            },
          },
          data: { recordatorios_desde: ahora },
        });
      }
    });
    return {
      area: area as Area,
      etiqueta: AREA_LABELS[area],
      responsable: usuario,
    };
  },

  /**
   * Alta manual de un usuario, sin pasar por invitación.
   *
   * Hasta ahora la única forma de crear a alguien era invitarle por correo y
   * que él mismo pusiera su contraseña. Eso no sirve para dar de alta a quien
   * no tiene correo corporativo o a quien hay que dejar listo en el momento.
   *
   * Detalles que NO son opcionales:
   *  - `id`, `created_at` y `updated_at` se pasan a mano: el modelo `usuarios`
   *    no tiene `@default` en ninguno de los tres y Prisma falla sin ellos.
   *  - El hash usa `argon2.hash` con los parámetros por defecto, EXACTAMENTE
   *    igual que `InvitacionesService.aceptar`. `AuthService.login` acepta
   *    bcrypt y argon2 (los bcrypt vienen del backend antiguo), pero todo lo
   *    que se crea hoy debe salir por la misma puerta que la invitación; si
   *    aquí se usara otro algoritmo o coste habría dos formatos «nuevos» que
   *    mantener.
   *  - `es_invitado: false` distingue estas altas de las que vinieron por
   *    invitación, que es lo que mira la pantalla de usuarios.
   */
  async create(input: CrearUsuarioInput) {
    const correo = input.correo.trim().toLowerCase();

    /// Se comprueba antes para poder devolver un 409 con mensaje en español.
    /// El índice único de `correo` sigue siendo la garantía real (dos altas
    /// simultáneas pasarían las dos por aquí), y el P2002 se traduce abajo.
    const existente = await prisma.usuarios.findUnique({ where: { correo } });
    if (existente) {
      throw new UsuarioError(
        "CORREO_DUPLICADO",
        `Ya existe un usuario registrado con el correo "${correo}".`,
      );
    }

    const hash = await argon2.hash(input.password);
    const ahora = new Date();

    try {
      return await prisma.usuarios.create({
        data: {
          id: crypto.randomUUID(),
          nombre: input.nombre.trim(),
          correo,
          password: hash,
          telefono: input.telefono || null,
          cargo: input.cargo || null,
          /// La columna se conserva por compatibilidad, pero el cliente no la asigna ni autoriza.
          role: "usuario",
          area: input.area ?? [],
          permisos: PERMISOS_DEFAULT,
          permisos_rutas: input.permisos_rutas ?? null,
          es_invitado: false,
          created_at: ahora,
          updated_at: ahora,
        },
        select: USUARIO_SELECT,
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        throw new UsuarioError(
          "CORREO_DUPLICADO",
          `Ya existe un usuario registrado con el correo "${correo}".`,
        );
      }
      throw err;
    }
  },
  async list() {
    return prisma.usuarios.findMany({
      select: USUARIO_SELECT,
      orderBy: { nombre: "asc" },
    });
  },
  async getById(id: string) {
    return prisma.usuarios.findUnique({
      where: { id },
      select: USUARIO_SELECT,
    });
  },
  async update(
    id: string,
    data: {
      nombre?: string;
      telefono?: string;
      correo?: string;
      cargo?: string;
      area?: string[];
      activo?: boolean;
      permisos_rutas?: Record<string, AccessLevel> | null;
    },
  ) {
    if (data.activo === false || data.area !== undefined) {
      const responsabilidades = await prisma.usuario_area_responsable.findMany({
        where: { usuario_id: id },
        select: { area: true },
      });
      const areasQuePerderia = responsabilidades
        .filter(
          ({ area }) =>
            data.activo === false ||
            (data.area !== undefined && !data.area.includes(area)),
        )
        .map(({ area }) => AREA_LABELS[area as Area] ?? area);
      if (areasQuePerderia.length) {
        throw new ResponsableAreaError(
          `Esta persona es responsable de ${areasQuePerderia.join(", ")}. Asigna primero otra persona desde Personal.`,
        );
      }
    }
    const actualizado = await prisma.usuarios.update({
      where: { id },
      data: { ...data, updated_at: new Date() },
      select: USUARIO_SELECT,
    });

    /// Si se tocó la lista blanca hay que tirar la caché de 30 s, o el recorte
    /// no se notaría hasta medio minuto después de guardarlo.
    if ("permisos_rutas" in data) invalidarPermisosRutas(id);

    /// El middleware toma áreas y estado de la sesión con una caché de
    /// 30 s. Quitar un área o desactivar a alguien tiene que notarse ya.
    if ("area" in data || "activo" in data) olvidarSesionesEnCache();
    /// Desactivar cierra sus sesiones también por esta vía (no solo desde el
    /// interruptor de la lista): sin sesión activa el middleware lo rechaza.
    if (data.activo === false) await SesionesService.cerrarTodas(id);

    return actualizado;
  },
  /**
   * Reemplaza la contraseña de un usuario y revoca sus sesiones en la misma
   * transacción para que la clave anterior no conserve acceso abierto.
   */
  async cambiarPassword(id: string, password: string) {
    const usuario = await prisma.usuarios.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!usuario) return false;

    const hash = await argon2.hash(password);
    await prisma.$transaction([
      prisma.usuarios.update({
        where: { id },
        data: { password: hash, updated_at: new Date() },
        select: { id: true },
      }),
      prisma.sesiones.updateMany({
        where: { usuario_id: id, is_active: true },
        data: { is_active: false, closed_at: new Date() },
      }),
    ]);
    /// La transacción cerró las sesiones en DB; vaciar caché hace efectivo el
    /// cierre también en peticiones que aún tengan el token anterior.
    olvidarSesionesEnCache();
    return true;
  },
  async updatePermisos(id: string, permisos: Record<string, boolean>) {
    const actualizado = await prisma.usuarios.update({
      where: { id },
      data: { permisos },
      select: USUARIO_SELECT,
    });
    olvidarSesionesEnCache();
    return actualizado;
  },

  /**
   * Otorga o revoca el permiso INDIVIDUAL `bonos-planilla` a uno o
   * varios usuarios. Este permiso es independiente del área: solo lo
   * управan los administradores desde la página de Usuarios.
   *
   *  - Devuelve el array de usuarios actualizados.
   *  - Si el usuario está deshabilitado, igual actualiza (un admin puede
   *    preparar el acceso antes de habilitarlo).
   */
  async setBonosPlanilla(userIds: string[], granted: boolean) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return [];
    }

    // Optimización: leer los permisos actuales en una sola query y
    // mergear en JS para no perder otras claves (nomina, flota, etc.).
    const usuarios = await prisma.usuarios.findMany({
      where: { id: { in: userIds } },
      select: { id: true, permisos: true },
    });

    const updates = await Promise.all(
      usuarios.map(async (u) => {
        const current = (u.permisos as Record<string, boolean> | null) || {};
        const merged: Record<string, boolean> = {
          ...current,
          "bonos-planilla": granted,
        };
        return prisma.usuarios.update({
          where: { id: u.id },
          data: { permisos: merged },
          select: {
            id: true,
            nombre: true,
            correo: true,
            permisos: true,
          },
        });
      }),
    );

    /// `bonos-planilla` lo lee `requireBonosPlanilla` de la sesión: que el cambio
    /// aplique ya y no a los 30 s.
    olvidarSesionesEnCache();
    return updates;
  },
  async listConductoresBasicos() {
    return prisma.usuarios.findMany({
      where: {
        role: "CONDUCTOR",
        deletedAt: null,
      },
      select: {
        id: true,
        nombre: true,
        correo: true,
        telefono: true,
        conductores: {
          select: {
            id: true,
            numero_identificacion: true,
            estado: true,
          },
        },
      },
      orderBy: {
        nombre: "asc",
      },
    });
  },
};
