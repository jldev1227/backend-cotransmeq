export interface SugerenciaIA {
  plan_accion_sugerido: string
  responsables_recomendados: string[]
  plazo_recomendado_dias: number
  criterios_evaluacion: string[]
  indicadores_seguimiento: string[]
  riesgos_implementacion: string[]
  recursos_necesarios: string[]
  mejores_practicas: string[]
}

export interface SolicitudSugerenciaIA {
  analisis_causa: string // El "Por qué" que necesita solución
  orden_causa: number // 1er, 2do, 3er por qué, etc.
  descripcion_hallazgo: string // Contexto del hallazgo
  tipo_accion: 'CORRECTIVA' | 'PREVENTIVA' | 'MEJORA'
  valoracion_riesgo: 'ALTO' | 'MEDIO' | 'BAJO'
  lugar_sede?: string
  proceso_origen?: string
}

/**
 * Lista oficial de cargos en la estructura organizacional de Cotransmeq
 * Estos son los únicos cargos que la IA debe recomendar como responsables
 */
export const CARGOS_TRANSMERALDA = [
  'Coordinador HSEQ',
  'Gerente',
  'Líder de Operaciones',
  'Jefe de Mantenimiento',
  'Supervisor de Flota',
  'Coordinador de Calidad',
  'Coordinador de Sistemas',
  'Jefe de Talento Humano',
  'Coordinador Administrativo',
  'Líder PESV',
  'Auditor Interno',
  'Técnico de Mantenimiento',
  'Supervisor de Operaciones',
  'Coordinador de Gestión de Calidad',
  'Ingeniero de Mantenimiento'
] as const

export class IAsugerenciasService {
  private apiKey: string
  private endpoint: string
  private modelName: string

  constructor() {
    this.apiKey = process.env.MINISTRAL_API_KEY || ''
    this.endpoint = process.env.MINISTRAL_ENDPOINT || ''
    this.modelName = process.env.MINISTRAL_MODEL_NAME || 'Ministral-3B-2'

    if (!this.apiKey || !this.endpoint) {
      throw new Error('MINISTRAL_API_KEY y MINISTRAL_ENDPOINT deben estar configuradas en las variables de entorno')
    }
  }

  /**
   * Genera sugerencias inteligentes para el plan de acción de una causa específica
   */
  async generarSugerenciasPlanAccion(solicitud: SolicitudSugerenciaIA): Promise<SugerenciaIA> {
    const prompt = this.construirPrompt(solicitud)

    try {
      const response = await fetch(`${this.endpoint}/chat/completions?api-version=2024-05-01-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: 'Eres un experto en sistemas de gestión de calidad ISO 9001 y análisis de causa raíz. Respondes ÚNICAMENTE en formato JSON válido, sin texto adicional antes ni después.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2048,
          temperature: 0.7,
          model: this.modelName
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Error en API de Azure: ${response.status} - ${errorText}`)
      }

      const data = await response.json() as any
      const contenido = data.choices?.[0]?.message?.content

      if (!contenido) {
        throw new Error('Respuesta de IA no contiene contenido')
      }

      const sugerencia = this.parsearRespuestaIA(contenido)
      return sugerencia
    } catch (error) {
      console.error('Error al generar sugerencias con IA:', error)
      throw new Error(
        `Error al consultar API de Azure Ministral: ${error instanceof Error ? error.message : 'Error desconocido'}`
      )
    }
  }

  /**
   * Construye el prompt para la IA
   */
  private construirPrompt(solicitud: SolicitudSugerenciaIA): string {
    const listaCargos = CARGOS_TRANSMERALDA.join(', ')
    
    return `Eres un experto en sistemas de gestión de calidad ISO 9001 y análisis de causa raíz (5 Por qués).

CONTEXTO DEL PROBLEMA:
- Hallazgo identificado: ${solicitud.descripcion_hallazgo}
- Causa analizada (${solicitud.orden_causa}° Por qué): ${solicitud.analisis_causa}
- Tipo de acción: ${solicitud.tipo_accion}
- Nivel de riesgo: ${solicitud.valoracion_riesgo}
${solicitud.lugar_sede ? `- Sede/Lugar: ${solicitud.lugar_sede}` : ''}
${solicitud.proceso_origen ? `- Proceso origen: ${solicitud.proceso_origen}` : ''}

ESTRUCTURA ORGANIZACIONAL DE LA EMPRESA (Cotransmeq):
Cargos disponibles: ${listaCargos}.
IMPORTANTE: Los responsables recomendados deben ser EXCLUSIVAMENTE cargos de esta lista. No inventes cargos que no existan.

INSTRUCCIONES:
Proporciona una respuesta DETALLADA y PRÁCTICA en formato JSON estricto para ayudar a eliminar esta causa raíz.

Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta (sin comentarios ni texto adicional):

{
  "plan_accion_sugerido": "Descripción detallada y específica del plan de acción para eliminar esta causa. Debe ser SMART: Específico, Medible, Alcanzable, Relevante y con Tiempo definido. Mínimo 100 palabras.",
  "responsables_recomendados": ["Cargo o rol 1", "Cargo o rol 2", "Cargo o rol 3"],
  "plazo_recomendado_dias": 30,
  "criterios_evaluacion": [
    "Criterio medible 1 para verificar la eficacia",
    "Criterio medible 2",
    "Criterio medible 3"
  ],
  "indicadores_seguimiento": [
    "Indicador 1 (KPI con métrica específica)",
    "Indicador 2 (KPI con métrica específica)",
    "Indicador 3 (KPI con métrica específica)"
  ],
  "riesgos_implementacion": [
    "Riesgo 1 y su mitigación",
    "Riesgo 2 y su mitigación",
    "Riesgo 3 y su mitigación"
  ],
  "recursos_necesarios": [
    "Recurso humano, técnico o económico 1",
    "Recurso 2",
    "Recurso 3"
  ],
  "mejores_practicas": [
    "Mejor práctica 1 de la industria",
    "Mejor práctica 2",
    "Mejor práctica 3"
  ]
}

IMPORTANTE:
- Sé específico y práctico, no genérico
- Adapta las sugerencias al nivel de riesgo (${solicitud.valoracion_riesgo})
- Para riesgo ALTO: plazos cortos, seguimiento frecuente, múltiples responsables
- Para riesgo MEDIO: balance entre urgencia y recursos
- Para riesgo BAJO: optimización de procesos, mejora continua
- Considera el tipo de acción: ${solicitud.tipo_accion}
- Responde SOLO con el JSON, sin texto antes ni después`
  }

  /**
   * Parsea y valida la respuesta JSON de la IA
   */
  private parsearRespuestaIA(textoRespuesta: string): SugerenciaIA {
    try {
      // Limpiar posibles caracteres antes/después del JSON
      let jsonTexto = textoRespuesta.trim()

      // Buscar el inicio y fin del objeto JSON
      const inicioJson = jsonTexto.indexOf('{')
      const finJson = jsonTexto.lastIndexOf('}')

      if (inicioJson === -1 || finJson === -1) {
        throw new Error('No se encontró un objeto JSON válido en la respuesta')
      }

      jsonTexto = jsonTexto.substring(inicioJson, finJson + 1)

      const sugerencia = JSON.parse(jsonTexto) as SugerenciaIA

      // Validar estructura mínima
      this.validarSugerencia(sugerencia)

      return sugerencia
    } catch (error) {
      console.error('Error al parsear respuesta de IA:', error)
      console.error('Texto recibido:', textoRespuesta)
      throw new Error(
        `No se pudo parsear la respuesta de la IA: ${error instanceof Error ? error.message : 'Error desconocido'}`
      )
    }
  }

  /**
   * Valida que la sugerencia tenga la estructura correcta
   */
  private validarSugerencia(sugerencia: any): void {
    const camposRequeridos = [
      'plan_accion_sugerido',
      'responsables_recomendados',
      'plazo_recomendado_dias',
      'criterios_evaluacion',
      'indicadores_seguimiento',
      'riesgos_implementacion',
      'recursos_necesarios',
      'mejores_practicas'
    ]

    for (const campo of camposRequeridos) {
      if (!(campo in sugerencia)) {
        throw new Error(`Campo requerido faltante en respuesta de IA: ${campo}`)
      }
    }

    // Validar que los arrays no estén vacíos
    const camposArray = [
      'responsables_recomendados',
      'criterios_evaluacion',
      'indicadores_seguimiento',
      'riesgos_implementacion',
      'recursos_necesarios',
      'mejores_practicas'
    ]

    for (const campo of camposArray) {
      if (!Array.isArray(sugerencia[campo]) || sugerencia[campo].length === 0) {
        throw new Error(`El campo ${campo} debe ser un array no vacío`)
      }
    }

    // Validar que plan_accion_sugerido no esté vacío
    if (typeof sugerencia.plan_accion_sugerido !== 'string' || sugerencia.plan_accion_sugerido.length < 50) {
      throw new Error('El plan de acción debe tener al menos 50 caracteres')
    }

    // Validar que plazo_recomendado_dias sea un número positivo
    if (typeof sugerencia.plazo_recomendado_dias !== 'number' || sugerencia.plazo_recomendado_dias <= 0) {
      throw new Error('El plazo recomendado debe ser un número positivo')
    }
  }

  /**
   * Genera sugerencias para el seguimiento de una causa
   */
  async generarSugerenciasSeguimiento(
    causa_id: string,
    plan_accion: string,
    estado_actual: string,
    observaciones?: string
  ): Promise<{
    recomendaciones: string[]
    proximos_pasos: string[]
    alertas: string[]
  }> {
    const prompt = `Eres un experto en seguimiento de acciones correctivas y preventivas ISO 9001.

CONTEXTO:
- Plan de acción implementado: ${plan_accion}
- Estado actual: ${estado_actual}
${observaciones ? `- Observaciones: ${observaciones}` : ''}

Proporciona recomendaciones para el seguimiento en formato JSON:

{
  "recomendaciones": [
    "Recomendación específica 1",
    "Recomendación específica 2",
    "Recomendación específica 3"
  ],
  "proximos_pasos": [
    "Paso inmediato 1",
    "Paso inmediato 2",
    "Paso inmediato 3"
  ],
  "alertas": [
    "Punto de atención 1",
    "Punto de atención 2"
  ]
}

Responde SOLO con el JSON, sin texto adicional.`

    try {
      const response = await fetch(`${this.endpoint}/chat/completions?api-version=2024-05-01-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'system',
              content: 'Eres un experto en seguimiento de acciones correctivas. Respondes ÚNICAMENTE en formato JSON.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 1024,
          temperature: 0.7,
          model: this.modelName
        })
      })

      if (!response.ok) {
        throw new Error(`Error en API: ${response.status}`)
      }

      const data = await response.json() as any
      const contenido = data.choices?.[0]?.message?.content

      if (!contenido) {
        throw new Error('Sin contenido en respuesta')
      }

      // Extraer JSON de la respuesta
      let jsonTexto = contenido.trim()
      const inicioJson = jsonTexto.indexOf('{')
      const finJson = jsonTexto.lastIndexOf('}')

      if (inicioJson !== -1 && finJson !== -1) {
        jsonTexto = jsonTexto.substring(inicioJson, finJson + 1)
      }

      const resultado = JSON.parse(jsonTexto)
      return resultado
    } catch (error) {
      console.error('Error al generar sugerencias de seguimiento:', error)
      // Retornar valores por defecto en caso de error
      return {
        recomendaciones: ['Revisar el avance del plan de acción', 'Verificar cumplimiento de fechas'],
        proximos_pasos: ['Solicitar actualización de estado', 'Programar reunión de seguimiento'],
        alertas: ['Error al consultar IA para sugerencias personalizadas']
      }
    }
  }
}
