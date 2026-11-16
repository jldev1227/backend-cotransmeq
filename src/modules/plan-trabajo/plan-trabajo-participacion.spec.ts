import { describe, expect, it } from "vitest";
import { cortesDeParticipacion } from "./plan-trabajo-participacion.service";
import { reglaDeRecordatorio } from "./plan-trabajo.service";

describe("cuota individual del plan", () => {
  it("reparte cuatro cortes dentro de una sola ocurrencia mensual", () => {
    const cortes = cortesDeParticipacion(new Date("2026-11-30T00:00:00Z"), 4);
    expect(cortes.map((fecha) => fecha.toISOString().slice(0, 10)))
      .toEqual(["2026-11-08", "2026-11-15", "2026-11-23", "2026-11-30"]);
  });

  it("reparte tres inspecciones entre la asignación y el cierre del mes", () => {
    const cortes = cortesDeParticipacion(
      new Date("2026-11-30T00:00:00Z"), 3, new Date("2026-11-16T11:00:00Z")
    );
    expect(cortes.map((fecha) => fecha.toISOString().slice(0, 10)))
      .toEqual(["2026-11-20", "2026-11-25", "2026-11-30"]);
  });

  it("avisa antes, en el corte y a los tres días hábiles de atraso", () => {
    const corte = new Date("2026-11-30T00:00:00Z");
    const activado = new Date("2026-11-01T00:00:00Z");
    expect(reglaDeRecordatorio(corte, new Date("2026-11-23T00:00:00Z"), activado)).toBe("ANTES_7");
    expect(reglaDeRecordatorio(corte, new Date("2026-11-29T00:00:00Z"), activado)).toBe("ANTES_1");
    expect(reglaDeRecordatorio(corte, corte, activado)).toBe("VENCE_HOY");
    expect(reglaDeRecordatorio(corte, new Date("2026-12-03T00:00:00Z"), activado)).toBe("ATRASO_2026-12-03");
  });
});
