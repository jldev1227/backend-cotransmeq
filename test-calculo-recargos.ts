// Script para verificar los cálculos de recargos
// Compara la lógica del backend con los resultados esperados del frontend

interface RecargosCalculados {
  hed: number;
  hen: number;
  hefd: number;
  hefn: number;
  rn: number;
  rd: number;
}

// Constantes (mismas que el backend)
const LIMITES_HORARIOS = {
  JORNADA_NORMAL: 10,
  INICIO_NOCTURNO: 21,
  FIN_NOCTURNO: 6
};

// Función de normalización (como en el frontend)
function normalizarHora(hora: number): number {
  return ((hora % 24) + 24) % 24;
}

// Implementación del BACKEND actual
function calcularRecargosDiaBackend(
  hora_inicio: number,
  hora_fin: number,
  total_horas: number,
  es_domingo_o_festivo: boolean
): RecargosCalculados {
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rn = 0, rd = 0;

  // Calcular recargo nocturno (21:00-06:00) - SOLO EN LAS PRIMERAS 10 HORAS
  let horaActual = hora_inicio;
  while (horaActual < Math.min(hora_inicio + total_horas, hora_inicio + LIMITES_HORARIOS.JORNADA_NORMAL)) {
    const horaDelDia = horaActual % 24;
    const siguienteHora = Math.min(horaActual + 0.5, hora_inicio + total_horas, hora_inicio + LIMITES_HORARIOS.JORNADA_NORMAL);
    
    if (horaDelDia >= LIMITES_HORARIOS.INICIO_NOCTURNO || horaDelDia < LIMITES_HORARIOS.FIN_NOCTURNO) {
      rn += siguienteHora - horaActual;
    }
    
    horaActual = siguienteHora;
  }

  if (es_domingo_o_festivo) {
    rd = Math.min(total_horas, LIMITES_HORARIOS.JORNADA_NORMAL);

    if (total_horas > LIMITES_HORARIOS.JORNADA_NORMAL) {
      const horas_extras = total_horas - LIMITES_HORARIOS.JORNADA_NORMAL;
      const horaInicioExtras = hora_inicio + LIMITES_HORARIOS.JORNADA_NORMAL;
      let horasExtrasNocturnas = 0;
      
      let horaActualExtra = horaInicioExtras;
      while (horaActualExtra < hora_inicio + total_horas) {
        const horaDelDia = horaActualExtra % 24;
        const siguienteHora = Math.min(horaActualExtra + 0.5, hora_inicio + total_horas);
        
        if (horaDelDia >= LIMITES_HORARIOS.INICIO_NOCTURNO || horaDelDia < LIMITES_HORARIOS.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra;
        }
        
        horaActualExtra = siguienteHora;
      }
      
      hefn = Math.min(horasExtrasNocturnas, horas_extras);
      hefd = horas_extras - hefn;
    }
  } else {
    if (total_horas > LIMITES_HORARIOS.JORNADA_NORMAL) {
      const horas_extras = total_horas - LIMITES_HORARIOS.JORNADA_NORMAL;
      const horaInicioExtras = hora_inicio + LIMITES_HORARIOS.JORNADA_NORMAL;
      let horasExtrasNocturnas = 0;
      
      let horaActualExtra = horaInicioExtras;
      while (horaActualExtra < hora_inicio + total_horas) {
        const horaDelDia = horaActualExtra % 24;
        const siguienteHora = Math.min(horaActualExtra + 0.5, hora_inicio + total_horas);
        
        if (horaDelDia >= LIMITES_HORARIOS.INICIO_NOCTURNO || horaDelDia < LIMITES_HORARIOS.FIN_NOCTURNO) {
          horasExtrasNocturnas += siguienteHora - horaActualExtra;
        }
        
        horaActualExtra = siguienteHora;
      }
      
      hen = Math.min(horasExtrasNocturnas, horas_extras);
      hed = horas_extras - hen;
    }
  }

  return {
    hed: Math.round(hed * 10) / 10,
    hen: Math.round(hen * 10) / 10,
    hefd: Math.round(hefd * 10) / 10,
    hefn: Math.round(hefn * 10) / 10,
    rn: Math.round(rn * 10) / 10,
    rd: Math.round(rd * 10) / 10
  };
}

// Implementación del FRONTEND (la correcta)
function calcularRecargosDiaFrontend(
  hora_inicio: number,
  hora_fin: number,
  es_festivo: boolean
): RecargosCalculados {
  const total_horas = hora_fin - hora_inicio;
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rn = 0, rd = 0;

  // Iterar cada media hora
  for (let i = hora_inicio; i < hora_fin; i += 0.5) {
    const horaActual = normalizarHora(i);
    const esNocturno = horaActual >= LIMITES_HORARIOS.INICIO_NOCTURNO || horaActual < LIMITES_HORARIOS.FIN_NOCTURNO;
    const posicionEnJornada = i - hora_inicio;

    if (posicionEnJornada < LIMITES_HORARIOS.JORNADA_NORMAL) {
      // Primeras 10 horas
      if (esNocturno) rn += 0.5;
      if (es_festivo) rd += 0.5;
    } else {
      // Horas extras (después de 10 horas)
      if (es_festivo) {
        if (esNocturno) {
          hefn += 0.5;
        } else {
          hefd += 0.5;
        }
      } else {
        if (esNocturno) {
          hen += 0.5;
        } else {
          hed += 0.5;
        }
      }
    }
  }

  return {
    hed: Math.round(hed * 10) / 10,
    hen: Math.round(hen * 10) / 10,
    hefd: Math.round(hefd * 10) / 10,
    hefn: Math.round(hefn * 10) / 10,
    rn: Math.round(rn * 10) / 10,
    rd: Math.round(rd * 10) / 10
  };
}

// Casos de prueba
const casos = [
  {
    nombre: "Día 1: 1:00-48:00 (47h) festivo - EL PROBLEMA PRINCIPAL",
    hora_inicio: 1,
    hora_fin: 48,
    total_horas: 47,
    es_festivo: true
  },
  {
    nombre: "Día 2: 1:00-11:00 (10h) festivo",
    hora_inicio: 1,
    hora_fin: 11,
    total_horas: 10,
    es_festivo: true
  },
  {
    nombre: "Día normal: 8:00-18:00 (10h)",
    hora_inicio: 8,
    hora_fin: 18,
    total_horas: 10,
    es_festivo: false
  },
  {
    nombre: "Día normal con extras: 8:00-22:00 (14h)",
    hora_inicio: 8,
    hora_fin: 22,
    total_horas: 14,
    es_festivo: false
  },
  {
    nombre: "Nocturno completo: 22:00-46:00 (24h) festivo",
    hora_inicio: 22,
    hora_fin: 46,
    total_horas: 24,
    es_festivo: true
  }
];

console.log('\n🧪 VERIFICACIÓN DE CÁLCULOS DE RECARGOS\n');
console.log('='.repeat(80));

let erroresEncontrados = 0;

casos.forEach((caso, index) => {
  console.log(`\n📋 CASO ${index + 1}: ${caso.nombre}`);
  console.log('-'.repeat(80));
  
  const backend = calcularRecargosDiaBackend(
    caso.hora_inicio,
    caso.hora_fin,
    caso.total_horas,
    caso.es_festivo
  );
  
  const frontend = calcularRecargosDiaFrontend(
    caso.hora_inicio,
    caso.hora_fin,
    caso.es_festivo
  );
  
  console.log(`\n🔵 Backend:   RN=${backend.rn}  RD=${backend.rd}  HED=${backend.hed}  HEN=${backend.hen}  HEFD=${backend.hefd}  HEFN=${backend.hefn}`);
  console.log(`🟢 Frontend:  RN=${frontend.rn}  RD=${frontend.rd}  HED=${frontend.hed}  HEN=${frontend.hen}  HEFD=${frontend.hefd}  HEFN=${frontend.hefn}`);
  
  // Comparar resultados
  const keys: Array<keyof RecargosCalculados> = ['hed', 'hen', 'hefd', 'hefn', 'rn', 'rd'];
  const diferencias: string[] = [];
  
  keys.forEach(key => {
    if (backend[key] !== frontend[key]) {
      diferencias.push(`${key.toUpperCase()}: ${backend[key]} vs ${frontend[key]}`);
    }
  });
  
  if (diferencias.length > 0) {
    console.log(`\n❌ DIFERENCIAS ENCONTRADAS:`);
    diferencias.forEach(diff => console.log(`   - ${diff}`));
    erroresEncontrados++;
  } else {
    console.log(`\n✅ CÁLCULOS COINCIDEN PERFECTAMENTE`);
  }
});

console.log('\n' + '='.repeat(80));
console.log(`\n📊 RESUMEN: ${erroresEncontrados === 0 ? '✅ TODOS LOS CÁLCULOS CORRECTOS' : `❌ ${erroresEncontrados} CASOS CON DIFERENCIAS`}\n`);

if (erroresEncontrados > 0) {
  process.exit(1);
}
