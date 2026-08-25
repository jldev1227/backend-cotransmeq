/**
 * Normalización de los tres campos ENUM de `conductores`.
 *
 * Postgres es estricto con las etiquetas de un enum, y las tres de
 * `conductores` no siguen la misma convención:
 *
 *   · `estado`       MINÚSCULA, sin `@map`  → el cliente escribe `activo`
 *   · `sede_trabajo` sin `@map`, y con las seis variantes (`Yopal` Y `YOPAL`)
 *   · `tipo_sangre`  CON `@map`             → el cliente escribe `O_POSITIVO`
 *                                             y Prisma guarda `O+`
 *
 * Esa última distinción es la que confunde: mirar la base y ver `O+` invita a
 * mandar `O+`, y el que hay que mandar es el nombre del miembro. Por eso los
 * valores canónicos de aquí son los del CLIENTE de Prisma, no las etiquetas
 * de Postgres.
 *
 * El dashboard trabaja con un vocabulario propio —`ACTIVO`, `INCAPACITADO`— y
 * lo traduce al LEER pero no al ESCRIBIR, así que cada alta y cada edición
 * terminaban en un 500 con el volcado de Prisma dentro:
 *
 *     Invalid value for argument `estado`. Expected enum_conductores_estado.
 *
 * Solo `estado` estaba roto —`tipo_sangre` y `sede_trabajo` coincidían por
 * casualidad con lo que manda el front—, pero la coincidencia no es un
 * contrato: normalizar los tres es lo que evita que el próximo cambio de
 * etiqueta en cualquiera de ellos vuelva a caer en el mismo 500.
 *
 * La traducción vive AQUÍ, en el borde del módulo, y no en cada pantalla:
 * escriben conductores el formulario de alta, el de edición, el cambio rápido
 * de estado y los filtros del listado, y arreglarlos de uno en uno garantiza
 * que el próximo llamador —la app de conductores, una carga masiva— vuelva a
 * romperlo. También significa que el front puede seguir hablando su
 * vocabulario sin que la base se entere.
 *
 * LO DESCONOCIDO NO SE DESCARTA EN SILENCIO. Un `estado` que no se reconoce es
 * un dato que alguien creyó guardar: se lanza un error que dice qué valores
 * existen, que es lo que el volcado de Prisma nunca dijo.
 */

/// `enum_conductores_estado`, en el orden en que están declaradas en la base.
export const ESTADOS_CONDUCTOR = [
  "activo",
  "inactivo",
  "suspendido",
  "retirado",
  "disponible",
  "programado",
  "servicio",
  "descanso",
  "vacaciones",
  "incapacidad",
  "desvinculado",
] as const;
export type EstadoConductor = (typeof ESTADOS_CONDUCTOR)[number];

/**
 * `tipo_sangre_enum`, con los nombres del CLIENTE de Prisma.
 *
 * En Postgres las etiquetas son `A+`, `A-`… pero el enum va `@map`-eado
 * porque `A+` no es un identificador válido en TypeScript. Lo que se le pasa
 * a `prisma.conductores.create()` es `A_POSITIVO`; la traducción a `A+` la
 * hace Prisma.
 */
export const TIPOS_SANGRE = [
  "A_POSITIVO",
  "A_NEGATIVO",
  "B_POSITIVO",
  "B_NEGATIVO",
  "AB_POSITIVO",
  "AB_NEGATIVO",
  "O_POSITIVO",
  "O_NEGATIVO",
] as const;
export type TipoSangre = (typeof TIPOS_SANGRE)[number];

/**
 * `enum_conductores_sede_trabajo`.
 *
 * El enum tiene las seis variantes: `Yopal` Y `YOPAL`, y así con las tres
 * sedes — restos de una migración a medias. NINGUNA fila usa la capitalizada,
 * y los filtros del listado mandan mayúscula, así que esa es la forma canónica
 * y la otra solo se acepta de entrada. Escribir las dos partiría el filtrado
 * en dos mitades que no se ven entre sí.
 */
export const SEDES_TRABAJO = ["YOPAL", "VILLANUEVA", "TAURAMENA"] as const;
export type SedeTrabajo = (typeof SEDES_TRABAJO)[number];

/**
 * Error de valor fuera del enum.
 *
 * Lleva `code` en vez de confiar en el texto: los controladores deciden el 400
 * mirando el código, y encadenar `message.includes(...)` es lo que hace que un
 * día un mensaje reescrito devuelva 500 sin que nadie se dé cuenta.
 */
export class ValorEnumInvalidoError extends Error {
  readonly code = "ENUM_CONDUCTOR_INVALIDO";
  constructor(
    readonly campo: string,
    readonly valor: string,
    readonly permitidos: readonly string[],
  ) {
    super(
      `"${valor}" no es un valor válido para ${campo}. Valores permitidos: ${permitidos.join(", ")}.`,
    );
  }
}

/// Sinónimos de `estado` que NO se resuelven pasando a minúsculas.
const SINONIMOS_ESTADO: Record<string, EstadoConductor> = {
  incapacitado: "incapacidad",
  en_servicio: "servicio",
  en_descanso: "descanso",
  en_vacaciones: "vacaciones",
  de_vacaciones: "vacaciones",
};

function aClave(valor: string): string {
  return valor.trim().replace(/\s+/g, "_");
}

export function normalizarEstado(valor: unknown): EstadoConductor | null {
  if (valor == null || valor === "") return null;
  const bruto = aClave(String(valor)).toLowerCase();
  const canonico = SINONIMOS_ESTADO[bruto] ?? bruto;
  if ((ESTADOS_CONDUCTOR as readonly string[]).includes(canonico)) {
    return canonico as EstadoConductor;
  }
  throw new ValorEnumInvalidoError("estado", String(valor), ESTADOS_CONDUCTOR);
}

/**
 * `O+`, `o +`, `O_POSITIVO` → `O_POSITIVO`.
 *
 * La forma con símbolo se acepta porque es la que se ve al mirar la base y la
 * que devuelve cualquier export en SQL crudo; mandarla a Prisma tal cual falla
 * igual que mandarle `ACTIVO`, y el mensaje sería igual de opaco.
 */
export function normalizarTipoSangre(valor: unknown): TipoSangre | null {
  if (valor == null || valor === "") return null;
  const bruto = aClave(String(valor)).toUpperCase().replace(/_/g, "");
  const partes = /^(AB|A|B|O)(\+|-|POSITIVO|NEGATIVO)$/.exec(bruto);
  const canonico = partes
    ? `${partes[1]}_${partes[2] === "+" || partes[2] === "POSITIVO" ? "POSITIVO" : "NEGATIVO"}`
    : bruto;
  if ((TIPOS_SANGRE as readonly string[]).includes(canonico)) {
    return canonico as TipoSangre;
  }
  throw new ValorEnumInvalidoError("tipo_sangre", String(valor), TIPOS_SANGRE);
}

export function normalizarSedeTrabajo(valor: unknown): SedeTrabajo | null {
  if (valor == null || valor === "") return null;
  const canonico = aClave(String(valor)).toUpperCase();
  if ((SEDES_TRABAJO as readonly string[]).includes(canonico)) {
    return canonico as SedeTrabajo;
  }
  throw new ValorEnumInvalidoError("sede_trabajo", String(valor), SEDES_TRABAJO);
}

/**
 * Aplica el normalizador que corresponda a un campo, o devuelve el valor tal
 * cual si el campo no es un enum.
 *
 * Lo usa el camino de actualización, que recorre una lista de campos
 * permitidos y no puede tener un `if` por cada uno sin volver a repartir el
 * conocimiento de qué campo es enum y cuál no.
 */
export function normalizarCampoConductor(campo: string, valor: unknown): unknown {
  switch (campo) {
    case "estado":
      return normalizarEstado(valor);
    case "tipo_sangre":
      return normalizarTipoSangre(valor);
    case "sede_trabajo":
      return normalizarSedeTrabajo(valor);
    default:
      return valor;
  }
}
