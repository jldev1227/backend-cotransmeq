import type { Herramienta, UsuarioAsistente } from '../asistente.types'
import { textoOpcional } from '../asistente.utils'
import { GUIAS, buscarGuia } from './catalogo'
import { elegirGuias, hayEmpate } from './elegir'
import type { Guia } from './tipos'

const JERARQUIA = ['limited', 'read', 'full'] as const

/** Las guías que este usuario puede seguir: mismo criterio que las herramientas. */
export function guiasPara(u: UsuarioAsistente): Guia[] {
  return GUIAS.filter((g) => {
    if (g.modulo === null) return true
    const nivel = u.modulos.get(g.modulo)
    if (!nivel) return false
    return !g.nivel || JERARQUIA.indexOf(nivel) >= JERARQUIA.indexOf(g.nivel)
  })
}

function resumen(g: Guia) {
  return { guia_id: g.id, titulo: g.titulo, descripcion: g.descripcion, pasos: g.pasos.length }
}

/**
 * Devuelve la guía como la pinta el navegador. `guia` en la salida es lo que
 * `asistente.service` convierte en el evento SSE `{t:'guia'}`.
 */
function salidaGuia(g: Guia, iniciar: boolean) {
  return {
    hayGuia: true,
    guia: { id: g.id, titulo: g.titulo, descripcion: g.descripcion, ruta: g.ruta, pasos: g.pasos },
    iniciar,
    pista: iniciar
      ? 'La guía ya arrancó en pantalla. Responde en una o dos líneas qué va a ver el usuario; no repitas los pasos.'
      : 'El usuario ve una tarjeta con el botón «Iniciar guía». Resume en dos líneas qué hace y dile que puede iniciarla abajo.',
  }
}

export const guiaInteractiva: Herramienta = {
  nombre: 'guia_interactiva',
  descripcion:
    'Busca la guía paso a paso que responde a un «¿cómo hago…?» o «¿dónde está…?» y la muestra en pantalla con un foco sobre cada elemento. Llámala siempre que el usuario pregunte cómo hacer algo en la app. Si devuelve candidatas, elige la que corresponda y vuelve a llamar con guia_id. Pasa iniciar=true cuando el usuario pida que lo guíes, se lo muestres o lo acompañes; si solo pregunta, déjala en false y se le ofrece el botón.',
  parametros: {
    type: 'object',
    properties: {
      pregunta: {
        type: 'string',
        description:
          'La frase del usuario TAL CUAL la escribió, sin reformular ni añadir contexto (añadir palabras como «liquidación» o «servicio» confunde la búsqueda)',
      },
      guia_id: { type: 'string', description: 'Id de una guía ya elegida (de candidatas o de la lista)' },
      iniciar: { type: 'boolean', description: 'true para arrancar la guía ya; false para ofrecerla' },
    },
    required: ['pregunta'],
    additionalProperties: false,
  },
  etiqueta: 'Buscando una guía',
  requiere: null,
  canales: ['app'],
  async ejecutar(args, usuario) {
    const disponibles = guiasPara(usuario)
    const iniciar = args.iniciar === true
    const id = textoOpcional(args.guia_id, 60)
    if (id) {
      const g = buscarGuia(id)
      if (!g) return { hayGuia: false, error: `No existe la guía «${id}»`, guias: disponibles.map(resumen) }
      if (!disponibles.includes(g)) return { hayGuia: false, error: 'El usuario no tiene acceso a esa pantalla' }
      return salidaGuia(g, iniciar)
    }
    const pregunta = textoOpcional(args.pregunta, 300) ?? ''
    const puntuadas = elegirGuias(pregunta, disponibles)
    if (puntuadas.length === 0) {
      return {
        hayGuia: false,
        mensaje: 'No hay una guía para eso. Explícalo con tus palabras y enlaza la pantalla; si alguna de estas se acerca, ofrécela.',
        guias: disponibles.map(resumen),
      }
    }
    if (hayEmpate(puntuadas)) {
      return {
        hayGuia: false,
        elegir: 'Varias guías encajan: elige la que corresponda por el contexto (o pregunta) y vuelve a llamar con guia_id',
        candidatas: puntuadas.slice(0, 4).map((p) => resumen(p.guia)),
      }
    }
    return salidaGuia(puntuadas[0].guia, iniciar)
  },
}
