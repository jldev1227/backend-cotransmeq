import { LiquidacionesService } from './src/modules/liquidaciones/liquidaciones.service';

async function main() {
  const preview = await LiquidacionesService.previewRecargos(
    'b7c08dc8-3bf9-44b0-8b6d-2aeedcaab1fd',
    '2026-06-21',
    '2026-07-20'
  );

  console.log('Total planillas devueltas:', preview.planillas.length);
  console.log('Resumen:', JSON.stringify(preview.resumen, null, 2));
  console.log('\nDetalle por planilla:');
  for (const p of preview.planillas) {
    const nDisp = (p.dias || []).filter((d: any) => d.disponibilidad).length;
    const nNorm = (p.dias || []).filter((d: any) => !d.disponibilidad).length;
    console.log(`  - ${p.planilla_id} | vehiculo=${p.vehiculo?.placa} | empresa=${p.empresa?.nombre} | mes=${p.mes}/${p.año} | total_valor=${p.total_valor} | dias=${p.dias?.length || 0} (normales=${nNorm}, disp=${nDisp})`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
