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

// Base de datos ORIGEN
const sourceDb = new Client({
  connectionString: conexion('MIGRACION_ORIGEN_URL'),
  ssl: false
});

// Base de datos DESTINO (Azure)
const targetDb = new Client({
  connectionString: conexion('MIGRACION_DESTINO_URL'),
  ssl: {
    rejectUnauthorized: false
  }
});

// Mapeo de nombres de tablas (origen → destino)
const tableNameMap: Record<string, string> = {
  'user': 'usuarios',
  'usuarios': 'usuarios',
  'conductores': 'conductores',
  'vehiculos': 'vehiculos',
  'clientes': 'clientes',
  'municipios': 'municipios',
  'liquidaciones': 'liquidaciones',
  'recargos': 'recargos',
  'anticipos': 'anticipos',
  'bonificaciones': 'bonificaciones',
  'pernotes': 'pernotes',
  'mantenimientos': 'mantenimientos',
  'documento': 'documento',
  'liquidacion_vehiculo': 'liquidacion_vehiculo',
  'servicio_historicos': 'servicio_historicos',
  'configuraciones_liquidacion': 'configuraciones_liquidacion',
  'liquidaciones_servicios': 'liquidaciones_servicios'
};

// Tablas en orden de dependencias
const tablesToMigrate = [
  // 1. Sin dependencias
  { source: 'user', target: 'usuarios' },
  { source: 'municipios', target: 'municipios' },
  
  // 2. Dependen de usuarios
  { source: 'conductores', target: 'conductores' },
  { source: 'vehiculos', target: 'vehiculos' },
  
  // 3. Configuraciones
  { source: 'configuraciones_liquidacion', target: 'configuraciones_liquidacion' },
  
  // 4. Liquidaciones (depende de conductores y vehiculos)
  { source: 'liquidaciones', target: 'liquidaciones' },
  
  // 5. Dependen de liquidaciones
  { source: 'recargos', target: 'recargos' },
  { source: 'anticipos', target: 'anticipos' },
  { source: 'bonificaciones', target: 'bonificaciones' },
  { source: 'pernotes', target: 'pernotes' },
  { source: 'mantenimientos', target: 'mantenimientos' },
  { source: 'liquidacion_vehiculo', target: 'liquidacion_vehiculo' },
  
  // 6. Documentos
  { source: 'documento', target: 'documento' },
  
  // 7. Otros
  { source: 'servicio_historicos', target: 'servicio_historicos' },
  { source: 'liquidaciones_servicios', target: 'liquidaciones_servicios' }
];

interface MigrationStats {
  table: string;
  rowsCopied: number;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  duration: number;
}

async function getTableColumns(client: Client, tableName: string): Promise<string[]> {
  const result = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = $1 
    ORDER BY ordinal_position
  `, [tableName]);
  
  return result.rows.map(row => row.column_name);
}

async function getTableRowCount(client: Client, tableName: string): Promise<number> {
  try {
    const result = await client.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
    return parseInt(result.rows[0].count);
  } catch {
    return 0;
  }
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  try {
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      )
    `, [tableName]);
    return result.rows[0].exists;
  } catch {
    return false;
  }
}

async function migrateTable(sourceTable: string, targetTable: string): Promise<MigrationStats> {
  const startTime = Date.now();
  const stats: MigrationStats = {
    table: `${sourceTable} → ${targetTable}`,
    rowsCopied: 0,
    status: 'success',
    duration: 0
  };

  try {
    console.log(`\n📋 Migrando: ${sourceTable} → ${targetTable}`);
    
    // Verificar existencia en origen
    const sourceExists = await tableExists(sourceDb, sourceTable);
    if (!sourceExists) {
      console.log(`   ⚠️  Tabla "${sourceTable}" no existe en origen. Saltando...`);
      stats.status = 'skipped';
      stats.duration = Date.now() - startTime;
      return stats;
    }
    
    // Verificar existencia en destino
    const targetExists = await tableExists(targetDb, targetTable);
    if (!targetExists) {
      console.log(`   ⚠️  Tabla "${targetTable}" no existe en destino. Saltando...`);
      stats.status = 'skipped';
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Contar registros
    const sourceCount = await getTableRowCount(sourceDb, sourceTable);
    console.log(`   📊 Registros en origen: ${sourceCount}`);
    
    if (sourceCount === 0) {
      console.log(`   ℹ️  Tabla vacía, saltando...`);
      stats.status = 'skipped';
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Obtener columnas de ambas tablas
    const sourceColumns = await getTableColumns(sourceDb, sourceTable);
    const targetColumns = await getTableColumns(targetDb, targetTable);
    
    // Columnas comunes (solo migrar estas)
    const commonColumns = sourceColumns.filter(c => targetColumns.includes(c));
    
    if (commonColumns.length === 0) {
      console.log(`   ❌ No hay columnas en común entre las tablas`);
      stats.status = 'error';
      stats.error = 'No common columns';
      stats.duration = Date.now() - startTime;
      return stats;
    }
    
    const columnsToSkip = sourceColumns.filter(c => !targetColumns.includes(c));
    if (columnsToSkip.length > 0) {
      console.log(`   ⚠️  Columnas omitidas: ${columnsToSkip.join(', ')}`);
    }
    
    const columnsList = commonColumns.map(c => `"${c}"`).join(', ');
    
    // Leer datos
    console.log(`   📥 Leyendo datos de origen...`);
    const sourceData = await sourceDb.query(`SELECT ${columnsList} FROM "${sourceTable}"`);
    
    if (sourceData.rows.length === 0) {
      console.log(`   ℹ️  No hay datos para migrar`);
      stats.status = 'skipped';
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Limpiar tabla destino
    console.log(`   🗑️  Limpiando tabla en destino...`);
    await targetDb.query(`TRUNCATE TABLE "${targetTable}" CASCADE`);
    
    // Insertar en lotes
    const batchSize = 100;
    let totalInserted = 0;
    
    for (let i = 0; i < sourceData.rows.length; i += batchSize) {
      const batch = sourceData.rows.slice(i, i + batchSize);
      
      const placeholders: string[] = [];
      const values: any[] = [];
      let valueIndex = 1;
      
      batch.forEach((row) => {
        const rowPlaceholders = commonColumns.map(() => `$${valueIndex++}`).join(', ');
        placeholders.push(`(${rowPlaceholders})`);
        commonColumns.forEach(col => values.push(row[col]));
      });
      
      const insertQuery = `
        INSERT INTO "${targetTable}" (${columnsList})
        VALUES ${placeholders.join(', ')}
        ON CONFLICT DO NOTHING
      `;
      
      await targetDb.query(insertQuery, values);
      totalInserted += batch.length;
      
      const progress = Math.round((totalInserted / sourceData.rows.length) * 100);
      process.stdout.write(`   📤 Insertando... ${progress}% (${totalInserted}/${sourceData.rows.length})\r`);
    }
    
    console.log(`\n   ✅ Completado: ${totalInserted} registros copiados`);
    stats.rowsCopied = totalInserted;
    stats.duration = Date.now() - startTime;
    
  } catch (error: any) {
    console.error(`\n   ❌ Error:`, error.message);
    stats.status = 'error';
    stats.error = error.message;
    stats.duration = Date.now() - startTime;
  }
  
  return stats;
}

async function main() {
  const allStats: MigrationStats[] = [];
  
  try {
    console.log('🚀 MIGRACIÓN INTELIGENTE DE BASE DE DATOS');
    console.log('='.repeat(80));
    console.log('📍 ORIGEN: 100.106.115.11');
    console.log('📍 DESTINO: Azure PostgreSQL');
    console.log('');
    console.log('✨ Características:');
    console.log('   • Mapea nombres de tablas automáticamente (user → usuarios)');
    console.log('   • Solo migra columnas que existen en destino');
    console.log('   • Respeta el orden de dependencias (foreign keys)');
    console.log('');
    console.log('⚠️  ADVERTENCIA: Esto eliminará los datos existentes en Azure!');
    console.log('');
    console.log('⏸️  Presiona Ctrl+C para cancelar o Enter para continuar...');
    
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    
    console.log('\n🔌 Conectando...');
    await sourceDb.connect();
    console.log('✅ Origen conectado');
    
    await targetDb.connect();
    console.log('✅ Destino conectado');
    
    console.log(`\n📦 Migrando ${tablesToMigrate.length} tablas...\n`);
    
    // Migrar cada tabla
    for (let i = 0; i < tablesToMigrate.length; i++) {
      const { source, target } = tablesToMigrate[i];
      console.log(`[${i + 1}/${tablesToMigrate.length}]`);
      
      const stats = await migrateTable(source, target);
      allStats.push(stats);
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Resumen
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 RESUMEN');
    console.log('='.repeat(80) + '\n');
    
    const successful = allStats.filter(s => s.status === 'success');
    const errors = allStats.filter(s => s.status === 'error');
    const skipped = allStats.filter(s => s.status === 'skipped');
    const totalRows = successful.reduce((sum, s) => sum + s.rowsCopied, 0);
    
    console.log(`✅ Migradas exitosamente: ${successful.length}`);
    console.log(`⚠️  Saltadas: ${skipped.length}`);
    console.log(`❌ Con errores: ${errors.length}`);
    console.log(`📊 Total registros: ${totalRows.toLocaleString()}\n`);
    
    if (errors.length > 0) {
      console.log('❌ ERRORES:\n');
      errors.forEach(stat => {
        console.log(`   • ${stat.table}: ${stat.error}`);
      });
      console.log('');
    }
    
    if (successful.length > 0) {
      console.log('✅ MIGRADAS:\n');
      successful.forEach(stat => {
        console.log(`   • ${stat.table}: ${stat.rowsCopied} registros`);
      });
      console.log('');
    }
    
    console.log('='.repeat(80));
    console.log('🎉 Migración completada!\n');
    
  } catch (error: any) {
    console.error('\n❌ Error fatal:', error.message);
    process.exit(1);
  } finally {
    await sourceDb.end();
    await targetDb.end();
    console.log('🔌 Conexiones cerradas\n');
  }
}

main().catch(console.error);
