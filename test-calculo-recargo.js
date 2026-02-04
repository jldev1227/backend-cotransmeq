// Test manual del cálculo de recargos
// Para el día con: hora_inicio=20, hora_fin=48, total_horas=28

const HORAS_LIMITE = {
  JORNADA_NORMAL: 10,
  INICIO_NOCTURNO: 21,
  FIN_NOCTURNO: 6
};

function calcularRecargosDia(hora_inicio, hora_fin, total_horas, es_domingo_o_festivo) {
  console.log(`\n📊 Calculando recargos:`);
  console.log(`  - Hora inicio: ${hora_inicio}`);
  console.log(`  - Hora fin: ${hora_fin}`);
  console.log(`  - Total horas: ${total_horas}`);
  console.log(`  - Domingo/Festivo: ${es_domingo_o_festivo}`);
  
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rn = 0, rd = 0;

  // Calcular recargo nocturno (21:00-06:00)
  let horaActual = hora_inicio;
  while (horaActual < hora_inicio + total_horas) {
    const horaDelDia = horaActual % 24;
    const siguienteHora = Math.min(horaActual + 0.5, hora_inicio + total_horas);
    
    // Verificar si está en período nocturno
    if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
      rn += siguienteHora - horaActual;
    }
    
    horaActual = siguienteHora;
  }

  if (es_domingo_o_festivo) {
    // Recargo dominical/festivo: máximo 10 horas
    rd = Math.min(total_horas, HORAS_LIMITE.JORNADA_NORMAL);

    // Horas extras festivas (solo si trabaja más de 10 horas)
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL;
      
      // Calcular cuántas horas extras son nocturnas
      const horaInicioExtras = hora_inicio + HORAS_LIMITE.JORNADA_NORMAL;
      let horasExtrasNocturnas = 0;
      
      let horaActualExtra = horaInicioExtras;
      while (horaActualExtra < hora_inicio + total_horas) {
        const horaDelDia = horaActualExtra % 24;
        const siguienteHora = Math.min(horaActualExtra + 0.5, hora_inicio + total_horas);
        
        if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra;
        }
        
        horaActualExtra = siguienteHora;
      }
      
      hefn = Math.min(horasExtrasNocturnas, horas_extras);
      hefd = horas_extras - hefn;
    }
  } else {
    // Día normal (no domingo ni festivo)
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL;
      
      // Calcular cuántas horas extras son nocturnas
      const horaInicioExtras = hora_inicio + HORAS_LIMITE.JORNADA_NORMAL;
      let horasExtrasNocturnas = 0;
      
      let horaActualExtra = horaInicioExtras;
      while (horaActualExtra < hora_inicio + total_horas) {
        const horaDelDia = horaActualExtra % 24;
        const siguienteHora = Math.min(horaActualExtra + 0.5, hora_inicio + total_horas);
        
        if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra;
        }
        
        horaActualExtra = siguienteHora;
      }
      
      hen = Math.min(horasExtrasNocturnas, horas_extras);
      hed = horas_extras - hen;
    }
  }

  const resultado = { 
    hed: Math.round(hed * 10) / 10, 
    hen: Math.round(hen * 10) / 10, 
    hefd: Math.round(hefd * 10) / 10, 
    hefn: Math.round(hefn * 10) / 10, 
    rn: Math.round(rn * 10) / 10, 
    rd: Math.round(rd * 10) / 10 
  };
  
  console.log(`\n✅ Resultado del cálculo:`);
  console.log(`  - HED (Hora Extra Diurna): ${resultado.hed}`);
  console.log(`  - HEN (Hora Extra Nocturna): ${resultado.hen}`);
  console.log(`  - HEFD (Hora Extra Festiva Diurna): ${resultado.hefd}`);
  console.log(`  - HEFN (Hora Extra Festiva Nocturna): ${resultado.hefn}`);
  console.log(`  - RN (Recargo Nocturno): ${resultado.rn}`);
  console.log(`  - RD (Recargo Dominical): ${resultado.rd}`);
  
  return resultado;
}

// Test con los datos reales del recargo
console.log('\n========================================');
console.log('TEST: Recargo ID da56638f-3ec9-481b-92b5-8c10cfcd6b1d');
console.log('========================================');

const resultado = calcularRecargosDia(
  20.0,  // hora_inicio
  48.0,  // hora_fin
  28.0,  // total_horas
  false  // es_domingo_o_festivo
);

console.log('\n========================================');
console.log('ANÁLISIS:');
console.log('========================================');
console.log('Horario: 20:00 (8 PM) hasta 48:00 (24:00 del día siguiente)');
console.log('= Desde las 8 PM hasta medianoche del día siguiente');
console.log('= 28 horas continuas');
console.log('\nDesglose esperado:');
console.log('- Horas ordinarias: 10 horas');
console.log('- Horas extras: 18 horas');
console.log('- De esas 18 extras, varias son nocturnas (21:00-06:00)');
console.log('\n¿Por qué está en 0 en la BD?');
console.log('Posibles causas:');
console.log('1. No se insertaron los detalles en detalles_recargos_dias');
console.log('2. Se insertaron con deleted_at NOT NULL');
console.log('3. Se insertaron con activo = false');
console.log('4. Error en la transacción de creación');
