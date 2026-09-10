/**
 * Configuración de los gastos calculados de un PERIODO.
 *
 * Papelería y gastos diversos eran constantes de código iguales para todos los
 * meses. Son tarifas del negocio —el porcentaje de gastos diversos se negocia
 * periodo a periodo— así que se configuran por mes.
 *
 * La regla que gobierna todo este archivo: **un mes sin fila no es un error**.
 * Se cae a `CONFIG_GASTOS_FALLBACK`, que es exactamente lo que rigió hasta que
 * esta tabla existió, de modo que los meses que nadie configure siguen
 * liquidándose igual que siempre. Por eso la tabla nace vacía y no sembrada.
 *
 * La aritmética NO vive aquí: está en `reglas-conceptos.ts`, que es puro y se
 * puede probar sin base de datos. Esto solo lee y escribe filas.
 */

import { prisma } from '../../config/prisma';
import {
  CONFIG_GASTOS_FALLBACK,
  type ConfigGastosPeriodo,
} from './reglas-conceptos';

/** Cliente Prisma o transacción. */
type Db = typeof prisma | any;

export interface ConfigGastosPeriodoDetalle extends ConfigGastosPeriodo {
  anio: number;
  mes: number;
  /**
   * `false` cuando el periodo no tiene fila y se están devolviendo los valores
   * de respaldo. El modal lo usa para avisar de que aún no se ha configurado
   * nada, en vez de enseñar los números como si alguien los hubiera revisado.
   */
  configurado: boolean;
  actualizado_por_id?: string | null;
  updated_at?: Date | null;
}

function num(v: any, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const ConfigGastosPeriodoService = {
  /**
   * La config vigente de un periodo, siempre resuelta.
   *
   * Nunca devuelve null: quien calcula necesita números, no un `if`. Si el mes
   * no tiene fila devuelve el fallback con `configurado: false`.
   */
  async obtener(
    anio: number,
    mes: number,
    db: Db = prisma,
  ): Promise<ConfigGastosPeriodoDetalle> {
    const fila = await db.configuracion_gastos_periodo.findFirst({
      where: { anio: Number(anio), mes: Number(mes), deleted_at: null },
    });

    if (!fila) {
      return {
        anio: Number(anio),
        mes: Number(mes),
        configurado: false,
        ...CONFIG_GASTOS_FALLBACK,
      };
    }

    // Campo a campo con su respaldo: una columna que llegue nula por un
    // backfill a medias no debe tumbar el cálculo de todo un cierre.
    return {
      anio: fila.anio,
      mes: fila.mes,
      configurado: true,
      pct_gastos_diversos: num(
        fila.pct_gastos_diversos,
        CONFIG_GASTOS_FALLBACK.pct_gastos_diversos,
      ),
      fijo_gastos_diversos: num(
        fila.fijo_gastos_diversos,
        CONFIG_GASTOS_FALLBACK.fijo_gastos_diversos,
      ),
      papeleria_alta: num(fila.papeleria_alta, CONFIG_GASTOS_FALLBACK.papeleria_alta),
      papeleria_baja: num(fila.papeleria_baja, CONFIG_GASTOS_FALLBACK.papeleria_baja),
      papeleria_umbral: num(
        fila.papeleria_umbral,
        CONFIG_GASTOS_FALLBACK.papeleria_umbral,
      ),
      actualizado_por_id: fila.actualizado_por_id,
      updated_at: fila.updated_at,
    };
  },

  /**
   * Crea o actualiza la config del periodo.
   *
   * Upsert sobre `(anio, mes)`, que es único en la tabla: dos personas
   * guardando el mismo mes a la vez no crean dos filas.
   *
   * NO recalcula ningún cierre ya generado. Es deliberado: un cierre liquidado
   * con la tarifa de julio tiene que seguir diciendo lo que se pagó, y
   * reescribir importes de cierres cerrados por cambiar una config sería
   * rehacer contabilidad pasada sin que nadie lo pida. La config manda sobre
   * lo que se genere DESPUÉS, y sobre lo que se recalcule explícitamente.
   */
  async guardar(
    anio: number,
    mes: number,
    valores: Partial<ConfigGastosPeriodo>,
    userId?: string,
  ): Promise<ConfigGastosPeriodoDetalle> {
    const a = Number(anio);
    const m = Number(mes);
    if (!Number.isInteger(a) || a < 2000 || a > 2100) {
      throw Object.assign(new Error('Año inválido'), { statusCode: 400 });
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      throw Object.assign(new Error('Mes inválido (1-12)'), { statusCode: 400 });
    }

    // Partimos de lo vigente para que un PUT parcial no borre los campos que
    // no vienen: el modal manda el formulario entero, pero la API no debería
    // depender de eso.
    const actual = await this.obtener(a, m);
    const datos = {
      pct_gastos_diversos: num(valores.pct_gastos_diversos, actual.pct_gastos_diversos),
      fijo_gastos_diversos: num(valores.fijo_gastos_diversos, actual.fijo_gastos_diversos),
      papeleria_alta: num(valores.papeleria_alta, actual.papeleria_alta),
      papeleria_baja: num(valores.papeleria_baja, actual.papeleria_baja),
      papeleria_umbral: num(valores.papeleria_umbral, actual.papeleria_umbral),
    };

    for (const [campo, valor] of Object.entries(datos)) {
      if (valor < 0) {
        throw Object.assign(new Error(`«${campo}» no puede ser negativo`), {
          statusCode: 400,
        });
      }
    }
    if (datos.pct_gastos_diversos > 100) {
      throw Object.assign(
        new Error('El porcentaje de gastos diversos va en puntos porcentuales (0,4 es 0,4%)'),
        { statusCode: 400 },
      );
    }

    await prisma.configuracion_gastos_periodo.upsert({
      where: { anio_mes: { anio: a, mes: m } },
      create: {
        anio: a,
        mes: m,
        ...datos,
        actualizado_por_id: userId ?? null,
      },
      update: {
        ...datos,
        actualizado_por_id: userId ?? null,
        // Un periodo que se había retirado y se vuelve a guardar revive: es lo
        // que espera quien pulsa Guardar.
        deleted_at: null,
      },
    });

    return this.obtener(a, m);
  },
};
