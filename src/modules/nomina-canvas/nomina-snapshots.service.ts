/**
 * Snapshots del libro de nómina de un periodo.
 *
 * La identidad es `(anio, mes, version)` y no la liquidación: lo que se
 * captura y lo que se revierte es el PERIODO entero. Las hojas comparten
 * configuración —el día de corte y las constantes de disponibilidad— y
 * revertir una sola dejaría el libro descuadrado respecto a las demás.
 *
 * Reutiliza `utils/snapshot-version.ts` sin tocarlo: la reserva de número con
 * advisory lock, el hash canónico que evita duplicar payloads idénticos y la
 * ventana antirrebote de las capturas automáticas.
 */
import { prisma } from '../../config/prisma';
import {
  reservarVersionSnapshot,
  hashSnapshotPayload,
  inicioVentanaAntirrebote,
} from '../../utils/snapshot-version';
import { NominaCanvasService } from './nomina-canvas.service';
import { ESTADOS_BLOQUEADOS } from './nomina-estado.service';
import type { NominaPeriodoDTO } from './nomina-canvas.types';

export type OrigenSnapshot = 'manual' | 'auto' | 'revert';

const scopeDe = (anio: number, mes: number) => `snapshot:nomina:${anio}-${mes}`;

export interface ResumenSnapshot {
  id: string;
  version: number;
  origen: string;
  rama: string;
  created_at: Date;
  usuario: { id: string; nombre: string | null } | null;
  revertido_de_id: string | null;
  /** Para la lista del panel, sin bajarse el payload entero. */
  hojas: number;
  conductores_con_planilla: number;
}

export const NominaSnapshotsService = {
  /**
   * Captura el estado actual del periodo.
   *
   * Devuelve `null` cuando no se escribe nada: o porque el contenido es
   * idéntico al último snapshot, o porque es una captura `auto` dentro de la
   * ventana antirrebote. Un `null` no es un error — es «no hacía falta».
   */
  async capturar(params: {
    anio: number;
    mes: number;
    corte?: number;
    origen?: OrigenSnapshot;
    usuarioId?: string | null;
    revertidoDeId?: string | null;
  }): Promise<{ id: string; version: number } | null> {
    const { anio, mes, corte } = params;
    const origen: OrigenSnapshot = params.origen ?? 'manual';

    // El freno barato primero: si es automático y ya hay uno reciente, ni se
    // construye el payload (son decenas de queries).
    if (origen === 'auto') {
      const reciente = await prisma.nomina_periodo_snapshot.findFirst({
        where: {
          anio,
          mes,
          origen: 'auto',
          created_at: { gte: inicioVentanaAntirrebote() },
        },
        select: { id: true },
      });
      if (reciente) return null;
    }

    const dto = await NominaCanvasService.construirPeriodo({ anio, mes, corte });
    const payload = this.payloadDesdeDTO(dto);
    const hash = hashSnapshotPayload(payload);

    // El segundo freno: contenido idéntico al último. Solo aplica a los
    // automáticos — si alguien pulsa «guardar versión» a mano, se le da.
    if (origen === 'auto') {
      const ultimo = await prisma.nomina_periodo_snapshot.findFirst({
        where: { anio, mes, rama: 'main' },
        orderBy: { version: 'desc' },
        select: { payload: true },
      });
      if (ultimo && hashSnapshotPayload(ultimo.payload) === hash) return null;
    }

    return reservarVersionSnapshot({
      scope: scopeDe(anio, mes),
      ultimaVersion: async (tx) => {
        const ultimo = await tx.nomina_periodo_snapshot.findFirst({
          where: { anio, mes },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        return ultimo?.version ?? null;
      },
      insertar: async (tx, version) => {
        const creado = await tx.nomina_periodo_snapshot.create({
          data: {
            anio,
            mes,
            version,
            rama: 'main',
            origen,
            revertido_de_id: params.revertidoDeId ?? null,
            usuario_id: params.usuarioId ?? null,
            payload: payload as any,
          },
          select: { id: true, version: true },
        });
        return creado;
      },
    });
  },

  /**
   * Lo que se guarda. No es el DTO tal cual: se quitan las etiquetas y los
   * colores, que son presentación y se recalculan al restaurar. Lo que hay
   * que conservar son los DATOS y la configuración con la que se calcularon.
   */
  payloadDesdeDTO(dto: NominaPeriodoDTO) {
    return {
      anio: dto.anio,
      mes: dto.mes,
      corte: dto.corte,
      disponibilidad: dto.disponibilidad,
      topes: dto.topes,
      hojas: dto.hojas.map((h) => ({
        conductorId: h.conductorId,
        liquidacionId: h.liquidacionId,
        version: h.version,
        estado: h.estado,
        nombre: h.nombre,
        cedula: h.cedula,
        salarioBasico: h.salarioBasico,
        valorHora: h.valorHora,
        horasMensualesBase: h.horasMensualesBase,
        totalHorasMes: h.totalHorasMes,
        dias: h.dias.map((d) => ({
          indice: d.indice,
          fecha: d.fecha,
          horaInicio: d.horaInicio,
          horaFin: d.horaFin,
          totalHoras: d.totalHoras,
          disponibilidad: d.disponibilidad,
          horas: d.horas,
          empresaId: d.empresaId,
        })),
        tarifas: h.tarifas.map((t) => ({
          codigo: t.codigo,
          porcentaje: t.porcentaje,
          valorHora: t.valorHora,
          horas: t.horas,
          valor: t.valor,
        })),
        bloquesEmpresa: h.bloquesEmpresa.map((b) => ({
          empresaId: b.empresaId,
          empresa: b.empresa,
          mes: b.mes,
          anio: b.anio,
          dias: b.dias,
          totalHoras: b.totalHoras,
          totalValor: b.totalValor,
        })),
        devengos: h.devengos,
        deducciones: h.deducciones,
        totales: h.totales,
      })),
      meta: {
        // Fuera del hash a propósito: cambia en cada captura por definición.
        capturado_en: new Date().toISOString(),
        hojas: dto.hojas.length,
      },
    };
  },

  /** Las versiones de un periodo, de la más reciente a la más antigua. */
  async listar(anio: number, mes: number): Promise<ResumenSnapshot[]> {
    const filas = await prisma.nomina_periodo_snapshot.findMany({
      where: { anio, mes },
      orderBy: { version: 'desc' },
      take: 100,
      include: { usuario: { select: { id: true, nombre: true } } },
    });

    return filas.map((f) => {
      const p = (f.payload ?? {}) as any;
      const hojas: any[] = Array.isArray(p.hojas) ? p.hojas : [];
      return {
        id: f.id,
        version: f.version,
        origen: f.origen,
        rama: f.rama,
        created_at: f.created_at,
        usuario: f.usuario ? { id: f.usuario.id, nombre: f.usuario.nombre } : null,
        revertido_de_id: f.revertido_de_id,
        hojas: hojas.length,
        conductores_con_planilla: hojas.filter((h) => (h?.dias?.length ?? 0) > 0).length,
      };
    });
  },

  async obtener(id: string) {
    return prisma.nomina_periodo_snapshot.findUnique({
      where: { id },
      include: { usuario: { select: { id: true, nombre: true } } },
    });
  },

  /**
   * Diferencias entre dos versiones, campo a campo y por conductor.
   *
   * Se compara contra `vs` si se indica, y si no contra la versión anterior.
   */
  async diff(id: string, vsId?: string) {
    const actual = await prisma.nomina_periodo_snapshot.findUnique({ where: { id } });
    if (!actual) return null;

    const previo = vsId
      ? await prisma.nomina_periodo_snapshot.findUnique({ where: { id: vsId } })
      : await prisma.nomina_periodo_snapshot.findFirst({
          where: { anio: actual.anio, mes: actual.mes, version: { lt: actual.version } },
          orderBy: { version: 'desc' },
        });

    const hojasDe = (s: any): Map<string, any> => {
      const p = (s?.payload ?? {}) as any;
      const lista: any[] = Array.isArray(p.hojas) ? p.hojas : [];
      return new Map(lista.map((h) => [h.conductorId, h]));
    };

    const aHojas = hojasDe(previo);
    const bHojas = hojasDe(actual);
    const cambios: {
      conductorId: string;
      nombre: string;
      campo: string;
      antes: unknown;
      despues: unknown;
    }[] = [];

    // Solo se comparan los totales y el estado: el diff es para decidir si
    // restaurar, no para auditar celda a celda. Con 30 conductores × 25
    // conceptos, un diff exhaustivo no se lee.
    const CAMPOS: { clave: string; leer: (h: any) => unknown }[] = [
      { clave: 'estado', leer: (h) => h?.estado },
      { clave: 'días laborados', leer: (h) => h?.devengos?.find((d: any) => d.clave === 'salario')?.cantidad },
      { clave: 'total horas', leer: (h) => h?.totalHorasMes },
      { clave: 'total recargos', leer: (h) => h?.totales?.totalRecargos },
      { clave: 'total devengado', leer: (h) => h?.totales?.sueldoBruto },
      { clave: 'deducciones', leer: (h) => h?.totales?.totalDeducciones },
      { clave: 'neto a pagar', leer: (h) => h?.totales?.sueldoTotal },
    ];

    const redondear = (v: unknown) => (typeof v === 'number' ? Math.round(v) : v);

    for (const [conductorId, b] of bHojas) {
      const a = aHojas.get(conductorId);
      if (!a) {
        cambios.push({ conductorId, nombre: b.nombre, campo: 'hoja', antes: null, despues: 'nueva' });
        continue;
      }
      for (const c of CAMPOS) {
        const antes = redondear(c.leer(a));
        const despues = redondear(c.leer(b));
        if (antes !== despues) {
          cambios.push({ conductorId, nombre: b.nombre, campo: c.clave, antes, despues });
        }
      }
    }
    for (const [conductorId, a] of aHojas) {
      if (!bHojas.has(conductorId)) {
        cambios.push({ conductorId, nombre: a.nombre, campo: 'hoja', antes: 'existía', despues: null });
      }
    }

    return {
      actual: { id: actual.id, version: actual.version, created_at: actual.created_at },
      previo: previo ? { id: previo.id, version: previo.version, created_at: previo.created_at } : null,
      cambios: cambios.slice(0, 200),
      truncado: cambios.length > 200,
    };
  },

  /**
   * Restaura un periodo desde un snapshot.
   *
   * Las hojas en estado bloqueado (APROBADA, PAGADA, ANULADA) NO se tocan y
   * se devuelven en `omitidas`: restaurar por encima de un desprendible ya
   * aprobado sería reescribir un documento que alguien firmó. El canvas lo
   * avisa en un toast largo, no en silencio.
   *
   * Al restaurar se captura un snapshot nuevo con `origen: 'revert'`, para que
   * la propia reversión quede en el historial y se pueda deshacer.
   */
  async revertir(params: {
    snapshotId: string;
    usuarioId?: string | null;
  }): Promise<{
    restauradas: number;
    omitidas: { conductorId: string; nombre: string; estado: string }[];
    nuevoSnapshot: { id: string; version: number } | null;
  }> {
    const snap = await prisma.nomina_periodo_snapshot.findUnique({
      where: { id: params.snapshotId },
    });
    if (!snap) throw new Error('Snapshot no encontrado');

    const payload = (snap.payload ?? {}) as any;
    const hojas: any[] = Array.isArray(payload.hojas) ? payload.hojas : [];

    const conIds = hojas.map((h) => h.liquidacionId).filter(Boolean) as string[];
    const actuales = conIds.length
      ? await prisma.liquidaciones.findMany({
          where: { id: { in: conIds } },
          select: { id: true, estado_flujo: true },
        })
      : [];
    const estadoPorId = new Map(actuales.map((l) => [l.id, l.estado_flujo]));

    const omitidas: { conductorId: string; nombre: string; estado: string }[] = [];
    const aRestaurar: any[] = [];
    for (const h of hojas) {
      if (!h.liquidacionId) continue;
      const estado = estadoPorId.get(h.liquidacionId);
      if (!estado) continue; // la liquidación ya no existe
      if (ESTADOS_BLOQUEADOS.includes(estado)) {
        omitidas.push({ conductorId: h.conductorId, nombre: h.nombre, estado });
        continue;
      }
      aRestaurar.push(h);
    }

    // Una transacción por hoja y no una global: con 30 conductores, un fallo
    // en el último revertiría los 29 anteriores sin decir cuál falló. Es el
    // mismo criterio que `cambiarLote()`.
    let restauradas = 0;
    for (const h of aRestaurar) {
      const t = h.totales ?? {};
      await prisma.liquidaciones.update({
        where: { id: h.liquidacionId },
        data: {
          salario_devengado: t.salarioDevengado ?? 0,
          auxilio_transporte: t.auxilioTransporte ?? 0,
          total_bonificaciones: t.totalBonificaciones ?? 0,
          total_pernotes: t.totalPernotes ?? 0,
          total_recargos: t.totalRecargos ?? 0,
          total_vacaciones: t.totalVacaciones ?? 0,
          total_anticipos: t.totalAnticipos ?? 0,
          salud: t.salud ?? 0,
          pension: t.pension ?? 0,
          sueldo_total: t.sueldoTotal ?? 0,
          ajuste_parex: t.ajusteParex ?? 0,
          ajuste_geopark: t.ajusteGeopark ?? 0,
          ajuste_salarial: t.bonificacionVillanueva ?? 0,
          valor_incapacidad: t.valorIncapacidad ?? 0,
          interes_cesantias: t.interesCesantias ?? 0,
          disponibilidad: t.disponibilidad ?? 0,
          actualizado_por_id: params.usuarioId ?? null,
          version: { increment: 1 },
          updated_at: new Date(),
        },
      });
      restauradas++;
    }

    const nuevoSnapshot = await this.capturar({
      anio: snap.anio,
      mes: snap.mes,
      corte: payload.corte,
      origen: 'revert',
      usuarioId: params.usuarioId,
      revertidoDeId: snap.id,
    });

    return { restauradas, omitidas, nuevoSnapshot };
  },
};
