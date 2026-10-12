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
const tableMapping: Record<string, string> = {
  'user': 'usuarios',
  'empresa': 'clientes'
};

// Columnas a excluir por tabla (que existen en origen pero no en destino)
const columnsToExclude: Record<string, string[]> = {
  'conductores': ['old_id', 'licencia_conduccion'], // old_id no existe, licencia_conduccion es VARCHAR→JSONB
  'documento': ['modelo_id']
};

// Orden correcto de migración respetando foreign keys
const tablesToMigrate = [
  // 1. Tablas independientes primero
  { source: 'user', target: 'usuarios' },
  'municipios',
  'empresas', // Ya se llama igual en ambas bases
  
  // 2. Conductores y vehículos (dependen de usuarios)
  'conductores',
  'vehiculos',
  
  // 3. Configuraciones
  'configuraciones_liquidacion',
  
  // 4. Liquidaciones (depende de conductores)
  'liquidaciones',
  
  // 5. Tablas que dependen de liquidaciones
  'liquidacion_vehiculo',
  'recargos',
  'anticipos',
  'bonificaciones',
  'pernotes',
  'mantenimientos',
  
  // 6. Servicios (depende de conductores, vehiculos, clientes, municipios)
  'servicios',
  'servicio_historicos',
  'liquidaciones_servicios',
  
  // 7. Documentos
  'documento'
];

interface MigrationResult {
  table: string;
  status: 'success' | 'error' | 'skipped';
  rowsCopied: number;
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

async function getTableColumnsWithTypes(client: Client, tableName: string): Promise<Map<string, string>> {
  const result = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = $1 
    ORDER BY ordinal_position
  `, [tableName]);
  
  const map = new Map<string, string>();
  result.rows.forEach(row => {
    map.set(row.column_name, row.data_type);
  });
  return map;
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = $1
    )
  `, [tableName]);
  
  return result.rows[0].exists;
}

async function migrateTable(sourceTable: string, targetTable: string): Promise<MigrationResult> {
  const startTime = Date.now();
  const result: MigrationResult = {
    table: targetTable,
    status: 'success',
    rowsCopied: 0,
    duration: 0
  };
  
  try {
    console.log(`\n📋 Migrando: ${sourceTable} → ${targetTable}`);
    
    // Verificar que ambas tablas existan
    const sourceExists = await tableExists(sourceDb, sourceTable);
    const targetExists = await tableExists(targetDb, targetTable);
    
    if (!sourceExists) {
      console.log(`   ⚠️  Tabla ${sourceTable} no existe en origen`);
      result.status = 'skipped';
      result.duration = Date.now() - startTime;
      return result;
    }
    
    if (!targetExists) {
      console.log(`   ⚠️  Tabla ${targetTable} no existe en destino`);
      result.status = 'skipped';
      result.duration = Date.now() - startTime;
      return result;
    }
    
    // Obtener columnas de ambas tablas
    const sourceColumns = await getTableColumns(sourceDb, sourceTable);
    const targetColumns = await getTableColumns(targetDb, targetTable);
    const sourceColumnTypes = await getTableColumnsWithTypes(sourceDb, sourceTable);
    
    // Filtrar columnas: solo las que existen en ambas tablas
    const excludeList = columnsToExclude[targetTable] || [];
    const commonColumns = sourceColumns.filter(col => 
      targetColumns.includes(col) && !excludeList.includes(col)
    );
    
    if (commonColumns.length === 0) {
      console.log(`   ⚠️  No hay columnas comunes entre las tablas`);
      result.status = 'skipped';
      result.duration = Date.now() - startTime;
      return result;
    }
    
    console.log(`   📐 Columnas a migrar: ${commonColumns.length}`);
    if (excludeList.length > 0) {
      console.log(`   🚫 Columnas excluidas: ${excludeList.join(', ')}`);
    }
    
    // Contar registros en origen
    const countResult = await sourceDb.query(`SELECT COUNT(*) as count FROM "${sourceTable}"`);
    const totalRows = parseInt(countResult.rows[0].count);
    
    if (totalRows === 0) {
      console.log(`   ℹ️  No hay datos en origen`);
      result.status = 'skipped';
      result.duration = Date.now() - startTime;
      return result;
    }
    
    console.log(`   📊 Registros en origen: ${totalRows}`);
    
    // Leer datos de origen
    const columnsList = commonColumns.map(c => `"${c}"`).join(', ');
    const sourceData = await sourceDb.query(`SELECT ${columnsList} FROM "${sourceTable}"`);
    
    // Limpiar tabla destino
    console.log(`   🗑️  Limpiando tabla ${targetTable}...`);
    await targetDb.query(`TRUNCATE TABLE "${targetTable}" CASCADE`);
    
    // Insertar en lotes
    const batchSize = 100;
    let totalInserted = 0;
    
    // Para tablas con problemas JSON, insertar uno por uno
    const insertOneByOne = ['conductores', 'liquidaciones'].includes(targetTable);
    
    if (insertOneByOne) {
      console.log(`   ⚠️  Insertando uno por uno para detectar problemas...`);
      for (let i = 0; i < sourceData.rows.length; i++) {
        const row = sourceData.rows[i];
        try {
          // Filtrar columnas: excluir las que son NULL y son JSON con default
          const columnsToInsert: string[] = [];
          const valuesToInsert: any[] = [];
          
          commonColumns.forEach(col => {
            let value = row[col];
            
            // Si es NULL y la columna es JSON, omitir la columna (usará el default)
            if (value === null || value === '' || value === 'null' || value === '""') {
              const colType = sourceColumnTypes.get(col);
              if (colType === 'json' || colType === 'jsonb') {
                // No incluir esta columna, dejará que use el default
                return;
              }
            }
            
            // Si es un array/object y la columna es JSON, convertir a string JSON
            const colType = sourceColumnTypes.get(col);
            if ((colType === 'json' || colType === 'jsonb') && (Array.isArray(value) || typeof value === 'object')) {
              value = JSON.stringify(value);
            }
            
            columnsToInsert.push(`"${col}"`);
            valuesToInsert.push(value);
          });
          
          if (columnsToInsert.length === 0) {
            console.log(`\n   ⚠️  Registro ${i + 1} no tiene columnas válidas, saltando...`);
            continue;
          }
          
          const placeholders = columnsToInsert.map((_, idx) => `$${idx + 1}`).join(', ');
          const columnsListLocal = columnsToInsert.join(', ');
          
          const insertQuery = `
            INSERT INTO "${targetTable}" (${columnsListLocal})
            VALUES (${placeholders})
            ON CONFLICT DO NOTHING
          `;
          
          await targetDb.query(insertQuery, valuesToInsert);
          totalInserted++;
          
          const progress = Math.round((totalInserted / sourceData.rows.length) * 100);
          process.stdout.write(`   📤 Insertando... ${progress}% (${totalInserted}/${sourceData.rows.length})\r`);
        } catch (error: any) {
          console.error(`\n   ❌ Error en registro ${i + 1}:`, error.message);
          console.error(`   📋 Datos del registro:`, JSON.stringify(row, null, 2));
          throw error;
        }
      }
    } else {
      // Inserción normal en lotes
      for (let i = 0; i < sourceData.rows.length; i += batchSize) {
        const batch = sourceData.rows.slice(i, i + batchSize);
        
        const placeholders: string[] = [];
        const values: any[] = [];
        let valueIndex = 1;
        
        batch.forEach((row) => {
          const rowPlaceholders = commonColumns.map(() => `$${valueIndex++}`).join(', ');
          placeholders.push(`(${rowPlaceholders})`);
          commonColumns.forEach(col => {
            let value = row[col];
            
            // Sanitizar valores JSON/JSONB vacíos o inválidos
            if (value === '' || value === 'null' || value === '""') {
              const colType = sourceColumnTypes.get(col);
              if (colType === 'json' || colType === 'jsonb') {
                value = null; // Convertir strings vacíos a NULL para columnas JSON
              }
            }
            
            values.push(value);
          });
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
    }
    
    console.log(`\n   ✅ Completado: ${totalInserted} registros copiados`);
    result.rowsCopied = totalInserted;
    result.duration = Date.now() - startTime;
    
  } catch (error: any) {
    console.error(`\n   ❌ Error: ${error.message}`);
    result.status = 'error';
    result.error = error.message;
    result.duration = Date.now() - startTime;
  }
  
  return result;
}

async function main() {
  const results: MigrationResult[] = [];
  
  try {
    console.log('🚀 MIGRACIÓN MEJORADA CON MAPEO DE COLUMNAS');
    console.log('=' .repeat(80));
    console.log('');
    console.log('📍 ORIGEN: 100.106.115.11 (PostgreSQL)');
    console.log('📍 DESTINO: Azure PostgreSQL');
    console.log('');
    console.log('🔧 Características:');
    console.log('   ✅ Mapeo automático de tablas (user → usuarios, empresa → clientes)');
    console.log('   ✅ Exclusión de columnas incompatibles (old_id, modelo_id)');
    console.log('   ✅ Orden correcto respetando foreign keys');
    console.log('');
    console.log('⚠️  ADVERTENCIA: Esto eliminará los datos existentes en Azure!');
    console.log('');
    // Confirmación automática para ejecución desde npm
    // console.log('⏸️  Presiona Ctrl+C para cancelar o Enter para continuar...');
    // await new Promise(resolve => {
    //   process.stdin.once('data', resolve);
    // });
    console.log('✅ Iniciando migración automáticamente...');
    console.log('\n🔌 Conectando...');
    await sourceDb.connect();
    console.log('✅ Conectado a ORIGEN');
    
    await targetDb.connect();
    console.log('✅ Conectado a DESTINO');
    
    console.log(`\n📦 Migrando ${tablesToMigrate.length} tablas...`);
    console.log('=' .repeat(80));
    
    for (let i = 0; i < tablesToMigrate.length; i++) {
      const tableConfig = tablesToMigrate[i];
      let sourceTable: string;
      let targetTable: string;
      
      if (typeof tableConfig === 'string') {
        sourceTable = tableConfig;
        targetTable = tableConfig;
      } else {
        sourceTable = tableConfig.source;
        targetTable = tableConfig.target;
      }
      
      console.log(`\n[${i + 1}/${tablesToMigrate.length}] ▶️  ${sourceTable} → ${targetTable}`);
      
      const result = await migrateTable(sourceTable, targetTable);
      results.push(result);
      
      // Pausa breve entre tablas
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Resumen
    console.log('\n\n');
    console.log('=' .repeat(80));
    console.log('📊 RESUMEN FINAL');
    console.log('=' .repeat(80));
    console.log('');
    
    const successful = results.filter(r => r.status === 'success');
    const errors = results.filter(r => r.status === 'error');
    const skipped = results.filter(r => r.status === 'skipped');
    const totalRows = successful.reduce((sum, r) => sum + r.rowsCopied, 0);
    
    console.log(`✅ Tablas migradas: ${successful.length}`);
    console.log(`❌ Errores: ${errors.length}`);
    console.log(`⚠️  Saltadas: ${skipped.length}`);
    console.log(`📊 Total registros: ${totalRows.toLocaleString()}`);
    console.log('');
    
    if (errors.length > 0) {
      console.log('❌ ERRORES:');
      errors.forEach(r => {
        console.log(`   • ${r.table}: ${r.error}`);
      });
      console.log('');
    }
    
    if (successful.length > 0) {
      console.log('✅ TABLAS MIGRADAS:');
      successful.forEach(r => {
        console.log(`   • ${r.table}: ${r.rowsCopied.toLocaleString()} registros`);
      });
      console.log('');
    }
    
    console.log('=' .repeat(80));
    console.log('🎉 Proceso completado!');
    console.log('');
    
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
