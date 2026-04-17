/**
 * Script de migración: terceroRows de recargos_data JSON → tabla liquidacion_tercero
 * 
 * Uso: npx ts-node src/scripts/migrar-terceros.ts
 * O:   npx tsx src/scripts/migrar-terceros.ts
 */
import { prisma } from '../config/prisma';
import { randomUUID } from 'crypto';

async function main() {
  console.log('🔄 Iniciando migración de terceroRows a tabla liquidacion_tercero...\n');

  const liquidaciones = await prisma.liquidacion_servicio.findMany({
    where: { recargos_data: { not: null } },
    select: { id: true, consecutivo: true, recargos_data: true },
  });

  let migradas = 0;
  let itemsMigrados = 0;
  let yaExistentes = 0;

  for (const liq of liquidaciones) {
    const rd = liq.recargos_data as any;
    if (!rd?.terceroRows || !Array.isArray(rd.terceroRows) || rd.terceroRows.length === 0) continue;

    // Verificar si ya fue migrada
    const existing = await prisma.liquidacion_tercero.count({ where: { liquidacion_id: liq.id } });
    if (existing > 0) {
      yaExistentes++;
      continue;
    }

    const itemsData = rd.terceroRows.map((t: any, idx: number) => {
      const vrUnit = parseFloat(String(t.vr_unit)) || 0;
      const cant = parseFloat(String(t.cant)) || 0;
      const totalFacturado = vrUnit * cant;
      const pctAdmin = parseFloat(String(t.pct_admin)) || 0;
      const valorAdmin = totalFacturado * (pctAdmin / 100);
      const valorLiquidar = totalFacturado - valorAdmin;
      const ingresoExtraGlobal = parseFloat(String(t.ingreso_extra_global)) || 0;
      const ingresosExtraAval = parseFloat(String(t.ingresos_extra_aval)) || 0;
      const ingresoEmpresa = ingresoExtraGlobal - ingresosExtraAval;

      return {
        id: randomUUID(),
        liquidacion_id: liq.id,
        tercero_id: t.tercero_id || null,
        placa: t.placa || '',
        recorrido: t.recorrido || 'N/A',
        fechas: t.fechas || '',
        valor_unitario: vrUnit,
        cantidad: cant,
        total_facturado: totalFacturado,
        porcentaje_admin: pctAdmin,
        valor_admin: valorAdmin,
        valor_liquidar: valorLiquidar,
        ingreso_extra_global: ingresoExtraGlobal,
        ingresos_extra_aval: ingresosExtraAval,
        ingreso_empresa: ingresoEmpresa,
        src_index: t.src_index ?? idx,
        orden: idx,
      };
    });

    await prisma.liquidacion_tercero.createMany({ data: itemsData });
    migradas++;
    itemsMigrados += itemsData.length;
    console.log(`  ✅ ${liq.consecutivo}: ${itemsData.length} items migrados`);
  }

  console.log(`\n📊 Resumen:`);
  console.log(`   Liquidaciones revisadas: ${liquidaciones.length}`);
  console.log(`   Liquidaciones migradas:  ${migradas}`);
  console.log(`   Items migrados:          ${itemsMigrados}`);
  console.log(`   Ya existentes (skip):    ${yaExistentes}`);
  console.log(`\n✅ Migración completada.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('❌ Error en migración:', e);
  process.exit(1);
});
