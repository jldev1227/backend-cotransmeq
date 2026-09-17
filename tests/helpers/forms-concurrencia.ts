/**
 * Doble de Prisma y de S3 con semántica REAL de locks, para probar las carreras
 * del portal de formularios sin tocar ninguna base de datos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUÉ ESTO Y NO UN MOCK CORRIENTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Una prueba secuencial —«llamo A, luego llamo B, compruebo el error»— no
 * demuestra nada sobre una carrera: pasa igual de bien con los locks puestos que
 * sin ellos. Para que la prueba tenga valor, las dos operaciones tienen que estar
 * dentro de su sección crítica AL MISMO TIEMPO, y el lock tiene que ser lo que las
 * ordene.
 *
 * Esto es lo que este doble aporta y un mock normal no:
 *
 *  1. **Los locks bloquean de verdad.** `pg_advisory_xact_lock(a, b)` y
 *     `SELECT ... FOR UPDATE` devuelven una promesa que no se resuelve hasta que
 *     el tenedor hace COMMIT o ROLLBACK. Si el código bajo prueba no toma el lock,
 *     las dos transacciones se solapan y la prueba falla — que es justamente lo
 *     que se quiere detectar.
 *  2. **El espacio de nombres de los locks se respeta.** `(clase, objeto)` es la
 *     clave: dos claves distintas NO se serializan. Así, una prueba puede afirmar
 *     que dos envíos con vehículos diferentes NO compitieron, y no solo que los
 *     dos salieron bien.
 *  3. **Se registra la contención.** `entorno.huboContencion(clave)` distingue
 *     «salió bien porque el lock ordenó» de «salió bien por casualidad de
 *     planificación». Sin eso, una prueba verde no prueba nada.
 *  4. **Hay compuertas deterministas.** Los `hooks` permiten congelar una
 *     transacción justo después de tomar un lock, comprobar que la otra está
 *     ESPERANDO ese mismo lock, y solo entonces soltarla. El solapamiento no
 *     depende del `setTimeout` de nadie.
 *  5. **Rollback real.** Cada transacción escribe en una capa propia que se
 *     descarta si lanza. La transacción que pierde una carrera no deja basura.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  LO QUE NO MODELA (a propósito)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  - **Aislamiento de lectura.** Las lecturas ven lo COMMITEADO más lo propio, o
 *    sea READ COMMITTED. Es el nivel real de Postgres por defecto, así que es lo
 *    correcto aquí.
 *  - **Filtros de relación.** `version: {...}`, `targets: {some: ...}` y demás se
 *    IGNORAN: el control de acceso por target se prueba en otro sitio y meterlo
 *    aquí convertiría este archivo en medio motor de consultas. Los predicados
 *    escalares (`id`, `status`, `deleted_at`, `period_key`, …) sí se aplican, que
 *    son los que deciden los límites.
 *  - **Constraints de la base.** Los únicos e índices parciales de la migración no
 *    se replican. Son la segunda línea de defensa; lo que se prueba aquí es la
 *    primera, que es la que produce un error legible en vez de un 500.
 */

import { createHash } from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

/** Promesa que se resuelve desde fuera. La compuerta de las pruebas. */
export function compuerta() {
  let abrir!: () => void
  const promesa = new Promise<void>((res) => {
    abrir = res
  })
  return { promesa, abrir }
}

/**
 * Espera activa hasta que la condición se cumpla.
 *
 * Se usa para confirmar que la segunda transacción llegó A ESPERAR el lock antes
 * de soltar la primera. Sin esto habría que dormir un rato y cruzar los dedos, y
 * la prueba sería intermitente.
 */
export async function esperarHasta(
  condicion: () => boolean,
  descripcion: string,
  limiteMs = 2_000,
): Promise<void> {
  const inicio = Date.now()
  while (!condicion()) {
    if (Date.now() - inicio > limiteMs) {
      throw new Error(`Se agotó la espera: ${descripcion}`)
    }
    await new Promise((res) => setImmediate(res))
  }
}

export function sha256Base64(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('base64')
}

export function sha256HexDe(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de eventos
// ─────────────────────────────────────────────────────────────────────────────

export interface Evento {
  seq: number
  txId: string
  tipo:
    | 'tx-inicio'
    | 'lock-adquirido'
    | 'lock-espera'
    | 'lock-obtenido-tras-espera'
    | 'tx-commit'
    | 'tx-rollback'
  clave?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Gestor de locks
// ─────────────────────────────────────────────────────────────────────────────

interface Espera {
  txId: string
  resolver: () => void
  rechazar: (e: Error) => void
}

class GestorLocks {
  private tenedor = new Map<string, string>()
  private cola = new Map<string, Espera[]>()
  /** Claves en las que alguien tuvo que esperar. Es la prueba de la contención. */
  readonly contencion = new Set<string>()

  constructor(
    private readonly registrar: (txId: string, tipo: Evento['tipo'], clave?: string) => void,
    private readonly limiteEsperaMs: number,
  ) {}

  esperando(clave: string): number {
    return this.cola.get(clave)?.length ?? 0
  }

  async adquirir(clave: string, txId: string): Promise<void> {
    const actual = this.tenedor.get(clave)

    /// Reentrante: en Postgres, el mismo backend puede volver a tomar un lock que
    /// ya tiene. Sin esto, una transacción que bloquea la misma fila dos veces
    /// (releer tras el lock) se bloquearía sola.
    if (actual === txId) return

    if (actual === undefined) {
      this.tenedor.set(clave, txId)
      this.registrar(txId, 'lock-adquirido', clave)
      return
    }

    this.contencion.add(clave)
    this.registrar(txId, 'lock-espera', clave)

    await new Promise<void>((resolver, rechazar) => {
      const espera: Espera = { txId, resolver, rechazar }
      const lista = this.cola.get(clave) ?? []
      lista.push(espera)
      this.cola.set(clave, lista)

      /// Un lock que no llega nunca es un deadlock o un lock que falta. Se corta
      /// con un error explícito: si la prueba se colgara, el diagnóstico sería
      /// «el test se quedó pillado» en vez de «esta transacción esperaba esto».
      setTimeout(() => {
        const lista2 = this.cola.get(clave) ?? []
        const idx = lista2.indexOf(espera)
        if (idx >= 0) {
          lista2.splice(idx, 1)
          rechazar(
            new Error(
              `Deadlock o lock no liberado: ${txId} esperó ${this.limiteEsperaMs} ms por «${clave}» (lo tiene ${this.tenedor.get(clave)}).`,
            ),
          )
        }
      }, this.limiteEsperaMs).unref?.()
    })

    this.registrar(txId, 'lock-obtenido-tras-espera', clave)
  }

  /** Libera todo lo que tenga una transacción. Equivale al COMMIT/ROLLBACK. */
  liberarTodo(txId: string): void {
    for (const [clave, dueno] of [...this.tenedor.entries()]) {
      if (dueno !== txId) continue
      this.tenedor.delete(clave)
      const lista = this.cola.get(clave) ?? []
      const siguiente = lista.shift()
      if (siguiente) {
        this.tenedor.set(clave, siguiente.txId)
        siguiente.resolver()
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Almacén
// ─────────────────────────────────────────────────────────────────────────────

type Fila = Record<string, any>
const BORRADA = Symbol('fila-borrada')

const TABLAS = [
  'conductores',
  'vehiculos',
  'form_assignment',
  'form_submission',
  'form_submission_event',
  'form_answer',
  'form_answer_option',
  'form_field',
  'form_attachment',
] as const

type Tabla = (typeof TABLAS)[number]

/** Claves por las que `findUnique` puede buscar en cada tabla. */
const CLAVES_UNICAS: Record<string, string[]> = {
  form_submission: ['id', 'client_submission_id'],
  form_attachment: ['id', 'client_attachment_id'],
  form_assignment: ['id'],
  form_field: ['id'],
}

const OPERADORES = new Set(['not', 'in', 'notIn', 'equals', 'lt', 'lte', 'gt', 'gte'])

function esOperador(valor: unknown): boolean {
  if (valor === null || typeof valor !== 'object') return false
  if (valor instanceof Date) return false
  const claves = Object.keys(valor as object)
  return claves.length > 0 && claves.every((k) => OPERADORES.has(k))
}

function mismoValor(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a === 'bigint' || typeof b === 'bigint') return String(a) === String(b)
  /// Columna ausente en la fila = NULL, como en Postgres.
  ///
  /// Las filas que CREA el código bajo prueba solo traen las columnas que el
  /// servicio escribe; el resto las pone la base a su default, que en las
  /// nullables es NULL. Sin esta equivalencia, un filtro tan corriente como
  /// `deleted_at: null` no casaría con ninguna fila recién creada y la prueba
  /// fallaría por el doble, no por el código.
  if (a === undefined && b === null) return true
  if (a === null && b === undefined) return true
  return a === b
}

/**
 * Aplica un `where` de Prisma sobre una fila.
 *
 * Los filtros de relación se ignoran (ver la cabecera del archivo). Todo lo
 * escalar se compara de verdad, incluidos `not` e `in`, que es lo que usan
 * `verificarLimite` y `resolverAdjuntos`.
 */
function coincide(fila: Fila, where: any): boolean {
  if (!where) return true
  for (const [clave, valor] of Object.entries(where)) {
    if (clave === 'AND') {
      const lista = Array.isArray(valor) ? valor : [valor]
      if (!lista.every((w) => coincide(fila, w))) return false
      continue
    }
    if (clave === 'OR') {
      const lista = Array.isArray(valor) ? valor : [valor]
      if (!lista.some((w) => coincide(fila, w))) return false
      continue
    }
    if (clave === 'NOT') {
      if (coincide(fila, valor)) return false
      continue
    }

    if (esOperador(valor)) {
      const op = valor as Record<string, any>
      if ('equals' in op && !mismoValor(fila[clave], op.equals)) return false
      if ('not' in op && mismoValor(fila[clave], op.not)) return false
      if ('in' in op && !(op.in as unknown[]).some((v) => mismoValor(fila[clave], v))) return false
      if ('notIn' in op && (op.notIn as unknown[]).some((v) => mismoValor(fila[clave], v))) return false
      continue
    }

    if (valor !== null && typeof valor === 'object' && !(valor instanceof Date)) {
      /// Filtro de relación: fuera del alcance de este doble.
      continue
    }

    if (!mismoValor(fila[clave], valor)) return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Entorno
// ─────────────────────────────────────────────────────────────────────────────

export interface Hooks {
  /** Tras tomar un advisory lock. `clase` es el `classid`. */
  trasAdvisory?: (ctx: { txId: string; clase: number; objeto: number }) => Promise<void> | void
  /** Tras un `SELECT ... FOR UPDATE` sobre `form_submissions`. */
  trasRowLock?: (ctx: { txId: string; submissionId: string | null }) => Promise<void> | void
}

export interface ObjetoS3 {
  bytes: Buffer
  contentType: string
  /** Checksum que el bucket EXPONE. `null` simula un proveedor que no lo devuelve. */
  exponeChecksum: boolean
}

export interface Entorno {
  prisma: any
  aws: any
  env: { FORMS_S3_NATIVE_CHECKSUM: boolean }
  logs: { nivel: string; datos: any; mensaje: string }[]
  eventos: Evento[]
  hooks: Hooks
  /** Tabla → filas COMMITEADAS. Para preparar fixtures y comprobar el resultado. */
  tabla(nombre: Tabla): Fila[]
  sembrar(nombre: Tabla, filas: Fila[]): void
  /** ¿Alguien tuvo que esperar por esta clave? */
  huboContencion(clave: string): boolean
  esperandoPor(clave: string): number
  claveAdvisory(clase: number, objeto: number): string
  claveFila(submissionId: string): string
  /** S3 simulado: clave → objeto. */
  s3: Map<string, ObjetoS3>
  /**
   * Simula el PUT del navegador a la URL firmada.
   *
   * Si la firma llevaba checksum y los bytes no lo producen, RECHAZA como lo hace
   * S3 (`BadDigest`). Es lo que convierte la verificación posterior en real.
   */
  subir(clave: string, bytes: Buffer, opciones?: { exponeChecksum?: boolean }): void
  /**
   * Coloca un objeto SALTÁNDOSE la comprobación de la firma.
   *
   * Simula un bucket que no impuso el checksum —proveedor compatible-S3 antiguo,
   * o un objeto sustituido por otra vía— y es lo que permite probar que la
   * verificación del backend detecta bytes distintos de los declarados. Sin esto,
   * la única forma de «probar» ese caso sería inventar el valor esperado, que es
   * exactamente el error que FIX-02 corrige.
   */
  forzarObjeto(clave: string, bytes: Buffer, opciones?: { exponeChecksum?: boolean }): void
  /** Checksum que se firmó para una clave, si hubo firma. */
  checksumFirmado(clave: string): string | null
}

export function crearEntorno(opciones: { limiteEsperaMs?: number } = {}): Entorno {
  const eventos: Evento[] = []
  let seq = 0
  const registrar = (txId: string, tipo: Evento['tipo'], clave?: string) => {
    eventos.push({ seq: ++seq, txId, tipo, clave })
  }

  const locks = new GestorLocks(registrar, opciones.limiteEsperaMs ?? 2_000)

  const comiteado = new Map<string, Map<string, Fila>>()
  for (const t of TABLAS) comiteado.set(t, new Map())

  const s3 = new Map<string, ObjetoS3>()
  const firmas = new Map<string, string | null>()
  const logs: Entorno['logs'] = []
  const hooks: Hooks = {}
  const envFalso = { FORMS_S3_NATIVE_CHECKSUM: true }

  let contadorTx = 0

  // ── Capa de escritura de una transacción ──────────────────────────────────

  interface Capa {
    txId: string
    cambios: Map<string, Map<string, Fila | typeof BORRADA>>
  }

  function capaDe(capa: Capa | null, tabla: string): Map<string, Fila | typeof BORRADA> {
    if (!capa) throw new Error('Escritura fuera de transacción')
    let m = capa.cambios.get(tabla)
    if (!m) {
      m = new Map()
      capa.cambios.set(tabla, m)
    }
    return m
  }

  /** Vista de una tabla: lo commiteado más lo propio de la transacción. */
  function vista(tabla: string, capa: Capa | null): Fila[] {
    const base = new Map(comiteado.get(tabla) ?? new Map())
    const propios = capa?.cambios.get(tabla)
    if (propios) {
      for (const [id, fila] of propios) {
        if (fila === BORRADA) base.delete(id)
        else base.set(id, fila)
      }
    }
    return [...base.values()]
  }

  function idDe(fila: Fila): string {
    /// `form_answer_option` no tiene `id` propio: su clave es el par.
    return String(fila.id ?? `${fila.answer_id}:${fila.option_id}`)
  }

  function commit(capa: Capa): void {
    for (const [tabla, cambios] of capa.cambios) {
      const destino = comiteado.get(tabla)!
      for (const [id, fila] of cambios) {
        if (fila === BORRADA) destino.delete(id)
        else destino.set(id, fila)
      }
    }
  }

  // ── Delegados de modelo ───────────────────────────────────────────────────

  function anexarRelaciones(tabla: string, fila: Fila, include: any, capa: Capa | null): Fila {
    if (!include) return fila
    if (tabla === 'form_attachment' && include.submission) {
      const envio = vista('form_submission', capa).find((s) => s.id === fila.submission_id)
      return { ...fila, submission: envio ?? null }
    }
    return fila
  }

  function delegado(tabla: string, capa: Capa | null) {
    return {
      async findUnique(args: any) {
        const where = args?.where ?? {}
        const claves = CLAVES_UNICAS[tabla] ?? ['id']
        const usada = claves.find((k) => where[k] !== undefined)
        if (!usada) throw new Error(`findUnique en ${tabla} sin clave única reconocida: ${JSON.stringify(where)}`)
        const fila = vista(tabla, capa).find((f) => mismoValor(f[usada], where[usada]))
        return fila ? anexarRelaciones(tabla, fila, args?.include, capa) : null
      },
      async findFirst(args: any) {
        const fila = vista(tabla, capa).find((f) => coincide(f, args?.where))
        return fila ? anexarRelaciones(tabla, fila, args?.include, capa) : null
      },
      async findMany(args: any) {
        return vista(tabla, capa)
          .filter((f) => coincide(f, args?.where))
          .map((f) => anexarRelaciones(tabla, f, args?.include, capa))
      },
      async count(args: any) {
        return vista(tabla, capa).filter((f) => coincide(f, args?.where)).length
      },
      async create(args: any) {
        const fila = { ...args.data }
        capaDe(capa, tabla).set(idDe(fila), fila)
        return fila
      },
      async createMany(args: any) {
        const filas: Fila[] = Array.isArray(args.data) ? args.data : [args.data]
        for (const f of filas) capaDe(capa, tabla).set(idDe(f), { ...f })
        return { count: filas.length }
      },
      async update(args: any) {
        const actual = vista(tabla, capa).find((f) => coincide(f, args.where))
        if (!actual) throw new Error(`update en ${tabla}: no existe ${JSON.stringify(args.where)}`)
        /// Fila NUEVA y no mutación: quien capturó la anterior no debe ver el
        /// cambio, igual que en Postgres.
        const nueva = { ...actual, ...args.data }
        capaDe(capa, tabla).set(idDe(nueva), nueva)
        return nueva
      },
      async delete(args: any) {
        const actual = vista(tabla, capa).find((f) => coincide(f, args.where))
        if (!actual) throw new Error(`delete en ${tabla}: no existe ${JSON.stringify(args.where)}`)
        capaDe(capa, tabla).set(idDe(actual), BORRADA)
        return actual
      },
      async deleteMany(args: any) {
        const objetivo = vista(tabla, capa).filter((f) => coincide(f, args?.where))
        for (const f of objetivo) capaDe(capa, tabla).set(idDe(f), BORRADA)
        return { count: objetivo.length }
      },
      async groupBy() {
        return []
      },
    }
  }

  // ── SQL crudo: es donde viven los locks ───────────────────────────────────

  function textoDe(plantilla: unknown, valores: unknown[]): string {
    if (Array.isArray(plantilla)) {
      /// Template etiquetado: `["SELECT pg_advisory... (", "::int4, ", ...)"]`.
      return (plantilla as string[]).reduce((acc, parte, i) => acc + parte + (i < valores.length ? `$${i}` : ''), '')
    }
    return String(plantilla)
  }

  function crudoDe(capa: Capa) {
    return {
      async $executeRaw(plantilla: any, ...valores: any[]) {
        const sql = textoDe(plantilla, valores)
        if (sql.includes('pg_advisory_xact_lock')) {
          const [clase, objeto] = valores as [number, number]
          if (typeof clase !== 'number' || typeof objeto !== 'number') {
            throw new Error(
              `pg_advisory_xact_lock con argumentos no numéricos: ${JSON.stringify(valores)}. ` +
                'La forma de UN argumento (bigint) no la cubre este doble a propósito: el módulo debe usar la de dos.',
            )
          }
          await locks.adquirir(claveAdvisory(clase, objeto), capa.txId)
          await hooks.trasAdvisory?.({ txId: capa.txId, clase, objeto })
          return 1
        }
        throw new Error(`$executeRaw no reconocido por el doble: ${sql}`)
      },

      async $queryRaw(plantilla: any, ...valores: any[]) {
        const sql = textoDe(plantilla, valores)
        if (!/FOR UPDATE/i.test(sql) || !/form_submissions/i.test(sql)) {
          throw new Error(`$queryRaw no reconocido por el doble: ${sql}`)
        }

        const porClientId = /client_submission_id\s*=/i.test(sql)
        const valor = String(valores[0])

        /// Se resuelve la fila ANTES de bloquear, como hace Postgres: el lock es
        /// sobre la fila encontrada. Si no hay fila, `FOR UPDATE` no bloquea nada.
        const fila = vista('form_submission', capa).find((f) =>
          porClientId ? f.client_submission_id === valor : f.id === valor,
        )
        if (!fila) {
          await hooks.trasRowLock?.({ txId: capa.txId, submissionId: null })
          return []
        }

        await locks.adquirir(claveFila(String(fila.id)), capa.txId)

        /// Relectura DESPUÉS del lock: es el punto entero de `FOR UPDATE`. Si se
        /// devolviera la fila leída antes de esperar, el estado saldría rancio y
        /// las comprobaciones del servicio mirarían el pasado.
        const fresca = vista('form_submission', capa).find((f) => f.id === fila.id)
        await hooks.trasRowLock?.({ txId: capa.txId, submissionId: String(fila.id) })
        if (!fresca) return []

        return [
          {
            id: fresca.id,
            conductor_id: fresca.conductor_id,
            usuario_id: fresca.usuario_id ?? null,
            status: fresca.status,
            version_id: fresca.version_id,
            assignment_id: fresca.assignment_id,
            client_submission_id: fresca.client_submission_id,
            deleted_at: fresca.deleted_at ?? null,
          },
        ]
      },
    }
  }

  function claveAdvisory(clase: number, objeto: number): string {
    return `adv:${clase}:${objeto}`
  }
  function claveFila(submissionId: string): string {
    return `row:form_submissions:${submissionId}`
  }

  // ── El objeto `prisma` ────────────────────────────────────────────────────

  function clienteDe(capa: Capa | null): any {
    const cliente: any = {}
    for (const t of TABLAS) cliente[t] = delegado(t, capa)
    if (capa) Object.assign(cliente, crudoDe(capa))
    return cliente
  }

  const prismaFalso: any = {
    ...clienteDe(null),
    async $transaction(arg: any) {
      /// Solo la forma interactiva: es la única que usa el portal.
      if (Array.isArray(arg)) return Promise.all(arg)

      const capa: Capa = { txId: `tx${++contadorTx}`, cambios: new Map() }
      registrar(capa.txId, 'tx-inicio')
      try {
        const resultado = await arg(clienteDe(capa))
        commit(capa)
        registrar(capa.txId, 'tx-commit')
        return resultado
      } catch (err) {
        registrar(capa.txId, 'tx-rollback')
        throw err
      } finally {
        /// Igual que en Postgres: los locks de la transacción caen con ella, haya
        /// ido bien o mal. Se liberan DESPUÉS de aplicar los cambios para que el
        /// que estaba esperando vea el estado ya commiteado.
        locks.liberarTodo(capa.txId)
      }
    },
  }

  // ── El doble de S3 ────────────────────────────────────────────────────────

  const awsFalso = {
    async getS3UploadUrl(
      clave: string,
      contentType: string,
      _contentLength: number,
      checksumSha256Base64: string | null = null,
    ) {
      firmas.set(clave, checksumSha256Base64)
      return `https://s3.test/${clave}?firma=1${checksumSha256Base64 ? `&checksum=${encodeURIComponent(checksumSha256Base64)}` : ''}`
    },

    async getS3SignedUrl(clave: string) {
      return `https://s3.test/${clave}?descarga=1`
    },

    sha256HexToBase64(hex: string) {
      if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`SHA-256 hexadecimal inválido: ${hex}`)
      return Buffer.from(hex, 'hex').toString('base64')
    },

    async headS3Object(clave: string) {
      const objeto = s3.get(clave)
      if (!objeto) return null
      return {
        contentLength: objeto.bytes.length,
        contentType: objeto.contentType,
        etag: `"${sha256HexDe(objeto.bytes).slice(0, 32)}"`,
        /// EL PUNTO DE FIX-02: el checksum se calcula sobre los BYTES GUARDADOS,
        /// nunca se copia del request. Si el objeto almacenado no es el declarado,
        /// este valor no cuadra y el servicio tiene que rechazarlo.
        checksumSha256: objeto.exponeChecksum ? sha256Base64(objeto.bytes) : null,
      }
    },

    async computeS3ObjectSha256(clave: string, maxBytes: number) {
      const objeto = s3.get(clave)
      if (!objeto) return null
      if (objeto.bytes.length > maxBytes) {
        throw new Error(`El objeto supera el tope de lectura (${maxBytes} bytes)`)
      }
      return { sha256Hex: sha256HexDe(objeto.bytes), byteLength: objeto.bytes.length }
    },
  }

  return {
    prisma: prismaFalso,
    aws: awsFalso,
    env: envFalso,
    logs,
    eventos,
    hooks,
    s3,
    tabla: (nombre) => [...(comiteado.get(nombre)?.values() ?? [])],
    sembrar: (nombre, filas) => {
      const destino = comiteado.get(nombre)!
      for (const f of filas) destino.set(idDe(f), f)
    },
    huboContencion: (clave) => locks.contencion.has(clave),
    esperandoPor: (clave) => locks.esperando(clave),
    claveAdvisory,
    claveFila,
    subir: (clave, bytes, opts = {}) => {
      const firmado = firmas.get(clave) ?? null
      /// S3 con `ChecksumSHA256` firmado rechaza los bytes que no lo producen.
      /// Reproducirlo es lo que permite afirmar que el contrato es real.
      if (firmado && sha256Base64(bytes) !== firmado) {
        throw Object.assign(new Error('BadDigest: los bytes no coinciden con el checksum firmado'), {
          status: 400,
          code: 'BadDigest',
        })
      }
      s3.set(clave, {
        bytes,
        contentType: 'image/jpeg',
        exponeChecksum: opts.exponeChecksum ?? true,
      })
    },
    forzarObjeto: (clave, bytes, opts = {}) => {
      s3.set(clave, {
        bytes,
        contentType: 'image/jpeg',
        exponeChecksum: opts.exponeChecksum ?? true,
      })
    },
    checksumFirmado: (clave) => firmas.get(clave) ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Puente hacia los mocks de módulo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entorno activo. Los `vi.mock` apuntan a proxies que resuelven contra esto, de
 * forma que cada test puede tener su propio entorno limpio sin volver a mockear.
 */
let activo: Entorno | null = null

export function usarEntorno(entorno: Entorno): void {
  activo = entorno
}

function actual(): Entorno {
  if (!activo) throw new Error('No hay entorno activo: llama a usarEntorno() en el beforeEach.')
  return activo
}

/** Proxy que sustituye a `prisma` en `src/config/prisma`. */
export const prismaProxy: any = new Proxy(
  {},
  {
    get: (_t, prop) => (actual().prisma as any)[prop as string],
    has: (_t, prop) => prop in actual().prisma,
  },
)

/** Proxy que sustituye al módulo `src/config/aws`. */
export const awsProxy: any = new Proxy(
  {},
  {
    get: (_t, prop) => (actual().aws as any)[prop as string],
    has: (_t, prop) => prop in actual().aws,
  },
)

/** Proxy que sustituye a `env` en `src/config/env`. */
export const envProxy: any = new Proxy(
  {},
  {
    get: (_t, prop) => (actual().env as any)[prop as string],
    set: (_t, prop, valor) => {
      ;(actual().env as any)[prop as string] = valor
      return true
    },
  },
)

/** Logger que acumula en el entorno, para poder afirmar sobre los avisos. */
export const loggerProxy = {
  info: (datos: any, mensaje?: string) => actual().logs.push({ nivel: 'info', datos, mensaje: mensaje ?? '' }),
  warn: (datos: any, mensaje?: string) => actual().logs.push({ nivel: 'warn', datos, mensaje: mensaje ?? '' }),
  error: (datos: any, mensaje?: string) => actual().logs.push({ nivel: 'error', datos, mensaje: mensaje ?? '' }),
  debug: () => {},
}
