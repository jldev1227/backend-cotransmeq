/**
 * Script de prueba para verificar la generación automática de números de planilla
 */

// Simular algunos números de planilla existentes
const recargosTest = [
  { numero_planilla: 'TM-0001' },
  { numero_planilla: 'TM-0002' },
  { numero_planilla: 'TM-0005' },
  { numero_planilla: null },
  { numero_planilla: 'TM-0010' },
  { numero_planilla: 'TM-0003' }
];

console.log('📋 Recargos de prueba:', recargosTest.length);

// Filtrar solo los que tienen numero_planilla y extraer el número
const numerosExistentes = recargosTest
  .filter(r => r.numero_planilla)
  .map(r => {
    // Extraer el número del formato "TM-0001" o similar
    const match = r.numero_planilla.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  })
  .filter(n => !isNaN(n));

console.log('📊 Números existentes:', numerosExistentes);

// Encontrar el número más alto
const ultimoNumero = numerosExistentes.length > 0 
  ? Math.max(...numerosExistentes) 
  : 0;

console.log('🔢 Último número:', ultimoNumero);

// Generar el siguiente número con formato TM-0001
const siguienteNumero = (ultimoNumero + 1).toString().padStart(4, '0');
const nuevaPlanilla = `TM-${siguienteNumero}`;

console.log('✅ Nueva planilla generada:', nuevaPlanilla);

// Casos de prueba adicionales
console.log('\n🧪 Pruebas adicionales:');

// Caso 1: Sin planillas existentes
const recargosVacios = [];
const numeros1 = recargosVacios
  .filter(r => r.numero_planilla)
  .map(r => {
    const match = r.numero_planilla.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  })
  .filter(n => !isNaN(n));
const ultimo1 = numeros1.length > 0 ? Math.max(...numeros1) : 0;
const siguiente1 = (ultimo1 + 1).toString().padStart(4, '0');
console.log('Caso sin planillas:', `TM-${siguiente1}`, '(esperado: TM-0001)');

// Caso 2: Solo null
const recargosNull = [
  { numero_planilla: null },
  { numero_planilla: null }
];
const numeros2 = recargosNull
  .filter(r => r.numero_planilla)
  .map(r => {
    const match = r.numero_planilla.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  })
  .filter(n => !isNaN(n));
const ultimo2 = numeros2.length > 0 ? Math.max(...numeros2) : 0;
const siguiente2 = (ultimo2 + 1).toString().padStart(4, '0');
console.log('Caso solo null:', `TM-${siguiente2}`, '(esperado: TM-0001)');

// Caso 3: Números altos
const recargosAltos = [
  { numero_planilla: 'TM-0099' },
  { numero_planilla: 'TM-0100' },
  { numero_planilla: 'TM-0998' }
];
const numeros3 = recargosAltos
  .filter(r => r.numero_planilla)
  .map(r => {
    const match = r.numero_planilla.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  })
  .filter(n => !isNaN(n));
const ultimo3 = numeros3.length > 0 ? Math.max(...numeros3) : 0;
const siguiente3 = (ultimo3 + 1).toString().padStart(4, '0');
console.log('Caso números altos:', `TM-${siguiente3}`, '(esperado: TM-0999)');

console.log('\n✅ Todas las pruebas completadas');
