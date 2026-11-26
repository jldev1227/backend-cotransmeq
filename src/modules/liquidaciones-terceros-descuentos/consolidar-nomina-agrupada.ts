import { recalcularBasesPrestacionesSS } from './reglas-conceptos';

type FilaLaboral = {
  id: string;
  liquidacion_tercero_final_id: string;
  tipo: string;
  concepto: string;
  conductor_id: string | null;
  dias: unknown;
  valor_total: unknown;
  valor_unitario: unknown;
  porcentaje: unknown;
  base_calculo: unknown;
  calculado: boolean;
};

const CONCEPTOS_POR_PLACA = new Set(['BONIFICACION', 'BONIFICACION_TURNO_DOBLE', 'RECARGOS']);

function numero(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** La nómina salarial se comparte entre placas; bonos y recargos pertenecen a cada placa. */
export function planConsolidacionNomina(filas: FilaLaboral[], cierrePrincipalId: string) {
  const porClave = new Map<string, FilaLaboral[]>();
  for (const fila of filas) {
    if (fila.tipo !== 'COSTO_LABORAL' || !fila.conductor_id) continue;
    const clave = `${fila.conductor_id}:${fila.concepto}`;
    const grupo = porClave.get(clave) || [];
    grupo.push(fila);
    porClave.set(clave, grupo);
  }

  const archivar: string[] = [];
  const actualizaciones = new Map<string, Record<string, unknown>>();
  const vigentes: FilaLaboral[] = [];
  const conductoresCombinados = new Set<string>();
  for (const grupo of porClave.values()) {
    const principal = grupo.find((fila) => fila.liquidacion_tercero_final_id === cierrePrincipalId);
    const conservar = principal || grupo[0];
    vigentes.push(conservar);
    if (grupo.length < 2) continue;
    conductoresCombinados.add(conservar.conductor_id!);
    archivar.push(...grupo.filter((fila) => fila.id !== conservar.id).map((fila) => fila.id));

    if (CONCEPTOS_POR_PLACA.has(conservar.concepto)) {
      const dias = grupo.reduce((total, fila) => total + numero(fila.dias), 0);
      const valorTotal = grupo.reduce((total, fila) => total + numero(fila.valor_total), 0);
      const cantidad = dias || (valorTotal ? 1 : 0);
      const data = {
        dias: String(cantidad),
        valor_unitario: String(cantidad ? valorTotal / cantidad : numero(conservar.valor_unitario)),
        valor_total: valorTotal.toFixed(2),
        calculado: grupo.every((fila) => fila.calculado),
      };
      actualizaciones.set(conservar.id, data);
      Object.assign(conservar, data);
    }
  }

  const recalculadas = recalcularBasesPrestacionesSS(vigentes as any[]);
  for (const fila of recalculadas) {
    const original = vigentes.find((vigente) => vigente.id === fila.id)!;
    if (!conductoresCombinados.has(original.conductor_id!) || !original.calculado) continue;
    if (numero(fila.base_calculo) === numero(original.base_calculo) &&
        numero(fila.valor_total) === numero(original.valor_total)) continue;
    actualizaciones.set(fila.id, {
      ...actualizaciones.get(fila.id),
      base_calculo: numero(fila.base_calculo).toFixed(2),
      valor_total: numero(fila.valor_total).toFixed(2),
    });
  }
  return { archivar, actualizaciones };
}
