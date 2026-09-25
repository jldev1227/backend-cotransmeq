/**
 * Edición celda a celda del canvas de nómina, con compare-and-swap.
 *
 * Solo se tocan los campos que una persona teclea en el desprendible. Todo lo
 * demás —los recargos, las horas, el reparto entre desprendible y
 * disponibilidad— es DERIVADO de las planillas y no se edita aquí: si la
 * cifra de recargos está mal, lo que hay que corregir es la planilla, no el
 * desprendible. Por eso hay lista blanca y no una lista negra.
 *
 * La excepción es el IMPORTE de disponibilidad, que sí se teclea: no se deriva
 * de nada. El reparto por días de standby reparte HORAS, y esas horas valen
 * cero siempre porque un día de disponibilidad no genera recargos.
 *
 * Después de cada cambio se recalculan los totales con `liquidarNomina()` y se
 * persisten, para que la fila de la base y lo que enseña el canvas no puedan
 * separarse.
 */
import { randomUUID } from 'crypto';
import { prisma } from '../../config/prisma';
import { liquidarNomina, type EntradaLiquidacion } from '../../lib/nomina/liquidar';
import { ESTADOS_BLOQUEADOS } from './nomina-estado.service';

/**
 * Campos editables y cómo se validan.
 *
 * `dias` son enteros de 0 a 31; `moneda` son importes no negativos; `flag` son
 * booleanos. Los importes se guardan como número, nunca como texto — una celda
 * de texto no suma ni ordena, y acaba llegando como NaN a la base.
 */
const CAMPOS_EDITABLES: Record<string, 'dias' | 'moneda' | 'flag' | 'entero' | 'fecha'> = {
  /// Las dos fechas de vacaciones y el salario con el que se liquidan. Los
  /// DÍAS no están aquí a propósito: salen de restar las fechas y guardarlos
  /// permitiría dejar un número que contradiga a sus propias fechas.
  periodo_start_vacaciones: 'fecha',
  periodo_end_vacaciones: 'fecha',
  salario_vacaciones: 'moneda',
  dias_laborados: 'dias',
  dias_laborados_villanueva: 'dias',
  dias_laborados_anual: 'entero',
  dias_ajuste_deducciones: 'entero',
  total_vacaciones: 'moneda',
  interes_cesantias: 'moneda',
  /// Lo que se imputa a disponibilidad. NO es dinero nuevo: se descuenta de la
  /// bolsa de OTROS, igual que en el desprendible. Por eso no mueve el neto.
  disponibilidad: 'moneda',
  valor_incapacidad: 'moneda',
  cesantias: 'moneda',
  ajuste_salarial: 'moneda',
  /// Básico del desprendible. Lo que se divide entre 30 por los días. NO es
  /// el valor hora de los recargos, que sale de la config de la empresa.
  salario_basico: 'moneda',
  observaciones: 'flag', // texto libre; se valida aparte
  descontar_salud_salario: 'flag',
  descontar_pension_salario: 'flag',
  ajuste_parex_recargos_completos: 'flag',
  ajuste_salarial_por_dia: 'flag',
  mostrar_recargos: 'flag',
  desprendible_visible: 'flag',
};

/**
 * Prefijo de los campos que NO son una columna de `liquidaciones` sino una
 * celda de la matriz de bonos: `bono|<vehiculo_id>|<YYYY-MM>|<nombre>`.
 *
 * Viaja como un `field` más para no tener que cambiar el protocolo del canvas:
 * el binding, el índice inverso que repinta lo que edita otro usuario y el
 * compare-and-swap funcionan igual con una cadena estructurada que con el
 * nombre de una columna.
 *
 * El nombre del bono va AL FINAL porque es lo único que puede contener
 * cualquier cosa; los tres primeros campos se parten y el resto se re-une.
 */
const PREFIJO_BONO = 'bono|';

interface CampoBono {
  vehiculoId: string;
  mes: string;
  nombre: string;
}

function parsearCampoBono(campo: string): CampoBono | null {
  if (!campo.startsWith(PREFIJO_BONO)) return null;
  const partes = campo.slice(PREFIJO_BONO.length).split('|');
  if (partes.length < 3) return null;
  const [vehiculoId, mes, ...resto] = partes;
  const nombre = resto.join('|').trim();
  if (!vehiculoId || !/^\d{4}-\d{2}$/.test(mes) || !nombre) return null;
  return { vehiculoId, mes, nombre };
}

/**
 * Prefijo de las celdas de HORAS de la tabla de recargos:
 * `horas|<tramo>|<codigo>`.
 *
 * `tramo` es el índice del tramo de vigencia dentro del corte, porque un mismo
 * código puede tener dos filas con tarifas distintas cuando el corte cruza un
 * cambio de ley.
 */
const PREFIJO_HORAS = 'horas|';

const CODIGOS_VALIDOS = new Set(['RN', 'HEN', 'HED', 'HEFD', 'HEFN', 'RD', 'RNDF']);

function parsearCampoHoras(campo: string): { tramo: number; codigo: string } | null {
  if (!campo.startsWith(PREFIJO_HORAS)) return null;
  const [tramoStr, codigo] = campo.slice(PREFIJO_HORAS.length).split('|');
  const tramo = Number(tramoStr);
  if (!Number.isInteger(tramo) || tramo < 0 || !CODIGOS_VALIDOS.has(codigo)) return null;
  return { tramo, codigo };
}

/**
 * Prefijo de las celdas de la REJILLA DE DÍAS:
 * `dia|<YYYY-MM-DD>|<ocurrencia>|<codigo>`.
 *
 * Se direcciona por fecha y ocurrencia, no por columna: la rejilla del libro es
 * global y se corre en cuanto otro conductor abre una columna nueva, así que un
 * índice viajando en el campo apuntaría al día equivocado.
 */
const PREFIJO_DIA = 'dia|';

function parsearCampoDia(
  campo: string,
): { fecha: string; ocurrencia: number; codigo: string } | null {
  if (!campo.startsWith(PREFIJO_DIA)) return null;
  const [fecha, ocuStr, codigo] = campo.slice(PREFIJO_DIA.length).split('|');
  const ocurrencia = Number(ocuStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) return null;
  if (!Number.isInteger(ocurrencia) || ocurrencia < 0) return null;
  if (!CODIGOS_VALIDOS.has(codigo)) return null;
  return { fecha, ocurrencia, codigo };
}

/**
 * Prefijo de los CONCEPTOS ADICIONALES: `adicional|<nombre>`.
 *
 * No son una columna de `liquidaciones` sino un elemento del Json
 * `conceptos_adicionales`, que el formulario guarda como
 * `{ valor, observaciones }`. `observaciones` es el rótulo.
 *
 * SE DIRECCIONA POR NOMBRE Y NO POR ÍNDICE. El índice se corre en cuanto se
 * borra uno de en medio, y el índice viaja también en el binding inverso del
 * canvas —el que decide qué celda repinta el cambio de otro usuario—, así que
 * bastaría con que alguien eliminara el primer concepto para que el siguiente
 * patch escribiera en la fila equivocada. El nombre es lo que la persona lee
 * en la celda.
 *
 * La comparación es laxa (sin espacios sobrantes y sin distinguir mayúsculas)
 * porque el canvas PINTA el rótulo en mayúsculas y es de ahí de donde sale el
 * campo al editar la celda, mientras que en la base está tal cual se tecleó.
 */
const PREFIJO_ADICIONAL = 'adicional|';

const normalizarNombre = (v: unknown): string => String(v ?? '').trim().toLowerCase();

function parsearCampoAdicional(campo: string): { nombre: string } | null {
  if (!campo.startsWith(PREFIJO_ADICIONAL)) return null;
  // El nombre es libre y puede traer `|`, así que se toma TODO el resto.
  const nombre = campo.slice(PREFIJO_ADICIONAL.length).trim();
  if (!nombre) return null;
  return { nombre };
}

export class PatchNominaError extends Error {
  constructor(
    message: string,
    readonly code: 'CAMPO_NO_EDITABLE' | 'VALOR_INVALIDO' | 'NO_ENCONTRADO' | 'BLOQUEADA',
  ) {
    super(message);
  }
}

/** Error de concurrencia optimista, para que el gateway devuelva `conflict`. */
export class ConflictoVersionNomina extends Error {
  readonly code = 'VERSION_CONFLICT';
  constructor(
    readonly entityId: string,
    readonly serverRow: { version: number; estado_flujo: string; valor: unknown } | null,
  ) {
    super('La liquidación fue modificada por otro usuario');
  }
}

const dec = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function normalizar(campo: string, valor: unknown): number | boolean | string | null {
  const tipo = CAMPOS_EDITABLES[campo];

  if (campo === 'observaciones') {
    if (valor === null || valor === undefined) return null;
    const t = String(valor);
    if (t.length > 2000) throw new PatchNominaError('Observaciones demasiado largas.', 'VALOR_INVALIDO');
    return t;
  }

  if (tipo === 'flag') return valor === true || valor === 'true' || valor === 1;

  if (tipo === 'fecha') {
    /**
     * Una celda vacía BORRA la fecha, que es como se quitan unas vacaciones
     * mal puestas sin tener que adivinar un valor neutro.
     *
     * Se guarda como texto `YYYY-MM-DD` porque las columnas de periodo de
     * `liquidaciones` son `VarChar` —las teclea una persona en el formulario—
     * y meter un `Date` ahí dejaría una cadena con hora y zona que después no
     * casa con las comparaciones de cadena que usa el resto del módulo.
     */
    const texto = String(valor ?? '').trim();
    if (!texto) return null;
    const iso = texto.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) {
      throw new PatchNominaError('La fecha tiene que ir como AAAA-MM-DD.', 'VALOR_INVALIDO');
    }
    return iso;
  }


  if (valor === null || valor === undefined || valor === '') {
    // `dias_ajuste_deducciones` es el único que distingue vacío de cero: null
    // significa «el ajuste completo», 0 significa «ningún día».
    return campo === 'dias_ajuste_deducciones' ? null : 0;
  }

  const n = Number(valor);
  if (!Number.isFinite(n)) {
    throw new PatchNominaError(`«${valor}» no es un número.`, 'VALOR_INVALIDO');
  }

  if (tipo === 'dias') {
    if (n < 0 || n > 31) throw new PatchNominaError('Los días van de 0 a 31.', 'VALOR_INVALIDO');
    return Math.round(n);
  }
  if (tipo === 'entero') {
    if (n < 0) throw new PatchNominaError('No puede ser negativo.', 'VALOR_INVALIDO');
    return Math.round(n);
  }
  if (n < 0) throw new PatchNominaError('El importe no puede ser negativo.', 'VALOR_INVALIDO');
  return n;
}

export const NominaPatchService = {
  campoEsEditable(campo: string): boolean {
    if (parsearCampoBono(campo)) return true;
    if (parsearCampoHoras(campo)) return true;
    if (parsearCampoDia(campo)) return true;
    if (parsearCampoAdicional(campo)) return true;
    return Object.prototype.hasOwnProperty.call(CAMPOS_EDITABLES, campo);
  },

  camposEditables(): string[] {
    return Object.keys(CAMPOS_EDITABLES);
  },

  /**
   * Aplica un cambio de celda y devuelve la fila recalculada.
   *
   * `baseVersion` es el CAS: si no coincide, otro usuario cambió la
   * liquidación mientras tanto y se lanza `ConflictoVersionNomina` con el
   * valor del servidor, para que el cliente repinte en vez de insistir.
   */
  async aplicar(params: {
    liquidacionId: string;
    campo: string;
    valor: unknown;
    baseVersion?: number | null;
    actorId?: string | null;
  }) {
    const { liquidacionId, campo, baseVersion, actorId } = params;

    // La matriz de bonos no son columnas de `liquidaciones` sino filas de
    // `bonificaciones`, así que tiene su propia rama.
    const campoBono = parsearCampoBono(campo);
    if (campoBono) {
      return this.aplicarBono({
        liquidacionId,
        ...campoBono,
        cantidad: params.valor,
        baseVersion,
        actorId,
      });
    }

    // Los conceptos adicionales son un Json de la propia liquidación, pero
    // con alta y baja: no se puede resolver con un `data: { [campo]: valor }`.
    const campoAdicional = parsearCampoAdicional(campo);
    if (campoAdicional) {
      return this.aplicarAdicional({
        liquidacionId,
        nombre: campoAdicional.nombre,
        valor: params.valor,
        baseVersion,
        actorId,
      });
    }

    // La rejilla de días vive en la COPIA de la liquidación.
    const campoDia = parsearCampoDia(campo);
    if (campoDia) {
      return this.aplicarDia({
        liquidacionId,
        ...campoDia,
        horas: params.valor,
        baseVersion,
        actorId,
      });
    }

    // Las horas de recargo no son columnas de `liquidaciones` sino filas de
    // `ajustes_horas_recargo`, que conviven con lo que dice la planilla.
    const campoHoras = parsearCampoHoras(campo);
    if (campoHoras) {
      return this.aplicarHoras({
        liquidacionId,
        ...campoHoras,
        horas: params.valor,
        baseVersion,
        actorId,
      });
    }

    if (!this.campoEsEditable(campo)) {
      throw new PatchNominaError(
        `El campo «${campo}» no se edita desde el canvas. Los días y las horas vienen de las planillas.`,
        'CAMPO_NO_EDITABLE',
      );
    }
    const valor = normalizar(campo, params.valor);

    const actual = await prisma.liquidaciones.findFirst({
      where: { id: liquidacionId, deleted_at: null },
      select: { id: true, version: true, estado_flujo: true, conductor_id: true },
    });
    if (!actual) throw new PatchNominaError('Liquidación no encontrada.', 'NO_ENCONTRADO');

    if (ESTADOS_BLOQUEADOS.includes(actual.estado_flujo)) {
      throw new PatchNominaError(
        `La liquidación está en ${actual.estado_flujo} y no se puede editar. Devuélvela a LIQUIDADA primero.`,
        'BLOQUEADA',
      );
    }

    const gano = await prisma.liquidaciones.updateMany({
      where: {
        id: liquidacionId,
        ...(baseVersion != null ? { version: baseVersion } : {}),
      },
      data: {
        [campo]: valor,
        actualizado_por_id: actorId ?? null,
        version: { increment: 1 },
        updated_at: new Date(),
      } as any,
    });

    if (gano.count === 0) {
      const server = await prisma.liquidaciones.findFirst({
        where: { id: liquidacionId, deleted_at: null },
        select: { version: true, estado_flujo: true, [campo]: true } as any,
      });
      throw new ConflictoVersionNomina(
        liquidacionId,
        server
          ? {
              version: (server as any).version,
              estado_flujo: (server as any).estado_flujo,
              valor: (server as any)[campo],
            }
          : null,
      );
    }

    return this.recalcularYGuardar(liquidacionId, actorId);
  },

  /**
   * Escribe una celda de la matriz de bonos.
   *
   * La cantidad de UN mes, no el total: la celda es (bono × vehículo × mes) y
   * los demás meses de `values` se conservan tal cual. Poner 0 no borra la
   * fila — un bono a cero es información («este vehículo no generó ninguno»),
   * y borrarlo lo haría desaparecer de la tabla en vez de enseñar el cero.
   *
   * El compare-and-swap sigue siendo sobre `liquidaciones.version` aunque lo
   * que cambie sea una fila hija: la versión es del documento entero, que es
   * lo que el canvas tiene en pantalla.
   */
  async aplicarBono(params: {
    liquidacionId: string;
    vehiculoId: string;
    mes: string;
    nombre: string;
    cantidad: unknown;
    baseVersion?: number | null;
    actorId?: string | null;
  }) {
    const { liquidacionId, vehiculoId, mes, nombre, baseVersion, actorId } = params;

    const n = Number(params.cantidad ?? 0);
    if (!Number.isFinite(n)) {
      throw new PatchNominaError('La cantidad tiene que ser un número.', 'VALOR_INVALIDO');
    }
    if (n < 0) throw new PatchNominaError('La cantidad no puede ser negativa.', 'VALOR_INVALIDO');
    /// Entero: un bono se otorga o no, no hay medios bonos. Y el tope evita que
    /// un dedazo («310» por «31») pase como cantidad de un mes.
    const cantidad = Math.round(n);
    if (cantidad > 62) {
      throw new PatchNominaError(
        'Son demasiados bonos para un mes. Revisa la cantidad.',
        'VALOR_INVALIDO',
      );
    }

    const actual = await prisma.liquidaciones.findFirst({
      where: { id: liquidacionId, deleted_at: null },
      select: { id: true, version: true, estado_flujo: true, periodo_start: true },
    });
    if (!actual) throw new PatchNominaError('Liquidación no encontrada.', 'NO_ENCONTRADO');

    if (ESTADOS_BLOQUEADOS.includes(actual.estado_flujo)) {
      throw new PatchNominaError(
        `La liquidación está en ${actual.estado_flujo} y no se puede editar. Devuélvela a LIQUIDADA primero.`,
        'BLOQUEADA',
      );
    }

    // El CAS va primero y por sí solo: si no gana, no se toca ninguna fila
    // hija. Al revés —escribir el bono y después comprobar la versión— dejaría
    // el cambio aplicado tras un conflicto.
    const gano = await prisma.liquidaciones.updateMany({
      where: {
        id: liquidacionId,
        ...(baseVersion != null ? { version: baseVersion } : {}),
      },
      data: {
        actualizado_por_id: actorId ?? null,
        version: { increment: 1 },
        updated_at: new Date(),
      } as any,
    });

    if (gano.count === 0) {
      const server = await prisma.liquidaciones.findFirst({
        where: { id: liquidacionId, deleted_at: null },
        select: { version: true, estado_flujo: true },
      });
      throw new ConflictoVersionNomina(
        liquidacionId,
        server
          ? { version: server.version, estado_flujo: server.estado_flujo, valor: cantidad }
          : null,
      );
    }

    const existente = await prisma.bonificaciones.findFirst({
      where: { liquidacion_id: liquidacionId, vehiculo_id: vehiculoId, name: nombre, deleted_at: null },
    });

    /** `values` con el mes pedido puesto y los demás intactos. */
    const mezclar = (crudo: unknown): string => {
      let lista: { mes: string; quantity: number }[] = [];
      try {
        const parsed = JSON.parse(String(crudo ?? '[]'));
        if (Array.isArray(parsed)) {
          lista = parsed
            .filter((v: any) => typeof v?.mes === 'string')
            .map((v: any) => ({ mes: String(v.mes), quantity: Number(v.quantity) || 0 }));
        }
      } catch {
        /* un `values` corrupto se reemplaza en vez de tumbar la edición */
      }
      const i = lista.findIndex((v) => v.mes === mes);
      if (i >= 0) lista[i].quantity = cantidad;
      else lista.push({ mes, quantity: cantidad });
      lista.sort((a, b) => a.mes.localeCompare(b.mes));
      return JSON.stringify(lista);
    };

    if (existente) {
      await prisma.bonificaciones.update({
        where: { id: existente.id },
        data: { values: mezclar(existente.values), updated_at: new Date() },
      });
    } else {
      /// Precio unitario de una fila nueva. Se prefiere el de OTRO vehículo del
      /// mismo bono en esta liquidación —es el que ya se está pagando— y solo
      /// si no hay ninguno se baja a la configuración del año. Al revés, una
      /// liquidación vieja empezaría a mezclar el precio de este año con el del
      /// suyo en la misma tabla.
      const hermano = await prisma.bonificaciones.findFirst({
        where: { liquidacion_id: liquidacionId, name: nombre, deleted_at: null },
        select: { value: true },
      });
      let valor = hermano ? Number(hermano.value) : 0;
      if (!hermano) {
        const anio = Number(String(actual.periodo_start ?? '').slice(0, 4)) || new Date().getFullYear();
        const cfg = await prisma.configuraciones_liquidacion.findFirst({
          where: { nombre, activo: true, deleted_at: null, OR: [{ anio }, { anio: null }] },
          orderBy: { anio: 'desc' },
          select: { valor: true },
        });
        valor = cfg ? Number(cfg.valor) : 0;
      }

      await prisma.bonificaciones.create({
        data: {
          id: randomUUID(),
          liquidacion_id: liquidacionId,
          vehiculo_id: vehiculoId,
          name: nombre,
          value: valor,
          values: mezclar('[]'),
          creado_por_id: actorId ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    return this.recalcularYGuardar(liquidacionId, actorId);
  },

  /**
   * Da de alta, cambia o quita un CONCEPTO ADICIONAL.
   *
   * Son el cajón de lo pactado a mano: el `BONO ADICIONAL - NO SALARIAL`, un
   * pernocte de un mes anterior que se paga tarde, el `AJUSTE A NETO PACTADO`.
   * Suman al bruto y NO entran al IBC, que es el trato que les daban las hojas
   * de Excel.
   *
   * Tres operaciones en un solo campo, según el valor:
   *   número  → lo pone (si el nombre no existe, lo crea)
   *   `null`  → lo quita
   *
   * EL IMPORTE PUEDE SER NEGATIVO. Es lo que el formulario rotula
   * «+Devengo / −Deducción»: un concepto en negativo resta del devengado. Por
   * eso esta rama no pasa por `normalizar()`, que rechaza los negativos.
   *
   * Una celda VACÍA no borra: manda 0 —igual que en los bonos, donde un cero
   * es información— y quitarlo es una acción explícita del modal. Si vaciar
   * la celda borrara la fila, un `Supr` de más haría desaparecer el rótulo y
   * con él el motivo de lo que se pagó.
   *
   * El compare-and-swap va DENTRO del mismo `updateMany` que escribe el Json:
   * aquí el dato vive en la propia fila de `liquidaciones`, así que leer la
   * lista y escribirla en dos pasos dejaría una ventana en la que dos altas
   * simultáneas se pisarían. Con la versión en el `where`, la segunda no
   * encuentra fila y sale por conflicto.
   */
  async aplicarAdicional(params: {
    liquidacionId: string;
    nombre: string;
    valor: unknown;
    baseVersion?: number | null;
    actorId?: string | null;
  }) {
    const { liquidacionId, nombre, baseVersion, actorId } = params;

    if (nombre.length > 200) {
      throw new PatchNominaError('El nombre del concepto es demasiado largo.', 'VALOR_INVALIDO');
    }

    const borrar = params.valor === null;
    let valor = 0;
    if (!borrar) {
      const crudo = params.valor;
      const vacia = crudo === undefined || String(crudo).trim() === '';
      const n = vacia ? 0 : Number(crudo);
      if (!Number.isFinite(n)) {
        throw new PatchNominaError(`«${crudo}» no es un número.`, 'VALOR_INVALIDO');
      }
      valor = Math.round(n * 100) / 100;
    }

    const actual = await prisma.liquidaciones.findFirst({
      where: { id: liquidacionId, deleted_at: null },
      select: { id: true, version: true, estado_flujo: true, conceptos_adicionales: true },
    });
    if (!actual) throw new PatchNominaError('Liquidación no encontrada.', 'NO_ENCONTRADO');

    if (ESTADOS_BLOQUEADOS.includes(actual.estado_flujo)) {
      throw new PatchNominaError(
        `La liquidación está en ${actual.estado_flujo} y no se puede editar. Devuélvela a LIQUIDADA primero.`,
        'BLOQUEADA',
      );
    }

    /// Se conserva TODO lo que traiga cada elemento y solo se toca `valor`:
    /// el Json es libre y una fila vieja puede llevar campos que aquí no se
    /// conocen. Reescribirla entera los perdería.
    const lista: any[] = Array.isArray(actual.conceptos_adicionales)
      ? (actual.conceptos_adicionales as any[]).filter((c) => c && typeof c === 'object')
      : [];
    const objetivo = normalizarNombre(nombre);
    const i = lista.findIndex(
      (c) => normalizarNombre(c?.observaciones ?? c?.nombre) === objetivo,
    );

    let siguiente: any[];
    if (borrar) {
      if (i < 0) {
        throw new PatchNominaError(
          `No hay ningún concepto «${nombre}» en esta liquidación.`,
          'NO_ENCONTRADO',
        );
      }
      siguiente = lista.filter((_, j) => j !== i);
    } else if (i >= 0) {
      siguiente = lista.map((c, j) => (j === i ? { ...c, valor } : c));
    } else {
      siguiente = [...lista, { valor, observaciones: nombre }];
    }

    const gano = await prisma.liquidaciones.updateMany({
      where: {
        id: liquidacionId,
        ...(baseVersion != null ? { version: baseVersion } : {}),
      },
      data: {
        conceptos_adicionales: siguiente,
        actualizado_por_id: actorId ?? null,
        version: { increment: 1 },
        updated_at: new Date(),
      } as any,
    });

    if (gano.count === 0) {
      const server = await prisma.liquidaciones.findFirst({
        where: { id: liquidacionId, deleted_at: null },
        select: { version: true, estado_flujo: true, conceptos_adicionales: true },
      });
      throw new ConflictoVersionNomina(
        liquidacionId,
        server
          ? {
              version: server.version,
              estado_flujo: server.estado_flujo,
              valor: server.conceptos_adicionales,
            }
          : null,
      );
    }

    return this.recalcularYGuardar(liquidacionId, actorId);
  },

  /**
   * Corrige a mano las horas de un recargo, o deshace la corrección.
   *
   * Una celda VACÍA borra el ajuste y devuelve las horas de la planilla. Es lo
   * que hace reversible la corrección sin tener que recordar el valor
   * original: el dato de origen nunca se tocó.
   *
   * El ajuste se guarda con soft-delete y por eso el índice único es parcial:
   * ajustar, deshacer y volver a ajustar tiene que poder repetirse.
   */
  async aplicarHoras(params: {
    liquidacionId: string;
    tramo: number;
    codigo: string;
    horas: unknown;
    baseVersion?: number | null;
    actorId?: string | null;
  }) {
    const { liquidacionId, tramo, codigo, baseVersion, actorId } = params;

    const crudo = params.horas;
    const vacia = crudo === null || crudo === undefined || String(crudo).trim() === '';

    let horas = 0;
    if (!vacia) {
      const n = Number(crudo);
      if (!Number.isFinite(n)) {
        throw new PatchNominaError('Las horas tienen que ser un número.', 'VALOR_INVALIDO');
      }
      if (n < 0) throw new PatchNominaError('Las horas no pueden ser negativas.', 'VALOR_INVALIDO');
      /// 744 es un mes de 31 días seguidos sin dormir: por encima de eso es un
      /// dedazo, no una corrección.
      if (n > 744) {
        throw new PatchNominaError('Son demasiadas horas. Revisa la cifra.', 'VALOR_INVALIDO');
      }
      horas = Math.round(n * 100) / 100;
    }

    const actual = await prisma.liquidaciones.findFirst({
      where: { id: liquidacionId, deleted_at: null },
      select: { id: true, version: true, estado_flujo: true },
    });
    if (!actual) throw new PatchNominaError('Liquidación no encontrada.', 'NO_ENCONTRADO');

    if (ESTADOS_BLOQUEADOS.includes(actual.estado_flujo)) {
      throw new PatchNominaError(
        `La liquidación está en ${actual.estado_flujo} y no se puede editar. Devuélvela a LIQUIDADA primero.`,
        'BLOQUEADA',
      );
    }

    // El CAS va primero y por sí solo, igual que en los bonos: si no gana, no
    // se toca ninguna fila hija.
    const gano = await prisma.liquidaciones.updateMany({
      where: {
        id: liquidacionId,
        ...(baseVersion != null ? { version: baseVersion } : {}),
      },
      data: {
        actualizado_por_id: actorId ?? null,
        version: { increment: 1 },
        updated_at: new Date(),
      } as any,
    });

    if (gano.count === 0) {
      const server = await prisma.liquidaciones.findFirst({
        where: { id: liquidacionId, deleted_at: null },
        select: { version: true, estado_flujo: true },
      });
      throw new ConflictoVersionNomina(
        liquidacionId,
        server
          ? { version: server.version, estado_flujo: server.estado_flujo, valor: vacia ? null : horas }
          : null,
      );
    }

    const vivo = await prisma.ajustes_horas_recargo.findFirst({
      where: { liquidacion_id: liquidacionId, codigo, tramo, deleted_at: null },
      select: { id: true },
    });

    if (vacia) {
      if (vivo) {
        await prisma.ajustes_horas_recargo.update({
          where: { id: vivo.id },
          data: { deleted_at: new Date(), updated_at: new Date() },
        });
      }
    } else if (vivo) {
      await prisma.ajustes_horas_recargo.update({
        where: { id: vivo.id },
        data: { horas, creado_por_id: actorId ?? null, updated_at: new Date() },
      });
    } else {
      await prisma.ajustes_horas_recargo.create({
        data: {
          id: randomUUID(),
          liquidacion_id: liquidacionId,
          codigo,
          tramo,
          horas,
          creado_por_id: actorId ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    return this.recalcularYGuardar(liquidacionId, actorId);
  },

  /**
   * Escribe las horas de UN código en UN día de la copia.
   *
   * Solo toca ese código: los demás del mismo día se conservan, porque el
   * `horas` de la fila es un objeto y la celda que se edita es una de sus
   * claves. Una celda vacía pone ese código a cero, que es como se quita.
   *
   * `total_horas` NO se recalcula a partir de los recargos: son cosas
   * distintas —las horas trabajadas del día frente a cuántas se pagan con
   * recargo— y derivar una de otra haría que corregir un recargo moviera la
   * jornada.
   */
  async aplicarDia(params: {
    liquidacionId: string;
    fecha: string;
    ocurrencia: number;
    codigo: string;
    horas: unknown;
    baseVersion?: number | null;
    actorId?: string | null;
  }) {
    const { liquidacionId, fecha, ocurrencia, codigo, baseVersion, actorId } = params;

    const crudo = params.horas;
    const vacia = crudo === null || crudo === undefined || String(crudo).trim() === '';
    let horas = 0;
    if (!vacia) {
      const n = Number(crudo);
      if (!Number.isFinite(n)) {
        throw new PatchNominaError('Las horas tienen que ser un número.', 'VALOR_INVALIDO');
      }
      if (n < 0) throw new PatchNominaError('Las horas no pueden ser negativas.', 'VALOR_INVALIDO');
      /// Un día tiene 24 horas; por encima es un dedazo.
      if (n > 24) {
        throw new PatchNominaError('Un día no tiene más de 24 horas.', 'VALOR_INVALIDO');
      }
      horas = Math.round(n * 100) / 100;
    }

    const actual = await prisma.liquidaciones.findFirst({
      where: { id: liquidacionId, deleted_at: null },
      select: { id: true, version: true, estado_flujo: true },
    });
    if (!actual) throw new PatchNominaError('Liquidación no encontrada.', 'NO_ENCONTRADO');

    if (ESTADOS_BLOQUEADOS.includes(actual.estado_flujo)) {
      throw new PatchNominaError(
        `La liquidación está en ${actual.estado_flujo} y no se puede editar. Devuélvela a LIQUIDADA primero.`,
        'BLOQUEADA',
      );
    }

    // CAS primero y por sí solo, igual que en bonos y horas.
    const gano = await prisma.liquidaciones.updateMany({
      where: {
        id: liquidacionId,
        ...(baseVersion != null ? { version: baseVersion } : {}),
      },
      data: {
        actualizado_por_id: actorId ?? null,
        version: { increment: 1 },
        updated_at: new Date(),
      } as any,
    });

    if (gano.count === 0) {
      const server = await prisma.liquidaciones.findFirst({
        where: { id: liquidacionId, deleted_at: null },
        select: { version: true, estado_flujo: true },
      });
      throw new ConflictoVersionNomina(
        liquidacionId,
        server ? { version: server.version, estado_flujo: server.estado_flujo, valor: horas } : null,
      );
    }

    const dia = await prisma.liquidaciones_dias.findFirst({
      where: {
        liquidacion_id: liquidacionId,
        fecha: new Date(`${fecha}T00:00:00.000Z`),
        ocurrencia,
        deleted_at: null,
      },
    });
    if (!dia) {
      throw new PatchNominaError(
        'Ese día no está en el borrador. Pulsa «Actualizar días» para traerlo de las planillas.',
        'NO_ENCONTRADO',
      );
    }

    const actualesHoras = (dia.horas ?? {}) as Record<string, number>;
    await prisma.liquidaciones_dias.update({
      where: { id: dia.id },
      data: { horas: { ...actualesHoras, [codigo]: horas }, updated_at: new Date() },
    });

    return this.recalcularYGuardar(liquidacionId, actorId);
  },

  /**
   * Recalcula los totales de una liquidación y los persiste.
   *
   * Es lo que cierra el círculo: hasta ahora el backend guardaba los números
   * que le mandaba el navegador sin recalcular nada, así que un cliente
   * desactualizado podía dejar una liquidación descuadrada en la base.
   */
  async recalcularYGuardar(liquidacionId: string, actorId?: string | null) {
    const l = await prisma.liquidaciones.findFirst({
      where: { id: liquidacionId, deleted_at: null },
      include: {
        bonificaciones: { where: { deleted_at: null } },
        pernotes: { where: { deleted_at: null } },
        anticipos: { where: { deleted_at: null } },
        recargos: { where: { deleted_at: null } },
        conductores: { select: { id: true, salario_base: true } },
      },
    });
    if (!l) throw new PatchNominaError('Liquidación no encontrada.', 'NO_ENCONTRADO');

    const configs = await prisma.configuraciones_liquidacion.findMany({
      where: { activo: true, deleted_at: null },
      select: { nombre: true, valor: true },
    });
    const buscar = (nombre: string) =>
      dec(configs.find((c) => c.nombre.trim().toLowerCase() === nombre.toLowerCase())?.valor);

    const bonos = l.bonificaciones.map((b) => {
      let values: { quantity: number }[] = [];
      try {
        const parsed = JSON.parse(b.values ?? '[]');
        if (Array.isArray(parsed)) values = parsed.map((v: any) => ({ quantity: dec(v?.quantity) }));
      } catch {
        values = [];
      }
      return { values, value: dec(b.value) };
    });

    let conceptosAdicionales: { valor: number }[] = [];
    if (Array.isArray(l.conceptos_adicionales)) {
      conceptosAdicionales = (l.conceptos_adicionales as any[]).map((c) => ({ valor: dec(c?.valor) }));
    }

    const entrada: EntradaLiquidacion = {
      /// Igual que en el canvas: manda el básico de la liquidación, y el del
      /// conductor solo mientras aquel esté en null. Si esto leyera solo la
      /// ficha, editar el básico guardaría el número pero recalcularía con el
      /// viejo, y la hoja enseñaría dos cifras que no cuadran entre sí.
      salarioBase:
        l.salario_basico != null ? dec(l.salario_basico) : dec(l.conductores?.salario_base),
      diasLaborados: l.dias_laborados,
      diasLaboradosVillanueva: l.dias_laborados_villanueva,
      detallesVehiculos: [
        {
          bonos,
          pernotes: l.pernotes.map((p) => ({ cantidad: dec(p.cantidad), valor: dec(p.valor) })),
          /**
           * TODOS los recargos guardados cuentan, también los automáticos.
           *
           * `liquidarNomina()` suma por un lado los recargos MANUALES
           * (`!es_automatico`) y por otro el preview de planillas, porque en
           * el formulario de la liquidación los automáticos llegan en el
           * preview y sumarlos dos veces los duplicaría. Aquí no hay preview:
           * lo único que existe son las filas ya persistidas en `recargos`,
           * que es de donde los lee también el desprendible.
           *
           * Mientras viajaron con `es_automatico: true`, el recálculo los
           * descartaba y dejaba `total_recargos` en CERO: editar una celda
           * cualquiera —unas vacaciones, un anticipo— borraba 1.463.258 de
           * recargos de la liquidación de JONATHAN y le recortaba el neto en
           * esa misma cifra. 44 liquidaciones de esta base tenían recargos
           * automáticos expuestos a eso.
           *
           * `es_override` y `origen_planilla_id` solo sirven para decidir qué
           * grupos del preview quedan sobrescritos, así que sin preview no
           * cambian nada y se dejan de mandar.
           */
          recargos: l.recargos
            .filter((r) => r.incluir !== false)
            .map((r) => ({
              valor: dec(r.valor),
              empresa_id: r.empresa_id,
              es_automatico: false,
            })),
        },
      ],
      previewRecargosGrupos: [],
      anticipos: l.anticipos.map((a) => ({ valor: dec(a.valor) })),
      conceptosAdicionales,
      valorVacaciones: dec(l.total_vacaciones),
      vacacionesInicio: l.periodo_start_vacaciones,
      vacacionesFin: l.periodo_end_vacaciones,
      interesCesantias: dec(l.interes_cesantias),
      disponibilidad: dec(l.disponibilidad),
      descontarTransporte: dec(l.auxilio_transporte) === 0,
      aplicaAjusteVillanueva: dec(l.ajuste_salarial) > 0,
      ajusteVillanuevaPorDia: l.ajuste_salarial_por_dia,
      aplicaAjusteParex: dec(l.ajuste_parex) > 0,
      aplicaAjusteGeopark: dec((l as any).ajuste_geopark) > 0,
      ajusteRecargosCompletos: l.ajuste_parex_recargos_completos,
      aplicaIncapacidad: !!l.periodo_start_incapacidad,
      diasAjusteDeducciones: l.dias_ajuste_deducciones,
      noDescontarSalud: false,
      noDescontarPension: false,
      descontarSaludSalario: l.descontar_salud_salario,
      descontarPensionSalario: l.descontar_pension_salario,
    };

    const t = liquidarNomina(entrada, {
      auxilioTransporteMensual: buscar('Auxilio de transporte'),
      salarioVillanueva: buscar('Salario villanueva'),
      porcentajeSalud: buscar('Salud'),
      porcentajePension: buscar('Pensión'),
      empresaParexId: process.env.NOMINA_EMPRESA_PAREX_ID ?? null,
      empresaGeoparkId: process.env.NOMINA_EMPRESA_GEOPARK_ID ?? null,
      fraccionAjusteRecargos: Number(process.env.NOMINA_FRACCION_AJUSTE ?? 0.08),
    });

    const actualizada = await prisma.liquidaciones.update({
      where: { id: liquidacionId },
      data: {
        salario_devengado: t.salarioDevengado,
        auxilio_transporte: t.auxilioTransporte,
        total_bonificaciones: t.totalBonificaciones,
        total_pernotes: t.totalPernotes,
        total_recargos: t.totalRecargos,
        total_anticipos: t.totalAnticipos,
        salud: t.salud,
        pension: t.pension,
        sueldo_total: t.sueldoTotal,
        actualizado_por_id: actorId ?? null,
        updated_at: new Date(),
      },
      select: { id: true, version: true, estado_flujo: true, conductor_id: true },
    });

    return { ...actualizada, totales: t };
  },
};
