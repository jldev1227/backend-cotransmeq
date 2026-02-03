import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

// Servicio de calificación con IA usando Ministral-3B de Azure
export class AIGradingService {
  private client: any;
  private endpoint: string;
  private modelName: string;
  private apiKey: string;
  
  constructor() {
    // Configuración de Ministral desde variables de entorno
    this.endpoint = process.env.MINISTRAL_ENDPOINT || "";
    this.modelName = process.env.MINISTRAL_MODEL_NAME || "Ministral-3B-2";
    this.apiKey = process.env.MINISTRAL_API_KEY || "";
    
    if (!this.apiKey || !this.endpoint) {
      console.warn('⚠️  Ministral API no configurado. Las preguntas de texto recibirán 0 puntos.');
      console.warn('⚠️  Configura MINISTRAL_API_KEY y MINISTRAL_ENDPOINT en .env');
      return;
    }
    
    try {
      this.client = ModelClient(this.endpoint, new AzureKeyCredential(this.apiKey));
      console.log('✅ Servicio de calificación con IA (Ministral-3B) inicializado');
    } catch (error) {
      console.error('❌ Error inicializando cliente de Ministral:', error);
    }
  }

  /**
   * Califica una respuesta de texto usando IA (Ministral-3B)
   * @param pregunta Texto de la pregunta
   * @param respuesta Respuesta del usuario
   * @param puntajeMaximo Puntaje máximo de la pregunta
   * @returns Puntaje asignado por la IA (0 a puntajeMaximo)
   */
  async gradeTextResponse(
    pregunta: string,
    respuesta: string,
    puntajeMaximo: number
  ): Promise<{ score: number; reasoning: string }> {
    
    // Si no hay configuración de Ministral, retornar 0
    if (!this.client || !this.apiKey || !this.endpoint) {
      return {
        score: 0,
        reasoning: 'Calificación manual requerida - Ministral API no configurado'
      };
    }

    try {
      const systemPrompt = `Eres un evaluador experto en procesos de selección laboral. Tu tarea es calificar respuestas de manera justa y objetiva.

IMPORTANTE: Debes responder ÚNICAMENTE con JSON válido, sin texto adicional antes o después.`;

      const userPrompt = `Analiza y califica esta respuesta de un candidato:

PREGUNTA:
${pregunta}

RESPUESTA DEL CANDIDATO:
${respuesta}

CRITERIOS DE EVALUACIÓN:
1. ¿La respuesta está relacionada con la pregunta?
2. ¿El candidato proporciona información útil?
3. ¿La respuesta muestra actitud o experiencia relevante?
4. ¿La respuesta es coherente, aunque sea breve?

INSTRUCCIONES DE CALIFICACIÓN:
- Puntaje máximo posible: ${puntajeMaximo} puntos
- Si la respuesta NO tiene relación con la pregunta o es muy vaga (ej: "sí", "no"): 0 puntos
- Si la respuesta está relacionada pero es muy breve o general: ${Math.ceil(puntajeMaximo / 2)} puntos
- Si la respuesta es buena, relevante y aporta información útil: ${puntajeMaximo} puntos

SÉ FLEXIBLE: Una respuesta corta pero relevante puede tener puntaje parcial. No exijas respuestas perfectas.

Responde ÚNICAMENTE en formato JSON con esta estructura exacta:
{
  "puntaje": <número entre 0 y ${puntajeMaximo}>,
  "razonamiento": "<breve explicación de 1-2 líneas>"
}`;

      // Llamar a Ministral API
      const response = await this.client.path("/chat/completions").post({
        body: {
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: userPrompt
            }
          ],
          model: this.modelName,
          max_tokens: 300,
          temperature: 0.2  // Temperatura moderada para balance entre consistencia y flexibilidad
        }
      });

      if (response.status !== "200") {
        throw new Error(`Error en Ministral API: ${response.status}`);
      }

      // Extraer el contenido de la respuesta
      const content = response.body.choices[0].message.content;
      
      console.log('📥 Respuesta de Ministral:', content);
      
      // Parsear JSON de la respuesta
      const resultado = this._extractAndParseJSON(content, puntajeMaximo);
      
      // Validar que el puntaje esté en el rango correcto
      const score = Math.max(0, Math.min(puntajeMaximo, resultado.puntaje));
      
      return {
        score,
        reasoning: resultado.razonamiento || 'Calificación automática por IA'
      };

    } catch (error) {
      console.error('❌ Error al calificar con Ministral:', error);
      
      // En caso de error, retornar calificación manual pendiente
      return {
        score: 0,
        reasoning: 'Error en calificación automática - Requiere revisión manual'
      };
    }
  }

  /**
   * Extraer y parsear JSON de la respuesta de Ministral
   * @private
   */
  private _extractAndParseJSON(responseText: string, puntajeMaximo: number): any {
    try {
      let jsonText = responseText.trim();

      // Buscar el primer { y el último }
      const firstBrace = jsonText.indexOf('{');
      const lastBrace = jsonText.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonText = jsonText.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(jsonText);
      
      // Validar estructura
      if (typeof parsed.puntaje !== 'number' || !parsed.razonamiento) {
        throw new Error('Estructura JSON inválida');
      }

      return parsed;
    } catch (parseError) {
      console.error('❌ Error parseando respuesta de Ministral:', parseError);
      console.error('📝 Respuesta original:', responseText);

      // Fallback: intentar extraer puntaje del texto
      const puntajeMatch = responseText.match(/puntaje["\s:]+(\d+)/i);
      if (puntajeMatch) {
        return {
          puntaje: parseInt(puntajeMatch[1]),
          razonamiento: 'Calificación automática (parsing parcial)'
        };
      }

      // Si todo falla, retornar 0
      return {
        puntaje: 0,
        razonamiento: 'Error al procesar respuesta de IA - Requiere revisión manual'
      };
    }
  }

}

// Singleton para reutilizar la instancia
export const aiGradingService = new AIGradingService();
