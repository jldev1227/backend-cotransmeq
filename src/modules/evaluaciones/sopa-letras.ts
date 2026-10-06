/**
 * Sopa de letras: generación de la cuadrícula y calificación.
 *
 * La cuadrícula se genera UNA vez, al guardar la pregunta, y se persiste en
 * `Pregunta.configuracion` con la ubicación de cada palabra. Así todos los
 * evaluados ven la misma sopa, el PDF la puede dibujar y la calificación no
 * depende de nada que mande el cliente salvo los trazos.
 *
 * Un trazo es la línea entre dos celdas. Se califica releyendo las letras de
 * esa línea sobre la cuadrícula guardada: si forman una palabra de la lista
 * (en cualquier sentido), cuenta. Mandar la lista de palabras sin trazos
 * válidos no suma.
 */

export interface UbicacionPalabra {
  texto: string;
  fila: number;
  columna: number;
  dFila: number;
  dColumna: number;
}

export interface ConfigSopa {
  tamano: number;
  diagonales: boolean;
  palabras: UbicacionPalabra[];
  cuadricula: string[];
}

/** Lo que manda el editor: palabras, tamaño y si se permiten diagonales e inversas. */
export interface EntradaSopa {
  palabras: string[];
  tamano?: number;
  diagonales?: boolean;
  /** Si ya venía generada y la entrada no cambió, se conserva. */
  cuadricula?: string[];
}

export interface Trazo {
  palabra?: string;
  desde: [number, number];
  hasta: [number, number];
}

export const SOPA_TAMANO_MIN = 6;
export const SOPA_TAMANO_MAX = 20;
export const SOPA_TAMANO_DEFECTO = 12;

/** Mayúsculas, sin tildes ni espacios; la Ñ se conserva. */
export function normalizarPalabra(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/Ñ/g, "\u0000")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0000/g, "Ñ")
    .replace(/[^A-ZÑ]/g, "");
}

const DIRECCIONES_BASICAS: [number, number][] = [
  [0, 1],
  [1, 0],
];
const DIRECCIONES_TODAS: [number, number][] = [
  ...DIRECCIONES_BASICAS,
  [1, 1],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, -1],
  [-1, 1],
];

/** PRNG determinista (mulberry32): la misma entrada produce la misma sopa. */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function semillaDe(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function palabrasNormalizadas(palabras: string[]): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const p of palabras) {
    const n = normalizarPalabra(p);
    if (n.length >= 2 && !vistas.has(n)) {
      vistas.add(n);
      salida.push(n);
    }
  }
  return salida;
}

export function generarSopa(entrada: EntradaSopa): ConfigSopa {
  const palabras = palabrasNormalizadas(entrada.palabras);
  if (palabras.length === 0) {
    throw new Error("La sopa de letras necesita al menos una palabra de dos letras o más.");
  }
  const masLarga = Math.max(...palabras.map((p) => p.length));
  const tamano = Math.min(
    SOPA_TAMANO_MAX,
    Math.max(SOPA_TAMANO_MIN, entrada.tamano ?? SOPA_TAMANO_DEFECTO, masLarga),
  );
  const diagonales = entrada.diagonales ?? false;
  const direcciones = diagonales ? DIRECCIONES_TODAS : DIRECCIONES_BASICAS;

  // Se intentan varias semillas: con muchas palabras largas en una
  // cuadrícula justa, una colocación puede no encontrar sitio.
  const base = semillaDe(`${palabras.join("|")}|${tamano}|${diagonales}`);
  for (let intento = 0; intento < 40; intento++) {
    const rnd = azar(base + intento * 7919);
    const celdas: (string | null)[][] = Array.from({ length: tamano }, () =>
      Array<string | null>(tamano).fill(null),
    );
    const ubicaciones: UbicacionPalabra[] = [];
    let fallo = false;
    // Las largas primero: son las difíciles de ubicar.
    for (const palabra of [...palabras].sort((a, b) => b.length - a.length)) {
      let colocada = false;
      for (let i = 0; i < 300 && !colocada; i++) {
        const [dFila, dColumna] = direcciones[Math.floor(rnd() * direcciones.length)];
        const fila = Math.floor(rnd() * tamano);
        const columna = Math.floor(rnd() * tamano);
        const finFila = fila + dFila * (palabra.length - 1);
        const finColumna = columna + dColumna * (palabra.length - 1);
        if (finFila < 0 || finFila >= tamano || finColumna < 0 || finColumna >= tamano) continue;
        let cabe = true;
        for (let k = 0; k < palabra.length; k++) {
          const c = celdas[fila + dFila * k][columna + dColumna * k];
          if (c !== null && c !== palabra[k]) {
            cabe = false;
            break;
          }
        }
        if (!cabe) continue;
        for (let k = 0; k < palabra.length; k++) {
          celdas[fila + dFila * k][columna + dColumna * k] = palabra[k];
        }
        ubicaciones.push({ texto: palabra, fila, columna, dFila, dColumna });
        colocada = true;
      }
      if (!colocada) {
        fallo = true;
        break;
      }
    }
    if (fallo) continue;

    const letras = "ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
    const cuadricula = celdas.map((fila) =>
      fila.map((c) => c ?? letras[Math.floor(rnd() * letras.length)]).join(""),
    );
    // En el orden original, para que la lista se lea como la escribió HSEQ.
    const porTexto = new Map(ubicaciones.map((u) => [u.texto, u]));
    return {
      tamano,
      diagonales,
      palabras: palabras.map((p) => porTexto.get(p)!),
      cuadricula,
    };
  }
  throw new Error(
    `No fue posible ubicar las ${palabras.length} palabras en una cuadrícula de ${tamano}×${tamano}. Aumenta el tamaño o quita palabras.`,
  );
}

/** ¿La entrada describe la misma sopa que la configuración guardada? */
export function mismaSopa(config: ConfigSopa | null | undefined, entrada: EntradaSopa): boolean {
  if (!config) return false;
  const palabras = palabrasNormalizadas(entrada.palabras);
  const guardadas = config.palabras.map((p) => p.texto);
  const tamano = Math.min(
    SOPA_TAMANO_MAX,
    Math.max(
      SOPA_TAMANO_MIN,
      entrada.tamano ?? SOPA_TAMANO_DEFECTO,
      ...palabras.map((p) => p.length),
    ),
  );
  return (
    tamano === config.tamano &&
    (entrada.diagonales ?? false) === config.diagonales &&
    palabras.length === guardadas.length &&
    palabras.every((p, i) => p === guardadas[i])
  );
}

/** La configuración sin la ubicación de las palabras: lo que ve el evaluado. */
export function sopaParaPublico(config: ConfigSopa) {
  return {
    tamano: config.tamano,
    diagonales: config.diagonales,
    cuadricula: config.cuadricula,
    palabras: config.palabras.map((p) => p.texto),
  };
}

/** Letras de la línea recta entre dos celdas, o `null` si no es recta. */
export function letrasDeTrazo(cuadricula: string[], trazo: Trazo): string | null {
  const [f0, c0] = trazo.desde;
  const [f1, c1] = trazo.hasta;
  const n = cuadricula.length;
  if ([f0, c0, f1, c1].some((v) => !Number.isInteger(v) || v < 0 || v >= n)) return null;
  const dF = Math.sign(f1 - f0);
  const dC = Math.sign(c1 - c0);
  const largo = Math.max(Math.abs(f1 - f0), Math.abs(c1 - c0)) + 1;
  if (dF !== 0 && dC !== 0 && Math.abs(f1 - f0) !== Math.abs(c1 - c0)) return null;
  let letras = "";
  for (let k = 0; k < largo; k++) letras += cuadricula[f0 + dF * k][c0 + dC * k];
  return letras;
}

/**
 * Palabras encontradas (sin repetir) y puntaje proporcional, a partir de los
 * trazos. Cada trazo vale solo si sus letras forman una palabra de la lista.
 */
export function calificarSopa(
  config: ConfigSopa,
  trazos: Trazo[],
  puntajeMaximo: number,
): { encontradas: string[]; trazosValidos: Trazo[]; puntaje: number } {
  const lista = new Set(config.palabras.map((p) => p.texto));
  const encontradas: string[] = [];
  const trazosValidos: Trazo[] = [];
  for (const t of trazos) {
    const letras = letrasDeTrazo(config.cuadricula, t);
    if (!letras) continue;
    const invertidas = [...letras].reverse().join("");
    const palabra = lista.has(letras) ? letras : lista.has(invertidas) ? invertidas : null;
    if (!palabra || encontradas.includes(palabra)) continue;
    encontradas.push(palabra);
    trazosValidos.push({ palabra, desde: t.desde, hasta: t.hasta });
  }
  const puntaje = lista.size
    ? Math.round((encontradas.length / lista.size) * puntajeMaximo)
    : 0;
  return { encontradas, trazosValidos, puntaje };
}

/** Trazo de una palabra a partir de su ubicación guardada (para corregir desde el panel). */
export function trazoDeUbicacion(u: UbicacionPalabra): Trazo {
  const largo = u.texto.length - 1;
  return {
    palabra: u.texto,
    desde: [u.fila, u.columna],
    hasta: [u.fila + u.dFila * largo, u.columna + u.dColumna * largo],
  };
}
