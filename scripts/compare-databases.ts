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

// Base de datos ORIGEN (transmeralda_backend - la vieja)
const sourceDb = new Client({
  connectionString: conexion('MIGRACION_ORIGEN_URL'),
  ssl: false
});

// Base de datos DESTINO (Azure - backend-nest)
const targetDb = new Client({
  connectionString: conexion('MIGRACION_DESTINO_URL'),
  ssl: {
    rejectUnauthorized: false
  }
});

interface TableComparison {
  tableName: string;
  exists: {
    source: boolean;
    target: boolean;
  };
  columns: {
    source: string[];
    target: string[];
    onlyInSource: string[];
    onlyInTarget: string[];
    common: string[];
  };
  rowCounts: {
    source: number;
    target: number;
    difference: number;
  };
  latestRecords: {
    source: any;
    target: any;
    match: boolean;
  };
  structureMatch: boolean;
  dataMatch: boolean;
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  try {
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = $1
      )
    `, [tableName]);
    return result.rows[0].exists;
  } catch (error) {
    return false;
  }
}

async function getTableColumns(client: Client, tableName: string): Promise<string[]> {
  try {
    const result = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      AND table_name = $1 
      ORDER BY ordinal_position
    `, [tableName]);
    return result.rows.map(row => row.column_name);
  } catch (error) {
    return [];
  }
}

async function getTableRowCount(client: Client, tableName: string): Promise<number> {
  try {
    const result = await client.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
    return parseInt(result.rows[0].count);
  } catch (error) {
    return 0;
  }
}

async function getLatestRecord(client: Client, tableName: string, columns: string[]): Promise<any> {
  try {
    // Intentar encontrar una columna de fecha para ordenar
    const dateColumns = columns.filter(c => 
      c.includes('created_at') || 
      c.includes('updated_at') || 
      c.includes('fecha')
    );
    
    let orderBy = 'created_at';
    if (dateColumns.length > 0) {
      orderBy = dateColumns[0];
    } else if (!columns.includes('created_at')) {
      // Si no hay columna de fecha, usar la primera columna
      orderBy = columns[0];
    }
    
    const columnsList = columns.map(c => `"${c}"`).join(', ');
    const query = `
      SELECT ${columnsList}
      FROM "${tableName}"
      ORDER BY "${orderBy}" DESC
      LIMIT 1
    `;
    
    const result = await client.query(query);
    return result.rows[0] || null;
  } catch (error: any) {
    console.error(`Error obteniendo último registro de ${tableName}:`, error.message);
    return null;
  }
}

function compareRecords(record1: any, record2: any, commonColumns: string[]): boolean {
  if (!record1 || !record2) return false;
  
  // Comparar solo las columnas comunes
  for (const col of commonColumns) {
    const val1 = record1[col];
    const val2 = record2[col];
    
    // Comparar valores (manejando null, undefined, fechas, etc)
    if (val1 instanceof Date && val2 instanceof Date) {
      if (val1.getTime() !== val2.getTime()) return false;
    } else if (val1 !== val2) {
      // Permitir diferencias en timestamps muy pequeñas
      if (typeof val1 === 'object' && typeof val2 === 'object') {
        if (JSON.stringify(val1) !== JSON.stringify(val2)) return false;
      } else {
        return false;
      }
    }
  }
  
  return true;
}

async function compareTable(tableName: string): Promise<TableComparison> {
  const comparison: TableComparison = {
    tableName,
    exists: {
      source: false,
      target: false
    },
    columns: {
      source: [],
      target: [],
      onlyInSource: [],
      onlyInTarget: [],
      common: []
    },
    rowCounts: {
      source: 0,
      target: 0,
      difference: 0
    },
    latestRecords: {
      source: null,
      target: null,
      match: false
    },
    structureMatch: false,
    dataMatch: false
  };
  
  // Verificar existencia
  comparison.exists.source = await tableExists(sourceDb, tableName);
  comparison.exists.target = await tableExists(targetDb, tableName);
  
  if (!comparison.exists.source || !comparison.exists.target) {
    return comparison;
  }
  
  // Obtener columnas
  comparison.columns.source = await getTableColumns(sourceDb, tableName);
  comparison.columns.target = await getTableColumns(targetDb, tableName);
  
  // Columnas comunes y diferentes
  comparison.columns.common = comparison.columns.source.filter(c => 
    comparison.columns.target.includes(c)
  );
  comparison.columns.onlyInSource = comparison.columns.source.filter(c => 
    !comparison.columns.target.includes(c)
  );
  comparison.columns.onlyInTarget = comparison.columns.target.filter(c => 
    !comparison.columns.source.includes(c)
  );
  
  // Verificar si la estructura coincide
  comparison.structureMatch = 
    comparison.columns.onlyInSource.length === 0 && 
    comparison.columns.onlyInTarget.length === 0;
  
  // Contar registros
  comparison.rowCounts.source = await getTableRowCount(sourceDb, tableName);
  comparison.rowCounts.target = await getTableRowCount(targetDb, tableName);
  comparison.rowCounts.difference = comparison.rowCounts.source - comparison.rowCounts.target;
  
  // Obtener último registro de cada base de datos
  if (comparison.columns.common.length > 0) {
    comparison.latestRecords.source = await getLatestRecord(
      sourceDb, 
      tableName, 
      comparison.columns.source
    );
    comparison.latestRecords.target = await getLatestRecord(
      targetDb, 
      tableName, 
      comparison.columns.target
    );
    
    // Comparar registros
    comparison.latestRecords.match = compareRecords(
      comparison.latestRecords.source,
      comparison.latestRecords.target,
      comparison.columns.common
    );
  }
  
  // Verificar si los datos coinciden
  comparison.dataMatch = 
    comparison.rowCounts.difference === 0 && 
    comparison.latestRecords.match;
  
  return comparison;
}

async function main() {
  const tablesToCheck = [
    'usuarios',
    'conductores',
    'vehiculos',
    'clientes',
    'servicio',
    'liquidaciones',
    'municipios',
    'recargos',
    'tipos_recargos',
    'recargos_planillas',
    'dias_laborales_planillas',
    'anticipos',
    'bonificaciones',
    'pernotes',
    'mantenimientos',
    'documento'
  ];
  
  try {
    console.log('🔍 ANÁLISIS DETALLADO DE BASES DE DATOS');
    console.log('=' .repeat(100));
    console.log('');
    console.log('📍 ORIGEN: Base de datos local (transmeralda_backend)');
    console.log('📍 DESTINO: Azure PostgreSQL (backend-nest)');
    console.log('');
    
    // Conectar
    console.log('🔌 Conectando a bases de datos...');
    await sourceDb.connect();
    console.log('✅ Conectado a ORIGEN');
    
    await targetDb.connect();
    console.log('✅ Conectado a DESTINO');
    console.log('');
    
    // Comparar cada tabla
    const results: TableComparison[] = [];
    
    for (let i = 0; i < tablesToCheck.length; i++) {
      const tableName = tablesToCheck[i];
      process.stdout.write(`[${i + 1}/${tablesToCheck.length}] Analizando ${tableName}...`);
      
      const comparison = await compareTable(tableName);
      results.push(comparison);
      
      // Indicador rápido
      if (!comparison.exists.source || !comparison.exists.target) {
        process.stdout.write(' ⚠️  No existe\n');
      } else if (comparison.structureMatch && comparison.dataMatch) {
        process.stdout.write(' ✅\n');
      } else {
        process.stdout.write(' ❌\n');
      }
    }
    
    console.log('');
    console.log('=' .repeat(100));
    console.log('📊 RESUMEN DETALLADO');
    console.log('=' .repeat(100));
    console.log('');
    
    // Mostrar resultados detallados
    let tablesOk = 0;
    let tablesWithIssues = 0;
    let tablesMissing = 0;
    
    for (const result of results) {
      const { tableName, exists, columns, rowCounts, structureMatch, dataMatch } = result;
      
      console.log(`\n📋 TABLA: ${tableName}`);
      console.log('─'.repeat(100));
      
      // Existencia
      if (!exists.source) {
        console.log('   ⚠️  NO EXISTE EN ORIGEN');
        tablesMissing++;
        continue;
      }
      if (!exists.target) {
        console.log('   ⚠️  NO EXISTE EN DESTINO');
        tablesMissing++;
        continue;
      }
      
      console.log(`   ✅ Existe en ambas bases de datos`);
      
      // Estructura
      console.log(`\n   📐 ESTRUCTURA:`);
      console.log(`      Columnas en origen:  ${columns.source.length}`);
      console.log(`      Columnas en destino: ${columns.target.length}`);
      console.log(`      Columnas comunes:    ${columns.common.length}`);
      
      if (columns.onlyInSource.length > 0) {
        console.log(`      ⚠️  Solo en origen: ${columns.onlyInSource.join(', ')}`);
      }
      if (columns.onlyInTarget.length > 0) {
        console.log(`      ⚠️  Solo en destino: ${columns.onlyInTarget.join(', ')}`);
      }
      
      if (structureMatch) {
        console.log(`      ✅ Estructura IDÉNTICA`);
      } else {
        console.log(`      ❌ Estructura DIFERENTE`);
      }
      
      // Datos
      console.log(`\n   📊 DATOS:`);
      console.log(`      Registros en origen:  ${rowCounts.source.toLocaleString()}`);
      console.log(`      Registros en destino: ${rowCounts.target.toLocaleString()}`);
      console.log(`      Diferencia:           ${rowCounts.difference > 0 ? '+' : ''}${rowCounts.difference.toLocaleString()}`);
      
      if (rowCounts.difference === 0) {
        console.log(`      ✅ Mismo número de registros`);
      } else {
        console.log(`      ❌ Número de registros DIFERENTE`);
      }
      
      // Último registro
      if (result.latestRecords.source && result.latestRecords.target) {
        console.log(`\n   🔍 ÚLTIMO REGISTRO:`);
        
        // Mostrar algunos campos clave del último registro
        const sampleFields = ['id', 'created_at', 'updated_at', 'nombre', 'estado'];
        const fieldsToShow = sampleFields.filter(f => columns.common.includes(f));
        
        if (fieldsToShow.length > 0) {
          console.log(`      ORIGEN:`);
          for (const field of fieldsToShow) {
            const value = result.latestRecords.source[field];
            const displayValue = value instanceof Date 
              ? value.toISOString() 
              : String(value).substring(0, 50);
            console.log(`         ${field}: ${displayValue}`);
          }
          
          console.log(`      DESTINO:`);
          for (const field of fieldsToShow) {
            const value = result.latestRecords.target[field];
            const displayValue = value instanceof Date 
              ? value.toISOString() 
              : String(value).substring(0, 50);
            console.log(`         ${field}: ${displayValue}`);
          }
        }
        
        if (result.latestRecords.match) {
          console.log(`      ✅ Últimos registros COINCIDEN`);
        } else {
          console.log(`      ❌ Últimos registros DIFERENTES`);
        }
      }
      
      // Veredicto final
      console.log(`\n   🎯 VEREDICTO:`);
      if (structureMatch && dataMatch) {
        console.log(`      ✅ ✅ ✅ TABLA MIGRADA CORRECTAMENTE`);
        tablesOk++;
      } else {
        console.log(`      ❌ ❌ ❌ TABLA NECESITA MIGRACIÓN`);
        tablesWithIssues++;
        
        if (!structureMatch) {
          console.log(`         → La estructura es diferente`);
        }
        if (rowCounts.difference !== 0) {
          console.log(`         → Faltan ${Math.abs(rowCounts.difference)} registros en destino`);
        }
        if (!result.latestRecords.match) {
          console.log(`         → Los últimos registros no coinciden`);
        }
      }
    }
    
    // Resumen general
    console.log('\n\n');
    console.log('=' .repeat(100));
    console.log('🎯 RESUMEN GENERAL');
    console.log('=' .repeat(100));
    console.log('');
    console.log(`✅ Tablas migradas correctamente: ${tablesOk}`);
    console.log(`❌ Tablas con problemas:         ${tablesWithIssues}`);
    console.log(`⚠️  Tablas no encontradas:        ${tablesMissing}`);
    console.log('');
    
    if (tablesWithIssues > 0) {
      console.log('⚠️  ACCIÓN REQUERIDA:');
      console.log('   Algunas tablas tienen diferencias entre origen y destino.');
      console.log('   Ejecuta: npm run migrate:to-azure');
      console.log('');
    } else if (tablesOk === tablesToCheck.length) {
      console.log('🎉 ¡EXCELENTE!');
      console.log('   Todas las tablas están correctamente migradas.');
      console.log('   Las bases de datos están sincronizadas.');
      console.log('');
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sourceDb.end();
    await targetDb.end();
    console.log('🔌 Conexiones cerradas');
  }
}

main().catch(console.error);
