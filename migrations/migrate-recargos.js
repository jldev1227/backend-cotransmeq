/**
 * Script de migración de datos de recargos desde MySQL local a Azure PostgreSQL
 * 
 * Tablas a migrar en orden:
 * 1. tipos_recargos
 * 2. configuraciones_salarios
 * 3. recargos_planillas
 * 4. dias_laborales_planillas
 * 5. detalles_recargos_dias
 * 6. historial_recargos_planillas (opcional)
 * 7. snapshots_recargos_planillas (opcional)
 */

const mysql = require('mysql2/promise');
const { Client } = require('pg');
require('dotenv').config();

// Configuración de conexión MySQL (origen)
const mysqlConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'transmeralda_db'
};

// Configuración de conexión PostgreSQL Azure (destino)
const pgConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

// Stats
const stats = {
  tipos_recargos: { total: 0, migrados: 0, errores: 0 },
  configuraciones_salarios: { total: 0, migrados: 0, errores: 0 },
  recargos_planillas: { total: 0, migrados: 0, errores: 0 },
  dias_laborales_planillas: { total: 0, migrados: 0, errores: 0 },
  detalles_recargos_dias: { total: 0, migrados: 0, errores: 0 },
  historial_recargos_planillas: { total: 0, migrados: 0, errores: 0 },
  snapshots_recargos_planillas: { total: 0, migrados: 0, errores: 0 }
};

async function migrarTiposRecargos(mysqlConn, pgClient) {
  console.log('\n📊 Migrando tipos_recargos...');
  
  const [rows] = await mysqlConn.query(`
    SELECT * FROM tipos_recargos 
    WHERE deleted_at IS NULL
    ORDER BY created_at
  `);
  
  stats.tipos_recargos.total = rows.length;
  console.log(`  Total a migrar: ${rows.length}`);
  
  for (const row of rows) {
    try {
      await pgClient.query(`
        INSERT INTO tipos_recargos (
          id, codigo, nombre, descripcion, categoria, subcategoria,
          porcentaje, es_valor_fijo, valor_fijo, aplica_festivos, aplica_domingos,
          aplica_nocturno, aplica_diurno, orden_calculo, es_hora_extra,
          requiere_horas_extras, limite_horas_diarias, activo, vigencia_desde,
          vigencia_hasta, creado_por_id, created_at, updated_at, deleted_at, adicional
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
        )
        ON CONFLICT (id) DO UPDATE SET
          codigo = EXCLUDED.codigo,
          nombre = EXCLUDED.nombre,
          descripcion = EXCLUDED.descripcion,
          porcentaje = EXCLUDED.porcentaje,
          activo = EXCLUDED.activo,
          updated_at = EXCLUDED.updated_at
      `, [
        row.id, row.codigo, row.nombre, row.descripcion, row.categoria, row.subcategoria,
        row.porcentaje, row.es_valor_fijo, row.valor_fijo, row.aplica_festivos, row.aplica_domingos,
        row.aplica_nocturno, row.aplica_diurno, row.orden_calculo, row.es_hora_extra,
        row.requiere_horas_extras, row.limite_horas_diarias, row.activo, row.vigencia_desde,
        row.vigencia_hasta, row.creado_por_id, row.created_at, row.updated_at, row.deleted_at, row.adicional
      ]);
      stats.tipos_recargos.migrados++;
    } catch (error) {
      console.error(`  ❌ Error migrando tipo_recargo ${row.codigo}:`, error.message);
      stats.tipos_recargos.errores++;
    }
  }
  
  console.log(`  ✅ Migrados: ${stats.tipos_recargos.migrados}/${stats.tipos_recargos.total}`);
}

async function migrarConfiguracionesSalarios(mysqlConn, pgClient) {
  console.log('\n💰 Migrando configuraciones_salarios...');
  
  const [rows] = await mysqlConn.query(`
    SELECT * FROM configuraciones_salarios 
    WHERE deleted_at IS NULL
    ORDER BY created_at
  `);
  
  stats.configuraciones_salarios.total = rows.length;
  console.log(`  Total a migrar: ${rows.length}`);
  
  for (const row of rows) {
    try {
      await pgClient.query(`
        INSERT INTO configuraciones_salarios (
          id, empresa_id, salario_basico, valor_hora_trabajador, horas_mensuales_base,
          vigencia_desde, vigencia_hasta, activo, observaciones, creado_por_id,
          created_at, updated_at, deleted_at, paga_dias_festivos, porcentaje_festivos,
          seguridad_social, administracion, prueba_antigeno_covid, prestaciones_sociales, sede
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
        ON CONFLICT (id) DO UPDATE SET
          salario_basico = EXCLUDED.salario_basico,
          valor_hora_trabajador = EXCLUDED.valor_hora_trabajador,
          activo = EXCLUDED.activo,
          updated_at = EXCLUDED.updated_at
      `, [
        row.id, row.empresa_id, row.salario_basico, row.valor_hora_trabajador, row.horas_mensuales_base,
        row.vigencia_desde, row.vigencia_hasta, row.activo, row.observaciones, row.creado_por_id,
        row.created_at, row.updated_at, row.deleted_at, row.paga_dias_festivos, row.porcentaje_festivos,
        row.seguridad_social, row.administracion, row.prueba_antigeno_covid, row.prestaciones_sociales, row.sede
      ]);
      stats.configuraciones_salarios.migrados++;
    } catch (error) {
      console.error(`  ❌ Error migrando configuracion_salario ${row.id}:`, error.message);
      stats.configuraciones_salarios.errores++;
    }
  }
  
  console.log(`  ✅ Migrados: ${stats.configuraciones_salarios.migrados}/${stats.configuraciones_salarios.total}`);
}

async function migrarRecargosPlanillas(mysqlConn, pgClient) {
  console.log('\n📋 Migrando recargos_planillas...');
  
  const [rows] = await mysqlConn.query(`
    SELECT * FROM recargos_planillas 
    WHERE deleted_at IS NULL
    ORDER BY created_at
  `);
  
  stats.recargos_planillas.total = rows.length;
  console.log(`  Total a migrar: ${rows.length}`);
  
  for (const row of rows) {
    try {
      await pgClient.query(`
        INSERT INTO recargos_planillas (
          id, conductor_id, vehiculo_id, empresa_id, numero_planilla, mes, "año",
          total_dias_laborados, total_horas_trabajadas, total_horas_ordinarias,
          archivo_planilla_url, archivo_planilla_nombre, archivo_planilla_tipo,
          "archivo_planilla_tamaño", observaciones, estado, version,
          creado_por_id, actualizado_por_id, created_at, updated_at, deleted_at, planilla_s3key
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
        )
        ON CONFLICT (id) DO UPDATE SET
          numero_planilla = EXCLUDED.numero_planilla,
          total_dias_laborados = EXCLUDED.total_dias_laborados,
          total_horas_trabajadas = EXCLUDED.total_horas_trabajadas,
          estado = EXCLUDED.estado,
          version = EXCLUDED.version,
          updated_at = EXCLUDED.updated_at
      `, [
        row.id, row.conductor_id, row.vehiculo_id, row.empresa_id, row.numero_planilla, row.mes, row.año,
        row.total_dias_laborados, row.total_horas_trabajadas, row.total_horas_ordinarias,
        row.archivo_planilla_url, row.archivo_planilla_nombre, row.archivo_planilla_tipo,
        row.archivo_planilla_tamaño, row.observaciones, row.estado, row.version,
        row.creado_por_id, row.actualizado_por_id, row.created_at, row.updated_at, row.deleted_at, row.planilla_s3key
      ]);
      stats.recargos_planillas.migrados++;
    } catch (error) {
      console.error(`  ❌ Error migrando recargo_planilla ${row.id}:`, error.message);
      stats.recargos_planillas.errores++;
    }
  }
  
  console.log(`  ✅ Migrados: ${stats.recargos_planillas.migrados}/${stats.recargos_planillas.total}`);
}

async function migrarDiasLaboralesPlanillas(mysqlConn, pgClient) {
  console.log('\n📅 Migrando dias_laborales_planillas...');
  
  const [rows] = await mysqlConn.query(`
    SELECT * FROM dias_laborales_planillas 
    WHERE deleted_at IS NULL
    ORDER BY created_at
  `);
  
  stats.dias_laborales_planillas.total = rows.length;
  console.log(`  Total a migrar: ${rows.length}`);
  
  for (const row of rows) {
    try {
      await pgClient.query(`
        INSERT INTO dias_laborales_planillas (
          id, recargo_planilla_id, dia, hora_inicio, hora_fin, total_horas,
          horas_ordinarias, es_festivo, es_domingo, observaciones,
          creado_por_id, actualizado_por_id, created_at, updated_at, deleted_at,
          disponibilidad, kilometraje_inicial, kilometraje_final
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
        ON CONFLICT (id) DO UPDATE SET
          total_horas = EXCLUDED.total_horas,
          horas_ordinarias = EXCLUDED.horas_ordinarias,
          es_festivo = EXCLUDED.es_festivo,
          es_domingo = EXCLUDED.es_domingo,
          updated_at = EXCLUDED.updated_at
      `, [
        row.id, row.recargo_planilla_id, row.dia, row.hora_inicio, row.hora_fin, row.total_horas,
        row.horas_ordinarias, row.es_festivo, row.es_domingo, row.observaciones,
        row.creado_por_id, row.actualizado_por_id, row.created_at, row.updated_at, row.deleted_at,
        row.disponibilidad, row.kilometraje_inicial, row.kilometraje_final
      ]);
      stats.dias_laborales_planillas.migrados++;
    } catch (error) {
      console.error(`  ❌ Error migrando dia_laboral ${row.id}:`, error.message);
      stats.dias_laborales_planillas.errores++;
    }
  }
  
  console.log(`  ✅ Migrados: ${stats.dias_laborales_planillas.migrados}/${stats.dias_laborales_planillas.total}`);
}

async function migrarDetallesRecargosDias(mysqlConn, pgClient) {
  console.log('\n🔢 Migrando detalles_recargos_dias...');
  
  const [rows] = await mysqlConn.query(`
    SELECT * FROM detalles_recargos_dias 
    WHERE deleted_at IS NULL
    ORDER BY created_at
  `);
  
  stats.detalles_recargos_dias.total = rows.length;
  console.log(`  Total a migrar: ${rows.length}`);
  
  for (const row of rows) {
    try {
      await pgClient.query(`
        INSERT INTO detalles_recargos_dias (
          id, dia_laboral_id, tipo_recargo_id, horas, valor_hora_base, valor_calculado,
          observaciones, calculado_automaticamente, activo, version,
          creado_por_id, actualizado_por_id, created_at, updated_at, deleted_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        ON CONFLICT (id) DO UPDATE SET
          horas = EXCLUDED.horas,
          valor_hora_base = EXCLUDED.valor_hora_base,
          valor_calculado = EXCLUDED.valor_calculado,
          activo = EXCLUDED.activo,
          updated_at = EXCLUDED.updated_at
      `, [
        row.id, row.dia_laboral_id, row.tipo_recargo_id, row.horas, row.valor_hora_base, row.valor_calculado,
        row.observaciones, row.calculado_automaticamente, row.activo, row.version,
        row.creado_por_id, row.actualizado_por_id, row.created_at, row.updated_at, row.deleted_at
      ]);
      stats.detalles_recargos_dias.migrados++;
    } catch (error) {
      console.error(`  ❌ Error migrando detalle_recargo ${row.id}:`, error.message);
      stats.detalles_recargos_dias.errores++;
    }
  }
  
  console.log(`  ✅ Migrados: ${stats.detalles_recargos_dias.migrados}/${stats.detalles_recargos_dias.total}`);
}

async function migrarHistorialRecargosPlanillas(mysqlConn, pgClient) {
  console.log('\n📜 Migrando historial_recargos_planillas...');
  
  const [rows] = await mysqlConn.query(`
    SELECT * FROM historial_recargos_planillas 
    ORDER BY created_at
  `);
  
  stats.historial_recargos_planillas.total = rows.length;
  console.log(`  Total a migrar: ${rows.length}`);
  
  for (const row of rows) {
    try {
      await pgClient.query(`
        INSERT INTO historial_recargos_planillas (
          id, recargo_planilla_id, accion, version_anterior, version_nueva,
          datos_anteriores, datos_nuevos, campos_modificados, motivo,
          ip_usuario, user_agent, realizado_por_id, fecha_accion
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        row.id, row.recargo_planilla_id, row.accion, row.version_anterior, row.version_nueva,
        row.datos_anteriores, row.datos_nuevos, row.campos_modificados, row.motivo,
        row.ip_usuario, row.user_agent, row.realizado_por_id, row.fecha_accion
      ]);
      stats.historial_recargos_planillas.migrados++;
    } catch (error) {
      console.error(`  ❌ Error migrando historial ${row.id}:`, error.message);
      stats.historial_recargos_planillas.errores++;
    }
  }
  
  console.log(`  ✅ Migrados: ${stats.historial_recargos_planillas.migrados}/${stats.historial_recargos_planillas.total}`);
}

async function migrarSnapshotsRecargosPlanillas(mysqlConn, pgClient) {
  console.log('\n📸 Migrando snapshots_recargos_planillas...');
  
  const [rows] = await mysqlConn.query(`
    SELECT * FROM snapshots_recargos_planillas 
    ORDER BY created_at
  `);
  
  stats.snapshots_recargos_planillas.total = rows.length;
  console.log(`  Total a migrar: ${rows.length}`);
  
  for (const row of rows) {
    try {
      await pgClient.query(`
        INSERT INTO snapshots_recargos_planillas (
          id, recargo_planilla_id, version, snapshot_completo, es_snapshot_mayor,
          tipo_snapshot, "tamaño_bytes", creado_por_id, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        ON CONFLICT (id) DO NOTHING
      `, [
        row.id, row.recargo_planilla_id, row.version, row.snapshot_completo, row.es_snapshot_mayor,
        row.tipo_snapshot, row.tamaño_bytes, row.creado_por_id, row.created_at
      ]);
      stats.snapshots_recargos_planillas.migrados++;
    } catch (error) {
      console.error(`  ❌ Error migrando snapshot ${row.id}:`, error.message);
      stats.snapshots_recargos_planillas.errores++;
    }
  }
  
  console.log(`  ✅ Migrados: ${stats.snapshots_recargos_planillas.migrados}/${stats.snapshots_recargos_planillas.total}`);
}

async function main() {
  console.log('🚀 Iniciando migración de datos de recargos...\n');
  console.log('Origen: MySQL', mysqlConfig.host);
  console.log('Destino: PostgreSQL Azure\n');
  
  let mysqlConn;
  let pgClient;
  
  try {
    // Conectar a MySQL (origen)
    console.log('📡 Conectando a MySQL...');
    mysqlConn = await mysql.createConnection(mysqlConfig);
    console.log('✅ Conectado a MySQL');
    
    // Conectar a PostgreSQL (destino)
    console.log('📡 Conectando a PostgreSQL Azure...');
    pgClient = new Client(pgConfig);
    await pgClient.connect();
    console.log('✅ Conectado a PostgreSQL Azure');
    
    // Ejecutar migraciones en orden
    await migrarTiposRecargos(mysqlConn, pgClient);
    await migrarConfiguracionesSalarios(mysqlConn, pgClient);
    await migrarRecargosPlanillas(mysqlConn, pgClient);
    await migrarDiasLaboralesPlanillas(mysqlConn, pgClient);
    await migrarDetallesRecargosDias(mysqlConn, pgClient);
    await migrarHistorialRecargosPlanillas(mysqlConn, pgClient);
    await migrarSnapshotsRecargosPlanillas(mysqlConn, pgClient);
    
    // Mostrar resumen
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DE MIGRACIÓN');
    console.log('='.repeat(60));
    
    Object.entries(stats).forEach(([tabla, data]) => {
      const emoji = data.errores === 0 ? '✅' : '⚠️';
      console.log(`${emoji} ${tabla.padEnd(35)} ${data.migrados}/${data.total} (errores: ${data.errores})`);
    });
    
    console.log('='.repeat(60));
    console.log('\n✅ Migración completada!\n');
    
  } catch (error) {
    console.error('\n❌ Error fatal en la migración:', error);
    process.exit(1);
  } finally {
    // Cerrar conexiones
    if (mysqlConn) {
      await mysqlConn.end();
      console.log('🔌 Conexión MySQL cerrada');
    }
    if (pgClient) {
      await pgClient.end();
      console.log('🔌 Conexión PostgreSQL cerrada');
    }
  }
}

// Ejecutar migración
main();
