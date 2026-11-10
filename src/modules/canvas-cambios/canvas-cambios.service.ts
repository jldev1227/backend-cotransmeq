import { randomUUID } from "crypto";
import { prisma } from "../../config/prisma";

export interface CambioCelda {
  scope: string;
  anio: number;
  mes: number;
  sheetKey: string | null;
  entityType: string;
  entityId: string;
  field: string;
  anterior: unknown;
  nuevo: unknown;
  usuarioId: string;
  usuarioNombre: string;
}

const MODELOS: Record<string, string> = {
  "adicionales:adicional": "liquidacion_tercero_final_adicional",
  "cierres-finales:concepto": "liquidacion_tercero_final_concepto",
  "cierres-finales:adicional": "liquidacion_tercero_final_adicional",
  "cierres-finales:item": "liquidacion_tercero_final_item",
  "nomina:liquidacion": "liquidaciones",
  "recorridos:segmento": "registro_dia_laboral_segmento",
  "recorridos:dia": "registro_dia_laboral",
};

/** Valor persistido de una columna directa; los campos compuestos no tienen un único valor SQL. */
export async function leerValorCelda(
  scope: string,
  tipo: string,
  id: string,
  field: string,
): Promise<unknown> {
  const nombre = MODELOS[`${scope}:${tipo}`];
  if (!nombre || field.includes("|") || field.includes(":")) return null;
  const modelo = (prisma as any)[nombre];
  if (!modelo) return null;
  const fila = await modelo.findUnique({ where: { id } });
  return fila && Object.prototype.hasOwnProperty.call(fila, field)
    ? fila[field]
    : null;
}

/** Identidad estable de hoja; el id interno de Univer cambia al reconstruir el libro. */
export async function hojaDeCambio(
  scope: string,
  tipo: string,
  id: string,
  respaldo: string | null,
): Promise<string | null> {
  if (scope === "nomina") {
    const fila = await prisma.liquidaciones.findUnique({
      where: { id },
      select: { conductor_id: true },
    });
    return fila?.conductor_id ?? respaldo;
  }
  if (scope === "recorridos" && tipo === "dia") {
    const fila = await prisma.registro_dia_laboral.findUnique({
      where: { id },
      select: { conductor_id: true },
    });
    return fila?.conductor_id ?? respaldo;
  }
  if (scope === "recorridos" && tipo === "segmento") {
    const fila = await prisma.registro_dia_laboral_segmento.findUnique({
      where: { id },
      select: { registro_dia: { select: { conductor_id: true } } },
    });
    return fila?.registro_dia?.conductor_id ?? respaldo;
  }
  if (scope === "adicionales" && tipo === "adicional") {
    const fila = await prisma.liquidacion_tercero_final_adicional.findUnique({
      where: { id },
      select: { placa: true },
    });
    return fila?.placa ?? respaldo;
  }
  return respaldo;
}

/** Se llama solo tras un patch confirmado; el error del historial no reintenta una edición ya aplicada. */
export async function registrarCambioCelda(cambio: CambioCelda): Promise<void> {
  try {
    const anterior = JSON.stringify(cambio.anterior ?? null);
    const nuevo = JSON.stringify(cambio.nuevo ?? null);
    await prisma.$executeRaw`
      INSERT INTO canvas_celda_cambio
        (id, scope, anio, mes, sheet_key, entity_type, entity_id, field,
         valor_anterior, valor_nuevo, usuario_id, usuario_nombre)
      VALUES (${randomUUID()}::uuid, ${cambio.scope}, ${cambio.anio}, ${cambio.mes},
        ${cambio.sheetKey}, ${cambio.entityType}, ${cambio.entityId}, ${cambio.field},
        ${anterior}::jsonb, ${nuevo}::jsonb, ${cambio.usuarioId}::uuid, ${cambio.usuarioNombre})
    `;
  } catch (error) {
    console.error(
      "[canvas-cambios] No se pudo registrar un patch confirmado",
      error,
    );
  }
}

export async function listarCambiosCelda(filtro: {
  scope: string;
  anio: number;
  mes: number;
  sheetKey?: string | null;
  limit?: number;
}) {
  const limite = Math.min(Math.max(filtro.limit ?? 100, 1), 500);
  return prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, scope, anio, mes, sheet_key, entity_type, entity_id, field,
           valor_anterior, valor_nuevo, usuario_id, usuario_nombre, created_at
    FROM canvas_celda_cambio
    WHERE scope = ${filtro.scope} AND anio = ${filtro.anio} AND mes = ${filtro.mes}
      AND (${filtro.sheetKey ?? null}::text IS NULL OR sheet_key = ${filtro.sheetKey ?? null})
    ORDER BY created_at DESC, id DESC
    LIMIT ${limite}
  `;
}
