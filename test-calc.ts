const HORAS_LIMITE = { JORNADA_NORMAL: 10, INICIO_NOCTURNO: 19, FIN_NOCTURNO: 6 };

function calcularRecargosDia(hora_inicio: number, hora_fin: number, total_horas: number, es_domingo_o_festivo: boolean) {
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rn = 0, rd = 0;

  // RN sobre TODAS las horas trabajadas
  let horaActual = hora_inicio;
  while (horaActual < hora_inicio + total_horas) {
    const horaDelDia = horaActual % 24;
    const siguienteHora = Math.min(horaActual + 0.5, hora_inicio + total_horas);
    if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
      rn += siguienteHora - horaActual;
    }
    horaActual = siguienteHora;
  }

  if (es_domingo_o_festivo) {
    rd = Math.min(total_horas, HORAS_LIMITE.JORNADA_NORMAL);
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL;
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
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL;
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

  return { 
    hed: Math.round(hed*10)/10, hen: Math.round(hen*10)/10, 
    hefd: Math.round(hefd*10)/10, hefn: Math.round(hefn*10)/10, 
    rn: Math.round(rn*10)/10, rd: Math.round(rd*10)/10 
  };
}

// Test 1: 0 a 24, día normal
const r1 = calcularRecargosDia(0, 24, 24, false);
console.log('Test 1: Jornada 0-24 (día normal)');
console.log('  RN  =', r1.rn, '(esperado: 11 = 0-6 + 19-24)');
console.log('  HED =', r1.hed, '(esperado: 9 = 10-19)');
console.log('  HEN =', r1.hen, '(esperado: 5 = 19-24)');

// Test 2: 6 a 18, día normal
const r2 = calcularRecargosDia(6, 18, 12, false);
console.log('\nTest 2: Jornada 6-18 (día normal)');
console.log('  RN  =', r2.rn, '(esperado: 0)');
console.log('  HED =', r2.hed, '(esperado: 2)');
console.log('  HEN =', r2.hen, '(esperado: 0)');

// Test 3: 6 a 20, día normal
const r3 = calcularRecargosDia(6, 20, 14, false);
console.log('\nTest 3: Jornada 6-20 (día normal)');
console.log('  RN  =', r3.rn, '(esperado: 1 = 19-20)');
console.log('  HED =', r3.hed, '(esperado: 3 = 16-19)');
console.log('  HEN =', r3.hen, '(esperado: 1 = 19-20)');

// Test 4: 0 a 24, domingo
const r4 = calcularRecargosDia(0, 24, 24, true);
console.log('\nTest 4: Jornada 0-24 (domingo)');
console.log('  RN   =', r4.rn, '(esperado: 11)');
console.log('  RD   =', r4.rd, '(esperado: 10)');
console.log('  HEFD =', r4.hefd, '(esperado: 9 = 10-19)');
console.log('  HEFN =', r4.hefn, '(esperado: 5 = 19-24)');
