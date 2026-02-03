// Script de prueba para analizar evaluación con Ministral
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testEvaluacion() {
  const evaluacionId = '7e180413-b9b2-4544-8d0a-9fe53d262c9d';
  
  const evaluacion = await prisma.evaluacion.findUnique({
    where: { id: evaluacionId },
    include: {
      preguntas: {
        include: {
          opciones: true
        }
      }
    }
  });
  
  if (!evaluacion) {
    console.log('❌ Evaluación no encontrada');
    return;
  }
  
  console.log('\n📋 EVALUACIÓN:', evaluacion.nombre);
  console.log('━'.repeat(80));
  
  evaluacion.preguntas.forEach((pregunta, idx) => {
    console.log(`\n${idx + 1}. ${pregunta.texto}`);
    console.log(`   Tipo: ${pregunta.tipo}`);
    console.log(`   Puntaje: ${pregunta.puntaje}`);
    
    if (pregunta.opciones.length > 0) {
      console.log('   Opciones:');
      pregunta.opciones.forEach(op => {
        console.log(`   ${op.es_correcta ? '✓' : '○'} ${op.texto}`);
      });
    }
  });
  
  console.log('\n━'.repeat(80));
  
  await prisma.$disconnect();
}

testEvaluacion();
