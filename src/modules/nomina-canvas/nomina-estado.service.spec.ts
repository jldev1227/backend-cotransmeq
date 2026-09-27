import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  createHistorial: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  prisma: {
    liquidaciones: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));

import { NominaEstadoService } from './nomina-estado.service';

const admin = { id: 'usuario-admin', areas: ['ADMINISTRACION'] };

describe('NominaEstadoService — visibilidad del desprendible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      id: 'liquidacion-1',
      estado_flujo: 'APROBADA',
      version: 3,
      conductor_id: 'conductor-1',
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.createHistorial.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        liquidaciones: {
          updateMany: mocks.updateMany,
          findUnique: mocks.findUnique,
        },
        historial_estado_liquidacion_nomina: { create: mocks.createHistorial },
      }),
    );
  });

  it('publica el desprendible en la misma transacción que marca PAGADA', async () => {
    await NominaEstadoService.cambiar({
      id: 'liquidacion-1',
      estado: 'PAGADA',
      base_version: 3,
      actor: admin,
    });

    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado_flujo: 'PAGADA',
          desprendible_visible: true,
        }),
      }),
    );
  });

  it('no pisa una decisión manual de visibilidad en otros cambios de estado', async () => {
    await NominaEstadoService.cambiar({
      id: 'liquidacion-1',
      estado: 'LIQUIDADA',
      base_version: 3,
      actor: admin,
    });

    const update = mocks.updateMany.mock.calls[0][0];
    expect(update.data.estado_flujo).toBe('LIQUIDADA');
    expect(update.data).not.toHaveProperty('desprendible_visible');
  });
});
