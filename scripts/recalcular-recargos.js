/**
 * Script para recalcular TODOS los recargos de días laborales existentes
 * usando la fórmula corregida (RN sobre TODAS las horas nocturnas).
 * 
 * - Días con disponibilidad=true → recargos en 0, sin detalles
 * - Días normales → recalcular con la nueva fórmula
 * - Actualizar detalles_recargos_dias (eliminar viejos, crear nuevos)
 * - Recalcular totales de cada planilla
 */

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');
const prisma = new PrismaClient();

const HORAS_LIMITE = {
  JORNADA_NORMAL: 10,
  INICIO_NOCTURNO: 19,
  FIN_NOCTURNO: 6
};

function calcularRecargosDia(hora_inicio, hora_fin, total_horas, es_domingo_o_festivo) {
  let hed = 0, hen = 0, hefd = 0, hefn = 0, rn = 0, rd = 0;

  // RN sobre TODAS las horas trabajadas (no solo primeras 10)
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
      let ha = horaInicioExtras;
      while (ha < hora_inicio + total_horas) {
        const hd = ha % 24;
        const sh = Math.min(ha + 0.5, hora_inicio + total_horas);
        if (hd >= HORAS_LIMITE.INICIO_NOCTURNO || hd < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += sh - ha;
        }
        ha = sh;
      }
      hefn = Math.min(horasExtrasNocturnas, horas_extras);
      hefd = horas_extras - hefn;
    }
  } else {
    if (total_horas > HORAS_LIMITE.JORNADA_NORMAL) {
      const horas_extras = total_horas - HORAS_LIMITE.JORNADA_NORMAL;
      const horaInicioExtras = hora_inicio + HORAS_LIMITE.JORNADA_NORMAL;
      let horasExtrasNocturnas = 0;
      let ha = horaInicioExtras;
      while (ha < hora_inicio + total_horas) {
        const hd = ha % 24;
        const sh = Math.min(ha + 0.5, hora_inicio + total_horas);
        if (hd >= HORAS_LIMITE.INICIO_NOCTURNO || hd < HORAS_LIMITE.FIN_NOCTURNO) {
          horasExtrasNocturnas += sh - ha;
        }
        ha = sh;
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

async function main() {
  console.log('🔄 Iniciando recalculación de recargos...\n');

  // 1. Obtener tipos de recargo
  const tiposRecargo = await prisma.tipos_recargos.findMany({ where: { activo: true } });
  const tiposMap = new Map(tiposRecargo.map(t => [t.codigo, t.id]));
  console.log('📋 Tipos de recargo:', Array.from(tiposMap.keys()).join(', '));

  // 2. Obtener todos los días laborales activos
  const dias = await prisma.dias_laborales_planillas.findMany({
    where: { deleted_at: null },
    include: {
      recargos_planillas: { select: { numero_planilla: true } },
      detalles_recargos_dias: {
        where: { deleted_at: null, activo: true },
        include: { tipos_recargos: { select: { codigo: true } } }
      }
    }
  });

  console.log(`📊 Total días a procesar: ${dias.length}\n`);

  const now = new Date();
  let diasCorregidos = 0;
  let diasSinCambio = 0;
  let diasDisponibles = 0;
  const planillasAfectadas = new Set();

  for (const dia of dias) {
    const planilla = dia.recargos_planillas.numero_planilla || dia.recargo_planilla_id;
    const hora_inicio = Number(dia.hora_inicio) || 0;
    const hora_fin = Number(dia.hora_fin) || 0;
    const total_horas = Number(dia.total_horas) || 0;
    const es_domingo_o_festivo = dia.es_domingo || dia.es_festivo;

    // Si es disponible, los recargos deben ser 0
    if (dia.disponibilidad) {
      // Eliminar cualquier detalle de recargo existente
      if (dia.detalles_recargos_dias.length > 0) {
        await prisma.detalles_recargos_dias.deleteMany({
          where: { dia_laboral_id: dia.id }
        });
        console.log(`  🟦 [${planilla}] Día ${dia.dia}: DISPONIBLE - eliminados ${dia.detalles_recargos_dias.length} detalles`);
        planillasAfectadas.add(dia.recargo_planilla_id);
        diasCorregidos++;
      } else {
        diasDisponibles++;
      }
      continue;
    }

    // Calcular recargos con la nueva fórmula
    const nuevos = calcularRecargosDia(hora_inicio, hora_fin, total_horas, es_domingo_o_festivo);

    // Obtener recargos actuales para comparar
    const actuales = {};
    dia.detalles_recargos_dias.forEach(d => {
      actuales[d.tipos_recargos.codigo] = Number(d.horas);
    });

    // Verificar si hay diferencias
    const codigos = ['HED', 'HEN', 'HEFD', 'HEFN', 'RN', 'RD'];
    let hayDiferencia = false;
    const cambios = [];

    for (const codigo of codigos) {
      const actual = actuales[codigo] || 0;
      const nuevo = nuevos[codigo.toLowerCase()] || 0;
      if (Math.abs(actual - nuevo) > 0.01) {
        hayDiferencia = true;
        cambios.push(`${codigo}: ${actual} → ${nuevo}`);
      }
    }

    if (!hayDiferencia) {
      diasSinCambio++;
      continue;
    }

    // Hay diferencias → recalcular
    console.log(`  🔧 [${planilla}] Día ${dia.dia} (${hora_inicio}-${hora_fin}, ${total_horas}h, ${es_domingo_o_festivo ? 'DOM/FEST' : 'normal'}):`);
    console.log(`     Cambios: ${cambios.join(' | ')}`);

    // Eliminar detalles viejos
    await prisma.detalles_recargos_dias.deleteMany({
      where: { dia_laboral_id: dia.id }
    });

    // Crear nuevos detalles
    const nuevosDetalles = [];
    for (const codigo of codigos) {
      const horas = nuevos[codigo.toLowerCase()];
      if (horas > 0 && tiposMap.has(codigo)) {
        nuevosDetalles.push({
          id: randomUUID(),
          dia_laboral_id: dia.id,
          tipo_recargo_id: tiposMap.get(codigo),
          horas: horas,
          creado_por_id: dia.creado_por_id,
          created_at: now,
          updated_at: now
        });
      }
    }

    if (nuevosDetalles.length > 0) {
      await prisma.detalles_recargos_dias.createMany({ data: nuevosDetalles });
    }

    planillasAfectadas.add(dia.recargo_planilla_id);
    diasCorregidos++;
  }

  console.log(`\n📊 Resumen de días:`);
  console.log(`   ✅ Corregidos: ${diasCorregidos}`);
  console.log(`   ⏭️  Sin cambio: ${diasSinCambio}`);
  console.log(`   🟦 Disponibles (ya OK): ${diasDisponibles}`);
  console.log(`   📋 Planillas afectadas: ${planillasAfectadas.size}`);

  // 3. Recalcular totales de cada planilla afectada
  console.log(`\n🔄 Recalculando totales de ${planillasAfectadas.size} planilla(s)...`);

  for (const planillaId of planillasAfectadas) {
    const recargo = await prisma.recargos_planillas.findUnique({
      where: { id: planillaId },
      include: {
        dias_laborales_planillas: {
          where: { deleted_at: null },
          select: {
            total_horas: true,
            horas_ordinarias: true,
            disponibilidad: true
          }
        }
      }
    });

    if (!recargo) continue;

    const diasNoDisponibles = recargo.dias_laborales_planillas.filter(d => !d.disponibilidad);
    const total_dias_laborados = diasNoDisponibles.length;
    const total_horas_trabajadas = diasNoDisponibles.reduce((s, d) => s + Number(d.total_horas), 0);
    const total_horas_ordinarias = diasNoDisponibles.reduce((s, d) => s + Number(d.horas_ordinarias), 0);

    await prisma.recargos_planillas.update({
      where: { id: planillaId },
      data: { total_dias_laborados, total_horas_trabajadas, total_horas_ordinarias }
    });

    console.log(`   ✅ ${recargo.numero_planilla || planillaId}: ${total_dias_laborados} días, ${total_horas_trabajadas}h trabajadas`);
  }

  // 4. Verificación final
  console.log('\n=== Verificación final ===');
  const diasVerif = await prisma.dias_laborales_planillas.findMany({
    where: { deleted_at: null },
    include: {
      recargos_planillas: { select: { numero_planilla: true } },
      detalles_recargos_dias: {
        where: { deleted_at: null, activo: true },
        include: { tipos_recargos: { select: { codigo: true } } }
      }
    },
    orderBy: [{ recargo_planilla_id: 'asc' }, { dia: 'asc' }]
  });

  for (const dia of diasVerif) {
    const recargos = dia.detalles_recargos_dias.map(d => d.tipos_recargos.codigo + ':' + d.horas).join(', ');
    const disp = dia.disponibilidad ? ' [DISPONIBLE]' : '';
    console.log(
      `  ${dia.recargos_planillas.numero_planilla || '(sin #)'} | Día ${dia.dia} | ${Number(dia.hora_inicio)}-${Number(dia.hora_fin)} (${Number(dia.total_horas)}h)${disp} | ${recargos || 'NINGUNO'}`
    );
  }

  console.log('\n✅ Recalculación completada.');
  await prisma.$disconnect();
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1); });
