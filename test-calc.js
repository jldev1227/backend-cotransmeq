// Test de cálculo de recargos
const HORAS_LIMITE = {
  JORNADA_NORMAL: 10,
  INICIO_NOCTURNO: 19,
  FIN_NOCTURNO: 6
}

function calcularRecargosDia(hora_inicio, hora_fin, total_horas, es_domingo_o_festivo) {
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rn = 0, rd = 0

  // RN sobre TODAS las horas trabajadas
  let horaActual = hora_inicio
  while (horaActual < hora_inicio + total_horas) {
    const horaDelDia = horaActual % 24
    const siguienteHora = Math.min(horaActual + 0.5, hora_inicio + total_horas)
    if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
      rn += siguienteHora - horaActual
    }
    horaActual = siguienteHora
  }

  if (es_domingo_o_festivo) {
    rd = Math.min(total_horas, HORAS_LIMITE.JORNADA_NORMAL)
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL
      const horaInicioExtras = hora_inicio + HORAS_LIMITE.JORNADA_NORMAL
      let horasExtrasNocturnas = 0
      let horaActualExtra = horaInicioExtras
      while (horaActualExtra < hora_inicio + total_horas) {
        const horaDelDia = horaActualExtra % 24
        const siguienteHora = Math.min(horaActualExtra + 0.5, hora_inicio + total_horas)
        if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra
        }
        horaActualExtra = siguienteHora
      }
      hefn = Math.min(horasExtrasNocturnas, horas_extras)
      hefd = horas_extras - hefn
    }
  } else {
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL
      const horaInicioExtras = hora_inicio + HORAS_LIMITE.JORNADA_NORMAL
      let horasExtrasNocturnas = 0
      let horaActualExtra = horaInicioExtras
      while (horaActualExtra < hora_inicio + total_horas) {
        const horaDelDia = horaActualExtra % 24
        const siguienteHora = Math.min(horaActualExtra + 0.5, hora_inicio + total_horas)
        if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra
        }
        horaActualExtra = siguienteHora
      }
      hen = Math.min(horasExtrasNocturnas, horas_extras)
      hed = horas_extras - hen
    }
  }

  return {
    hed: Math.round(hed * 10) / 10,
    hen: Math.round(hen * 10) / 10,
    hefd: Math.round(hefd * 10) / 10,
    hefn: Math.round(hefn * 10) / 10,
    rn: Math.round(rn * 10) / 10,
    rd: Math.round(rd * 10) / 10
  }
}

// Test 1: Día normal, 0 a 24 (24 horas)
console.log("=== Test 1: Día normal, 0-24 (24h) ===")
const t1 = calcularRecargosDia(0, 24, 24, false)
console.log(t1)
console.log("Esperado: RN=11 (0-6=6h + 19-24=5h), HED=9 (10-19), HEN=5 (19-24)")
console.log("RN OK?", t1.rn === 11)
console.log("HED OK?", t1.hed === 9)
console.log("HEN OK?", t1.hen === 5)

// Test 2: Día normal, 6 a 18 (12 horas)
console.log("\n=== Test 2: Día normal, 6-18 (12h) ===")
const t2 = calcularRecargosDia(6, 18, 12, false)
console.log(t2)
console.log("Esperado: RN=0, HED=2 (10h jornada + 2h extras diurnas 16-18)")
console.log("RN OK?", t2.rn === 0)
console.log("HED OK?", t2.hed === 2)

// Test 3: Día normal, 6 a 22 (16 horas)
console.log("\n=== Test 3: Día normal, 6-22 (16h) ===")
const t3 = calcularRecargosDia(6, 22, 16, false)
console.log(t3)
console.log("Esperado: RN=3 (19-22), HED=3 (16-19), HEN=3 (19-22)")
console.log("RN OK?", t3.rn === 3)
console.log("HED OK?", t3.hed === 3)
console.log("HEN OK?", t3.hen === 3)

// Test 4: Domingo, 0 a 24 (24 horas)
console.log("\n=== Test 4: Domingo, 0-24 (24h) ===")
const t4 = calcularRecargosDia(0, 24, 24, true)
console.log(t4)
console.log("Esperado: RN=11, RD=10, HEFD=9, HEFN=5")
console.log("RN OK?", t4.rn === 11)
console.log("RD OK?", t4.rd === 10)
console.log("HEFD OK?", t4.hefd === 9)
console.log("HEFN OK?", t4.hefn === 5)

// Test 5: Día normal, 5 a 15 (10 horas, jornada normal)
console.log("\n=== Test 5: Día normal, 5-15 (10h, jornada normal) ===")
const t5 = calcularRecargosDia(5, 15, 10, false)
console.log(t5)
console.log("Esperado: RN=1 (5-6), HED=0, HEN=0 (no hay extras)")
console.log("RN OK?", t5.rn === 1)
console.log("HED OK?", t5.hed === 0)
console.log("HEN OK?", t5.hen === 0)
