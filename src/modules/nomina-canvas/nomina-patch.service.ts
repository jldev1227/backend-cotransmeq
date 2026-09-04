/**
 * Edición celda a celda del canvas de nómina, con compare-and-swap.
 *
 * Solo se tocan los campos que una persona teclea en el desprendible. Todo lo
 * demás —los recargos, las horas, el reparto entre desprendible y
 * disponibilidad— es DERIVADO de las planillas y no se edita aquí: si la
 * cifra de recargos está mal, lo que hay que corregir es la planilla, no el
 * desprendible. Por eso hay lista blanca y no una lista negra.
 *
 * Después de cada cambio se recalculan los totales con `liquidarNomina()` y se
 * persisten, para que la fila de la base y lo que enseña el canvas no puedan
 * separarse.
 */
import { prisma } from '../../config/prisma';
import { liquidarNomina, type EntradaLiquidacion } from '../../lib/nomina/liquidar';
import { ESTADOS_BLOQUEADOS } from './nomina-estado.service';

/**
 * Campos editables y cómo se validan.
 *
 * `dias` son enteros de 0 a 31; `moneda` son importes no negativos; `flag` son
 * booleanos. Los importes se guardan como número, nunca como texto — una celda
 * de texto no suma ni ordena, y acaba llegando como NaN a la base.
 */
const CAMPOS_EDITABLES: Record<string, 'dias' | 'moneda' | 'flag' | 'entero'> = {
  dias_laborados: 'dias',
  dias_laborados_villanueva: 'dias',
  dias_laborados_anual: 'entero',
  dias_ajuste_deducciones: 'entero',
  total_vacaciones: 'moneda',
  interes_cesantias: 'moneda',
  valor_incapacidad: 'moneda',
  cesantias: 'moneda',
  ajuste_salarial: 'moneda',
  observaciones: 'flag', // texto libre; se valida aparte
  descontar_salud_salario: 'flag',
  descontar_pension_salario: 'flag',
  ajuste_parex_recargos_completos: 'flag',
  ajuste_salarial_por_dia: 'flag',
  mostrar_recargos: 'flag',
  desprendible_visible: 'flag',
};

export class PatchNominaError extends Error {
  constructor(
    message: string,
    readonly code: 'CAMPO_NO_EDITABLE' | 'VALOR_INVALIDO' | 'NO_ENCONTRADO' | 'BLOQUEADA',
  ) {
    super(message);
  }
}

/** Error de concurrencia optimista, para que el gateway devuelva `conflict`. */
export class ConflictoVersionNomina extends Error {
  readonly code = 'VERSION_CONFLICT';
  constructor(
    readonly entityId: string,
    readonly serverRow: { version: number; estado_flujo: string; valor: unknown } | null,
  ) {
    super('La liquidación fue modificada por otro usuario');
  }
}

const dec = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function normalizar(campo: string, valor: unknown): number | boolean | string | null {
  const tipo = CAMPOS_EDITABLES[campo];

  if (campo === 'observaciones') {
    if (valor === null || valor === undefined) return null;
    const t = String(valor);
    if (t.length > 2000) throw new PatchNominaError('Observaciones demasiado largas.', 'VALOR_INVALIDO');
    return t;
  }

  if (tipo === 'flag') return valor === true || valor === 'true' || valor === 1;

  if (valor === null || valor === undefined || valor === '') {
    // `dias_ajuste_deducciones` es el único que distingue vacío de cero: null
    // significa «el ajuste completo», 0 significa «ningún día».
    return campo === 'dias_ajuste_deducciones' ? null : 0;
  }

  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new PatchNominaError(`«${valor}» no es un número.`, 'VALOR_INVALIDO');
  }

  if (tipo === 'dias') {
    if (n < 0 || n > 31) throw new PatchNominaError('Los días van de 0 a 31.', 'VALOR_INVALIDO');
    return Math.round(n);
  }
  if (tipo === 'entero') {
    if (n < 0) throw new PatchNominaError('No puede ser negativo.', 'VALOR_INVALIDO');
    return Math.round(n);
  }
  if (n < 0) throw new PatchNominaError('El importe no puede ser negativo.', 'VALOR_INVALIDO');
  return n;
}

export const NominaPatchService = {
  campoEsEditable(campo: string): boolean {
    return Object.prototype.hasOwnProperty.call(CAMPOS_EDITABLES, campo);
  },

  camposEditables(): string[] {
    return Object.keys(CAMPOS_EDITABLES);
  },

  /**
   * Aplica un cambio de celda y devuelve la fila recalculada.
   *
   * `baseVersion` es el CAS: si no coincide, otro usuario cambió la
   * liquidación mientras tanto y se lanza `ConflictoVersionNomina` con el
   * valor del servidor, para que el cliente repinte en vez de insistir.
   */
  async aplicar(params: {
    liquidacionId: string;
    campo: string;
    valor: unknown;
    baseVersion?: number | null;
    actorId?: string | null;
  }) {
    const { liquidacionId, campo, baseVersion, actorId } = params;

    if (!this.campoEsEditable(campo)) {
      throw new PatchNominaError(
        `El campo «${campo}» no se edita desde el canvas. Los recargos y las horas vienen de las planillas.`,
        'CAMPO_NO_EDITABLE',
      );
    }
    const valor = normalizar(campo, params.valor);

    const actual = await prisma.liquidaciones.findFirst({
      where: { deleted_at: null, id: liquidacionId },
      select: { id: true, version: true, estado_flujo: true, conductor_id: true },
    });
    if (!actual) throw new PatchNominaError('Liquidación no encontrada.', 'NO_ENCONTRADO');

    if (ESTADOS_BLOQUEADOS.includes(actual.estado_flujo)) {
      throw new PatchNominaError(
        `La liquidación está en ${actual.estado_flujo} y no se puede editar. Devuélvela a LIQUIDADA primero.`,
        'BLOQUEADA',
      );
    }

    const gano = await prisma.liquidaciones.updateMany({
      where: {
        id: liquidacionId,
        ...(baseVersion != null ? { version: baseVersion } : {}),
      },
      data: {
        [campo]: valor,
        actualizado_por_id: actorId ?? null,
        version: { increment: 1 },
        updated_at: new Date(),
      } as any,
    });

    if (gano.count === 0) {
      const server = await prisma.liquidaciones.findFirst({
        where: { deleted_at: null, id: liquidacionId },
        select: { version: true, estado_flujo: true, [campo]: true } as any,
      });
      throw new ConflictoVersionNomina(
        liquidacionId,
        server
          ? {
              version: (server as any).version,
              estado_flujo: (server as any).estado_flujo,
              valor: (server as any)[campo],
            }
          : null,
      );
    }

    return this.recalcularYGuardar(liquidacionId, actorId);
  },

  /**
   * Recalcula los totales de una liquidación y los persiste.
   *
   * Es lo que cierra el círculo: hasta ahora el backend guardaba los números
   * que le mandaba el navegador sin recalcular nada, así que un cliente
   * desactualizado podía dejar una liquidación descuadrada en la base.
   */
  async recalcularYGuardar(liquidacionId: string, actorId?: string | null) {
    const l = await prisma.liquidaciones.findFirst({
      where: { deleted_at: null, id: liquidacionId },
      include: {
        bonificaciones: { where: { deleted_at: null } },
        pernotes: { where: { deleted_at: null } },
        anticipos: { where: { deleted_at: null } },
        recargos: { where: { deleted_at: null } },
        conductores: { select: { id: true, salario_base: true } },
      },
    });
    if (!l) throw new PatchNominaError('Liquidación no encontrada.', 'NO_ENCONTRADO');

    const configs = await prisma.configuraciones_liquidacion.findMany({
      where: { activo: true, deleted_at: null },
      select: { nombre: true, valor: true },
    });
    const buscar = (nombre: string) =>
      dec(configs.find((c) => c.nombre.trim().toLowerCase() === nombre.toLowerCase())?.valor);

    const bonos = l.bonificaciones.map((b) => {
      let values: { quantity: number }[] = [];
      try {
        const parsed = JSON.parse(b.values ?? '[]');
        if (Array.isArray(parsed)) values = parsed.map((v: any) => ({ quantity: dec(v?.quantity) }));
      } catch {
        values = [];
      }
      return { values, value: dec(b.value) };
    });

    let conceptosAdicionales: { valor: number }[] = [];
    if (Array.isArray(l.conceptos_adicionales)) {
      conceptosAdicionales = (l.conceptos_adicionales as any[]).map((c) => ({ valor: dec(c?.valor) }));
    }

    const entrada: EntradaLiquidacion = {
      salarioBase: dec(l.conductores?.salario_base),
      diasLaborados: l.dias_laborados,
      diasLaboradosVillanueva: l.dias_laborados_villanueva,
      detallesVehiculos: [
        {
          bonos,
          pernotes: l.pernotes.map((p) => ({ cantidad: dec(p.cantidad), valor: dec(p.valor) })),
          recargos: l.recargos.map((r) => ({
            valor: dec(r.valor),
            empresa_id: r.empresa_id,
            es_automatico: r.es_automatico,
            es_override: r.es_override,
            origen_planilla_id: r.origen_planilla_id,
          })),
        },
      ],
      previewRecargosGrupos: [],
      anticipos: l.anticipos.map((a) => ({ valor: dec(a.valor) })),
      conceptosAdicionales,
      valorVacaciones: dec(l.total_vacaciones),
      vacacionesInicio: l.periodo_start_vacaciones,
      vacacionesFin: l.periodo_end_vacaciones,
      interesCesantias: dec(l.interes_cesantias),
      disponibilidad: dec(l.disponibilidad),
      descontarTransporte: dec(l.auxilio_transporte) === 0,
      aplicaAjusteVillanueva: dec(l.ajuste_salarial) > 0,
      ajusteVillanuevaPorDia: l.ajuste_salarial_por_dia,
      aplicaAjusteParex: dec(l.ajuste_parex) > 0,
      aplicaAjusteGeopark: dec((l as any).ajuste_geopark) > 0,
      ajusteRecargosCompletos: l.ajuste_parex_recargos_completos,
      aplicaIncapacidad: !!l.periodo_start_incapacidad,
      diasAjusteDeducciones: l.dias_ajuste_deducciones,
      noDescontarSalud: false,
      noDescontarPension: false,
      descontarSaludSalario: l.descontar_salud_salario,
      descontarPensionSalario: l.descontar_pension_salario,
    };

    const t = liquidarNomina(entrada, {
      auxilioTransporteMensual: buscar('Auxilio de transporte'),
      salarioVillanueva: buscar('Salario villanueva'),
      porcentajeSalud: buscar('Salud'),
      porcentajePension: buscar('Pensión'),
      empresaParexId: process.env.NOMINA_EMPRESA_PAREX_ID ?? null,
      empresaGeoparkId: process.env.NOMINA_EMPRESA_GEOPARK_ID ?? null,
      fraccionAjusteRecargos: Number(process.env.NOMINA_FRACCION_AJUSTE ?? 0.08),
    });

    const actualizada = await prisma.liquidaciones.update({
      where: { id: liquidacionId },
      data: {
        salario_devengado: t.salarioDevengado,
        auxilio_transporte: t.auxilioTransporte,
        total_bonificaciones: t.totalBonificaciones,
        total_pernotes: t.totalPernotes,
        total_recargos: t.totalRecargos,
        total_anticipos: t.totalAnticipos,
        salud: t.salud,
        pension: t.pension,
        sueldo_total: t.sueldoTotal,
        actualizado_por_id: actorId ?? null,
        updated_at: new Date(),
      },
      select: { id: true, version: true, estado_flujo: true, conductor_id: true },
    });

    return { ...actualizada, totales: t };
  },
};
