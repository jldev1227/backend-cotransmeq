import { prisma } from '../../config/prisma';
import {
  VALORES_UNITARIOS_TERCERO_POR_DEFECTO,
  type ValoresUnitariosTercero,
} from './reglas-conceptos';

/** Tarifas base que afectan nuevas filas y recálculos de cierres de terceros. */
export type ConfigValoresTercero = ValoresUnitariosTercero;
export const CONFIG_VALORES_TERCERO_POR_DEFECTO = VALORES_UNITARIOS_TERCERO_POR_DEFECTO;

type Db = typeof prisma | any;
const CAMPOS = Object.keys(CONFIG_VALORES_TERCERO_POR_DEFECTO) as Array<keyof ConfigValoresTercero>;

function numero(valor: unknown, respaldo: number): number {
  if (valor == null) return respaldo;
  const n = Number(valor);
  return Number.isFinite(n) ? n : respaldo;
}

function serializar(fila: any): ConfigValoresTercero {
  return {
    valor_dia_conductor_nomina: numero(
      fila?.valor_dia_conductor_nomina,
      CONFIG_VALORES_TERCERO_POR_DEFECTO.valor_dia_conductor_nomina,
    ),
    valor_salario_manual: numero(
      fila?.valor_salario_manual,
      CONFIG_VALORES_TERCERO_POR_DEFECTO.valor_salario_manual,
    ),
    valor_auxilio_transporte_manual: numero(
      fila?.valor_auxilio_transporte_manual,
      CONFIG_VALORES_TERCERO_POR_DEFECTO.valor_auxilio_transporte_manual,
    ),
    valor_bonificacion_manual: numero(
      fila?.valor_bonificacion_manual,
      CONFIG_VALORES_TERCERO_POR_DEFECTO.valor_bonificacion_manual,
    ),
    valor_bonificacion_turno_doble_manual: numero(
      fila?.valor_bonificacion_turno_doble_manual,
      CONFIG_VALORES_TERCERO_POR_DEFECTO.valor_bonificacion_turno_doble_manual,
    ),
    valor_dotacion: numero(fila?.valor_dotacion, CONFIG_VALORES_TERCERO_POR_DEFECTO.valor_dotacion),
    valor_examen_medico: numero(
      fila?.valor_examen_medico,
      CONFIG_VALORES_TERCERO_POR_DEFECTO.valor_examen_medico,
    ),
  };
}

export const ConfigValoresTerceroService = {
  async obtener(db: Db = prisma): Promise<ConfigValoresTercero> {
    const fila = await db.configuracion_valores_tercero.findUnique({
      where: { id: 'global' },
    });
    return serializar(fila);
  },

  async guardar(
    valores: Partial<ConfigValoresTercero>,
    userId?: string,
  ): Promise<ConfigValoresTercero> {
    const actual = await this.obtener();
    const datos = Object.fromEntries(
      CAMPOS.map((campo) => {
        const recibido = valores[campo];
        const valor = recibido === undefined ? actual[campo] : Number(recibido);
        if (!Number.isFinite(valor) || valor < 0) {
          throw Object.assign(new Error(`«${campo}» debe ser un valor numérico mayor o igual a cero`), {
            statusCode: 400,
          });
        }
        return [campo, valor];
      }),
    ) as ConfigValoresTercero;

    const fila = await prisma.configuracion_valores_tercero.upsert({
      where: { id: 'global' },
      create: {
        id: 'global',
        ...datos,
        actualizado_por_id: userId ?? null,
      },
      update: {
        ...datos,
        actualizado_por_id: userId ?? null,
      },
    });
    return serializar(fila);
  },
};
