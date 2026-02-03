import { Client } from 'pg';

// Base de datos ORIGEN (la actual)
const sourceDb = new Client({
  host: '100.106.115.11',
  port: 5432,
  user: 'postgres',
  password: 'Transmeralda2025',
  database: 'postgres',
  ssl: false
});

// Base de datos DESTINO (Azure)
const targetDb = new Client({
  host: 'cotransmeq.postgres.database.azure.com',
  port: 5432,
  user: 'admintransmeralda',
  password: 'SASesmeralda2025',
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false
  }
});

// Lista de tablas a migrar en orden (respetando dependencias)
const tablesToMigrate = [
  // Primero las tablas sin dependencias
  'usuarios',
  'municipios',
  'clientes',
  'subsystems',
  'tipos_recargos',
  'recargos',
  'documentos_requeridos_conductor',
  
  // Tablas con dependencias de usuarios
  'conductores',
  'vehiculos',
  'configuracion_liquidador',
  'configuraciones_liquidacion',
  'configuraciones_salarios',
  
  // Servicios y relacionados
  'servicio',
  'servicio_historicos',
  'servicios_cancelados',
  
  // Mantenimientos
  'mantenimientos',
  'documento',
  
  // Liquidaciones
  'liquidaciones',
  'liquidacion_vehiculo',
  'liquidaciones_servicios',
  'servicio_liquidaciones',
  
  // Anticipos, bonificaciones, pernotes
  'anticipos',
  'bonificaciones',
  'pernotes',
  
  // Recargos y planillas
  'recargos_planillas',
  'dias_laborales_planillas',
  'detalles_recargos_dias',
  'historial_recargos_planillas',
  'snapshots_recargos_planillas',
  
  // Firmas
  'firmas_desprendibles',
  
  // Asistencias
  'formularios_asistencia',
  'respuestas_asistencia',
  
  // Acciones correctivas
  'acciones_correctivas_preventivas'
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
    WHERE table_name = $1 
    ORDER BY ordinal_position
  `, [tableName]);
  
  return result.rows.map(row => row.column_name);
}

async function getTableRowCount(client: Client, tableName: string): Promise<number> {
  const result = await client.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
  return parseInt(result.rows[0].count);
}

async function migrateTable(tableName: string): Promise<MigrationStats> {
  const startTime = Date.now();
  const stats: MigrationStats = {
    table: tableName,
    rowsCopied: 0,
    status: 'success',
    duration: 0
  };

  try {
    console.log(`\n📋 Migrando tabla: ${tableName}`);
    
    // Verificar si la tabla existe en origen
    const tableExists = await sourceDb.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = $1
      )
    `, [tableName]);
    
    if (!tableExists.rows[0].exists) {
      console.log(`⚠️  Tabla ${tableName} no existe en la base de datos origen. Saltando...`);
      stats.status = 'skipped';
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Contar registros en origen
    const sourceCount = await getTableRowCount(sourceDb, tableName);
    console.log(`   📊 Registros en origen: ${sourceCount}`);
    
    if (sourceCount === 0) {
      console.log(`   ℹ️  Tabla vacía, saltando...`);
      stats.status = 'skipped';
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Obtener columnas de la tabla
    const columns = await getTableColumns(sourceDb, tableName);
    const columnsList = columns.map(c => `"${c}"`).join(', ');
    
    // Leer datos de origen
    console.log(`   📥 Leyendo datos de origen...`);
    const sourceData = await sourceDb.query(`SELECT ${columnsList} FROM "${tableName}"`);
    
    if (sourceData.rows.length === 0) {
      console.log(`   ℹ️  No hay datos para migrar`);
      stats.status = 'skipped';
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Limpiar tabla destino (CUIDADO: esto borra los datos existentes)
    console.log(`   🗑️  Limpiando tabla en destino...`);
    await targetDb.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
    
    // Insertar datos en lotes de 100
    const batchSize = 100;
    let totalInserted = 0;
    
    for (let i = 0; i < sourceData.rows.length; i += batchSize) {
      const batch = sourceData.rows.slice(i, i + batchSize);
      
      // Construir query de inserción múltiple
      const placeholders: string[] = [];
      const values: any[] = [];
      let valueIndex = 1;
      
      batch.forEach((row) => {
        const rowPlaceholders = columns.map(() => `$${valueIndex++}`).join(', ');
        placeholders.push(`(${rowPlaceholders})`);
        columns.forEach(col => values.push(row[col]));
      });
      
      const insertQuery = `
        INSERT INTO "${tableName}" (${columnsList})
        VALUES ${placeholders.join(', ')}
        ON CONFLICT DO NOTHING
      `;
      
      await targetDb.query(insertQuery, values);
      totalInserted += batch.length;
      
      // Mostrar progreso
      const progress = Math.round((totalInserted / sourceData.rows.length) * 100);
      process.stdout.write(`   📤 Insertando datos... ${progress}% (${totalInserted}/${sourceData.rows.length})\r`);
    }
    
    console.log(`\n   ✅ Migración completada: ${totalInserted} registros copiados`);
    stats.rowsCopied = totalInserted;
    stats.duration = Date.now() - startTime;
    
  } catch (error: any) {
    console.error(`\n   ❌ Error migrando ${tableName}:`, error.message);
    stats.status = 'error';
    stats.error = error.message;
    stats.duration = Date.now() - startTime;
  }
  
  return stats;
}

async function resetSequences() {
  console.log('\n🔄 Reiniciando secuencias...');
  
  // Obtener todas las secuencias
  const sequences = await targetDb.query(`
    SELECT sequence_name 
    FROM information_schema.sequences 
    WHERE sequence_schema = 'public'
  `);
  
  for (const seq of sequences.rows) {
    const sequenceName = seq.sequence_name;
    const tableName = sequenceName.replace(/_id_seq$/, '');
    
    try {
      await targetDb.query(`
        SELECT setval('${sequenceName}', 
          COALESCE((SELECT MAX(id) FROM "${tableName}"), 1), 
          true
        )
      `);
      console.log(`   ✓ ${sequenceName}`);
    } catch (error) {
      // Ignorar errores de secuencias que no existen
    }
  }
}

async function main() {
  const allStats: MigrationStats[] = [];
  
  try {
    console.log('🚀 Iniciando migración de base de datos...\n');
    console.log('📍 ORIGEN: Base de datos local/actual');
    console.log('📍 DESTINO: Azure PostgreSQL (cotransmeq.postgres.database.azure.com)\n');
    console.log('⚠️  ADVERTENCIA: Esta operación eliminará los datos existentes en Azure!\n');
    
    // Confirmar antes de continuar
    console.log('⏸️  Presiona Ctrl+C para cancelar o Enter para continuar...');
    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });
    
    console.log('\n🔌 Conectando a bases de datos...');
    await sourceDb.connect();
    console.log('✅ Conectado a base de datos ORIGEN');
    
    await targetDb.connect();
    console.log('✅ Conectado a base de datos DESTINO (Azure)');
    
    console.log('\n📦 Iniciando migración de tablas...');
    console.log(`📋 Total de tablas a migrar: ${tablesToMigrate.length}\n`);
    
    // Migrar cada tabla
    for (let i = 0; i < tablesToMigrate.length; i++) {
      const tableName = tablesToMigrate[i];
      console.log(`\n[${i + 1}/${tablesToMigrate.length}] ▶️  Procesando: ${tableName}`);
      
      const stats = await migrateTable(tableName);
      allStats.push(stats);
      
      // Pequeña pausa entre tablas
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Reiniciar secuencias
    await resetSequences();
    
    // Mostrar resumen
    console.log('\n\n' + '='.repeat(80));
    console.log('📊 RESUMEN DE MIGRACIÓN');
    console.log('='.repeat(80) + '\n');
    
    const successful = allStats.filter(s => s.status === 'success');
    const errors = allStats.filter(s => s.status === 'error');
    const skipped = allStats.filter(s => s.status === 'skipped');
    const totalRows = successful.reduce((sum, s) => sum + s.rowsCopied, 0);
    const totalDuration = allStats.reduce((sum, s) => sum + s.duration, 0);
    
    console.log(`✅ Tablas migradas exitosamente: ${successful.length}`);
    console.log(`⚠️  Tablas saltadas (vacías/no existen): ${skipped.length}`);
    console.log(`❌ Tablas con errores: ${errors.length}`);
    console.log(`📊 Total de registros copiados: ${totalRows.toLocaleString()}`);
    console.log(`⏱️  Duración total: ${(totalDuration / 1000).toFixed(2)}s\n`);
    
    if (errors.length > 0) {
      console.log('❌ ERRORES ENCONTRADOS:\n');
      errors.forEach(stat => {
        console.log(`   • ${stat.table}: ${stat.error}`);
      });
      console.log('');
    }
    
    console.log('='.repeat(80));
    console.log('🎉 Migración completada!\n');
    
  } catch (error: any) {
    console.error('\n❌ Error fatal durante la migración:', error.message);
    process.exit(1);
  } finally {
    await sourceDb.end();
    await targetDb.end();
    console.log('🔌 Conexiones cerradas');
  }
}

// Ejecutar migración
main().catch(console.error);
