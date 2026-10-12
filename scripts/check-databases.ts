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

// Base de datos ORIGEN (la actual)
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

const tablesToCheck = [
  'usuarios',
  'conductores',
  'vehiculos',
  'clientes',
  'servicio',
  'liquidaciones',
  'municipios',
  'recargos_planillas',
  'dias_laborales_planillas'
];

interface TableStats {
  table: string;
  sourceCount: number;
  targetCount: number;
  difference: number;
}

async function getTableCount(client: Client, tableName: string): Promise<number> {
  try {
    const result = await client.query(`SELECT COUNT(*) as count FROM "${tableName}"`);
    return parseInt(result.rows[0].count);
  } catch (error) {
    return -1; // Tabla no existe
  }
}

async function main() {
  try {
    console.log('🔍 Verificando conexiones y contando registros...\n');
    
    // Conectar a ambas bases de datos
    console.log('📡 Conectando a base de datos ORIGEN...');
    await sourceDb.connect();
    console.log('✅ Conectado a ORIGEN\n');
    
    console.log('📡 Conectando a base de datos DESTINO (Azure)...');
    await targetDb.connect();
    console.log('✅ Conectado a DESTINO (Azure)\n');
    
    console.log('📊 Contando registros en ambas bases de datos...\n');
    console.log('='.repeat(80));
    console.log('TABLA'.padEnd(35) + 'ORIGEN'.padEnd(15) + 'DESTINO'.padEnd(15) + 'DIFERENCIA');
    console.log('='.repeat(80));
    
    const stats: TableStats[] = [];
    
    for (const tableName of tablesToCheck) {
      const sourceCount = await getTableCount(sourceDb, tableName);
      const targetCount = await getTableCount(targetDb, tableName);
      
      const stat: TableStats = {
        table: tableName,
        sourceCount,
        targetCount,
        difference: sourceCount - targetCount
      };
      
      stats.push(stat);
      
      const sourceStr = sourceCount === -1 ? 'N/A' : sourceCount.toString();
      const targetStr = targetCount === -1 ? 'N/A' : targetCount.toString();
      const diffStr = sourceCount === -1 || targetCount === -1 
        ? 'N/A' 
        : stat.difference === 0 
          ? '✅ IGUAL'
          : `⚠️  ${stat.difference > 0 ? '+' : ''}${stat.difference}`;
      
      console.log(
        tableName.padEnd(35) + 
        sourceStr.padEnd(15) + 
        targetStr.padEnd(15) + 
        diffStr
      );
    }
    
    console.log('='.repeat(80));
    
    // Resumen
    const totalSource = stats.filter(s => s.sourceCount > 0).reduce((sum, s) => sum + s.sourceCount, 0);
    const totalTarget = stats.filter(s => s.targetCount > 0).reduce((sum, s) => sum + s.targetCount, 0);
    const tablesWithDifferences = stats.filter(s => s.difference !== 0 && s.sourceCount !== -1 && s.targetCount !== -1).length;
    
    console.log('\n📈 RESUMEN:');
    console.log(`   Total registros en ORIGEN: ${totalSource.toLocaleString()}`);
    console.log(`   Total registros en DESTINO: ${totalTarget.toLocaleString()}`);
    console.log(`   Tablas con diferencias: ${tablesWithDifferences}`);
    
    if (tablesWithDifferences > 0) {
      console.log('\n⚠️  Hay diferencias entre las bases de datos.');
      console.log('   Considera ejecutar la migración: npm run migrate:to-azure');
    } else {
      console.log('\n✅ Las bases de datos están sincronizadas!');
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await sourceDb.end();
    await targetDb.end();
    console.log('\n🔌 Conexiones cerradas\n');
  }
}

main().catch(console.error);
