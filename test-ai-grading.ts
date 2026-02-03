// Test de calificación con IA usando Ministral-3B
import { aiGradingService } from './src/services/ai-grading.service';

async function testAIGrading() {
  console.log('🧪 Iniciando pruebas de calificación con IA...\n');

  // Test 1: Respuesta correcta y completa
  console.log('📝 Test 1: Respuesta correcta y completa');
  const test1 = await aiGradingService.gradeTextResponse(
    "¿Cuáles son las principales funciones de un conductor de transporte?",
    "Las principales funciones incluyen: conducir el vehículo de manera segura, verificar el estado del vehículo antes de cada viaje, cumplir con las normas de tránsito, mantener limpio el vehículo, tratar con respeto a los pasajeros, y reportar cualquier incidente o novedad.",
    10
  );
  console.log('Resultado:', test1);
  console.log('');

  // Test 2: Respuesta parcialmente correcta
  console.log('📝 Test 2: Respuesta parcial');
  const test2 = await aiGradingService.gradeTextResponse(
    "¿Qué es la seguridad vial?",
    "Es cuando los conductores manejan con cuidado",
    10
  );
  console.log('Resultado:', test2);
  console.log('');

  // Test 3: Respuesta irrelevante
  console.log('📝 Test 3: Respuesta irrelevante');
  const test3 = await aiGradingService.gradeTextResponse(
    "¿Cuál es la velocidad máxima en zona urbana en Colombia?",
    "Me gusta el color azul",
    10
  );
  console.log('Resultado:', test3);
  console.log('');

  // Test 4: Respuesta vacía
  console.log('📝 Test 4: Respuesta vacía');
  const test4 = await aiGradingService.gradeTextResponse(
    "¿Qué documentos debe portar un conductor?",
    "",
    10
  );
  console.log('Resultado:', test4);
  console.log('');

  console.log('✅ Pruebas completadas!');
}

// Ejecutar pruebas
testAIGrading().catch(console.error);
