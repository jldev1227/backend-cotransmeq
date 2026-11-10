import { prisma } from "../../config/prisma";
import { CanvasAnotacionesService } from "../canvas-anotaciones/canvas-anotaciones.service";
import {
  hashSnapshotPayload,
  reservarVersionSnapshot,
} from "../../utils/snapshot-version";
import { LiquidacionesTercerosIngresosService } from "./liquidaciones-terceros-ingresos.service";

type Origen = "manual" | "auto" | "revert";

export function diferencias(
  antes: any,
  despues: any,
  prefijo = "",
): Array<{ path: string; anterior: any; nuevo: any }> {
  const claves = new Set([
    ...Object.keys(antes ?? {}),
    ...Object.keys(despues ?? {}),
  ]);
  const cambios: Array<{ path: string; anterior: any; nuevo: any }> = [];
  for (const clave of claves) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    const a = antes?.[clave];
    const b = despues?.[clave];
    if (
      a &&
      b &&
      !Array.isArray(a) &&
      !Array.isArray(b) &&
      typeof a === "object" &&
      typeof b === "object"
    )
      cambios.push(...diferencias(a, b, ruta));
    else if (JSON.stringify(a) !== JSON.stringify(b))
      cambios.push({ path: ruta, anterior: a ?? null, nuevo: b ?? null });
  }
  return cambios;
}

/** Reemplaza solo los overrides de las filas cuya placa se restaura. */
export function combinarOverridesDePlaca<T extends Record<string, any>>(
  actuales: T[],
  historicos: T[],
  idsDePlaca: Set<string>,
): T[] {
  const clave = (fila: T): string => fila.liquidacion_tercero_id ?? fila.adicional_id ?? '';
  return [
    ...actuales.filter((fila) => !idsDePlaca.has(clave(fila))),
    ...historicos.filter((fila) => idsDePlaca.has(clave(fila))),
  ];
}

async function payloadDelPeriodo(anio: number, mes: number) {
  const [filas, estado, anotaciones] = await Promise.all([
    LiquidacionesTercerosIngresosService.listarPorPeriodo(mes, anio),
    LiquidacionesTercerosIngresosService.estadoPorPeriodo(mes, anio),
    CanvasAnotacionesService.exportar("ingresos", anio, mes),
  ]);
  return { periodo: { anio, mes }, filas, estado, anotaciones };
}

export const IngresosSnapshotsService = {
  async capturar(
    anio: number,
    mes: number,
    usuarioId: string | null,
    origen: Origen = "manual",
    revertidoDeId: string | null = null,
  ) {
    const payload = await payloadDelPeriodo(anio, mes);
    const previo = await prisma.liquidacion_ingreso_periodo_snapshot.findFirst({
      where: { anio, mes },
      orderBy: { version: "desc" },
    });
    if (
      previo &&
      hashSnapshotPayload(previo.payload) === hashSnapshotPayload(payload)
    )
      return { ...previo, sinCambios: true };
    const diff = previo ? diferencias(previo.payload, payload) : [];
    return reservarVersionSnapshot({
      scope: `snapshot:ingresos:${anio}-${mes}`,
      ultimaVersion: async (tx) =>
        (
          await tx.liquidacion_ingreso_periodo_snapshot.findFirst({
            where: { anio, mes },
            orderBy: { version: "desc" },
            select: { version: true },
          })
        )?.version,
      insertar: (tx, version) =>
        tx.liquidacion_ingreso_periodo_snapshot.create({
          data: {
            anio,
            mes,
            version,
            origen,
            usuario_id: usuarioId,
            revertido_de_id: revertidoDeId,
            payload: payload as never,
            diff: diff as never,
          },
        }),
    });
  },

  async listar(anio: number, mes: number) {
    const snapshots =
      await prisma.liquidacion_ingreso_periodo_snapshot.findMany({
        where: { anio, mes },
        orderBy: { version: "desc" },
        take: 100,
        select: {
          id: true,
          anio: true,
          mes: true,
          version: true,
          rama: true,
          origen: true,
          usuario_id: true,
          revertido_de_id: true,
          created_at: true,
          diff: true,
          payload: true,
        },
      });
    const ids = [
      ...new Set(
        snapshots.map((s) => s.usuario_id).filter((id): id is string => !!id),
      ),
    ];
    const usuarios = ids.length
      ? await prisma.usuarios.findMany({
          where: { id: { in: ids } },
          select: { id: true, nombre: true, correo: true },
        })
      : [];
    const porId = new Map(usuarios.map((u) => [u.id, u]));
    return snapshots.map(({ payload, ...s }) => ({
      ...s,
      usuario: s.usuario_id ? (porId.get(s.usuario_id) ?? null) : null,
      totales: { filas: (payload as any)?.filas?.length ?? 0 },
    }));
  },

  async obtener(id: string) {
    const snapshot =
      await prisma.liquidacion_ingreso_periodo_snapshot.findUnique({
        where: { id },
      });
    if (!snapshot) throw new Error("Snapshot no encontrado");
    return snapshot;
  },

  async diff(id: string, vs?: string) {
    const actual = await this.obtener(id);
    const anterior = vs
      ? await this.obtener(vs)
      : await prisma.liquidacion_ingreso_periodo_snapshot.findFirst({
          where: {
            anio: actual.anio,
            mes: actual.mes,
            version: { lt: actual.version },
          },
          orderBy: { version: "desc" },
        });
    if (
      anterior &&
      (anterior.anio !== actual.anio || anterior.mes !== actual.mes)
    )
      throw new Error("Las versiones pertenecen a periodos distintos");
    return {
      fields: anterior ? diferencias(anterior.payload, actual.payload) : [],
    };
  },

  async revertir(id: string, usuarioId: string, placa?: string | null) {
    const snapshot = await this.obtener(id);
    const payload = snapshot.payload as any;
    const filasActuales =
      await LiquidacionesTercerosIngresosService.listarPorPeriodo(
        snapshot.mes,
        snapshot.anio,
      );
    /// Las filas nacen de servicios facturados: si cambiaron, restaurar solo
    /// la capa editable produciría una hoja distinta a la vista previa.
    const filasSnapshot = payload.filas ?? [];
    const actualesAlcance = placa ? filasActuales.filter((f: any) => f.placa === placa) : filasActuales;
    const snapshotAlcance = placa ? filasSnapshot.filter((f: any) => f.placa === placa) : filasSnapshot;
    if (placa && actualesAlcance.length === 0 && snapshotAlcance.length === 0) {
      const error = new Error(`El snapshot y el periodo actual no contienen la placa ${placa}.`);
      (error as any).statusCode = 404;
      throw error;
    }
    if (hashSnapshotPayload(actualesAlcance) !== hashSnapshotPayload(snapshotAlcance)) {
      const error = new Error(
        placa
          ? `Los servicios de ${placa} cambiaron desde esta versión. No se puede restaurar esa hoja exactamente.`
          : "Los servicios de esta versión cambiaron. No se puede restaurar la hoja exactamente.",
      );
      (error as any).statusCode = 409;
      throw error;
    }
    await this.capturar(snapshot.anio, snapshot.mes, usuarioId);
    const estado = payload.estado ?? {};
    let filasEstado = estado.filas ?? [];
    let conceptos = estado.conceptos ?? [];
    let cabecera = estado.cabecera ?? {};
    if (placa) {
      const estadoActual = await LiquidacionesTercerosIngresosService.estadoPorPeriodo(snapshot.mes, snapshot.anio);
      const idsDePlaca = new Set([...snapshotAlcance, ...actualesAlcance].map((f: any) => f.id));
      filasEstado = combinarOverridesDePlaca(estadoActual.filas ?? [], estado.filas ?? [], idsDePlaca);
      /// Los porcentajes, observaciones, conceptos del pie y anotaciones son
      /// valores compartidos por el periodo; la reversión de una placa solo
      /// reemplaza sus filas y conserva esas decisiones globales.
      cabecera = estadoActual.cabecera ?? {};
      conceptos = estadoActual.conceptos ?? [];
    }
    await LiquidacionesTercerosIngresosService.guardarBorrador({
      anio: snapshot.anio,
      mes: snapshot.mes,
      user_id: usuarioId,
      observaciones: cabecera.observaciones ?? null,
      pct_admon_ingresos: cabecera.pct_admon_ingresos,
      pct_ganancia_adicionales: cabecera.pct_ganancia_adicionales,
      pct_admon_adicionales: cabecera.pct_admon_adicionales,
      filas: filasEstado,
      conceptos,
    });
    if (!placa) {
      await CanvasAnotacionesService.restaurar({
        scope: "ingresos",
        anio: snapshot.anio,
        mes: snapshot.mes,
        anotaciones: payload.anotaciones ?? [],
        user_id: usuarioId,
      });
    }
    const nuevoSnapshot = await this.capturar(
      snapshot.anio,
      snapshot.mes,
      usuarioId,
      "revert",
      id,
    );
    return { restauradas: placa ? snapshotAlcance.length : 1, nuevoSnapshot };
  },
};
