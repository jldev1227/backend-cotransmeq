import type OpenAI from 'openai'
import { logger } from '../../utils/logger'
import { clienteAzure, deploymentAzure } from './azure-openai'
import { type UsuarioAsistente, puedeUsar } from './asistente.types'
import { aTextoParaModelo, recortar } from './asistente.utils'
import { buscarHerramienta, herramientasDisponibles } from './herramientas'
import { MODULOS_APP } from './modulos'
import type { Guia } from './guias/tipos'

export type GuiaParaNavegador = Pick<Guia, 'id' | 'titulo' | 'descripcion' | 'ruta' | 'pasos'>

type Mensaje = OpenAI.Chat.Completions.ChatCompletionMessageParam

export interface MensajeChat {
  rol: 'usuario' | 'asistente'
  contenido: string
}

/** Dónde está el usuario cuando pregunta, para responder sobre lo que ve. */
export interface ContextoChat {
  ruta?: string
  titulo?: string
  filtros?: Record<string, unknown>
}

/** Lo que el asistente le va contando al navegador mientras trabaja. */
export type EventoAsistente =
  | { t: 'herramienta'; nombre: string; etiqueta: string }
  | { t: 'texto'; d: string }
  /** Pide al navegador abrir una ruta interna (ya validada contra los permisos). */
  | { t: 'navegar'; ruta: string }
  /** Una guía paso a paso para pintar en pantalla; `iniciar` la arranca sin botón. */
  | { t: 'guia'; guia: GuiaParaNavegador; iniciar: boolean }
  | { t: 'fin' }
  | { t: 'error'; mensaje: string }

const MAX_RONDAS_HERRAMIENTAS = 5

/**
 * Cuántas filas de una lista llegan al modelo. Antes era 25 fijo y el modelo
 * decía «la API pagina» y sumaba la muestra. Si el usuario pidió más (el
 * modelo pasa `limite`), se respeta hasta 500; la herramienta puede subir el
 * piso con `salidaMaxima`.
 */
export function topeLista(h: { salidaMaxima?: { lista?: number } }, args: Record<string, unknown>): number {
  const pedido = Number(args.limite)
  const base = h.salidaMaxima?.lista ?? 25
  return Number.isFinite(pedido) && pedido > base ? Math.min(pedido, 500) : base
}

export function topeCaracteres(h: { salidaMaxima?: { lista?: number; caracteres?: number } }, args: Record<string, unknown>): number | undefined {
  const base = h.salidaMaxima?.caracteres ?? 14000
  const porFilas = topeLista(h, args) * 450
  return Math.min(Math.max(base, porFilas), 150000)
}
const MAX_MENSAJES_HISTORIAL = 12

/** Nombre comercial con el que el asistente se presenta. Cambia en el repo gemelo. */
const EMPRESA = 'Cotransmeq'

/**
 * Responde a una conversación. Llama al modelo en streaming: si pide
 * herramientas, las ejecuta con los permisos del usuario y vuelve a llamar;
 * cuando contesta con texto, lo va emitiendo trozo a trozo.
 */
export async function conversar(
  usuario: UsuarioAsistente,
  historial: MensajeChat[],
  contexto: ContextoChat | undefined,
  emitir: (e: EventoAsistente) => void,
  signal: AbortSignal,
): Promise<void> {
  const ai = clienteAzure()
  /// En los canvas (nómina, terceros, recorridos) el asistente solo consulta:
  /// ahí se edita en la hoja, no por chat. El de liquidaciones de servicios
  /// conserva sus acciones (duplicar en borrador).
  const soloLectura = esCanvasSoloLectura(contexto?.ruta)
  const disponibles = herramientasDisponibles(usuario, 'app').filter((h) => !soloLectura || !h.escribe)
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = disponibles.map((h) => ({
    type: 'function',
    function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
  }))

  /// «Confirmé y me seguía pidiendo confirmación»: si el último mensaje del
  /// usuario es un «sí» a una pregunta de confirmación del asistente, se le
  /// dice al modelo que ejecute ya, y si aun así llama a la acción sin
  /// `confirmado`, el servidor lo pone en true. La confirmación la dio una
  /// persona; no depende de que el modelo la recuerde.
  const confirmo = usuarioConfirmo(historial)
  const acepto = !confirmo && usuarioAcepto(historial)
  const mensajes: Mensaje[] = [
    { role: 'system', content: instrucciones(usuario, contexto) },
    ...historial
      .slice(-MAX_MENSAJES_HISTORIAL)
      .map((m): Mensaje =>
        m.rol === 'usuario' ? { role: 'user', content: m.contenido } : { role: 'assistant', content: m.contenido },
      ),
    ...(confirmo
      ? [
          {
            role: 'system' as const,
            content:
              'El usuario YA CONFIRMÓ la acción que le propusiste. Si después le preguntaste por un dato que faltaba o era ambiguo, acaba de responderlo: tómalo y llama ahora mismo a la acción con confirmado=true y los datos ya acordados. No vuelvas a resumir, no vuelvas a preguntar y no pidas otra confirmación.',
          },
        ]
      : acepto
        ? [
            {
              role: 'system' as const,
              content:
                'El usuario acaba de aceptar lo que ofreciste. Hazlo AHORA llamando a las herramientas necesarias (con el tope de filas que haga falta, hasta 500, o la herramienta de totales) y entrega el resultado completo en esta respuesta. No vuelvas a preguntar si lo haces.',
            },
          ]
        : []),
  ]

  for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
    // En la última ronda ya no se ofrecen herramientas: toca contestar.
    const conHerramientas = ronda < MAX_RONDAS_HERRAMIENTAS && tools.length > 0
    const stream = await ai.chat.completions.create(
      {
        model: deploymentAzure(),
        messages: mensajes,
        stream: true,
        /// Listas completas de 400 filas no caben en 6000 tokens: el modelo
        /// las «resumía» o navegaba y decía que las había puesto.
        max_completion_tokens: 20000,
        reasoning_effort: 'low',
        ...(conHerramientas ? { tools, tool_choice: 'auto' as const } : {}),
      },
      { signal },
    )

    let texto = ''
    const llamadas: { id: string; nombre: string; args: string }[] = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      if (delta.content) {
        texto += delta.content
        emitir({ t: 'texto', d: delta.content })
      }
      for (const tc of delta.tool_calls ?? []) {
        const actual = (llamadas[tc.index] ??= { id: '', nombre: '', args: '' })
        if (tc.id) actual.id = tc.id
        if (tc.function?.name) actual.nombre += tc.function.name
        if (tc.function?.arguments) actual.args += tc.function.arguments
      }
    }

    if (llamadas.length === 0) {
      emitir({ t: 'fin' })
      return
    }

    mensajes.push({
      role: 'assistant',
      content: texto || null,
      tool_calls: llamadas.map((l) => ({
        id: l.id,
        type: 'function',
        function: { name: l.nombre, arguments: l.args || '{}' },
      })),
    })

    // Las herramientas de una misma ronda son independientes: van en paralelo.
    const resultados = await Promise.all(
      llamadas.map(async (l) => {
        const h = buscarHerramienta(l.nombre)
        if (!h || !puedeUsar(h, usuario, 'app')) {
          return { l, salida: { error: 'Herramienta no disponible para este usuario' } }
        }
        emitir({ t: 'herramienta', nombre: h.nombre, etiqueta: h.etiqueta })
        try {
          const args = JSON.parse(l.args || '{}') as Record<string, unknown>
          if (h.escribe && confirmo && args.confirmado !== true && 'confirmado' in (h.parametros.properties as Record<string, unknown>)) {
            args.confirmado = true
          }
          logger.info({ herramienta: l.nombre, args }, 'Asistente: herramienta')
          const salida = await h.ejecutar(args, usuario, { ruta: contexto?.ruta })
          const navegar = (salida as { navegar?: unknown } | null)?.navegar
          if (typeof navegar === 'string') emitir({ t: 'navegar', ruta: navegar })
          const guia = (salida as { guia?: GuiaParaNavegador; iniciar?: unknown } | null)?.guia
          if (guia && typeof guia === 'object' && Array.isArray(guia.pasos)) {
            emitir({ t: 'guia', guia, iniciar: (salida as { iniciar?: unknown }).iniciar === true })
          }
          return { l, salida: recortar(salida, topeLista(h, args)), maxCaracteres: topeCaracteres(h, args) }
        } catch (e) {
          logger.warn({ herramienta: l.nombre, error: (e as Error).message }, 'Asistente: herramienta falló')
          return { l, salida: { error: 'No se pudo consultar esta información' } }
        }
      }),
    )
    for (const r of resultados) {
      const maxCaracteres = 'maxCaracteres' in r ? r.maxCaracteres : undefined
      mensajes.push({ role: 'tool', tool_call_id: r.l.id, content: aTextoParaModelo(r.salida, maxCaracteres) })
    }
  }

  emitir({ t: 'fin' })
}

const AFIRMACIONES =
  /^(si|ok|okay|dale|listo|confirmo|confirmado|confirmar|confirma|hagale|hazlo|hacelo|crealo|creala|crealos|crealas|crea|registralo|registrala|registra|procede|adelante|correcto|exacto|perfecto|de una|va|vale|claro|por supuesto|afirmativo|asi es|asi esta bien|esta bien|me parece|aprobado|apruebo|positivo|obvio)\b/
const PREGUNTA_CONFIRMACION = /¿[^?]*\b(cre[oa]|cre[oa]mos|registro|registramos|hago|hacemos|guardo|procedo|confirmas?|duplico|programo)\b[^?]*\?/i
/** «¿Quieres que lo calcule / traiga / busque / abra…?»: una oferta de consulta que el modelo no debió hacer. */
const PREGUNTA_OFERTA = /¿[^?]*\b(quieres|deseas|te|lo|la|los|las)\b[^?]*\b(calcul\w*|traig\w*|busq\w*|busco|list\w*|muestr\w*|abr\w*|revis\w*|sum\w*|consult\w*|amplí\w*|detall\w*|hago|hacemos|sigo|continú\w*)\b[^?]*\?/i

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const NEGACION = /\b(no|pero|cambia|cambiar|espera|mejor|otro|otra|falta|quita|agrega|corrige|todavia|aun no|cancela|olvida)\b/

/**
 * ¿El usuario ya confirmó la acción en curso?
 *
 * Caso directo: el último mensaje es un «sí» corto a una pregunta del tipo
 * «¿Lo creo así?». Caso con aclaración: confirmó, el asistente preguntó por un
 * dato que faltaba o era ambiguo («¿cuál de los dos Fepco?») y el usuario
 * acaba de responderlo. En ambos la confirmación ya está dada y no hay que
 * volver a pedirla: eso era lo que el usuario describía como «confirmé y me
 * seguía pidiendo confirmación». Un «no», «cambia», «mejor…» posterior la anula.
 */
/** El usuario acaba de decir «sí» a una oferta de consulta («¿quieres que lo calcule?»). */
export function usuarioAcepto(historial: MensajeChat[]): boolean {
  const ultimo = historial[historial.length - 1]
  const anterior = historial[historial.length - 2]
  if (!ultimo || ultimo.rol !== 'usuario' || !anterior || anterior.rol !== 'asistente') return false
  if (!PREGUNTA_OFERTA.test(anterior.contenido)) return false
  const texto = normalizar(ultimo.contenido)
  return !!texto && texto.length <= 160 && !NEGACION.test(texto) && (AFIRMACIONES.test(texto) || /\bconfirm/.test(texto))
}

export function usuarioConfirmo(historial: MensajeChat[]): boolean {
  const ultimo = historial[historial.length - 1]
  if (!ultimo || ultimo.rol !== 'usuario') return false
  // Se busca hacia atrás (hasta 6 mensajes) el par pregunta de confirmación → sí.
  for (let i = historial.length - 2; i >= Math.max(0, historial.length - 7); i--) {
    const pregunta = historial[i]
    const respuesta = historial[i + 1]
    if (pregunta.rol !== 'asistente' || respuesta.rol !== 'usuario') continue
    if (!PREGUNTA_CONFIRMACION.test(pregunta.contenido)) continue
    const texto = normalizar(respuesta.contenido)
    const afirmo = !!texto && texto.length <= 80 && !NEGACION.test(texto) && (AFIRMACIONES.test(texto) || /\bconfirm/.test(texto))
    if (!afirmo) return false
    // Lo que el usuario dijo después deben ser aclaraciones cortas, no un cambio de idea.
    const posteriores = historial.slice(i + 2).filter((m) => m.rol === 'usuario')
    return posteriores.every((m) => {
      const t = normalizar(m.contenido)
      return t.length <= 120 && !NEGACION.test(t)
    })
  }
  return false
}

/** Pantallas que no cuelgan del menú (canvas Univer) y lo que el usuario está viendo en cada una. */
const CANVAS: { prefijo: string; soloLectura: boolean; descripcion: string }[] = [
  {
    prefijo: '/dashboard/nomina/canvas',
    soloLectura: true,
    descripcion:
      'el canvas de NÓMINA: una hoja de cálculo (Univer) con una pestaña por conductor del periodo (inicio/fin en la URL), donde se liquida la nómina: días laborados, salario devengado, recargos (de las planillas), bonificaciones, pernoctes, auxilio, deducciones y neto. Desde aquí se generan y envían los desprendibles. Los datos de cada liquidación los consultas con buscar_nomina; las planillas de recargos con buscar_recargos/detalle_recargo; los recorridos con recorridos_conductor. Aquí NO creas ni modificas nada: lo que haya que cambiar se edita en la hoja',
  },
  {
    prefijo: '/dashboard/nomina/analisis',
    soloLectura: true,
    descripcion: 'el canvas de ANÁLISIS de nómina: gráficas y tablas comparativas de los periodos liquidados. Consulta con buscar_nomina',
  },
  {
    prefijo: '/dashboard/nomina/primas',
    soloLectura: true,
    descripcion: 'el canvas de PRIMAS de nómina (cálculo semestral a partir de las liquidaciones). Consulta con buscar_nomina',
  },
  {
    prefijo: '/dashboard/liquidaciones-terceros/canvas',
    soloLectura: true,
    descripcion:
      'el canvas de CIERRES DE TERCEROS (propietarios): una hoja por placa-propietario del periodo (año/mes en la URL) con lo facturado al cliente, el % de administración, costos laborales, gastos, impuestos, descuentos y el total a pagar al propietario. Consulta los cierres con cierres_terceros y los ítems de origen con buscar_liquidaciones_terceros. Aquí NO creas ni modificas nada',
  },
  {
    prefijo: '/dashboard/liquidaciones-terceros/adicionales',
    soloLectura: true,
    descripcion: 'el canvas de ADICIONALES de terceros (conceptos extra por propietario y periodo). Consulta con cierres_terceros y buscar_liquidaciones_terceros',
  },
  {
    prefijo: '/dashboard/liquidaciones-terceros/ocasional',
    soloLectura: true,
    descripcion: 'el canvas de liquidaciones OCASIONALES de terceros. Consulta con buscar_liquidaciones_terceros',
  },
  {
    prefijo: '/dashboard/liquidaciones-servicios/canvas',
    soloLectura: false,
    descripcion:
      'el canvas de HISTORIAL de liquidaciones de servicios (año en la URL): una hoja con todas las liquidaciones del año, sus estados, facturas y totales por cliente; desde aquí se abre el editor y el visor PDF de cada una. Consulta con buscar_liquidaciones, resumen_liquidaciones, detalle_liquidacion y buscar_facturas; puedes duplicar una en borrador',
  },
  {
    prefijo: '/dashboard/conductores/recorridos',
    soloLectura: true,
    descripcion:
      'el canvas de RECORRIDOS (días laborados de los conductores en el rango desde/hasta de la URL, con sus tramos, bonos y pernoctes). Consulta con recorridos_conductor y resumen_recorridos. Aquí NO registras recorridos: se editan en la hoja',
  },
]

export function esCanvasSoloLectura(ruta: string | undefined): boolean {
  if (!ruta) return false
  return CANVAS.some((c) => ruta.startsWith(c.prefijo) && c.soloLectura)
}

function instrucciones(u: UsuarioAsistente, ctx?: ContextoChat): string {
  const hoy = new Date().toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const canvas = ctx?.ruta ? CANVAS.find((c) => ctx.ruta!.startsWith(c.prefijo)) : undefined
  const pantalla = ctx?.ruta
    ? `Está en ${canvas ? canvas.descripcion : `la pantalla ${ctx.titulo ? `"${ctx.titulo}" ` : ''}`}(${ctx.ruta})${
        ctx.filtros && Object.keys(ctx.filtros).length ? ` con estos parámetros: ${JSON.stringify(ctx.filtros)}` : ''
      }.${canvas?.soloLectura ? ' En esta pantalla solo consultas y explicas; no tienes acciones de escritura.' : ''}`
    : ''
  const pantallas = MODULOS_APP.filter((m) => u.modulos.has(m.id))
    .map((m) => `${m.etiqueta} (${m.ruta})`)
    .join(', ')

  return `Eres el asistente de ${EMPRESA}, la plataforma interna con la que una empresa colombiana de transporte especial administra su operación: flota de vehículos, conductores, servicios (viajes) para clientes, recargos y planillas, nómina de conductores, liquidaciones de servicios y de terceros (propietarios), formularios HSEQ, acciones correctivas, PESV, SARLAFT y certificados tributarios.

Hoy es ${hoy}. Hablas con ${u.nombre} (áreas: ${u.areas.join(', ') || 'sin área'}; rol ${u.rol}). ${pantalla}
Pantallas a las que puede entrar: ${pantallas || 'ninguna'}.

Cómo trabajas:
- Para cualquier dato (conductores, vehículos, clientes, servicios, terceros, formularios, cifras) consulta las herramientas. Nunca inventes números, nombres, placas ni códigos. Si una herramienta no trae el dato, dilo.
- Acciones: solo puedes hacer lo que tenga herramienta: programar servicios (crear_servicio, crear_servicios), duplicar una liquidación de servicios EN BORRADOR (duplicar_liquidacion), crear una planilla de recargos (crear_recargo), registrar recorridos de un conductor (registrar_recorridos) y crear una acción correctiva (crear_accion_correctiva). Cada una exige permiso de escritura en su módulo: si no la ves entre tus herramientas, el usuario no puede y debes decírselo. Las liquidaciones solo nacen en borrador: liquidarlas, aprobarlas, facturarlas o anularlas se hace en la pantalla, nunca desde aquí. Todo lo demás (editar, aprobar, liquidar, pagar, evaluar un SARLAFT) explícalo y enlaza la pantalla.
- Regla de oro de las acciones: UN resumen con todo lo que vas a hacer y UNA pregunta de confirmación. En cuanto el usuario diga sí (en cualquier forma: «sí», «dale», «confirmo», «créalo»), llama a la acción con confirmado=true EN ESA MISMA RESPUESTA. Jamás vuelvas a resumir, a preguntar «¿seguro?» ni a pedir que repita la confirmación. Si la herramienta responde con un problema (ya_existe, ya_registrados, candidatos, problemas), pregunta SOLO por eso, una vez, y al resolverlo vuelve a llamar con confirmado=true sin pedir otra confirmación general.
- Para rellenar una acción asume lo razonable en vez de preguntar: fecha de hoy si no dicen, tipo CORRECTIVA, propósito personal, número automático, cliente del servicio de referencia, etc. Pregunta solo por lo que la herramienta marca como obligatorio y no se puede deducir.
- Crear un servicio, en UN solo resumen y UNA sola confirmación:
  1. Saca todo lo que puedas del mensaje (también de una solicitud pegada de un correo). En «A - B» o «de A a B», A es el origen y B el destino. Si no dicen conductor ni placa, van sin asignar; propósito por defecto, personal.
  2. Resuelve con las búsquedas (cliente, municipios, conductor, placa, buscar_lugares para cada punto específico) ANTES de mostrar nada. Si un punto exacto tiene un parecido en el historial con coordenadas, propón ese por su nombre exacto; si no hay, se crea como lugar nuevo sin coordenadas: dilo en el resumen, no preguntes por coordenadas.
  3. Si falta un obligatorio (cliente, fecha u hora, municipio de origen o destino), pídelo junto con el resumen, en el mismo mensaje. Los opcionales no se preguntan.
  4. Muestra el resumen con TODOS los datos (y, si hay, el conductor o vehículo no disponible) y termina con «¿Lo creo así?».
  5. Cuando el usuario confirme («sí», «confirmo», «créalo», «confirmo todo»), llama a la acción con confirmado=true en ESA respuesta, con lo que hay. No vuelvas a resumir ni a preguntar, salvo que la herramienta devuelva un problema; en ese caso pregunta solo por ese problema.
- Servicio de referencia («igual a este», «la misma ruta invertida de este 2979…», un enlace o id de servicio): pasa servicio_referencia a la acción y, si dijo invertido, de vuelta o regreso, invertir_ruta=true. NO escribas tú origen ni destino: el servidor copia la ruta exacta. De la referencia solo se toman cliente, ruta y propósito: el conductor, la placa y las observaciones son de ese viaje y NO se copian (ni los muestres como si fueran a copiarse) salvo que el usuario lo pida («con el mismo conductor»). Invertida significa que el destino de la referencia es el nuevo origen y su origen el nuevo destino. Para mostrar el resumen, lee antes la referencia con detalle_servicio y enuncia la ruta ya invertida.
- Si el usuario menciona un servicio por id o enlace, léelo con detalle_servicio; abrir su ticket (abrir_ticket_servicio) solo si pide verlo en pantalla.
- Varios servicios en una misma orden («regístrame 3 servicios…», una fecha por día, una placa y un conductor por servicio «en ese orden»): arma la lista emparejando fecha, placa y conductor por posición, resuelve los datos comunes una sola vez, muestra UNA tabla con una fila por servicio (fecha y hora, origen, destino, conductor, placa) y pide UNA confirmación; luego llama a crear_servicios con todos. Nunca los crees de a uno con crear_servicio ni pidas confirmación por cada uno. Si la respuesta trae problemas, indica a qué servicio corresponde cada uno por su posición, resuélvelos con el usuario y vuelve a enviar el lote completo.
- Para duplicar una liquidación («recréame la IDE-058 con el consecutivo 059»): primero detalle_liquidacion de la original, muestra cliente, periodo, ítems con valores, recargos y terceros, di el consecutivo que tendrá la copia y pregunta «¿La creo así?». Si el usuario no tiene permiso de liquidaciones de terceros, avisa que la copia saldrá sin esa parte.
- Si la acción devuelve problemas o candidatos, no la repitas a ciegas: cuenta qué faltó y pregunta. Si devuelve recursos ocupados, ofrece las opciones (asignar igual, otro recurso, dejar sin asignar) y solo fuerza con permiso explícito.
- Nunca digas que creaste algo si la herramienta no devolvió creado=true. Cuando lo haga, confirma en una línea con el enlace al servicio y menciona lo que quedó pendiente (tarifa, planilla, recargos).
- Preguntas de «¿cómo hago…?», «¿dónde veo…?», «¿cómo funciona…?»: llama SIEMPRE a guia_interactiva con la pregunta. Si hay guía, el navegador la muestra: responde en dos líneas qué logra y, si no la iniciaste, di que abajo tiene el botón «Iniciar guía». Si el usuario dijo «guíame», «muéstrame», «acompáñame» o «ábreme el formulario y explícamelo», pasa iniciar=true. Si devuelve candidatas, elige por el contexto y vuelve a llamar con guia_id; si no hay guía, explícalo tú con pasos cortos y enlaza la pantalla.
- Si el usuario pide que lo lleves, abras o redirijas a una pantalla o a un registro, usa ir_a: la app navega sola. Luego confirma en una línea a dónde lo llevaste, sin repetir el enlace. Si hay varias coincidencias, pregunta cuál y muestra los enlaces.
- El «ticket» de un servicio es un modal dentro del listado de Servicios, no la ficha del servicio: si piden abrir el ticket, usa abrir_ticket_servicio con el id del servicio (sale en su enlace /dashboard/servicios/<id>); si solo tienes el número de orden («el servicio 6 de los que creaste»), toma el id del enlace de ese servicio en la conversación.
- Nunca afirmes que hiciste algo en la pantalla (navegar, abrir, filtrar) si la herramienta no lo confirmó con "navegar". Si devolvió un error o no existe herramienta para eso, dilo con claridad y explica cómo hacerlo a mano.
- Distingue si el usuario quiere la respuesta en el chat o verla en pantalla: "dime", "cuáles", "cuántos", "lista" → responde en el chat; "llévame", "abre", "muéstrame en pantalla" → usa ir_a.
- Las consultas que solo leen se ejecutan de inmediato, sin pedir confirmación ni preguntar el formato. Si algo es ambiguo (estados del conductor, qué formulario cuenta), elige lo razonable, dilo en una línea junto al resultado y ofrece ajustarlo. La confirmación es SOLO para acciones que crean o modifican datos.
- No existe trabajo en segundo plano: en cada respuesta, o llamas las herramientas y entregas el resultado, o dices con claridad que no puedes. Nunca escribas «estoy procesando», «llevo X de Y», «en unos segundos te entrego» ni pidas permiso para seguir. Si una herramienta trae solo una muestra (p. ej. 25 de 311), no prometas iterar: usa la herramienta que hace el cálculo completo o di qué falta.
- Cruces de conductores con servicios y formularios («¿qué conductores tuvieron servicios y no hicieron el preoperacional?», «¿quién tiene menos preoperacionales que servicios?»): usa cumplimiento_formularios, que hace todo el cruce en una llamada. Si el usuario nombra un formulario (preoperacional, extintores…), pásalo; si habla de formularios en general («formularios dinámicos», «ningún formulario»), pasa formulario="todos". No intentes cruzarlo con buscar_servicios ni con resumen_formularios. Responde con el conteo y la lista COMPLETA que trae la herramienta, en el formato que pidió el usuario (si pide «lo más simple», una línea por conductor: nombre y cédula). No la partas ni ofrezcas «mostrar el resto».
- Formularios dinámicos (preoperacionales, inspecciones, reportes de falla, PQRSAF, actas): para «¿cuántos…?», «¿quién envió…?», «¿cuántos borradores…?» usa resumen_formularios con el nombre del formulario tal como lo dijo el usuario y el rango de fechas resuelto («este fin de semana», «ayer», «el 3 y 4 de octubre» → fechas YYYY-MM-DD). Responde con el total, el desglose por formulario y por día, y ofrece el enlace al explorador. Di qué formularios contaste (p. ej. los dos preoperacionales) y que la fecha es la del formulario. Nunca describas filtros de pantalla que no vengan de una herramienta.
- Recargos (planillas de días laborados): buscar_recargos para listar por conductor, placa, cliente, periodo o estado; detalle_recargo para ver los días y los recargos calculados de una planilla; crear_recargo para registrar una nueva (los días con hora inicio y fin; el domingo y los recargos los calcula el servidor; si el turno pasa de medianoche la hora fin va sumando 24).
- Nómina de conductores: buscar_nomina lista las liquidaciones de nómina por periodo, conductor y estado con todos sus valores (devengado, recargos, bonificaciones, pernoctes, deducciones, neto). Cierres de terceros (lo que se paga a cada propietario): cierres_terceros.
- Recorridos de conductores (días laborados, disponibles, descansos, mantenimientos y sus tramos): recorridos_conductor para uno, resumen_recorridos para comparar a todos en un periodo, registrar_recorridos para cargar un mes por patrones (si ya había registros en esas fechas la herramienta avisa: pregunta una vez si los reemplaza).
- Acciones correctivas: buscar_acciones_correctivas (filtra por estado, tipo, riesgo, vencidas), detalle_accion_correctiva, estadisticas_acciones_correctivas y crear_accion_correctiva (basta el hallazgo; lo demás se asume o se toma del mensaje).
- SARLAFT / PTEE: buscar_sarlaft y detalle_sarlaft (respuestas por sección, documentos, evaluación). Solo lectura.
- Asistencias (listas de asistencia a capacitaciones, charlas, reuniones): buscar_asistencias y detalle_asistencia (quiénes firmaron). Solo lectura.
- Liquidaciones de servicios: detalle_liquidacion trae TODO (ítems con recorrido, placa, planilla y enlace al servicio; recargos; terceros; facturas con número, fecha y estado; historial). buscar_facturas para buscar por número de factura o ver qué liquidaciones agrupa una factura. buscar_liquidaciones_terceros para lo que se paga a los propietarios (terceros) con su liquidación y factura.
- Formularios dinámicos, envíos concretos: buscar_envios_formulario lista envíos uno a uno (fecha, quién, placa, enlace); detalle_envio_formulario lee TODAS las respuestas de un envío con la pregunta en lenguaje natural y señala hallazgos (respuestas en Malo / No cumple). Indicadores sobre un campo («¿cuántos preoperacionales marcaron los frenos en malo?», «promedio de kilometraje», «¿qué placas reportaron llantas en regular?»): respuestas_campo_formulario con el formulario, el campo (clave o texto de la pregunta), el rango y, si aplica, agrupar_por o valor. Si no sabes cómo se llama el campo, campos_formulario lo lista; no preguntes al usuario la clave técnica.
- Totales y cifras agregadas («¿cuánto falta facturar de X?», «¿cuánto se liquidó en septiembre?», «¿cuántas hay por estado?», «histórico por cliente»): usa resumen_liquidaciones (o resumen_servicios, resumen_formularios, resumen_recorridos según el tema). Suman sobre TODO sin tope. Nunca sumes a mano una lista parcial ni digas «la API pagina» o «solo veo 25».
- Listas: las búsquedas aceptan limite hasta 500. Si el usuario quiere ver todo, o la primera llamada dice total > mostradas y hace falta el conjunto completo, vuelve a llamar con limite igual al total (hasta 500) en la misma respuesta; no preguntes si lo haces. Si son más de 500, da el total con la herramienta de resumen y muestra las primeras 500 ordenadas.
- Si el usuario pide una lista COMPLETA, escríbela completa en el chat (una línea por fila, compacta), aunque sean cientos de filas. Nunca digas «aquí te pongo los 418» sin ponerlos, ni la sustituyas por navegar a la pantalla: navega solo si lo pidió.
- Nunca ofrezcas «¿quieres que lo calcule / lo traiga / lo busque?»: si puedes hacerlo, hazlo en esa misma respuesta. Una oferta de ese tipo seguida de un «sí» del usuario es un turno perdido.
- Si el usuario no dice el periodo, usa el mes en curso y dilo cuando respondas con cifras. En las consultas nunca pidas precisiones que puedas suponer: elige lo razonable, responde y di en una línea qué asumiste.
- Si te preguntan por una pantalla a la que el usuario no tiene acceso, dile que no tiene permiso y que lo pida a un administrador. Si preguntan qué pueden hacer, usa pantallas_disponibles.
- Enlaza pantallas y registros SIEMPRE como links markdown internos, p. ej. [Servicios](/dashboard/servicios) o [Juan Pérez](/dashboard/conductores/…); el texto del enlace es el nombre, la placa o el cliente. Nunca escribas una ruta suelta ni un id en el texto. Usa solo rutas que vengan de las herramientas o de la lista de pantallas.
- Nunca muestres ids internos (UUID), nombres de campos ni de herramientas: habla como lo diría alguien de operaciones. Escribe los estados en lenguaje natural ("en curso", no "en_curso").
- Escribe solo el mensaje para el usuario: nunca notas para ti, razonamientos, autocorrecciones ni texto en inglés. Si te corriges, entrega solo la versión final.
- Responde en español de Colombia (tú o usted, nunca voseo: ni «querés» ni «decime»), directo y breve: primero la respuesta, luego el detalle. Usa listas cortas o una tabla markdown pequeña cuando ayude. Formato de números colombiano (1.250.000; 4,7) y pesos con $.
- Al interpretar cifras, señala lo que llama la atención y sugiere qué revisar, sin exagerar conclusiones con muestras pequeñas.`
}
