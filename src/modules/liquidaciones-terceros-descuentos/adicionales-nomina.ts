import { CONCEPTOS_CONDUCTOR_FIJOS } from "./reglas-conceptos";

/** Los adicionales pertenecen al mes en que termina la hoja de nómina. */
export function adicionalesDelMes(
  liquidaciones: Array<{
    conductor_id: string | null;
    periodo_end: string;
    conceptos_adicionales: unknown;
  }>,
  anio: number,
  mes: number,
) {
  const prefijo = `${anio}-${String(mes).padStart(2, "0")}-`;
  const acumulados = new Map<
    string,
    { conductor_id: string; concepto: string; valor: number }
  >();
  for (const liquidacion of liquidaciones) {
    if (
      !liquidacion.conductor_id ||
      !liquidacion.periodo_end.startsWith(prefijo)
    )
      continue;
    if (!Array.isArray(liquidacion.conceptos_adicionales)) continue;
    for (const raw of liquidacion.conceptos_adicionales) {
      if (!raw || typeof raw !== "object") continue;
      const dato = raw as Record<string, unknown>;
      const nombre = String(dato.observaciones ?? dato.nombre ?? "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_")
        .slice(0, 100);
      /// Un adicional llamado SALARIO debe seguir siendo una fila libre,
      /// editable y descartable, sin reemplazar la fila estándar.
      const concepto = CONCEPTOS_CONDUCTOR_FIJOS.has(nombre)
        ? `ADICIONAL_NOMINA_${nombre}`.slice(0, 100)
        : nombre;
      const valor = Number(dato.valor);
      if (!concepto || !Number.isFinite(valor)) continue;
      const clave = `${liquidacion.conductor_id}|${concepto}`;
      const anterior = acumulados.get(clave);
      acumulados.set(clave, {
        conductor_id: liquidacion.conductor_id,
        concepto,
        valor: Math.round(((anterior?.valor ?? 0) + valor) * 100) / 100,
      });
    }
  }
  return [...acumulados.values()];
}

/** El descarte pertenece al cierre, no modifica la nómina de origen. */
export function adicionalesNoDescartados<
  T extends { conductor_id: string; concepto: string },
>(
  adicionales: T[],
  bajas: Array<{ conductor_id: string | null; concepto: string }>,
): T[] {
  const descartados = new Set(
    bajas.map((baja) => `${baja.conductor_id}|${baja.concepto}`),
  );
  return adicionales.filter(
    (adicional) =>
      !descartados.has(`${adicional.conductor_id}|${adicional.concepto}`),
  );
}
