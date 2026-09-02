/**
 * La matriz de transiciones y los guards. Es la parte que se puede probar
 * sin base de datos, y es justo la que la barra del canvas consulta para
 * decidir qué botones pinta: si aquí y en el servidor no dicen lo mismo, el
 * usuario ve acciones que luego fallan.
 */
import { describe, it, expect } from 'vitest';
import {
  TRANSICIONES,
  ESTADOS_VALIDOS,
  ESTADOS_BLOQUEADOS,
  ESTADOS_QUE_EXIGEN_ADMIN,
  ESTADOS_QUE_EXIGEN_MOTIVO,
  transicionesPermitidas,
  esAdmin,
  type EstadoNomina,
} from '../../modules/nomina-canvas/nomina-estado.service';

const admin = { id: 'u1', areas: ['administracion'] };
const contable = { id: 'u2', areas: ['contabilidad'] };
const th = { id: 'u3', areas: ['talento_humano'] };

describe('esAdmin', () => {
  it('reconoce el área sin importar mayúsculas ni si viene suelta o en lista', () => {
    expect(esAdmin(admin)).toBe(true);
    expect(esAdmin({ id: 'x', areas: 'ADMINISTRACION' })).toBe(true);
    expect(esAdmin({ id: 'x', areas: ['operaciones', 'Administracion'] })).toBe(true);
  });

  it('no da por administrador a quien no lo es', () => {
    expect(esAdmin(contable)).toBe(false);
    expect(esAdmin({ id: 'x', areas: null })).toBe(false);
    expect(esAdmin(null)).toBe(false);
    expect(esAdmin(undefined)).toBe(false);
  });
});

describe('matriz de transiciones', () => {
  it('cubre todos los estados válidos', () => {
    for (const e of ESTADOS_VALIDOS) expect(TRANSICIONES[e]).toBeDefined();
  });

  it('solo apunta a estados válidos', () => {
    for (const destinos of Object.values(TRANSICIONES)) {
      for (const d of destinos) expect(ESTADOS_VALIDOS).toContain(d);
    }
  });

  it('ANULADA es terminal', () => {
    expect(TRANSICIONES.ANULADA).toEqual([]);
  });

  it('todo estado puede anularse menos el ya anulado', () => {
    for (const e of ESTADOS_VALIDOS) {
      if (e === 'ANULADA') continue;
      expect(TRANSICIONES[e]).toContain('ANULADA');
    }
  });

  it('se puede volver atrás desde LIQUIDADA y desde APROBADA', () => {
    expect(TRANSICIONES.LIQUIDADA).toContain('BORRADOR');
    expect(TRANSICIONES.APROBADA).toContain('LIQUIDADA');
  });

  it('todos los estados son alcanzables desde BORRADOR', () => {
    const vistos = new Set<string>(['BORRADOR']);
    const cola: string[] = ['BORRADOR'];
    while (cola.length) {
      for (const d of TRANSICIONES[cola.pop()!] ?? []) {
        if (!vistos.has(d)) {
          vistos.add(d);
          cola.push(d);
        }
      }
    }
    expect([...vistos].sort()).toEqual([...ESTADOS_VALIDOS].sort());
  });
});

describe('transicionesPermitidas — guard de ENTRADA', () => {
  it('quien no es admin no puede aprobar', () => {
    expect(transicionesPermitidas('LIQUIDADA', contable)).not.toContain('APROBADA');
    expect(transicionesPermitidas('LIQUIDADA', th)).not.toContain('APROBADA');
  });

  it('el admin sí', () => {
    expect(transicionesPermitidas('LIQUIDADA', admin)).toContain('APROBADA');
  });

  it('liquidar y devolver a borrador no exige ser admin', () => {
    expect(transicionesPermitidas('BORRADOR', contable)).toContain('LIQUIDADA');
    expect(transicionesPermitidas('LIQUIDADA', contable)).toContain('BORRADOR');
  });

  it('anular tampoco', () => {
    expect(transicionesPermitidas('BORRADOR', contable)).toContain('ANULADA');
  });
});

describe('transicionesPermitidas — guard de SALIDA', () => {
  it('desde un estado bloqueado, quien no es admin no puede hacer nada', () => {
    for (const e of ESTADOS_BLOQUEADOS) {
      expect(transicionesPermitidas(e, contable)).toEqual([]);
    }
  });

  it('el admin sí puede sacarla de APROBADA', () => {
    const permitidas = transicionesPermitidas('APROBADA', admin);
    expect(permitidas).toContain('LIQUIDADA');
    expect(permitidas).toContain('PAGADA');
  });

  it('de ANULADA no sale nadie, ni el admin', () => {
    expect(transicionesPermitidas('ANULADA', admin)).toEqual([]);
  });
});

describe('coherencia del vocabulario', () => {
  it('los estados que exigen admin y los bloqueados son estados válidos', () => {
    for (const e of ESTADOS_QUE_EXIGEN_ADMIN) expect(ESTADOS_VALIDOS).toContain(e);
    for (const e of ESTADOS_BLOQUEADOS) expect(ESTADOS_VALIDOS).toContain(e as EstadoNomina);
    for (const e of ESTADOS_QUE_EXIGEN_MOTIVO) expect(ESTADOS_VALIDOS).toContain(e);
  });

  it('entrar a un estado que exige admin implica que salir también', () => {
    // Si aprobar fuera cosa de admin pero desaprobar no, el guard no serviría
    // de nada: cualquiera podría bajarla y volver a subirla.
    for (const e of ESTADOS_QUE_EXIGEN_ADMIN) expect(ESTADOS_BLOQUEADOS).toContain(e);
  });

  it('un estado desconocido no ofrece ninguna transición', () => {
    expect(transicionesPermitidas('LO_QUE_SEA', admin)).toEqual([]);
  });
});
