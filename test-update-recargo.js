/**
 * Test para verificar actualización de recargo con numero_planilla
 */

const testData = {
  "conductor_id": "889d93c7-24de-4038-b8cf-f7ef5c1573ee",
  "vehiculo_id": "75f8525b-8ace-4fc2-bb36-7b722c21a1b3",
  "empresa_id": "6c53c8c6-633f-4c51-a1ae-7b9f7d7d7926",
  "numero_planilla": "TM-0001",
  "mes": 2,
  "año": 2026,
  "servicio_id": "e7fbf743-782c-435a-b0da-46a1dd7bd892",
  "estado_conductor": "optimo",
  "via_trocha": false,
  "via_afirmado": false,
  "via_mixto": true,
  "via_pavimentada": false,
  "riesgo_desniveles": true,
  "riesgo_deslizamientos": false,
  "riesgo_sin_senalizacion": false,
  "riesgo_animales": true,
  "riesgo_peatones": true,
  "riesgo_trafico_alto": true,
  "fuente_consulta": "conductor",
  "calificacion_servicio": "bueno",
  "tiempo_disponibilidad_horas": "12",
  "duracion_trayecto_horas": "10",
  "numero_dias_servicio": 1,
  "dias_laborales": [
    {
      "dia": 1,
      "hora_inicio": 4,
      "hora_fin": 14,
      "total_horas": 10,
      "kilometraje_inicial": 6615,
      "kilometraje_final": 6932,
      "es_domingo": true,
      "es_festivo": false,
      "pernocte": false,
      "disponibilidad": false
    }
  ]
};

console.log('📋 Verificando datos de actualización...\n');

// Verificar tipos
console.log('🔍 Tipos de campos numéricos:');
console.log('  tiempo_disponibilidad_horas:', typeof testData.tiempo_disponibilidad_horas, '→', testData.tiempo_disponibilidad_horas);
console.log('  duracion_trayecto_horas:', typeof testData.duracion_trayecto_horas, '→', testData.duracion_trayecto_horas);
console.log('  numero_dias_servicio:', typeof testData.numero_dias_servicio, '→', testData.numero_dias_servicio);

console.log('\n⚠️  PROBLEMA DETECTADO:');
console.log('  Los campos tiempo_disponibilidad_horas y duracion_trayecto_horas están como STRING');
console.log('  El schema espera NUMBER o NULL');

console.log('\n✅ Solución:');
const fixedData = {
  ...testData,
  tiempo_disponibilidad_horas: testData.tiempo_disponibilidad_horas ? parseFloat(testData.tiempo_disponibilidad_horas) : null,
  duracion_trayecto_horas: testData.duracion_trayecto_horas ? parseFloat(testData.duracion_trayecto_horas) : null
};

console.log('  tiempo_disponibilidad_horas:', typeof fixedData.tiempo_disponibilidad_horas, '→', fixedData.tiempo_disponibilidad_horas);
console.log('  duracion_trayecto_horas:', typeof fixedData.duracion_trayecto_horas, '→', fixedData.duracion_trayecto_horas);

console.log('\n📝 Datos corregidos:');
console.log(JSON.stringify(fixedData, null, 2));
