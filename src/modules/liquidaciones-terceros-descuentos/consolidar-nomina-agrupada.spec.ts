import { describe, expect, it } from 'vitest';
import { planConsolidacionNomina } from './consolidar-nomina-agrupada';

const fila = (id: string, cierre: string, concepto: string, valor: number, dias: number | null = null) => ({
  id,
  liquidacion_tercero_final_id: cierre,
  tipo: 'COSTO_LABORAL',
  concepto,
  conductor_id: 'conductor-1',
  dias,
  valor_total: valor,
  valor_unitario: dias ? valor / dias : 0,
  porcentaje: concepto === 'CESANTIAS' ? 8.33 : null,
  base_calculo: concepto === 'CESANTIAS' ? 1100 : null,
  calculado: true,
});

describe('nómina al agrupar cierres finales', () => {
  it('cobra el salario una vez, suma bonos y recargos por placa y recalcula prestaciones', () => {
    const filas = [
      fila('salario-principal', 'principal', 'SALARIO', 1000, 10),
      fila('bono-principal', 'principal', 'BONIFICACION', 30, 1),
      fila('recargo-principal', 'principal', 'RECARGOS', 100, 1),
      fila('cesantias-principal', 'principal', 'CESANTIAS', 91.63),
      fila('salario-otro', 'otro', 'SALARIO', 1000, 10),
      fila('bono-otro', 'otro', 'BONIFICACION', 60, 2),
      fila('recargo-otro', 'otro', 'RECARGOS', 50, 1),
      fila('cesantias-otro', 'otro', 'CESANTIAS', 87.47),
    ];
    const plan = planConsolidacionNomina(filas, 'principal');
    expect(plan.archivar).toEqual(['salario-otro', 'bono-otro', 'recargo-otro', 'cesantias-otro']);
    expect(plan.actualizaciones.has('salario-principal')).toBe(false);
    expect(plan.actualizaciones.get('bono-principal')).toMatchObject({ dias: '3', valor_total: '90.00' });
    expect(plan.actualizaciones.get('recargo-principal')).toMatchObject({ dias: '2', valor_total: '150.00' });
    expect(plan.actualizaciones.get('cesantias-principal')).toMatchObject({
      base_calculo: '1150.00', valor_total: '95.80',
    });
  });

  it('conserva conceptos de conductores distintos y no reemplaza prestaciones manuales', () => {
    const manual = { ...fila('cesantias-principal', 'principal', 'CESANTIAS', 120), calculado: false };
    const otroConductor = { ...fila('salario-segundo', 'otro', 'SALARIO', 500, 5), conductor_id: 'conductor-2' };
    const plan = planConsolidacionNomina([
      fila('salario-principal', 'principal', 'SALARIO', 1000, 10),
      manual,
      fila('salario-otro', 'otro', 'SALARIO', 1000, 10),
      fila('cesantias-otro', 'otro', 'CESANTIAS', 90),
      otroConductor,
    ], 'principal');
    expect(plan.archivar).toEqual(['salario-otro', 'cesantias-otro']);
    expect(plan.actualizaciones.has('cesantias-principal')).toBe(false);
    expect(plan.archivar).not.toContain('salario-segundo');
  });
});
