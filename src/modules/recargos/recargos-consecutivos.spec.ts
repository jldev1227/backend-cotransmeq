import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../config/prisma";
import { liberarNumeroPlanilla, reservarNumeroPlanilla } from "./recargos-planilla-consecutivos";

describe("reserva concurrente de consecutivos de planilla", () => {
  const prefijoPrueba = `Q${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;

  afterAll(async () => {
    // La suite usa una base desechable de test; no se toca ninguna planilla.
    await prisma.recargos_planillas_reservas.deleteMany({ where: { prefijo: prefijoPrueba } });
  });

  it("asigna un consecutivo distinto a cada formulario simultáneo", async () => {
    const cantidad = 32;
    const numeros = await Promise.all(
      Array.from({ length: cantidad }, () => reservarNumeroPlanilla(prefijoPrueba)),
    );

    const valoresNumericos = numeros.map((numero) => Number(numero.slice(prefijoPrueba.length + 1)));
    expect(new Set(numeros).size).toBe(cantidad);
    expect(valoresNumericos.sort((a, b) => a - b)).toEqual(
      Array.from({ length: cantidad }, (_, indice) => indice + 1),
    );
  }, 30_000);

  it("revalida la reserva propia sin crear cinco ocupaciones falsas", async () => {
    const reserva = randomUUID();
    const usuario = randomUUID();
    const inicial = await reservarNumeroPlanilla(prefijoPrueba, reserva, usuario);
    const repetidos = await Promise.all(
      Array.from({ length: 5 }, () => reservarNumeroPlanilla(prefijoPrueba, reserva, usuario)),
    );
    expect(repetidos).toEqual(Array(5).fill(inicial));

    const otro = await reservarNumeroPlanilla(prefijoPrueba, randomUUID(), usuario);
    expect(Number(otro.split("-")[1])).toBe(Number(inicial.split("-")[1]) + 1);
    await expect(reservarNumeroPlanilla(prefijoPrueba, reserva, randomUUID())).rejects.toThrow(
      "no pertenece a este formulario",
    );
    await liberarNumeroPlanilla(reserva, usuario);
    const reutilizado = await reservarNumeroPlanilla(prefijoPrueba, randomUUID(), usuario);
    expect(reutilizado).toBe(inicial);
  }, 30_000);

  it("al regenerar toma un hueco anterior y deja libre su número previo", async () => {
    const prefijo = `Q${randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
    const reservaA = randomUUID();
    const reservaB = randomUUID();
    const usuarioA = randomUUID();
    const usuarioB = randomUUID();

    try {
      const primero = await reservarNumeroPlanilla(prefijo, reservaA, usuarioA);
      const segundo = await reservarNumeroPlanilla(prefijo, reservaB, usuarioB);
      expect(Number(segundo.split("-")[1])).toBe(Number(primero.split("-")[1]) + 1);

      await liberarNumeroPlanilla(reservaA, usuarioA);
      expect(await reservarNumeroPlanilla(prefijo, reservaB, usuarioB)).toBe(primero);
      expect(await reservarNumeroPlanilla(prefijo, reservaB, usuarioB)).toBe(primero);
      expect(await reservarNumeroPlanilla(prefijo, reservaA, usuarioA)).toBe(segundo);
    } finally {
      await prisma.recargos_planillas_reservas.deleteMany({ where: { prefijo } });
    }
  }, 30_000);
});
