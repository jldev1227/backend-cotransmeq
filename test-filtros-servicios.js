/**
 * Script de prueba para validar los filtros del endpoint de servicios
 * 
 * Prueba los siguientes filtros:
 * - conductor_id
 * - vehiculo_id
 * - cliente_id
 * - Combinaciones (conductor + cliente, vehiculo + conductor + cliente)
 * - fecha_desde y fecha_hasta (especificando qué campo de fecha usar)
 * - estado
 * - search
 * - orderBy y orderDirection
 */

const BASE_URL = 'http://localhost:4000/api';

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(testName) {
  console.log('\n' + '='.repeat(80));
  log(`TEST: ${testName}`, 'cyan');
  console.log('='.repeat(80));
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

async function makeRequest(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${endpoint}${queryString ? '?' + queryString : ''}`;
  
  logInfo(`Request: ${url}`);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (!response.ok) {
      logError(`HTTP ${response.status}: ${JSON.stringify(data)}`);
      return null;
    }
    
    return data;
  } catch (error) {
    logError(`Error en request: ${error.message}`);
    return null;
  }
}

function validateResults(data, expectedConditions, testName) {
  if (!data || !data.success) {
    logError(`${testName}: Respuesta no exitosa`);
    return false;
  }

  const servicios = data.data;
  
  if (!Array.isArray(servicios)) {
    logError(`${testName}: data.data no es un array`);
    return false;
  }

  if (servicios.length === 0) {
    logWarning(`${testName}: No se encontraron resultados`);
    return true;
  }

  logSuccess(`${testName}: ${servicios.length} servicios encontrados`);
  
  // Validar condiciones específicas
  let allValid = true;
  
  servicios.forEach((servicio, index) => {
    for (const [field, expectedValue] of Object.entries(expectedConditions)) {
      if (field === 'fecha_desde' || field === 'fecha_hasta') continue; // Se validan aparte
      
      const actualValue = servicio[field];
      
      if (expectedValue && actualValue !== expectedValue) {
        logError(`Servicio ${index + 1}: ${field} = "${actualValue}", esperado "${expectedValue}"`);
        allValid = false;
      }
    }
    
    // Validar fechas si están especificadas
    if (expectedConditions.fecha_desde || expectedConditions.fecha_hasta) {
      const campoFecha = expectedConditions.campo_fecha || 'fecha_solicitud';
      const fechaServicio = new Date(servicio[campoFecha]);
      
      if (expectedConditions.fecha_desde) {
        const fechaDesde = new Date(expectedConditions.fecha_desde);
        if (fechaServicio < fechaDesde) {
          logError(`Servicio ${index + 1}: ${campoFecha} (${fechaServicio.toISOString()}) es menor que fecha_desde (${fechaDesde.toISOString()})`);
          allValid = false;
        }
      }
      
      if (expectedConditions.fecha_hasta) {
        const fechaHasta = new Date(expectedConditions.fecha_hasta);
        if (fechaServicio > fechaHasta) {
          logError(`Servicio ${index + 1}: ${campoFecha} (${fechaServicio.toISOString()}) es mayor que fecha_hasta (${fechaHasta.toISOString()})`);
          allValid = false;
        }
      }
    }
  });
  
  if (allValid) {
    logSuccess(`${testName}: Todos los resultados cumplen las condiciones`);
  }
  
  return allValid;
}

async function obtenerDatosPrueba() {
  logTest('OBTENIENDO DATOS DE PRUEBA');
  
  // Obtener servicios para extraer IDs reales
  const servicios = await makeRequest('/servicios', { limit: 5 });
  
  if (!servicios || servicios.data.length === 0) {
    logError('No hay servicios en la base de datos para hacer pruebas');
    return null;
  }
  
  const primerServicio = servicios.data[0];
  
  const datos = {
    conductor_id: primerServicio.conductor_id || primerServicio.conductores?.id,
    vehiculo_id: primerServicio.vehiculo_id || primerServicio.vehiculos?.id,
    cliente_id: primerServicio.cliente_id || primerServicio.clientes?.id,
    estado: primerServicio.estado,
    fecha_solicitud: primerServicio.fecha_solicitud
  };
  
  logSuccess('Datos de prueba obtenidos:');
  console.log(JSON.stringify(datos, null, 2));
  
  return datos;
}

async function runTests() {
  log('\n🧪 INICIANDO PRUEBAS DE FILTROS DE SERVICIOS', 'bright');
  log('================================================\n', 'bright');
  
  const datosPrueba = await obtenerDatosPrueba();
  
  if (!datosPrueba) {
    logError('No se pudieron obtener datos de prueba. Abortando...');
    return;
  }
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // TEST 1: Filtrar por conductor
  logTest('1. Filtrar por conductor_id');
  if (datosPrueba.conductor_id) {
    const result = await makeRequest('/servicios', { 
      conductor_id: datosPrueba.conductor_id,
      limit: 50
    });
    
    if (validateResults(result, { conductor_id: datosPrueba.conductor_id }, 'Filtro conductor')) {
      testsPassed++;
    } else {
      testsFailed++;
    }
  } else {
    logWarning('No hay conductor_id disponible para probar');
  }
  
  // TEST 2: Filtrar por cliente
  logTest('2. Filtrar por cliente_id');
  if (datosPrueba.cliente_id) {
    const result = await makeRequest('/servicios', { 
      cliente_id: datosPrueba.cliente_id,
      limit: 50
    });
    
    if (validateResults(result, { cliente_id: datosPrueba.cliente_id }, 'Filtro cliente')) {
      testsPassed++;
    } else {
      testsFailed++;
    }
  } else {
    logWarning('No hay cliente_id disponible para probar');
  }
  
  // TEST 3: Filtrar por vehículo
  logTest('3. Filtrar por vehiculo_id');
  if (datosPrueba.vehiculo_id) {
    const result = await makeRequest('/servicios', { 
      vehiculo_id: datosPrueba.vehiculo_id,
      limit: 50
    });
    
    if (validateResults(result, { vehiculo_id: datosPrueba.vehiculo_id }, 'Filtro vehículo')) {
      testsPassed++;
    } else {
      testsFailed++;
    }
  } else {
    logWarning('No hay vehiculo_id disponible para probar');
  }
  
  // TEST 4: Filtrar por conductor + cliente
  logTest('4. Filtrar por conductor_id + cliente_id');
  if (datosPrueba.conductor_id && datosPrueba.cliente_id) {
    const result = await makeRequest('/servicios', { 
      conductor_id: datosPrueba.conductor_id,
      cliente_id: datosPrueba.cliente_id,
      limit: 50
    });
    
    if (validateResults(result, { 
      conductor_id: datosPrueba.conductor_id,
      cliente_id: datosPrueba.cliente_id 
    }, 'Filtro conductor + cliente')) {
      testsPassed++;
    } else {
      testsFailed++;
    }
  } else {
    logWarning('No hay datos suficientes para probar combinación conductor + cliente');
  }
  
  // TEST 5: Filtrar por vehículo + conductor + cliente
  logTest('5. Filtrar por vehiculo_id + conductor_id + cliente_id');
  if (datosPrueba.vehiculo_id && datosPrueba.conductor_id && datosPrueba.cliente_id) {
    const result = await makeRequest('/servicios', { 
      vehiculo_id: datosPrueba.vehiculo_id,
      conductor_id: datosPrueba.conductor_id,
      cliente_id: datosPrueba.cliente_id,
      limit: 50
    });
    
    if (validateResults(result, { 
      vehiculo_id: datosPrueba.vehiculo_id,
      conductor_id: datosPrueba.conductor_id,
      cliente_id: datosPrueba.cliente_id 
    }, 'Filtro vehículo + conductor + cliente')) {
      testsPassed++;
    } else {
      testsFailed++;
    }
  } else {
    logWarning('No hay datos suficientes para probar combinación completa');
  }
  
  // TEST 6: Filtrar por estado
  logTest('6. Filtrar por estado');
  if (datosPrueba.estado) {
    const result = await makeRequest('/servicios', { 
      estado: datosPrueba.estado,
      limit: 50
    });
    
    if (validateResults(result, { estado: datosPrueba.estado }, 'Filtro estado')) {
      testsPassed++;
    } else {
      testsFailed++;
    }
  }
  
  // TEST 7: Filtrar por rango de fechas (fecha_solicitud)
  logTest('7. Filtrar por fecha_desde y fecha_hasta (fecha_solicitud)');
  const fechaHoy = new Date();
  const fechaHace30Dias = new Date();
  fechaHace30Dias.setDate(fechaHace30Dias.getDate() - 30);
  
  const result7 = await makeRequest('/servicios', { 
    fecha_desde: fechaHace30Dias.toISOString(),
    fecha_hasta: fechaHoy.toISOString(),
    campo_fecha: 'fecha_solicitud',
    limit: 50
  });
  
  if (validateResults(result7, { 
    fecha_desde: fechaHace30Dias.toISOString(),
    fecha_hasta: fechaHoy.toISOString(),
    campo_fecha: 'fecha_solicitud'
  }, 'Filtro rango de fechas')) {
    testsPassed++;
  } else {
    testsFailed++;
  }
  
  // TEST 8: Búsqueda por texto
  logTest('8. Búsqueda por texto (search)');
  const result8 = await makeRequest('/servicios', { 
    search: 'cali',
    limit: 50
  });
  
  if (result8 && result8.success) {
    logSuccess('Búsqueda por texto ejecutada correctamente');
    testsPassed++;
  } else {
    logError('Búsqueda por texto falló');
    testsFailed++;
  }
  
  // TEST 9: Ordenamiento
  logTest('9. Ordenamiento por fecha_solicitud DESC');
  const result9 = await makeRequest('/servicios', { 
    orderBy: 'fecha_solicitud',
    orderDirection: 'desc',
    limit: 10
  });
  
  if (result9 && result9.success && result9.data.length > 1) {
    const primeraFecha = new Date(result9.data[0].fecha_solicitud);
    const segundaFecha = new Date(result9.data[1].fecha_solicitud);
    
    if (primeraFecha >= segundaFecha) {
      logSuccess('Ordenamiento DESC correcto');
      testsPassed++;
    } else {
      logError('Ordenamiento DESC incorrecto');
      testsFailed++;
    }
  } else {
    logWarning('No hay suficientes datos para validar ordenamiento');
  }
  
  // TEST 10: Ordenamiento por cliente
  logTest('10. Ordenamiento por cliente (relación anidada)');
  const result10 = await makeRequest('/servicios', { 
    orderBy: 'cliente',
    orderDirection: 'asc',
    limit: 10
  });
  
  if (result10 && result10.success) {
    logSuccess('Ordenamiento por cliente ejecutado correctamente');
    testsPassed++;
  } else {
    logError('Ordenamiento por cliente falló');
    testsFailed++;
  }
  
  // RESUMEN
  console.log('\n' + '='.repeat(80));
  log('RESUMEN DE PRUEBAS', 'bright');
  console.log('='.repeat(80));
  logSuccess(`Tests pasados: ${testsPassed}`);
  if (testsFailed > 0) {
    logError(`Tests fallidos: ${testsFailed}`);
  }
  log(`Total: ${testsPassed + testsFailed}`, 'cyan');
  console.log('='.repeat(80) + '\n');
}

// Ejecutar tests
runTests().catch(console.error);
