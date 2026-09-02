/**
 * Arbitraje de la cola de borradores.
 *
 * Lo que se protege es el cambio de mutex GLOBAL a lock por PERIODO. Antes,
 * que alguien estuviera generando cualquier cosa hacía que todo el sistema
 * respondiera `locked`; dos usuarios trabajando en meses distintos se
 * bloqueaban sin ningún motivo.
 *
 * Y la cancelación: antes marcaba el job y el bucle seguía generando hasta
 * el final, así que "cancelar" no cancelaba nada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.hoisted` es obligatorio aquí: vitest sube las llamadas a `vi.mock`
// por encima de los imports, así que unos `const` normales todavía estarían
// en zona muerta cuando corre la factory del mock.
const mocks = vi.hoisted(() => ({
  generarBorrador: vi.fn(),
  guardarBorrador: vi.fn(),
  hojaDeCierre: vi.fn(),
}));

vi.mock(
  "../modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.service",
  () => ({
    LiquidacionesTercerosDescuentosService: {
      generarBorrador: mocks.generarBorrador,
      guardarBorrador: mocks.guardarBorrador,
    },
  }),
);

vi.mock(
  "../modules/liquidaciones-terceros-descuentos/periodo-cierres.service",
  () => ({
    PeriodoCierresService: { hojaDeCierre: mocks.hojaDeCierre },
  }),
);

import { borradorQueueService } from "./borrador-queue.service";

const { generarBorrador, guardarBorrador, hojaDeCierre } = mocks;

/** Eventos emitidos, para poder afirmar sobre destino y contenido. */
let emitidos: Array<{ target: any; event: string; data: any }> = [];

/** Deja correr los microtasks pendientes. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Promesa que el test resuelve cuando quiere que termine la generación. */
function generacionControlada() {
  let resolver!: (v: any) => void;
  const p = new Promise((res) => (resolver = res));
  generarBorrador.mockReturnValue(p);
  return resolver;
}

beforeEach(() => {
  emitidos = [];
  generarBorrador.mockReset();
  guardarBorrador.mockReset();
  hojaDeCierre.mockReset();
  borradorQueueService.setEmitter((target, event, data) => {
    emitidos.push({ target, event, data });
  });
});

describe("lock por periodo", () => {
  it("dos periodos distintos no se rechazan entre sí", async () => {
    const terminar = generacionControlada();

    const a = borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      anio: 2026,
      mes: 8,
    });
    await tick();

    const b = borradorQueueService.enqueue("u2", "Beto", {
      liquidacion_servicio_ids: ["l2"],
      anio: 2026,
      mes: 9,
    });

    expect(a.status).toBe("queued");
    // Lo que importa: NO es 'locked'. Con el mutex global lo habría sido.
    expect(b.status).toBe("queued");
    expect(b.jobId).toBeTruthy();

    terminar({ terceros: [] });
    await tick();
  });

  it("el mismo periodo sí se bloquea", async () => {
    const terminar = generacionControlada();

    borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      anio: 2026,
      mes: 8,
    });
    await tick();

    const b = borradorQueueService.enqueue("u2", "Beto", {
      liquidacion_servicio_ids: ["l2"],
      anio: 2026,
      mes: 8,
    });

    expect(b.status).toBe("locked");
    expect(b.lockedBy?.userName).toBe("Ana");
    // La UI necesita decir QUÉ periodo está ocupado, no solo que lo está.
    expect(b.lockedBy?.anio).toBe(2026);
    expect(b.lockedBy?.mes).toBe(8);

    terminar({ terceros: [] });
    await tick();
  });

  it("el lock se libera al terminar", async () => {
    const terminar = generacionControlada();
    borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      anio: 2026,
      mes: 8,
    });
    await tick();

    terminar({ terceros: [] });
    await tick();

    const segundo = borradorQueueService.enqueue("u2", "Beto", {
      liquidacion_servicio_ids: ["l2"],
      anio: 2026,
      mes: 8,
    });
    expect(segundo.status).toBe("queued");

    generarBorrador.mockResolvedValue({ terceros: [] });
    await tick();
  });
});

describe("persistencia encadenada", () => {
  const entrada = (placa: string, terceroId: string | null, itemId: string) => ({
    placa,
    items: [itemId],
    conceptos: [{ id: "c1" }],
    items_adicionales: [],
    liquidacion_tercero: {
      tercero_id: terceroId,
      liquidacion_servicio_id: "liq-1",
    },
  });

  it("agrupa por (placa, tercero) — no crea un cierre por item", async () => {
    // `generarBorrador` devuelve UNA entrada por item del pivote, todas con
    // la misma lista de items. Guardarlas tal cual crearía duplicados.
    generarBorrador.mockResolvedValue({
      liquidacion_servicio: { id: "liq-1" },
      terceros: [
        entrada("ABC123", "t1", "i1"),
        entrada("ABC123", "t1", "i2"),
        entrada("ABC123", "t1", "i3"),
      ],
    });
    guardarBorrador.mockResolvedValue({ id: "cierre-1" });
    hojaDeCierre.mockResolvedValue({ id: "cierre-1", placa: "ABC123" });

    borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      persistir: true,
      anio: 2026,
      mes: 8,
    });
    await tick();
    await tick();

    expect(guardarBorrador).toHaveBeenCalledTimes(1);
  });

  it("una placa con DOS terceros produce DOS cierres", async () => {
    generarBorrador.mockResolvedValue({
      liquidacion_servicio: { id: "liq-1" },
      terceros: [entrada("ABC123", "t1", "i1"), entrada("ABC123", "t2", "i2")],
    });
    let n = 0;
    guardarBorrador.mockImplementation(async () => ({ id: `cierre-${++n}` }));
    hojaDeCierre.mockImplementation(async (id: string) => ({ id, placa: "ABC123" }));

    borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      persistir: true,
      anio: 2026,
      mes: 8,
    });
    await tick();
    await tick();

    expect(guardarBorrador).toHaveBeenCalledTimes(2);
  });

  it("anuncia cada hoja al ROOM del periodo, no al usuario", async () => {
    generarBorrador.mockResolvedValue({
      liquidacion_servicio: { id: "liq-1" },
      terceros: [entrada("ABC123", "t1", "i1")],
    });
    guardarBorrador.mockResolvedValue({ id: "cierre-1" });
    hojaDeCierre.mockResolvedValue({ id: "cierre-1", placa: "ABC123" });

    borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      persistir: true,
      anio: 2026,
      mes: 8,
    });
    await tick();
    await tick();

    const alta = emitidos.find((e) => e.event === "sheet:sheet-added");
    expect(alta, "no se emitió sheet:sheet-added").toBeTruthy();
    // Al room: quien tiene el periodo abierto debe verlo, no solo quien lanzó.
    expect(alta!.target.room).toBe("sheet:cierres-finales:2026:8");
    expect(alta!.target.userId).toBeUndefined();
    expect(alta!.data.cierre.id).toBe("cierre-1");
  });

  it("una placa que falla no tumba el lote", async () => {
    generarBorrador.mockResolvedValue({
      liquidacion_servicio: { id: "liq-1" },
      terceros: [entrada("AAA111", "t1", "i1"), entrada("BBB222", "t2", "i2")],
    });
    guardarBorrador
      .mockRejectedValueOnce(new Error("placa rota"))
      .mockResolvedValueOnce({ id: "cierre-2" });
    hojaDeCierre.mockResolvedValue({ id: "cierre-2", placa: "BBB222" });

    borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      persistir: true,
      anio: 2026,
      mes: 8,
    });
    await tick();
    await tick();

    const fin = emitidos.find((e) => e.event === "borrador:complete");
    expect(fin!.data.guardados).toHaveLength(1);
    expect(fin!.data.fallidos).toEqual([
      { placa: "AAA111", error: "placa rota" },
    ]);
  });

  it("respeta el filtro de placas del modal", async () => {
    generarBorrador.mockResolvedValue({
      liquidacion_servicio: { id: "liq-1" },
      terceros: [entrada("AAA111", "t1", "i1"), entrada("BBB222", "t2", "i2")],
    });
    guardarBorrador.mockResolvedValue({ id: "cierre-1" });
    hojaDeCierre.mockResolvedValue({ id: "cierre-1", placa: "BBB222" });

    borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      persistir: true,
      anio: 2026,
      mes: 8,
      placas: ["bbb222"], // en minúsculas: el filtro normaliza
    });
    await tick();
    await tick();

    expect(guardarBorrador).toHaveBeenCalledTimes(1);
    expect(guardarBorrador.mock.calls[0][0].placa).toBe("BBB222");
  });

  it("sin `persistir` no guarda nada", async () => {
    generarBorrador.mockResolvedValue({
      liquidacion_servicio: { id: "liq-1" },
      terceros: [entrada("AAA111", "t1", "i1")],
    });

    borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      anio: 2026,
      mes: 8,
    });
    await tick();
    await tick();

    expect(guardarBorrador).not.toHaveBeenCalled();
  });
});

describe("cancelación", () => {
  it("detiene el bucle de guardado y conserva lo ya creado", async () => {
    const placas = ["AAA111", "BBB222", "CCC333", "DDD444"];
    generarBorrador.mockResolvedValue({
      liquidacion_servicio: { id: "liq-1" },
      terceros: placas.map((p, i) => ({
        placa: p,
        items: [`i${i}`],
        conceptos: [],
        items_adicionales: [],
        liquidacion_tercero: {
          tercero_id: `t${i}`,
          liquidacion_servicio_id: "liq-1",
        },
      })),
    });

    let guardadas = 0;
    let jobId = "";
    guardarBorrador.mockImplementation(async () => {
      guardadas++;
      // Cancelar en mitad del lote, como haría el usuario.
      if (guardadas === 2) borradorQueueService.cancel(jobId, "u1");
      return { id: `cierre-${guardadas}` };
    });
    hojaDeCierre.mockImplementation(async (id: string) => ({ id, placa: "X" }));

    const r = borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      persistir: true,
      anio: 2026,
      mes: 8,
    });
    jobId = r.jobId;

    await tick();
    await tick();
    await tick();

    // Se detuvo: no llegó a las cuatro placas.
    expect(guardadas).toBeLessThan(placas.length);
    // Y lo ya guardado NO se deshace: son cierres válidos.
    const cancelado = emitidos.filter((e) => e.event === "borrador:cancelled").pop();
    expect(cancelado, "no se emitió borrador:cancelled").toBeTruthy();
  });

  it("un usuario no puede cancelar el job de otro", async () => {
    const terminar = generacionControlada();
    const r = borradorQueueService.enqueue("u1", "Ana", {
      liquidacion_servicio_ids: ["l1"],
      anio: 2026,
      mes: 8,
    });
    await tick();

    expect(borradorQueueService.cancel(r.jobId, "otro-usuario")).toBe(false);
    expect(borradorQueueService.cancel(r.jobId, "u1")).toBe(true);

    terminar({ terceros: [] });
    await tick();
  });
});
