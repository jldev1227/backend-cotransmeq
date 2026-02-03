// Test simple de Ministral sin base de datos
import 'dotenv/config'; // Cargar variables de entorno
import { aiGradingService } from './src/services/ai-grading.service';

async function testMinistral() {
  console.log('\n🔧 Configuración:');
  console.log(`   API Key: ${process.env.MINISTRAL_API_KEY?.substring(0, 20)}...`);
  console.log(`   Endpoint: ${process.env.MINISTRAL_ENDPOINT}`);
  console.log(`   Model: ${process.env.MINISTRAL_MODEL_NAME}\n`);
  
  console.log('🤖 TEST DE CALIFICACIÓN CON MINISTRAL\n');
  console.log('━'.repeat(80));
  
  // Casos de prueba para calificación de texto
  const casosPrueba = [
    {
      pregunta: "Describe tu experiencia como conductor",
      respuesta: "Me gusta poder servir a los demas y conocer lugares nuevos en mi trabajo",
      descripcion: "Respuesta válida del usuario (la que envió)"
    },
    {
      pregunta: "Describe tu experiencia como conductor",
      respuesta: "Tengo 5 años de experiencia conduciendo buses interprovinciales. Me caracterizo por ser puntual, responsable y siempre cumplo con las normas de tránsito. Mantengo mi vehículo limpio y en buen estado.",
      descripcion: "Respuesta excelente y detallada"
    },
    {
      pregunta: "Describe tu experiencia como conductor",
      respuesta: "si",
      descripcion: "Respuesta muy corta (inaceptable)"
    },
    {
      pregunta: "Describe tu experiencia como conductor",
      respuesta: "Me gusta jugar videojuegos y ver películas en mi tiempo libre",
      descripcion: "Respuesta no relacionada con conducir"
    }
  ];
  
  for (let i = 0; i < casosPrueba.length; i++) {
    const caso = casosPrueba[i];
    console.log(`\n📝 Caso ${i + 1}: ${caso.descripcion}`);
    console.log(`   Pregunta: "${caso.pregunta}"`);
    console.log(`   Respuesta: "${caso.respuesta}"`);
    console.log('   ⏳ Calificando con Ministral-3B...\n');
    
    try {
      const inicio = Date.now();
      const resultado = await aiGradingService.gradeTextResponse(
        caso.pregunta,
        caso.respuesta,
        2 // Puntaje máximo de la pregunta
      );
      const tiempo = Date.now() - inicio;
      
      console.log(`   ✅ Puntaje obtenido: ${resultado.score}/2 puntos`);
      console.log(`   💭 Razonamiento IA: ${resultado.reasoning}`);
      console.log(`   ⏱️  Tiempo: ${tiempo}ms`);
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n━'.repeat(80));
  console.log('✨ Test completado!\n');
}

testMinistral().catch(console.error);
