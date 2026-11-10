import { describe, expect, it } from 'vitest';
import { combinarOverridesDePlaca, diferencias } from '../src/modules/liquidaciones-terceros-ingresos/ingresos-snapshots.service';

describe('diff de snapshots de ingresos', () => {
  it('expone cambios de las dos hojas y conserva antes y después', () => {
    const cambios = diferencias(
      { estado: { cabecera: { total_ingreso_transmeralda: 100 } }, filas: [{ id: 'f1', ingreso_empresa: 100 }] },
      { estado: { cabecera: { total_ingreso_transmeralda: 120 } }, filas: [{ id: 'f1', ingreso_empresa: 120 }] },
    );
    expect(cambios).toContainEqual({ path: 'estado.cabecera.total_ingreso_transmeralda', anterior: 100, nuevo: 120 });
    expect(cambios).toContainEqual({ path: 'filas', anterior: [{ id: 'f1', ingreso_empresa: 100 }], nuevo: [{ id: 'f1', ingreso_empresa: 120 }] });
  });
});

describe('restauración de una placa en ingresos', () => {
	it('reemplaza solo sus overrides y conserva los de las demás placas', () => {
		const resultado = combinarOverridesDePlaca(
			[
				{ liquidacion_tercero_id: 'servicio-a', incluir_adicional: false },
				{ liquidacion_tercero_id: 'servicio-b', incluir_adicional: true },
				{ liquidacion_tercero_id: 'adicional-nuevo', incluir_adicional: true },
			],
			[
				{ liquidacion_tercero_id: 'servicio-a', incluir_adicional: true },
				{ liquidacion_tercero_id: 'servicio-viejo', incluir_adicional: true },
			],
			new Set(['servicio-a', 'servicio-viejo', 'adicional-nuevo']),
		);
		expect(resultado).toEqual([
			{ liquidacion_tercero_id: 'servicio-b', incluir_adicional: true },
			{ liquidacion_tercero_id: 'servicio-a', incluir_adicional: true },
			{ liquidacion_tercero_id: 'servicio-viejo', incluir_adicional: true },
		]);
	});
});
