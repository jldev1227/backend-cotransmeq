/**
 * Cola de generación de borradores de nómina.
 *
 * Es el gemelo de `borrador-queue.service.ts`, que hace lo mismo para los
 * cierres finales de terceros, y comparte sus decisiones: sin Redis, en
 * memoria y en un solo proceso; lock por PERIODO y no global, para que dos
 * personas trabajando en meses distintos no se bloqueen; y `cancel` que
 * cancela de verdad, comprobando un `AbortController` entre conductores.
 *
 * QUÉ RESUELVE. Hasta ahora una liquidación se creaba de una en una desde el
 * formulario, que además calculaba en el navegador y mandaba el resultado ya
 * hecho. Para un periodo con quince conductores eso son quince viajes
 * manuales. Aquí se elige el periodo, se marcan los conductores y el servidor
 * genera, persiste y anuncia cada borrador según lo va creando.
 *
 * DE DÓNDE SALEN LAS CIFRAS. No se recalcula nada nuevo: se reutiliza
 * `NominaCanvasService.construirPeriodo`, que es lo que ya alimenta al canvas,
 * y de cada hoja se toman sus `totales` — el resultado de `liquidarNomina`,
 * el cálculo puro que ya vive en el servidor. Así el borrador generado y lo
 * que el canvas pinta salen de la misma aritmética por construcción, y no por
 * disciplina de mantener dos copias.
 *
 * QUÉ NO HACE. No toca a un conductor que ya tenga liquidación en el periodo.
 * Regenerar encima es una decisión con consecuencias —lo guardado puede estar
 * revisado o firmado— y no se toma por omisión: hay que pedirla conductor a
 * conductor con `sobrescribir`.
 */

import { randomUUID } from 'crypto'
import { prisma } from '../config/prisma'
import { permiteReemplazar } from '../modules/nomina-canvas/nomina-estado.service'
import { NominaCanvasService } from '../modules/nomina-canvas/nomina-canvas.service'
import { sheetRoomKey } from '../sockets/sheet-rooms'
import { env } from '../config/env'

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type BorradorNominaStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'error'
  | 'cancelled'
  | 'locked'

export interface BorradorNominaPayload {
  anio: number
  mes: number
  /** Corte del periodo (día de inicio). Lo mismo que lee el canvas. */
  corte?: number | null
  /** Conductores a generar. Vacío = todos los que tengan planilla. */
  conductorIds: string[]
  /**
   * Conductores cuya liquidación existente se reemplaza. Va aparte de
   * `conductorIds` a propósito: sobrescribir es opt-in explícito y por
   * persona, no una casilla global que se marca sin mirar a quién afecta.
   */
  sobrescribir?: string[]
}

export interface BorradorNominaItem {
  conductorId: string
  nombre: string
  estado: 'creado' | 'reemplazado' | 'omitido' | 'error'
  motivo?: string
  liquidacionId?: string
  sueldoTotal?: number
}

export interface BorradorNominaJob {
  jobId: string
  userId: string
  userName: string
  status: BorradorNominaStatus
  progress: number
  currentStep: string
  processed: number
  total: number
  anio: number
  mes: number
  payload?: BorradorNominaPayload
  items: BorradorNominaItem[]
  error?: string
  startedAt?: number
  finishedAt?: number
  lockedBy?: {
    userId: string
    userName: string
    startedAt: number
    currentStep: string
    progress: number
    jobId: string
    anio: number | null
    mes: number | null
  }
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const MAX_QUEUE_SIZE = Number(env.BORRADOR_QUEUE_MAX_SIZE) || 10
const JOB_TTL_MS = Number(env.BORRADOR_QUEUE_JOB_TTL_MS) || 5 * 60 * 1000
const CLEANUP_INTERVAL_MS = 60_000

export interface EmitTarget {
  userId?: string
  room?: string
}
type EmitFn = (target: EmitTarget, event: string, data: any) => void

const dec = (v: unknown): number => (v == null ? 0 : Number(v))

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

class BorradorNominaQueueService {
  private queue: BorradorNominaJob[] = []
  private jobs = new Map<string, BorradorNominaJob>()
  private running = false
  private emitFn: EmitFn | null = null
  private cleanupTimer: NodeJS.Timeout | null = null
  /** Periodos con un job corriendo → jobId. Mismo criterio que terceros. */
  private locks = new Map<string, string>()
  private aborts = new Map<string, AbortController>()

  setEmitter(fn: EmitFn) {
    this.emitFn = fn
    console.log('[borrador-nomina] emitter configurado')
    this.startCleanup()
  }

  private emit(target: EmitTarget, event: string, data: any) {
    this.emitFn?.(target, event, data)
  }

  private clave(anio: number, mes: number) {
    return `${anio}:${mes}`
  }

  enqueue(
    userId: string,
    userName: string,
    payload: BorradorNominaPayload,
  ): { jobId: string; status: BorradorNominaStatus; lockedBy?: any } {
    const clave = this.clave(payload.anio, payload.mes)

    // El lock es por periodo: generar agosto no puede bloquear a quien está
    // generando septiembre.
    const ocupado = this.locks.get(clave)
    if (ocupado) {
      const dueño = this.jobs.get(ocupado)
      return {
        jobId: ocupado,
        status: 'locked',
        lockedBy: dueño
          ? {
              userId: dueño.userId,
              userName: dueño.userName,
              startedAt: dueño.startedAt ?? Date.now(),
              currentStep: dueño.currentStep,
              progress: dueño.progress,
              jobId: dueño.jobId,
              anio: dueño.anio,
              mes: dueño.mes,
            }
          : undefined,
      }
    }

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      throw new Error('La cola de borradores está llena. Intenta en un minuto.')
    }

    const job: BorradorNominaJob = {
      jobId: randomUUID(),
      userId,
      userName,
      status: 'queued',
      progress: 0,
      currentStep: 'En cola',
      processed: 0,
      total: payload.conductorIds.length,
      anio: payload.anio,
      mes: payload.mes,
      payload,
      items: [],
    }

    this.jobs.set(job.jobId, job)
    this.queue.push(job)
    this.emit({ userId }, 'borrador-nomina:queued', this.publico(job))
    void this.procesar()
    return { jobId: job.jobId, status: 'queued' }
  }

  getStatus(jobId: string): BorradorNominaJob | null {
    const j = this.jobs.get(jobId)
    return j ? this.publico(j) : null
  }

  cancel(jobId: string, userId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job) return false
    // Solo quien lanzó puede cancelar: el jobId circula por sockets y sin
    // esta comprobación bastaría conocerlo para tumbar el job de otro.
    if (job.userId !== userId) return false
    if (job.status === 'complete' || job.status === 'error') return false

    this.aborts.get(jobId)?.abort()
    job.status = 'cancelled'
    job.finishedAt = Date.now()
    this.queue = this.queue.filter((j) => j.jobId !== jobId)
    this.emit({ userId: job.userId }, 'borrador-nomina:cancelled', this.publico(job))
    return true
  }

  /** Copia sin el payload, que no aporta nada a la UI y puede ser grande. */
  private publico(job: BorradorNominaJob): BorradorNominaJob {
    const { payload, ...resto } = job
    return { ...resto } as BorradorNominaJob
  }

  private async procesar() {
    if (this.running) return
    const job = this.queue.shift()
    if (!job) return
    if (job.status === 'cancelled') return void this.procesar()

    const clave = this.clave(job.anio, job.mes)
    this.running = true
    this.locks.set(clave, job.jobId)

    const abort = new AbortController()
    this.aborts.set(job.jobId, abort)

    job.status = 'running'
    job.startedAt = Date.now()
    job.currentStep = 'Cargando el periodo'
    this.emit({ userId: job.userId }, 'borrador-nomina:start', this.publico(job))

    try {
      await this.ejecutar(job, abort.signal)
      // El cast no es cosmético: TS estrecha `status` a 'running' tras la
      // asignación de arriba y no ve que `cancel()` lo cambia desde fuera
      // mientras esto corre.
      if ((job.status as BorradorNominaStatus) !== 'cancelled') {
        job.status = 'complete'
        job.progress = 100
        job.currentStep = 'Terminado'
        job.finishedAt = Date.now()
        this.emit({ userId: job.userId }, 'borrador-nomina:complete', this.publico(job))
      }
    } catch (e: any) {
      job.status = 'error'
      job.error = e?.message || 'Error generando los borradores'
      job.finishedAt = Date.now()
      this.emit({ userId: job.userId }, 'borrador-nomina:error', this.publico(job))
    } finally {
      this.aborts.delete(job.jobId)
      this.locks.delete(clave)
      this.running = false
      void this.procesar()
    }
  }

  private async ejecutar(job: BorradorNominaJob, signal: AbortSignal) {
    const p = job.payload
    if (!p) throw new Error('El job perdió su contenido.')

    const room = sheetRoomKey('nomina', job.anio, job.mes)
    const sobrescribir = new Set(p.sobrescribir ?? [])

    // Una sola pasada: `construirPeriodo` ya trae, por conductor, sus días,
    // placas, recargos repartidos y los `totales` de `liquidarNomina`. Pedir
    // el periodo una vez por conductor sería multiplicar por N el trabajo
    // más caro del módulo.
    const periodo = await NominaCanvasService.construirPeriodo({
      anio: p.anio,
      mes: p.mes,
      corte: p.corte ?? undefined,
      // `construirPeriodo` ya sabe restringir: filtrar después obligaría a
      // construir hojas que se iban a descartar.
      conductorIds: p.conductorIds.length ? p.conductorIds : undefined,
    })

    // Sin lista explícita, solo los que tienen días: generar un borrador en
    // cero para quien no trabajó ensucia el periodo sin aportar nada.
    const hojas = (periodo.hojas as any[]).filter(
      (h) => p.conductorIds.length || h.dias?.length > 0,
    )
    job.total = hojas.length

    // La ventana real del periodo, que es lo que se guarda como
    // `periodo_start`/`periodo_end`. Sale de los días, no del mes: el corte
    // 21→20 cruza dos meses.
    const dias = periodo.periodo.dias
    const ventana = {
      desde: dias[0]?.fecha ?? '',
      hasta: dias[dias.length - 1]?.fecha ?? '',
    }

    /**
     * Conductores NOMBRADOS uno a uno desde el modal.
     *
     * Vacío cuando se lanza sobre el periodo entero. La diferencia importa: un
     * barrido no debe crear borradores de quien no tiene días, pero marcar una
     * casilla que la interfaz dejó desmarcada a propósito es una decisión
     * explícita y el servidor no debe ignorarla en silencio.
     */
    const pedidos = new Set(p.conductorIds ?? [])

    for (let i = 0; i < hojas.length; i++) {
      // No se puede abortar una escritura en vuelo, así que la promesa es
      // «se detiene al terminar el conductor en curso».
      if (signal.aborted) return

      const h = hojas[i]
      job.currentStep = `Generando ${h.nombre}`
      job.processed = i
      job.progress = Math.round((i / Math.max(1, hojas.length)) * 100)
      this.emit({ userId: job.userId }, 'borrador-nomina:progress', this.publico(job))

      const item = await this.generarUno(h, ventana, sobrescribir, job.userId, pedidos)
      job.items.push(item)

      // El alta va al room del libro: quien tenga el periodo abierto la ve
      // aparecer sin recargar.
      this.emit({ room }, 'borrador-nomina:item', { jobId: job.jobId, ...item })
    }

    job.processed = hojas.length
  }

  private async generarUno(
    hoja: any,
    ventana: { desde: string; hasta: string },
    sobrescribir: Set<string>,
    userId: string,
    /** Ids marcados a mano. Vacío en un barrido del periodo. */
    pedidos: Set<string> = new Set(),
  ): Promise<BorradorNominaItem> {
    const base: BorradorNominaItem = {
      conductorId: hoja.conductorId,
      nombre: hoja.nombre,
      estado: 'omitido',
    }

    try {
      if (hoja.liquidacionId && !sobrescribir.has(hoja.conductorId)) {
        return {
          ...base,
          motivo: `Ya tiene liquidación en este periodo (${hoja.estado}).`,
          liquidacionId: hoja.liquidacionId,
        }
      }

      /**
       * SOLO SE REEMPLAZA UN BORRADOR.
       *
       * Reemplazar no edita, destruye: reescribe todos los totales desde las
       * planillas y devuelve `estado_flujo` a BORRADOR. No había ninguna
       * guarda, así que marcar la casilla en una liquidación APROBADA borraba
       * la aprobación y las cifras revisadas sin aviso y sin vuelta atrás.
       *
       * La casilla ya no se ofrece fuera de BORRADOR, pero el servidor no
       * depende de eso: un `sobrescribir` con un id colado —desde la API, o
       * desde una pestaña abierta antes de que la liquidación se aprobara— se
       * rechaza aquí.
       */
      if (hoja.liquidacionId && !permiteReemplazar(String(hoja.estado ?? ''))) {
        return {
          ...base,
          motivo: `Está en ${hoja.estado} y no se puede rehacer. Devuélvela a BORRADOR primero.`,
          liquidacionId: hoja.liquidacionId,
        }
      }
      /**
       * Sin días no se genera... SALVO que lo hayan pedido por nombre.
       *
       * En un barrido del periodo la guarda es buena: crea solo a quien
       * trabajó y no ensucia el corte con borradores de todo el mundo.
       *
       * Pero marcando la casilla la respuesta era `omitido` con un «Sin
       * planillas en el periodo» que sonaba a que el conductor no había
       * trabajado, cuando lo que suele pasar es que SU PLANILLA LLEGÓ TARDE O
       * ESTÁ VACÍA. Y contradecía a la propia creación, que unas líneas más
       * abajo escribe `dias_laborados: DIAS_MES_COMERCIAL` precisamente porque
       * «alguien a sueldo mensual cobra el mes aunque su planilla llegue
       * tarde». Las dos cosas no pueden ser ciertas a la vez.
       *
       * Así que lo pedido a mano se crea, con el mes comercial como todos. Los
       * recargos seguirán en cero hasta que la planilla llegue, y eso se
       * arregla con «Actualizar días».
       */
      if (!hoja.dias?.length && !pedidos.has(hoja.conductorId)) {
        return { ...base, motivo: 'Sin planillas en el periodo.' }
      }

      const t = hoja.totales
      const datos = {
        conductor_id: hoja.conductorId,
        periodo_start: ventana.desde,
        periodo_end: ventana.hasta,
        /**
         * MES COMERCIAL, no los días con planilla.
         *
         * Antes esto era `hoja.dias.length` —los días que tienen planilla
         * cargada— y de ahí salía el sueldo: un conductor con 3 planillas en el
         * corte cobraba 3/30 del básico, y uno sin ninguna cobraba CERO. Las
         * planillas mandan sobre los recargos, no sobre el salario: alguien a
         * sueldo mensual cobra el mes aunque su planilla llegue tarde.
         *
         * 30 y no los días del calendario del corte (30, 31 o 32 según el mes)
         * porque el sueldo mensual no puede cambiar de un corte a otro, y es lo
         * que hacen los Excel de los que viene esta nómina.
         *
         * Las novedades de verdad —un ingreso o un retiro a mitad de corte— se
         * bajan a mano: la celda del desprendible es editable.
         */
        dias_laborados: DIAS_MES_COMERCIAL,
        salario_devengado: t.salarioDevengado,
        auxilio_transporte: t.auxilioTransporte,
        total_bonificaciones: t.totalBonificaciones,
        total_pernotes: t.totalPernotes,
        total_recargos: t.totalRecargos,
        total_anticipos: t.totalAnticipos,
        total_vacaciones: t.totalVacaciones,
        valor_incapacidad: t.valorIncapacidad,
        interes_cesantias: t.interesCesantias,
        ajuste_parex: t.ajusteParex,
        ajuste_geopark: t.ajusteGeopark,
        disponibilidad: t.disponibilidad,
        salud: t.salud,
        pension: t.pension,
        sueldo_total: t.sueldoTotal,
        estado_flujo: 'BORRADOR',
        updated_at: new Date(),
      }

      if (hoja.liquidacionId) {
        await prisma.liquidaciones.update({
          where: { id: hoja.liquidacionId },
          data: { ...datos, actualizado_por_id: userId, version: { increment: 1 } },
        })
        return {
          ...base,
          estado: 'reemplazado',
          liquidacionId: hoja.liquidacionId,
          sueldoTotal: dec(t.sueldoTotal),
        }
      }

      const creada = await prisma.liquidaciones.create({
        data: {
          id: randomUUID(),
          ...datos,
          created_at: new Date(),
          creado_por_id: userId,
        },
      })
      await sembrarBonificacionesDesdeRecorridos(
        creada.id,
        hoja.conductorId,
        ventana.desde,
        ventana.hasta,
        userId,
      )

      /// La copia de los días: a partir de aquí el canvas lee de ella y el
      /// borrador se puede editar sin tocar la planilla.
      await copiarDiasDesdePlanillas(creada.id, hoja.dias as any)

      return {
        ...base,
        estado: 'creado',
        liquidacionId: creada.id,
        sueldoTotal: dec(t.sueldoTotal),
      }
    } catch (e: any) {
      return { ...base, estado: 'error', motivo: e?.message || 'Error al guardar' }
    }
  }

  private startCleanup() {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => {
      const ahora = Date.now()
      for (const [id, j] of this.jobs) {
        if (j.finishedAt && ahora - j.finishedAt > JOB_TTL_MS) this.jobs.delete(id)
      }
    }, CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref?.()
  }
}

/**
 * Crea las `bonificaciones` del borrador a partir de lo MARCADO EN RECORRIDOS.
 *
 * El generador creaba la fila de `liquidaciones` y ninguna bonificación, así
 * que un borrador recién hecho nacía con todos los bonos a cero aunque el
 * conductor los tuviera marcados tramo a tramo. Había que volver a meterlos a
 * mano, que es justo lo que el canvas de recorridos vino a evitar.
 *
 * La cantidad es el CONTEO de marcas por (bono, vehículo, mes): cada bono de
 * recorridos es una marca en un tramo. El precio unitario sale de la config del
 * bono, no del `valor` congelado en la marca, porque lo que se paga es la
 * tarifa vigente del año que se liquida.
 *
 * Solo escribe si no hay ya bonificaciones: un borrador que se rehace no debe
 * pisar las cantidades que alguien haya corregido a mano en el canvas.
 */
/**
 * Clave de una fila de `bonificaciones`: (bono, vehículo).
 *
 * UNA SOLA DEFINICIÓN, exportada, porque cruzar las dos fuentes solo se puede
 * por nombre —`bonificaciones` no guarda de qué configuración salió— y basta
 * con que dos sitios normalicen distinto para que el cruce falle en silencio:
 * el primer intento indexaba las marcas con el nombre crudo y las buscaba en
 * minúsculas, así que no casaba NINGUNA y «rehacer desde recorridos» duplicaba
 * cada bono en vez de corregirlo.
 *
 * Trim, minúsculas y espacios colapsados: el mismo emparejamiento permisivo
 * que usa `matrizDeBonos` para pintar la tabla.
 */
export function claveBono(nombre: unknown, vehiculoId: unknown): string {
  const n = String(nombre ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return `${n}|${vehiculoId ?? ''}`
}

export interface BonoMarcado {
  nombre: string
  vehiculoId: string
  valor: number
  /** `YYYY-MM → cuántas marcas`. */
  porMes: Map<string, number>
}

/**
 * Lo que RECORRIDOS dice que cobró este conductor entre dos fechas.
 *
 * Agrupado por (bono, vehículo) porque así es como vive en `bonificaciones`, y
 * con el conteo por mes porque un corte 21→20 cruza dos y la celda del canvas
 * es (bono × placa × MES).
 *
 * Se extrajo de `sembrarBonificacionesDesdeRecorridos` para que el sembrado
 * del borrador y el «rehacer desde recorridos» del canvas lean exactamente lo
 * mismo: si cada uno tuviera su consulta, el botón podría restaurar algo
 * distinto de lo que el generador habría sembrado, y nadie sabría cuál de los
 * dos miente.
 */
export async function bonosMarcadosEnRecorridos(
  conductorId: string,
  desde: string,
  hasta: string,
): Promise<Map<string, BonoMarcado>> {
  const marcas = await prisma.registro_dia_laboral_bono.findMany({
    where: {
      deleted_at: null,
      registro_dia: {
        deleted_at: null,
        conductor_id: conductorId,
        fecha: { gte: new Date(`${desde}T00:00:00.000Z`), lte: new Date(`${hasta}T23:59:59.999Z`) },
      },
    },
    select: {
      registro_dia: { select: { fecha: true } },
      segmento: { select: { vehiculo_id: true, deleted_at: true } },
      config_liquidacion: { select: { nombre: true, valor: true } },
    },
  })

  /** `nombre|vehiculo → { valor, porMes }`. */
  const agrupado = new Map<string, BonoMarcado>()

  for (const m of marcas) {
    // Un tramo retirado deja sus bonos vivos: el soft-delete no cascadea.
    if (m.segmento?.deleted_at) continue
    const vehiculoId = m.segmento?.vehiculo_id
    // Sin vehículo no hay a qué columna colgarlo: `bonificaciones` es por
    // vehículo y una fila sin él no se puede editar después desde el canvas.
    if (!vehiculoId) continue
    const nombre = String(m.config_liquidacion?.nombre ?? '').trim()
    if (!nombre) continue

    const mes = m.registro_dia.fecha.toISOString().slice(0, 7)
    const k = claveBono(nombre, vehiculoId)
    const item =
      agrupado.get(k) ??
      { nombre, vehiculoId, valor: dec(m.config_liquidacion?.valor), porMes: new Map<string, number>() }
    item.porMes.set(mes, (item.porMes.get(mes) ?? 0) + 1)
    agrupado.set(k, item)
  }

  return agrupado
}

export async function sembrarBonificacionesDesdeRecorridos(
  liquidacionId: string,
  conductorId: string,
  desde: string,
  hasta: string,
  userId: string,
): Promise<number> {
  const yaHay = await prisma.bonificaciones.count({
    where: { liquidacion_id: liquidacionId, deleted_at: null },
  })
  if (yaHay > 0) return 0

  const agrupado = await bonosMarcadosEnRecorridos(conductorId, desde, hasta)
  if (!agrupado.size) return 0

  const ahora = new Date()
  let creadas = 0
  for (const item of agrupado.values()) {
    const values = [...item.porMes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, quantity]) => ({ mes, quantity }))
    await prisma.bonificaciones.create({
      data: {
        id: randomUUID(),
        liquidacion_id: liquidacionId,
        vehiculo_id: item.vehiculoId,
        name: item.nombre,
        value: item.valor,
        values: JSON.stringify(values),
        creado_por_id: userId,
        created_at: ahora,
        updated_at: ahora,
      },
    })
    creadas++
  }
  return creadas
}

/**
 * Pisa las `bonificaciones` de una liquidación con lo MARCADO EN RECORRIDOS.
 *
 * Es el reverso del canvas: allí se teclea una cantidad y esta deja de salir
 * de recorridos para pasar a ser cifra propia de la liquidación —con su aviso
 * ámbar `n → m`—. Este botón deshace eso y vuelve a poner lo que dicen los
 * tramos.
 *
 * TRES REGLAS, y las tres importan:
 *
 * 1. **Solo se tocan los meses de la VENTANA.** `values` puede traer meses de
 *    fuera del corte —una liquidación vieja cuyo periodo no coincide con lo
 *    que se está mirando— y reescribir la lista entera los borraría. Las
 *    marcas se leen dentro de la ventana, así que fuera de ella no hay nada
 *    que decir.
 *
 * 2. **Un bono que la liquidación tiene y recorridos NO marca se pone a CERO,
 *    no se borra.** Es la misma regla que `aplicarBono`: un bono a cero es
 *    información («este vehículo no generó ninguno») y borrar la fila lo haría
 *    desaparecer de la tabla en vez de enseñar el cero.
 *
 * 3. **El precio unitario de una fila que ya existe NO se toca.** Lo que se
 *    restaura son las CANTIDADES, que es lo que se marca tramo a tramo. El
 *    precio es una decisión de nómina —puede haberse pactado distinto del de
 *    la config— y arrastrarlo aquí cambiaría dinero sin que nadie lo pidiera.
 *    Una fila que nace ahora sí toma el precio de la config, porque no tiene
 *    otro.
 *
 * Devuelve cuántas filas se crearon y cuántas celdas (bono × vehículo × mes)
 * cambiaron de verdad, para poder decirlo en vez de un «listo» mudo.
 */
export async function rehacerBonificacionesDesdeRecorridos(
  liquidacionId: string,
  conductorId: string,
  desde: string,
  hasta: string,
  meses: string[],
  userId: string,
): Promise<{ creadas: number; celdas: number }> {
  const agrupado = await bonosMarcadosEnRecorridos(conductorId, desde, hasta)
  const enVentana = new Set(meses)

  const existentes = await prisma.bonificaciones.findMany({
    where: { liquidacion_id: liquidacionId, deleted_at: null },
  })

  /** `values` como lista, tolerando basura. */
  const leer = (crudo: unknown): { mes: string; quantity: number }[] => {
    try {
      const parsed = JSON.parse(String(crudo ?? '[]'))
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((v: any) => typeof v?.mes === 'string')
        .map((v: any) => ({ mes: String(v.mes), quantity: Number(v.quantity) || 0 }))
    } catch {
      return []
    }
  }

  /** Deja la lista con `destino` en los meses de la ventana y el resto intacto. */
  const mezclar = (
    actual: { mes: string; quantity: number }[],
    destino: Map<string, number>,
  ): { lista: { mes: string; quantity: number }[]; cambios: number } => {
    const fuera = actual.filter((v) => !enVentana.has(v.mes))
    const dentro = new Map(actual.filter((v) => enVentana.has(v.mes)).map((v) => [v.mes, v.quantity]))
    let cambios = 0
    const lista = [...fuera]
    for (const mes of meses) {
      const nuevo = destino.get(mes) ?? 0
      if ((dentro.get(mes) ?? 0) !== nuevo) cambios++
      lista.push({ mes, quantity: nuevo })
    }
    lista.sort((a, b) => a.mes.localeCompare(b.mes))
    return { lista, cambios }
  }

  const ahora = new Date()
  let creadas = 0
  let celdas = 0

  const escrituras: any[] = []
  const vistos = new Set<string>()

  for (const b of existentes) {
    const k = claveBono(b.name, b.vehiculo_id)
    vistos.add(k)
    // Sin marca en recorridos, el destino es «cero en toda la ventana».
    const destino = agrupado.get(k)?.porMes ?? new Map<string, number>()
    const { lista, cambios } = mezclar(leer(b.values), destino)
    if (!cambios) continue
    celdas += cambios
    escrituras.push(
      prisma.bonificaciones.update({
        where: { id: b.id },
        data: { values: JSON.stringify(lista), updated_at: ahora },
      }),
    )
  }

  for (const [k, item] of agrupado) {
    if (vistos.has(k)) continue
    const { lista, cambios } = mezclar([], item.porMes)
    if (!cambios) continue
    celdas += cambios
    creadas++
    escrituras.push(
      prisma.bonificaciones.create({
        data: {
          id: randomUUID(),
          liquidacion_id: liquidacionId,
          vehiculo_id: item.vehiculoId,
          name: item.nombre,
          value: item.valor,
          values: JSON.stringify(lista),
          creado_por_id: userId,
          created_at: ahora,
          updated_at: ahora,
        },
      }),
    )
  }

  if (!escrituras.length) return { creadas: 0, celdas: 0 }

  /**
   * Todo o nada, y la VERSIÓN SUBE con ello.
   *
   * Esto reescribe varias filas hijas de golpe: a medias dejaría la hoja
   * mezclando bonos restaurados con bonos tecleados, que es peor que no haber
   * pulsado. Y subir `version` hace que los patches que otra persona tuviera
   * en vuelo choquen por compare-and-swap en vez de escribir encima de lo que
   * se acaba de restaurar.
   */
  await prisma.$transaction([
    ...escrituras,
    prisma.liquidaciones.update({
      where: { id: liquidacionId },
      data: { actualizado_por_id: userId, version: { increment: 1 }, updated_at: ahora },
    }),
  ])

  return { creadas, celdas }
}


/**
 * Días de un mes comercial. Es la base sobre la que se prorratea el sueldo y el
 * auxilio de transporte, y coincide con el divisor que ya usa `liquidar.ts`
 * (`salario / 30 * días`).
 */
const DIAS_MES_COMERCIAL = 30

/**
 * Copia los días del corte desde las planillas a la liquidación.
 *
 * Es lo que convierte el borrador en editable: a partir de aquí el canvas lee
 * de estas filas y no vuelve a mirar `recargos_planillas`. Se llama al crear el
 * borrador y cuando alguien pulsa «Actualizar desde planillas».
 *
 * REEMPLAZA, no mezcla. Un refresco existe justamente para volver al dato de
 * origen, así que las ediciones manuales de los días se pierden —es lo pedido—
 * y mezclarlas dejaría un borrador mitad suyo y mitad de la planilla sin que
 * nadie pudiera distinguirlo. Lo que NO toca son los bonos, las vacaciones ni
 * los campos del desprendible: esos no vienen de las planillas.
 *
 * Se borra en duro y no con soft-delete: son una copia reproducible, no un
 * documento. Guardar cada versión llenaría la tabla de historial que nadie
 * consulta, y el original sigue intacto en la planilla.
 */
export async function copiarDiasDesdePlanillas(
  liquidacionId: string,
  dias: { 
    fecha: string
    ocurrencia: number
    horaInicio: number | null
    horaFin: number | null
    totalHoras: number
    esFestivo: boolean
    esDomingo: boolean
    disponibilidad: boolean
    pernocte: boolean
    continuaSiguienteDia: boolean
    empresaId: string | null
    vehiculoId: string | null
    placa: string | null
    horas: Record<string, number>
  }[],
): Promise<number> {
  const ahora = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.liquidaciones_dias.deleteMany({ where: { liquidacion_id: liquidacionId } })
    if (!dias.length) return
    await tx.liquidaciones_dias.createMany({
      data: dias.map((d) => ({
        id: randomUUID(),
        liquidacion_id: liquidacionId,
        fecha: new Date(`${d.fecha}T00:00:00.000Z`),
        ocurrencia: d.ocurrencia,
        hora_inicio: d.horaInicio,
        hora_fin: d.horaFin,
        total_horas: d.totalHoras,
        es_festivo: d.esFestivo,
        es_domingo: d.esDomingo,
        disponibilidad: d.disponibilidad,
        pernocte: d.pernocte,
        continua_siguiente_dia: d.continuaSiguienteDia,
        empresa_id: d.empresaId,
        vehiculo_id: d.vehiculoId,
        placa: d.placa,
        horas: d.horas,
        created_at: ahora,
        updated_at: ahora,
      })),
    })
  })
  return dias.length
}

export const borradorNominaQueueService = new BorradorNominaQueueService()
