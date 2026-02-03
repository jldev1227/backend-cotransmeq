// Test completo de Ministral con actualización de preguntas
import { PrismaClient } from '@prisma/client';
import { aiGradingService } from './src/services/ai-grading.service';

const prisma = new PrismaClient();

async function testMinistralCompleto() {
  const evaluacionId = '7e180413-b9b2-4544-8d0a-9fe53d262c9d';
  
  console.log('\n🔧 PASO 1: Actualizando puntos de las preguntas...\n');
  
  // Obtener evaluación con preguntas
  const evaluacion = await prisma.evaluacion.findUnique({
    where: { id: evaluacionId },
    include: { preguntas: true }
  });
  
  if (!evaluacion) {
    console.log('❌ Evaluación no encontrada');
    await prisma.$disconnect();
    return;
  }
  
  // Actualizar puntos de cada pregunta
  const preguntas = evaluacion.preguntas;
  
  // Pregunta 1: Opción Única - 3 pts
  await prisma.pregunta.update({
    where: { id: preguntas[0].id },
    data: { puntaje: 3 }
  });
  console.log('✅ Pregunta 1 (Opción Única): 5 pts → 3 pts');
  
  // Pregunta 2: Opción Múltiple - 3 pts (sin cambio)
  console.log('✅ Pregunta 2 (Opción Múltiple): 3 pts (sin cambio)');
  
  // Pregunta 3: Numérica - 2 pts (sin cambio)
  console.log('✅ Pregunta 3 (Numérica): 2 pts (sin cambio)');
  
  // Pregunta 4: Texto - 2 pts
  await prisma.pregunta.update({
    where: { id: preguntas[3].id },
    data: { puntaje: 2 }
  });
  console.log('✅ Pregunta 4 (Texto): 0 pts → 2 pts');
  
  console.log('\n📊 Distribución final: 3 + 3 + 2 + 2 = 10 puntos totales\n');
  
  console.log('━'.repeat(80));
  console.log('🤖 PASO 2: Probando calificación con Ministral\n');
  
  // Casos de prueba para calificación de texto
  const casosPrueba = [
    {
      pregunta: "Describe tu experiencia como conductor",
      respuesta: "Me gusta poder servir a los demas y conocer lugares nuevos en mi trabajo",
      descripcion: "Respuesta válida del usuario"
    },
    {
      pregunta: "Describe tu experiencia como conductor",
      respuesta: "Tengo 5 años de experiencia conduciendo buses interprovinciales. Me caracterizo por ser puntual, responsable y siempre cumplo con las normas de tránsito. Mantengo mi vehículo limpio y en buen estado.",
      descripcion: "Respuesta excelente"
    },
    {
      pregunta: "Describe tu experiencia como conductor",
      respuesta: "si",
      descripcion: "Respuesta muy corta"
    },
    {
      pregunta: "Describe tu experiencia como conductor",
      respuesta: "Me gusta jugar videojuegos y ver películas en mi tiempo libre",
      descripcion: "Respuesta no relacionada"
    }
  ];
  
  for (let i = 0; i < casosPrueba.length; i++) {
    const caso = casosPrueba[i];
    console.log(`\n📝 Caso ${i + 1}: ${caso.descripcion}`);
    console.log(`   Pregunta: "${caso.pregunta}"`);
    console.log(`   Respuesta: "${caso.respuesta}"`);
    console.log('   ⏳ Calificando con Ministral...');
    
    try {
      const resultado = await aiGradingService.gradeTextResponse(
        caso.pregunta,
        caso.respuesta,
        2 // Puntaje máximo de la pregunta
      );
      
      console.log(`   ✅ Puntaje: ${resultado.score}/2`);
      console.log(`   💭 Razonamiento: ${resultado.reasoning}`);
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n━'.repeat(80));
  console.log('✨ Test completado!\n');
  
  await prisma.$disconnect();
}

testMinistralCompleto().catch(console.error);
