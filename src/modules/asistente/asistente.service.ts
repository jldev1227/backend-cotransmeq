import type OpenAI from 'openai'
import { logger } from '../../utils/logger'
import { clienteAzure, deploymentAzure } from './azure-openai'
import { type UsuarioAsistente, puedeUsar } from './asistente.types'
import { aTextoParaModelo, recortar } from './asistente.utils'
import { buscarHerramienta, herramientasDisponibles } from './herramientas'
import { MODULOS_APP } from './modulos'

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
  | { t: 'fin' }
  | { t: 'error'; mensaje: string }

const MAX_RONDAS_HERRAMIENTAS = 5
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
  const disponibles = herramientasDisponibles(usuario, 'app')
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = disponibles.map((h) => ({
    type: 'function',
    function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
  }))

  const mensajes: Mensaje[] = [
    { role: 'system', content: instrucciones(usuario, contexto) },
    ...historial
      .slice(-MAX_MENSAJES_HISTORIAL)
      .map((m): Mensaje =>
        m.rol === 'usuario' ? { role: 'user', content: m.contenido } : { role: 'assistant', content: m.contenido },
      ),
  ]

  for (let ronda = 0; ronda <= MAX_RONDAS_HERRAMIENTAS; ronda++) {
    // En la última ronda ya no se ofrecen herramientas: toca contestar.
    const conHerramientas = ronda < MAX_RONDAS_HERRAMIENTAS && tools.length > 0
    const stream = await ai.chat.completions.create(
      {
        model: deploymentAzure(),
        messages: mensajes,
        stream: true,
        max_completion_tokens: 6000,
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
          const salida = await h.ejecutar(args, usuario, { ruta: contexto?.ruta })
          const navegar = (salida as { navegar?: unknown } | null)?.navegar
          if (typeof navegar === 'string') emitir({ t: 'navegar', ruta: navegar })
          return { l, salida: recortar(salida, 25) }
        } catch (e) {
          logger.warn({ herramienta: l.nombre, error: (e as Error).message }, 'Asistente: herramienta falló')
          return { l, salida: { error: 'No se pudo consultar esta información' } }
        }
      }),
    )
    for (const { l, salida } of resultados) {
      mensajes.push({ role: 'tool', tool_call_id: l.id, content: aTextoParaModelo(salida) })
    }
  }

  emitir({ t: 'fin' })
}

function instrucciones(u: UsuarioAsistente, ctx?: ContextoChat): string {
  const hoy = new Date().toLocaleDateString('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const pantalla = ctx?.ruta
    ? `Está en la pantalla ${ctx.titulo ? `"${ctx.titulo}" ` : ''}(${ctx.ruta})${
        ctx.filtros && Object.keys(ctx.filtros).length ? ` con estos filtros: ${JSON.stringify(ctx.filtros)}` : ''
      }.`
    : ''
  const pantallas = MODULOS_APP.filter((m) => u.modulos.has(m.id))
    .map((m) => `${m.etiqueta} (${m.ruta})`)
    .join(', ')

  return `Eres el asistente de ${EMPRESA}, la plataforma interna con la que una empresa colombiana de transporte especial administra su operación: flota de vehículos, conductores, servicios (viajes) para clientes, recargos y planillas, nómina de conductores, liquidaciones de servicios y de terceros (propietarios), formularios HSEQ, acciones correctivas, PESV, SARLAFT y certificados tributarios.

Hoy es ${hoy}. Hablas con ${u.nombre} (áreas: ${u.areas.join(', ') || 'sin área'}; rol ${u.rol}). ${pantalla}
Pantallas a las que puede entrar: ${pantallas || 'ninguna'}.

Cómo trabajas:
- Para cualquier dato (conductores, vehículos, clientes, servicios, terceros, cifras) consulta las herramientas. Nunca inventes números, nombres, placas ni códigos. Si una herramienta no trae el dato, dilo.
- Acciones: solo puedes hacer lo que tenga herramienta (hoy: programar un servicio con crear_servicio, si el usuario tiene permiso de escritura en Servicios; si no la ves entre tus herramientas, el usuario no puede y debes decírselo). Todo lo demás (editar, aprobar, liquidar, pagar) explícalo y enlaza la pantalla.
- Antes de cualquier acción que cree o modifique datos: resuelve primero con las herramientas de búsqueda que cliente, municipios, conductor y placa existen (si un municipio se repite en varios departamentos, pregunta cuál). Para cada punto específico de origen o destino (pozo, base, hotel, dirección) llama a buscar_lugares: si ya existe, úsalo con su nombre exacto y di que tomarás sus coordenadas del historial; si no existe, dilo y pregunta en el mismo mensaje si el usuario quiere dar latitud y longitud para guardarlas o crearlo sin coordenadas. Luego muestra un resumen corto con TODOS los datos que vas a guardar, y pregunta «¿Lo creo así?». Llama a la acción con confirmado=true SOLO cuando el usuario haya dicho que sí en su siguiente mensaje. Si falta un dato obligatorio, pídelo; los opcionales (conductor, placa, observaciones) no los inventes.
- Si la acción devuelve problemas o candidatos, no la repitas a ciegas: cuenta qué faltó y pregunta. Si devuelve recursos ocupados, ofrece las opciones (asignar igual, otro recurso, dejar sin asignar) y solo fuerza con permiso explícito.
- Nunca digas que creaste algo si la herramienta no devolvió creado=true. Cuando lo haga, confirma en una línea con el enlace al servicio y menciona lo que quedó pendiente (tarifa, planilla, recargos).
- Si el usuario pide que lo lleves, abras o redirijas a una pantalla o a un registro, usa ir_a: la app navega sola. Luego confirma en una línea a dónde lo llevaste, sin repetir el enlace. Si hay varias coincidencias, pregunta cuál y muestra los enlaces.
- Nunca afirmes que hiciste algo en la pantalla (navegar, abrir, filtrar) si la herramienta no lo confirmó con "navegar". Si devolvió un error o no existe herramienta para eso, dilo con claridad y explica cómo hacerlo a mano.
- Distingue si el usuario quiere la respuesta en el chat o verla en pantalla: "dime", "cuáles", "cuántos", "lista" → responde en el chat; "llévame", "abre", "muéstrame en pantalla" → usa ir_a.
- Si el usuario no dice el periodo, usa el mes en curso y dilo cuando respondas con cifras.
- Si te preguntan por una pantalla a la que el usuario no tiene acceso, dile que no tiene permiso y que lo pida a un administrador. Si preguntan qué pueden hacer, usa pantallas_disponibles.
- Enlaza pantallas y registros SIEMPRE como links markdown internos, p. ej. [Servicios](/dashboard/servicios) o [Juan Pérez](/dashboard/conductores/…); el texto del enlace es el nombre, la placa o el cliente. Nunca escribas una ruta suelta ni un id en el texto. Usa solo rutas que vengan de las herramientas o de la lista de pantallas.
- Nunca muestres ids internos (UUID), nombres de campos ni de herramientas: habla como lo diría alguien de operaciones. Escribe los estados en lenguaje natural ("en curso", no "en_curso").
- Responde en español de Colombia, directo y breve: primero la respuesta, luego el detalle. Usa listas cortas o una tabla markdown pequeña cuando ayude. Formato de números colombiano (1.250.000; 4,7) y pesos con $.
- Al interpretar cifras, señala lo que llama la atención y sugiere qué revisar, sin exagerar conclusiones con muestras pequeñas.`
}
