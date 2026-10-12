import { Client } from 'pg';

/// Las credenciales salen del entorno, nunca del código: este archivo está
/// versionado y las que tenía escritas quedaron en el historial de git.
function conexion(variable: string): string {
  const url = process.env[variable]
  if (!url) {
    console.error(`Falta ${variable}: la cadena de conexión postgresql://… de esa base.`)
    process.exit(1)
  }
  return url
}

// Configuración de bases de datos
const sourceConfig = {
  connectionString: conexion('MIGRACION_ORIGEN_URL')
};

const targetConfig = {
  connectionString: conexion('MIGRACION_DESTINO_URL'),
  ssl: {
    rejectUnauthorized: false
  }
};

async function compareServicios() {
  const sourceDb = new Client(sourceConfig);
  const targetDb = new Client(targetConfig);

  try {
    console.log('\n🔌 Conectando a las bases de datos...\n');
    await sourceDb.connect();
    await targetDb.connect();
    console.log('✅ Conectado a ORIGEN (100.106.115.11)');
    console.log('✅ Conectado a DESTINO (Azure)\n');

    // Obtener estructura de columnas
    console.log('📋 ESTRUCTURA DE LA TABLA SERVICIOS\n');
    console.log('════════════════════════════════════════════════════════════════\n');

    const sourceColumns = await sourceDb.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'servicios' 
      ORDER BY ordinal_position
    `);

    const targetColumns = await targetDb.query(`
      SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'servicios' 
      ORDER BY ordinal_position
    `);

    const sourceColNames = sourceColumns.rows.map(r => r.column_name);
    const targetColNames = targetColumns.rows.map(r => r.column_name);

    console.log(`📊 ORIGEN: ${sourceColNames.length} columnas`);
    console.log(`📊 DESTINO: ${targetColNames.length} columnas\n`);

    // Columnas solo en origen
    const onlyInSource = sourceColNames.filter(c => !targetColNames.includes(c));
    if (onlyInSource.length > 0) {
      console.log('⚠️  Columnas solo en ORIGEN:');
      onlyInSource.forEach(col => console.log(`   • ${col}`));
      console.log('');
    }

    // Columnas solo en destino
    const onlyInTarget = targetColNames.filter(c => !sourceColNames.includes(c));
    if (onlyInTarget.length > 0) {
      console.log('⚠️  Columnas solo en DESTINO:');
      onlyInTarget.forEach(col => console.log(`   • ${col}`));
      console.log('');
    }

    // Diferencias de tipo
    console.log('🔍 DIFERENCIAS DE TIPO:\n');
    const commonColumns = sourceColNames.filter(c => targetColNames.includes(c));
    let hasDifferences = false;

    for (const colName of commonColumns) {
      const sourceCol = sourceColumns.rows.find(r => r.column_name === colName);
      const targetCol = targetColumns.rows.find(r => r.column_name === colName);

      if (sourceCol.data_type !== targetCol.data_type) {
        console.log(`   ${colName}:`);
        console.log(`      ORIGEN: ${sourceCol.data_type}`);
        console.log(`      DESTINO: ${targetCol.data_type}`);
        hasDifferences = true;
      }
    }

    if (!hasDifferences) {
      console.log('   ✅ No hay diferencias de tipo en columnas comunes\n');
    } else {
      console.log('');
    }

    // Contar registros
    console.log('════════════════════════════════════════════════════════════════\n');
    console.log('📊 CANTIDAD DE REGISTROS\n');

    const sourceCount = await sourceDb.query('SELECT COUNT(*) as count FROM servicios');
    const targetCount = await targetDb.query('SELECT COUNT(*) as count FROM servicios');

    console.log(`   ORIGEN:  ${sourceCount.rows[0].count} servicios`);
    console.log(`   DESTINO: ${targetCount.rows[0].count} servicios`);

    if (sourceCount.rows[0].count === targetCount.rows[0].count) {
      console.log('   ✅ Misma cantidad de registros\n');
    } else {
      console.log(`   ⚠️  DIFERENCIA: ${Math.abs(sourceCount.rows[0].count - targetCount.rows[0].count)} registros\n`);
    }

    // Comparar estados
    console.log('════════════════════════════════════════════════════════════════\n');
    console.log('📈 DISTRIBUCIÓN POR ESTADO\n');

    const sourceStats = await sourceDb.query(`
      SELECT estado::text, COUNT(*) as count 
      FROM servicios 
      GROUP BY estado 
      ORDER BY estado
    `);

    const targetStats = await targetDb.query(`
      SELECT estado::text, COUNT(*) as count 
      FROM servicios 
      GROUP BY estado 
      ORDER BY estado
    `);

    console.log('ORIGEN:');
    sourceStats.rows.forEach(row => {
      console.log(`   ${row.estado}: ${row.count}`);
    });

    console.log('\nDESTINO:');
    targetStats.rows.forEach(row => {
      console.log(`   ${row.estado}: ${row.count}`);
    });
    console.log('');

    // Comparar registros específicos
    console.log('════════════════════════════════════════════════════════════════\n');
    console.log('🔍 COMPARACIÓN DETALLADA DE REGISTROS\n');

    const sourceData = await sourceDb.query(`
      SELECT 
        id,
        estado::text,
        origen_especifico,
        destino_especifico,
        fecha_solicitud,
        fecha_realizacion,
        fecha_finalizacion,
        valor,
        conductor_id,
        vehiculo_id,
        cliente_id,
        created_at
      FROM servicios 
      ORDER BY created_at DESC
    `);

    const targetData = await targetDb.query(`
      SELECT 
        id,
        estado::text,
        origen_especifico,
        destino_especifico,
        fecha_solicitud,
        fecha_realizacion,
        fecha_finalizacion,
        valor,
        conductor_id,
        vehiculo_id,
        cliente_id,
        created_at
      FROM servicios 
      ORDER BY created_at DESC
    `);

    console.log(`Comparando ${sourceData.rows.length} servicios del ORIGEN...\n`);

    let matchCount = 0;
    let missingCount = 0;
    let differentCount = 0;

    for (const sourceRow of sourceData.rows) {
      const targetRow = targetData.rows.find(r => r.id === sourceRow.id);

      if (!targetRow) {
        console.log(`❌ FALTA en destino: ${sourceRow.id}`);
        console.log(`   Estado: ${sourceRow.estado}`);
        console.log(`   Origen: ${sourceRow.origen_especifico}`);
        console.log(`   Destino: ${sourceRow.destino_especifico}`);
        console.log(`   Fecha: ${sourceRow.fecha_realizacion}`);
        console.log('');
        missingCount++;
        continue;
      }

      // Comparar campos importantes
      let hasDiff = false;
      const diffs: string[] = [];

      if (sourceRow.estado !== targetRow.estado) {
        diffs.push(`estado: ${sourceRow.estado} → ${targetRow.estado}`);
        hasDiff = true;
      }

      if (sourceRow.origen_especifico !== targetRow.origen_especifico) {
        diffs.push(`origen: ${sourceRow.origen_especifico} → ${targetRow.origen_especifico}`);
        hasDiff = true;
      }

      if (sourceRow.destino_especifico !== targetRow.destino_especifico) {
        diffs.push(`destino: ${sourceRow.destino_especifico} → ${targetRow.destino_especifico}`);
        hasDiff = true;
      }

      if (sourceRow.valor !== targetRow.valor) {
        diffs.push(`valor: ${sourceRow.valor} → ${targetRow.valor}`);
        hasDiff = true;
      }

      if (sourceRow.conductor_id !== targetRow.conductor_id) {
        diffs.push(`conductor_id: ${sourceRow.conductor_id} → ${targetRow.conductor_id}`);
        hasDiff = true;
      }

      if (hasDiff) {
        console.log(`⚠️  DIFERENCIAS en: ${sourceRow.id}`);
        diffs.forEach(diff => console.log(`   ${diff}`));
        console.log('');
        differentCount++;
      } else {
        matchCount++;
      }
    }

    // Buscar registros en destino que no están en origen
    for (const targetRow of targetData.rows) {
      const sourceRow = sourceData.rows.find(r => r.id === targetRow.id);
      if (!sourceRow) {
        console.log(`➕ EXTRA en destino: ${targetRow.id}`);
        console.log(`   Estado: ${targetRow.estado}`);
        console.log(`   Origen: ${targetRow.origen_especifico}`);
        console.log(`   Destino: ${targetRow.destino_especifico}`);
        console.log('');
      }
    }

    console.log('════════════════════════════════════════════════════════════════\n');
    console.log('📊 RESUMEN DE COMPARACIÓN\n');
    console.log(`   ✅ Idénticos: ${matchCount}`);
    console.log(`   ⚠️  Con diferencias: ${differentCount}`);
    console.log(`   ❌ Faltan en destino: ${missingCount}`);
    console.log(`   ➕ Extra en destino: ${targetData.rows.length - sourceData.rows.length + missingCount}`);
    console.log('');

    if (matchCount === sourceData.rows.length && missingCount === 0 && differentCount === 0) {
      console.log('🎉 ¡MIGRACIÓN PERFECTA! Todos los servicios coinciden.\n');
    } else {
      console.log('⚠️  Hay diferencias entre las bases de datos.\n');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sourceDb.end();
    await targetDb.end();
    console.log('🔌 Conexiones cerradas\n');
  }
}

compareServicios();
