# 🤖 Calificación con IA - Evaluaciones (Ministral-3B)

## Descripción

Este sistema utiliza **Ministral-3B** (Azure AI) para calificar automáticamente las preguntas de tipo **TEXTO** (abiertas). La IA analiza la respuesta del usuario y determina si está relacionada con la pregunta, si es coherente y si merece puntos.

## Configuración

### Ministral-3B en Azure (Ya Configurado) ✅

Variables de entorno en `.env`:

```env
MINISTRAL_API_KEY=C7pdrNJd6uU6MQmqXTNcDylNoGoiNYZ33OWQWq8JzH2N7Zz
MINISTRAL_ENDPOINT=https://lopezvidaljuliandavid5--resource.servi
MINISTRAL_MODEL_NAME=Ministral-3B-2
```

## Funcionamiento

### Preguntas de Texto (TEXTO)

**ANTES** (Sin IA):
- Todas las respuestas de texto recibían **0 puntos** automáticamente
- Requería calificación manual posterior

**AHORA** (Con IA):
```typescript
// El sistema envía a la IA:
{
  pregunta: "¿Cuáles son las principales causas del cambio climático?",
  respuesta: "El uso de combustibles fósiles y la deforestación",
  puntajeMaximo: 10
}

// La IA analiza y responde:
{
  puntaje: 8,
  razonamiento: "Respuesta correcta pero incompleta. Menciona dos causas principales correctamente."
}
```

### Criterios de Evaluación de la IA

La IA considera:

1. **Relevancia**: ¿La respuesta está relacionada con la pregunta?
2. **Comprensión**: ¿Demuestra entendimiento del tema?
3. **Coherencia**: ¿La respuesta tiene sentido y está bien estructurada?
4. **Corrección**: ¿La información es correcta?

### Ejemplos de Calificación

#### ✅ Respuesta Completa (100% puntos)
**Pregunta**: "¿Qué es la fotosíntesis?"
**Respuesta**: "Es el proceso por el cual las plantas convierten la luz solar, agua y CO2 en glucosa y oxígeno"
**Puntaje**: 10/10

#### ⚠️ Respuesta Parcial (50% puntos)
**Pregunta**: "¿Qué es la fotosíntesis?"
**Respuesta**: "Es cuando las plantas usan el sol para crear comida"
**Puntaje**: 5/10

#### ❌ Respuesta Irrelevante (0% puntos)
**Pregunta**: "¿Qué es la fotosíntesis?"
**Respuesta**: "Me gusta el color verde"
**Puntaje**: 0/10

## Modo Sin IA (Fallback)

Si no hay API key configurada, el sistema:
- Asigna **0 puntos** a todas las preguntas de texto
- Marca la respuesta con: `"Requiere calificación manual"`
- El administrador puede revisarla después

## Ventajas

✅ **Calificación Inmediata**: Los usuarios ven su puntaje al instante
✅ **Objetividad**: Criterios consistentes para todos
✅ **Escalabilidad**: Puede calificar miles de evaluaciones simultáneamente
✅ **Auditoría**: Cada calificación incluye el razonamiento de la IA
✅ **Fallback**: Si falla, requiere calificación manual (no se pierde la respuesta)

## Costos Estimados

### Ministral-3B en Azure
- **Modelo**: Ministral-3B-2 (modelo ligero y eficiente)
- **Hosting**: Azure AI Inference
- **Costo**: Según tu plan de Azure (generalmente incluido en créditos)
- **Por evaluación**: ~$0.001 - $0.002 USD (muy económico)

💡 **Para 1000 evaluaciones mensuales**: ~$1-2 USD/mes (más económico que Claude/GPT)

## Logs y Auditoría

Cada calificación genera un log:

```javascript
📝 Pregunta TEXTO calificada con IA (Ministral-3B): {
  pregunta: "¿Cuáles son las principales causas...".
  respuesta: "El uso de combustibles fósiles...",
  puntaje: 8,
  puntajeMaximo: 10,
  razonamiento: "Respuesta correcta pero incompleta..."
}
```

## Código Relevante

### Backend
- **Servicio IA**: `src/services/ai-grading.service.ts` (usa Ministral-3B)
- **Controller**: `src/modules/evaluaciones/evaluacion.controller.ts` (línea ~126)

### Configuración
- **Variables**: `.env` → `MINISTRAL_API_KEY`, `MINISTRAL_ENDPOINT`, `MINISTRAL_MODEL_NAME`
- **Modelo**: Ministral-3B-2 (Azure AI Inference)

## Testing

Puedes probar con curl:

```bash
curl -X POST http://localhost:4000/api/evaluaciones/{id}/responder \
  -H "Content-Type: application/json" \
  -d '{
    "nombre_completo": "Test User",
    "numero_documento": "123456",
    "cargo": "Test",
    "lugar_proceso": "Test",
    "correo": "test@test.com",
    "telefono": "123456",
    "respuestas": [{
      "preguntaId": "pregunta-texto-id",
      "valor_texto": "Esta es mi respuesta de prueba sobre el tema solicitado"
    }]
  }'
```

## Desactivar IA

Si quieres volver al modo manual:
1. Elimina o comenta las variables `MINISTRAL_*` del `.env`
2. Reinicia el backend
3. Todas las preguntas de texto recibirán 0 puntos (calificación manual pendiente)

## Ventajas de Ministral-3B

✅ **Hospedado en Azure**: Mayor control y privacidad de datos
✅ **Modelo Ligero**: Ministral-3B es rápido y eficiente
✅ **Económico**: Costos más bajos que GPT-4 o Claude
✅ **Ya Integrado**: Misma infraestructura que el OCR de conductores
✅ **Calificación Inmediata**: Resultados en menos de 2 segundos
✅ **Fallback Seguro**: Si falla, marca para revisión manual

## Mejoras Futuras

- [ ] Panel de administración para revisar/ajustar calificaciones de IA
- [ ] Múltiples modelos de IA con votación
- [ ] Configuración de umbral mínimo de confianza
- [ ] Estadísticas de precisión de la IA
- [ ] Feedback para mejorar el modelo
